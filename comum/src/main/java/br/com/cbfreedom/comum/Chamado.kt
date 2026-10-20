package br.com.cbfreedom.comum

import android.app.Notification
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Ações num chamado feitas pelo app (sem abrir o site), com os mesmos endereços que o site usa:
 * histórico (GET /timeline), responder (POST /messages), assumir (POST /take), status/prioridade/
 * responsável/setor (PATCH), pedir/aceitar/rejeitar conclusão (POST /solution...) e anexos.
 */
object Chamado {

    class Resultado(val ok: Boolean, val mensagem: String, val dados: JSONObject? = null)

    // códigos de erro do site -> texto (os mesmos que o site mostra)
    private val ERROS = mapOf(
        "helpdesk_ticket_already_assigned" to "Este chamado já foi assumido por outro atendente.",
        "stale_ticket_version" to "O chamado foi alterado por outro usuário. Tente de novo.",
        "helpdesk_forbidden" to "Seu acesso de atendimento não está disponível.",
        "resolved_helpdesk_ticket" to "Este chamado já foi resolvido.",
        "invalid_ticket_transition" to "Esta alteração de status não está mais disponível.",
        "invalid_helpdesk_assignee" to "O responsável escolhido não pode atender este chamado.",
        "inactive_helpdesk_queue" to "O setor de destino não está disponível."
    )

    /** Chama o site com a sessão guardada; se ela venceu, entra de novo com o login do app e repete. */
    private fun chamar(c: Context, metodo: String, caminho: String, corpo: JSONObject?): Pair<Int, String> {
        val login = Store.login(c) ?: throw ErroLogin("faça o login no app")
        val hp = Helpdesk.prefs(c)
        var api = Api(login.first, login.second, hp.getString("cookie", "") ?: "")
        if (api.cookie.isEmpty()) { api.entrar(); hp.edit().putString("cookie", api.cookie).apply() }
        var r = api.enviar(metodo, caminho, corpo)
        if (r.first == 401) {
            api = Api(login.first, login.second)
            api.entrar()
            hp.edit().putString("cookie", api.cookie).apply()
            r = api.enviar(metodo, caminho, corpo)
        }
        return r
    }

    /**
     * Requisição genérica das telas do app (lista, abrir chamado...). Só deixa passar endereços do Helpdesk.
     * Devolve (código HTTP, corpo); código 0 = não conseguiu falar com o site.
     */
    fun requisicao(c: Context, metodo: String, caminho: String, corpo: String): Pair<Int, String> {
        val m = metodo.uppercase()
        if (m !in setOf("GET", "POST", "PATCH", "PUT", "DELETE")) return Pair(0, "método não permitido")
        if (!permitido(m, caminho)) return Pair(0, "endereço não permitido")
        return try {
            val json = if (corpo.isBlank()) null else JSONObject(corpo)
            val r = chamar(c, m, caminho, json)
            if (m == "GET" && r.first == 200) Fila.guardar(c, "GET $caminho", r.second)
            r
        } catch (e: Exception) {
            if (Fila.semInternet(c, e)) {
                // sem internet: consulta -> mostra a última resposta guardada; chamado novo -> guarda para enviar depois
                if (m == "GET") Fila.guardado(c, "GET $caminho")?.let { g ->
                    return Pair(299, JSONObject().put("_offline", g.first).put("_corpo", g.second).toString())
                }
                if (m == "POST" && caminho == "/helpdesk/tickets" && corpo.isNotBlank()) {
                    Fila.adicionarChamado(c, corpo)
                    return Pair(202, JSONObject().put("_fila", true).toString())
                }
            }
            Pair(0, "Sem conexão com o site: " + Api.mensagem(e))
        }
    }

    // Gravações que as telas do app podem fazer no site: só estas (as mesmas que o site faz na Logística e na Administração).
    private val ESCRITAS = listOf(
        "PUT" to Regex("^/logistics/pending/orders/[^/]+/control$"),
        "POST" to Regex("^/logistics/standby/selections$"),
        "PUT" to Regex("^/logistics/standby/selections/\\d+$"),
        "DELETE" to Regex("^/logistics/standby/selections/\\d+$"),
        "POST" to Regex("^/logistics/report/snapshots$"),
        "POST" to Regex("^/logistics/report/products$"),
        "PUT" to Regex("^/logistics/report/products/\\d+$"),
        "DELETE" to Regex("^/logistics/report/products/\\d+$"),
        "POST" to Regex("^/logistics/billing/report/exclusions/(orders|customers|order-types)$"),
        "DELETE" to Regex("^/logistics/billing/report/exclusions/(orders|customers|order-types)/[^/]+$"),
        "POST" to Regex("^/logistics/billing/daily/exclusions/(customers|order-types)$"),
        "DELETE" to Regex("^/logistics/billing/daily/exclusions/(customers|order-types)/[^/]+$"),
        "POST" to Regex("^/admin/users$"),
        "PATCH" to Regex("^/admin/users/[^/]+$"),
        "POST" to Regex("^/admin/users/[^/]+/(activate|deactivate|reset-password)$")
    )

