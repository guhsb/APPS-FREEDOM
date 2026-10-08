package br.com.cbfreedom.comum

import android.app.Notification
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Ações num chamado feitas pelo app (sem abrir o site): ler o histórico, responder e assumir.
 * Usa os mesmos endereços do site: GET /helpdesk/tickets/{id}/timeline,
 * POST /helpdesk/tickets/{id}/messages {body} e POST /helpdesk/tickets/{id}/take {version}.
 */
object Chamado {

    class Resultado(val ok: Boolean, val mensagem: String, val dados: JSONObject? = null)

    // códigos de erro do site -> texto (os mesmos que o site mostra)
    private val ERROS = mapOf(
        "helpdesk_ticket_already_assigned" to "Este chamado já foi assumido por outro atendente.",
        "stale_ticket_version" to "O chamado foi alterado por outro usuário. Tente de novo.",
        "helpdesk_forbidden" to "Seu acesso de atendimento não está disponível.",
        "resolved_helpdesk_ticket" to "Este chamado já foi resolvido.",
        "invalid_ticket_transition" to "Esta alteração não está mais disponível."
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
        if (r.first == 200) Resultado(true, "", JSONObject(r.second))
        else Resultado(false, erro(r.first, r.second, "Não consegui abrir o chamado"))
    } catch (e: Exception) { Resultado(false, "Não consegui abrir o chamado: " + Api.mensagem(e)) }

    fun responder(c: Context, id: Int, texto: String): Resultado {
        val t = texto.trim()
        if (t.isEmpty()) return Resultado(false, "Escreva uma mensagem antes de enviar.")
        if (t.length > 10_000) return Resultado(false, "A mensagem passou de 10.000 caracteres.")
        return try {
            val r = chamar(c, "POST", "/helpdesk/tickets/$id/messages", JSONObject().put("body", t))
            if (r.first in 200..299) { depois(c, id); Resultado(true, "Resposta enviada") }
            else Resultado(false, erro(r.first, r.second, "Não consegui enviar a resposta"))
        } catch (e: Exception) { Resultado(false, "Não consegui enviar: " + Api.mensagem(e)) }
    }

    fun assumir(c: Context, id: Int): Resultado {
        try {
            for (tentativa in 0..1) {
                val h = historico(c, id)
                if (!h.ok) return h
                val d = h.dados ?: return Resultado(false, "Resposta inesperada do site.")
                val tk = d.optJSONObject("ticket") ?: return Resultado(false, "Resposta inesperada do site.")
                val cap = d.optJSONObject("capabilities")
                if (cap != null && !cap.optBoolean("can_take", false))
                    return Resultado(false, if (tk.isNull("assignee_user_id")) "Você não pode assumir este chamado." else "Este chamado já tem responsável.")
                val r = chamar(c, "POST", "/helpdesk/tickets/$id/take", JSONObject().put("version", tk.optInt("version")))
                if (r.first in 200..299) { depois(c, id); return Resultado(true, "Chamado assumido") }
                // versão antiga (alguém mexeu no meio-tempo): busca de novo uma vez
                if (r.first == 409 && tentativa == 0 && r.second.contains("stale")) continue
                return Resultado(false, erro(r.first, r.second, "Não consegui assumir"))
            }
            return Resultado(false, "O chamado mudou enquanto eu tentava. Tente de novo.")
        } catch (e: Exception) {
            return Resultado(false, "Não consegui assumir: " + Api.mensagem(e))
        }
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