    /** Helpdesk como antes; consultas de dashboards/Logística/Administração; e só as gravações da lista acima. */
    fun permitido(m: String, caminho: String): Boolean {
        if (caminho.contains("..") || !caminho.startsWith("/")) return false
        val p = caminho.substringBefore('?')
        if (p.startsWith("/helpdesk/admin/")) return m in setOf("GET", "POST", "PATCH", "PUT", "DELETE")   // Administração do Helpdesk (o site confere quem pode)
        if (p.startsWith("/helpdesk/")) return m in setOf("GET", "POST", "PATCH")
        if (m == "GET") return p == "/auth/me" || p.startsWith("/dashboard/") || p.startsWith("/logistics/") ||
            p.startsWith("/admin/users") || p.startsWith("/admin/audit") || p.startsWith("/admin/firebird-mappings")
        return ESCRITAS.any { it.first == m && it.second.matches(p) }
    }

    /** Exportar Excel (POST /exports, igual ao site). Só relatórios do Comercial. Devolve (código, bytes, nome do arquivo). */
    fun exportar(c: Context, corpo: String): Triple<Int, ByteArray, String> {
        val json = JSONObject(corpo)
        if (!json.optString("report").matches(Regex("^(clients|bonuses|daily_evolution|managers|networks|overview|products|sellers)$"))) return Triple(0, ByteArray(0), "")
        val login = Store.login(c) ?: throw ErroLogin("faça o login no app")
        val hp = Helpdesk.prefs(c)
        var api = Api(login.first, login.second, hp.getString("cookie", "") ?: "")
        if (api.cookie.isEmpty()) { api.entrar(); hp.edit().putString("cookie", api.cookie).apply() }
        var r = api.baixarPost("/exports", json, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if (r.first == 401) { api = Api(login.first, login.second); api.entrar(); hp.edit().putString("cookie", api.cookie).apply(); r = api.baixarPost("/exports", json, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }
        return Triple(r.first, r.second, nomeArquivo(r.third, json.optString("report")))
    }

    /** Nome do arquivo que o site mandou (Content-Disposition) ou Freedom_{relatório}.xlsx. */
    fun nomeArquivo(disp: String, report: String): String {
        var n = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(disp)?.groupValues?.get(1)?.let { try { java.net.URLDecoder.decode(it, "UTF-8") } catch (_: Exception) { it } }
        if (n.isNullOrBlank()) n = Regex("filename=\"([^\"]+)\"", RegexOption.IGNORE_CASE).find(disp)?.groupValues?.get(1)
        if (n.isNullOrBlank()) n = "Freedom_$report.xlsx"
        return n.replace(Regex("[\\\\/:*?\"<>|]"), "_")
    }

    /** Usado pela fila: (código, corpo) ou null se continua sem internet. */
    fun requisicaoDireta(c: Context, metodo: String, caminho: String, corpo: String): Pair<Int, String>? = try {
        chamar(c, metodo, caminho, if (corpo.isBlank()) null else JSONObject(corpo))
    } catch (e: Exception) { if (Fila.semInternet(c, e)) null else Pair(0, Api.mensagem(e)) }

    private fun erro(cod: Int, corpo: String, padrao: String): String {
        val det = try { JSONObject(corpo).opt("detail") } catch (_: Exception) { null }
        val codigo = (det as? String) ?: (det as? JSONObject)?.optString("code") ?: ""
        ERROS[codigo]?.let { return it }
        return when (cod) {
            403, 404 -> "Você não tem (mais) acesso a este chamado."
            409 -> if (codigo.isNotEmpty() && codigo.contains("resolved")) "Este chamado já foi resolvido." else "Este chamado não aceita essa ação agora."
            else -> padrao + " (HTTP $cod)"
        }
    }

    fun historico(c: Context, id: Int): Resultado = try {
        val r = chamar(c, "GET", "/helpdesk/tickets/$id/timeline", null)
        if (r.first == 200) {
            Fila.guardar(c, "timeline $id", r.second)
            Resultado(true, "", JSONObject(r.second).put("pendentes", Fila.doChamado(c, id)))
        }
        else Resultado(false, erro(r.first, r.second, "Não consegui abrir o chamado"))
    } catch (e: Exception) {
        val g = if (Fila.semInternet(c, e)) Fila.guardado(c, "timeline $id") else null
        if (g != null) Resultado(true, "offline:" + g.first, JSONObject(g.second).put("pendentes", Fila.doChamado(c, id)).put("_offline", g.first))
        else Resultado(false, "Não consegui abrir o chamado: " + Api.mensagem(e))
    }

    class Envio(val ok: Boolean, val mensagem: String, val semInternet: Boolean)

    /** Envia de verdade (usado também pela fila quando a internet volta). */
    fun responderAgora(c: Context, id: Int, t: String): Envio = try {
        val r = chamar(c, "POST", "/helpdesk/tickets/$id/messages", JSONObject().put("body", t))
        if (r.first in 200..299) { depois(c, id); Envio(true, "Resposta enviada", false) }
        else Envio(false, erro(r.first, r.second, "Não consegui enviar a resposta"), false)
    } catch (e: Exception) { Envio(false, "Não consegui enviar: " + Api.mensagem(e), Fila.semInternet(c, e)) }

    fun responder(c: Context, id: Int, texto: String): Resultado {
        val t = texto.trim()
        if (t.isEmpty()) return Resultado(false, "Escreva uma mensagem antes de enviar.")
        if (t.length > 10_000) return Resultado(false, "A mensagem passou de 10.000 caracteres.")
        val r = responderAgora(c, id, t)
        if (r.semInternet) {
            Fila.adicionarResposta(c, id, t)
            return Resultado(true, "Sem internet: a resposta foi guardada e vai ser enviada sozinha quando a internet voltar.")
        }
        return Resultado(r.ok, r.mensagem)
    }

    fun assumir(c: Context, id: Int): Resultado = operar(c, id, "assumir", null)

    /**
     * Operações de atendimento, iguais às do site (cada uma manda a "versão" do chamado para não
     * sobrescrever mudança de outra pessoa; se ficou velha, busca de novo e tenta uma vez mais):
     *  assumir · status · prioridade · responsavel · setor · solucao (pedir conclusão) ·
     *  aceitar (confirmar conclusão) · rejeitar (com motivo)
     */
    fun operar(c: Context, id: Int, tipo: String, valor: String?): Resultado {
        val v = valor?.trim() ?: ""
        try {
            for (tentativa in 0..1) {
                val h = historico(c, id)
                if (!h.ok) return h
                val d = h.dados ?: return Resultado(false, "Resposta inesperada do site.")
                val tk = d.optJSONObject("ticket") ?: return Resultado(false, "Resposta inesperada do site.")
                val cap = d.optJSONObject("capabilities") ?: JSONObject()
                val versao = tk.optInt("version")
                val corpo = JSONObject().put("version", versao)
                val (metodo, caminho, ok) = when (tipo) {
                    "assumir" -> {
                        if (!cap.optBoolean("can_take", false))
                            return Resultado(false, if (tk.isNull("assignee_user_id")) "Você não pode assumir este chamado." else "Este chamado já tem responsável.")
                        Triple("POST", "take", "Chamado assumido")
                    }
                    "status" -> {
                        if (!cap.optBoolean("can_change_status", false)) return Resultado(false, "Você não pode alterar o status deste chamado.")
                        corpo.put("status", v); Triple("PATCH", "status", "Status alterado para " + Engine.statusLabel(v))
                    }
                    "prioridade" -> {
                        if (!cap.optBoolean("can_change_priority", false)) return Resultado(false, "Você não pode alterar a prioridade.")
                        corpo.put("priority", v); Triple("PATCH", "priority", "Prioridade alterada")
                    }
                    "responsavel" -> {
                        if (!cap.optBoolean("can_change_assignee", false)) return Resultado(false, "Você não pode trocar o responsável.")
                        corpo.put("assignee_user_id", v.toIntOrNull() ?: JSONObject.NULL)
                        Triple("PATCH", "assignee", if (v.isEmpty()) "Chamado ficou sem responsável" else "Responsável alterado")
                    }
                    "setor" -> {
                        if (!cap.optBoolean("can_transfer", false)) return Resultado(false, "Você não pode transferir este chamado.")
                        val q = v.toIntOrNull() ?: return Resultado(false, "Escolha o setor de destino.")
                        corpo.put("queue_id", q); Triple("PATCH", "queue", "Chamado transferido")
                    }
                    "transferirResp" -> {   // valor: "id\nmotivo" — o setor do chamado não muda, a pessoa ganha acesso só a ele
                        if (!cap.optBoolean("can_transfer_assignee", false)) return Resultado(false, "Você não pode transferir o responsável.")
                        val pid = v.substringBefore('\n').toIntOrNull() ?: return Resultado(false, "Escolha o novo responsável.")
                        val mot = v.substringAfter('\n', "").trim()
                        if (mot.length < 3) return Resultado(false, "Escreva o motivo do encaminhamento.")
                        corpo.put("assignee_user_id", pid).put("reason", mot); Triple("PATCH", "assignee-transfer", "Responsável transferido")
                    }
                    "solucao" -> {
                        if (!cap.optBoolean("can_propose_solution", false)) return Resultado(false, "Você não pode pedir a conclusão deste chamado.")
                        if (v.isEmpty()) return Resultado(false, "Escreva a solução antes de enviar.")
                        corpo.put("solution", v); Triple("POST", "solution", "Solução enviada para aprovação")
                    }
                    "aceitar" -> {
                        if (!cap.optBoolean("can_review_solution", false)) return Resultado(false, "Você não pode aprovar esta solução.")
                        Triple("POST", "solution/accept", "Solução aceita · chamado concluído")
                    }
                    "rejeitar" -> {
                        if (!cap.optBoolean("can_review_solution", false)) return Resultado(false, "Você não pode rejeitar esta solução.")
                        if (v.isEmpty()) return Resultado(false, "Escreva o motivo da rejeição.")
                        corpo.put("reason", v); Triple("POST", "solution/reject", "Solução rejeitada")
                    }
                    else -> return Resultado(false, "Ação desconhecida.")
                }
                val r = chamar(c, metodo, "/helpdesk/tickets/$id/$caminho", corpo)
                if (r.first in 200..299) { depois(c, id); return Resultado(true, ok) }
                // versão antiga (alguém mexeu no meio-tempo): busca de novo uma vez
                if (r.first == 409 && tentativa == 0 && r.second.contains("stale")) continue
                return Resultado(false, erro(r.first, r.second, "Não consegui concluir"))
            }
            return Resultado(false, "O chamado mudou enquanto eu tentava. Tente de novo.")
        } catch (e: Exception) {
            return Resultado(false, "Não consegui concluir: " + Api.mensagem(e))
        }
    }

    // ---------------- anexos ----------------

    /** Lista de anexos do chamado (id, original_filename, size_bytes, uploaded_by_name, created_at). */
    fun anexos(c: Context, id: Int): Resultado = try {
        val r = chamar(c, "GET", "/helpdesk/tickets/$id/attachments", null)
        if (r.first == 200) {
            val t = r.second.trim()
            val arr = if (t.startsWith("[")) org.json.JSONArray(t) else JSONObject(t).optJSONArray("items") ?: org.json.JSONArray()
            Resultado(true, "", JSONObject().put("items", arr))
        } else Resultado(false, erro(r.first, r.second, "Não consegui ver os anexos"))
    } catch (e: Exception) { Resultado(false, "Não consegui ver os anexos: " + Api.mensagem(e)) }

    val EXTENSOES = setOf("pdf", "png", "jpg", "jpeg", "txt", "xls", "xlsx", "doc", "docx")

    fun anexar(c: Context, id: Int, nome: String, tipo: String, dados: ByteArray): Resultado {
        val ext = nome.substringAfterLast('.', "").lowercase()
        if (ext !in EXTENSOES) return Resultado(false, "Tipo de arquivo não aceito. Use PDF, imagem (PNG/JPG), texto, Excel ou Word.")
        if (dados.size > 10 * 1024 * 1024) return Resultado(false, "O arquivo passa de 10 MB.")
        return try {
            val login = Store.login(c) ?: return Resultado(false, "Faça o login no app.")
            val hp = Helpdesk.prefs(c)
            var api = Api(login.first, login.second, hp.getString("cookie", "") ?: "")
            if (api.cookie.isEmpty()) { api.entrar(); hp.edit().putString("cookie", api.cookie).apply() }
            var r = api.enviarArquivo("/helpdesk/tickets/$id/attachments", nome, tipo, dados)
            if (r.first == 401) {
                api = Api(login.first, login.second); api.entrar(); hp.edit().putString("cookie", api.cookie).apply()
                r = api.enviarArquivo("/helpdesk/tickets/$id/attachments", nome, tipo, dados)
            }
            when {
                r.first in 200..299 -> { depois(c, id); Resultado(true, "Arquivo anexado") }
                r.first == 413 -> Resultado(false, "O arquivo passa de 10 MB.")
                r.first == 409 -> Resultado(false, "Este chamado já chegou no limite de anexos ou não aceita anexos agora.")
                else -> Resultado(false, erro(r.first, r.second, "Não consegui anexar"))
            }
        } catch (e: Exception) { Resultado(false, "Não consegui anexar: " + Api.mensagem(e)) }
    }

    /** Endereço para baixar um anexo e o cookie da sessão (renovada se precisar). */
    fun preparoDownload(c: Context, id: Int, anexo: Int): Pair<String, String>? {
        val l = anexos(c, id)          // garante a sessão válida (entra de novo se tiver vencido)
        if (!l.ok) return null
        val cookie = Helpdesk.prefs(c).getString("cookie", "") ?: ""
        return Pair(Api.BASE + "/helpdesk/tickets/$id/attachments/$anexo/download", cookie)
    }

    /** Depois de mexer no chamado: atualiza a lista (a ação própria entra só no histórico, sem aviso). */
    @Suppress("UNUSED_PARAMETER")
    private fun depois(c: Context, id: Int) {
        Helpdesk.emSegundoPlano(c, true)
    }

    // ---------------- ações direto na notificação ----------------

    const val ACAO_RESPONDER = "br.com.cbfreedom.CHAMADO_RESPONDER"
    const val ACAO_ASSUMIR = "br.com.cbfreedom.CHAMADO_ASSUMIR"
    const val EXTRA_ID = "chamado"
    const val EXTRA_TITULO = "titulo"
    const val CHAVE_TEXTO = "texto"

    /** Mostra o resultado no lugar do aviso do chamado (sem tocar som de novo). */
    internal fun resultadoNaNotificacao(c: Context, id: Int, titulo: String, r: Resultado, texto: String?) {
        Helpdesk.criarCanais(c)
        val nid = Helpdesk.idNotificacao(id)
        val linha = if (r.ok) (if (texto != null) "Você: " + texto.trim() else r.mensagem) else r.mensagem
        val b = Notification.Builder(c, Helpdesk.CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle(if (r.ok) titulo else "Não deu certo · $titulo")
            .setContentText(linha)
            .setStyle(Notification.BigTextStyle().bigText(linha))
            .setContentIntent(Helpdesk.abrirApp(c, "/helpdesk/tickets/$id", nid))
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setGroup("helpdesk")
        if (r.ok) b.setTimeoutAfter(6000)
        try { Helpdesk.nm(c).notify(nid, b.build()) } catch (_: Exception) { }
    }
}

/** Botões "Responder" e "Assumir" dos avisos de chamado. */
class ChamadoAcao : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val id = i.getIntExtra(Chamado.EXTRA_ID, 0)
        if (id <= 0) return
        val titulo = i.getStringExtra(Chamado.EXTRA_TITULO) ?: "Chamado"
        val app = c.applicationContext
        val pendente = goAsync()
        val terminou = java.util.concurrent.atomic.AtomicBoolean(false)
        fun terminar() { if (terminou.compareAndSet(false, true)) try { pendente.finish() } catch (_: Exception) { } }
        // o Android dá ~60 s para um aviso de botão; libera antes disso mesmo se a internet estiver lenta
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ terminar() }, 50_000L)
        Thread {
            try {
                when (i.action) {
                    Chamado.ACAO_RESPONDER -> {
                        val texto = RemoteInput.getResultsFromIntent(i)?.getCharSequence(Chamado.CHAVE_TEXTO)?.toString() ?: ""
                        Chamado.resultadoNaNotificacao(app, id, titulo, Chamado.responder(app, id, texto), texto)
                    }
                    Chamado.ACAO_ASSUMIR ->
                        Chamado.resultadoNaNotificacao(app, id, titulo, Chamado.assumir(app, id), null)
                }
            } catch (_: Exception) {
            } finally {
                terminar()
            }
        }.start()
    }
}
