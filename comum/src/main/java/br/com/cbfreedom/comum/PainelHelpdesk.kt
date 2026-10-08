package br.com.cbfreedom.comum

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** Widget do Helpdesk (módulo "helpdesk"). Tocar abre a aba Helpdesk do app. */
class WidgetHelpdesk : Widget("helpdesk")

/**
 * Painel do Helpdesk: números da Central de Atendimento (na fila, comigo, sem responsável, SLA),
 * meus chamados ativos e a lista de chamados em aberto. Só aparece como widget (a tela cheia é a aba Helpdesk).
 * Os números são atualizados a cada verificação dos avisos (doMonitor) e, de reserva, a cada 15 min (buscar).
 */
object PainelHelpdesk : Painel {

    override val id = "helpdesk"
    override val titulo = "Freedom Helpdesk"
    override val nomeModulo = "Helpdesk"
    override val modulo = Acesso.HELPDESK
    override val tela = "helpdesk.html"
    override val classeWidget = WidgetHelpdesk::class.java
    override val naAbaPainel = false
    override val aba = "helpdesk"

    private val LISTAS = listOf(
        "/helpdesk/workspace/tickets?view=assigned&page=1&page_size=50",
        "/helpdesk/workspace/tickets?view=queues&page=1&page_size=50",
        "/helpdesk/tickets?view=requester&page=1&page_size=50"
    )

    // ---------------- DADOS ----------------

    override fun buscar(api: Api): JSONObject {
        val resumo = try { api.get("/helpdesk/notifications/summary") } catch (e: SemAcesso) {
            throw SemAcesso("este login não tem acesso ao Helpdesk")
        }
        val abertos = LinkedHashMap<String, JSONObject>()
        for (caminho in LISTAS) {
            val r = try { api.bruto(caminho) } catch (_: Exception) { continue }
            if (r.first != 200) continue
            val items = try { JSONObject(r.second).optJSONArray("items") } catch (_: Exception) { null } ?: continue
            for (i in 0 until items.length()) {
                val t = items.optJSONObject(i) ?: continue
                if (!Engine.isActive(t.optString("status"))) continue
                abertos[t.optString("id")] = JSONObject()
                    .put("id", t.optString("id")).put("protocol", t.optString("protocol")).put("title", t.optString("title"))
                    .put("status", t.optString("status")).put("priority", t.optString("priority"))
                    .put("updated", Engine.ts(t.optString("updated_at")))
            }
        }
        val arr = JSONArray()
        for (t in abertos.values.sortedByDescending { it.optString("updated") }.take(30)) arr.put(t)
        return JSONObject().put("resumo", resumo).put("abertos", arr).put("novidades", JSONArray())
    }

    /** Depois de cada verificação dos avisos: atualiza o widget com o que acabou de ser consultado. */
    fun doMonitor(c: Context) {
        try {
            val r = Helpdesk.resumoTela(c)
            val novidades = JSONArray()
            val feed = r.optJSONArray("feed") ?: JSONArray()
            for (i in 0 until feed.length()) {
                if (novidades.length() >= 5) break
                val f = feed.optJSONObject(i) ?: continue
                if (f.optBoolean("meu", false)) continue          // ações minhas não são "novidade"
                novidades.put(JSONObject().put("t", f.optLong("t")).put("titulo", f.optString("titulo")).put("texto", f.optString("texto")))
            }
            val d = JSONObject().put("resumo", r.optJSONObject("resumo") ?: JSONObject())
                .put("abertos", r.optJSONArray("abertos") ?: JSONArray()).put("novidades", novidades)
            if (!Store.logado(c)) return
            Store.cache(c).edit().putString("dados_$id", d.toString()).putLong("hora_$id", System.currentTimeMillis())
                .remove("erro_$id").commit()
            Widget.redesenharTodos(c)
        } catch (_: Exception) { }
    }

    // ---------------- DESENHO ----------------

    private const val X0 = 14f

    private class Numero(val rotulo: String, val valor: Int, val cor: Int)

    private fun numeros(d: JSONObject): List<Numero> {
        val r = d.optJSONObject("resumo") ?: JSONObject()
        val req = r.optJSONObject("requester") ?: JSONObject()
        val ws = r.optJSONObject("workspace")
        val l = ArrayList<Numero>()
        if (ws != null) {
            val sem = ws.optInt("unassigned_active"); val risco = ws.optInt("sla_at_risk"); val estourado = ws.optInt("sla_breached")
            l.add(Numero("Na fila", ws.optInt("open"), Cor.AZUL))
            l.add(Numero("Comigo", ws.optInt("assigned_to_me_active"), Cor.VIOLETA))
            l.add(Numero("Sem responsável", sem, if (sem > 0) Cor.LARANJA else Cor.LINHA))
            l.add(Numero("Meus chamados", req.optInt("active"), Cor.VERDE))
            l.add(Numero("SLA em risco", risco, if (risco > 0) Cor.LARANJA else Cor.LINHA))
            l.add(Numero("SLA estourado", estourado, if (estourado > 0) Cor.ROSA else Cor.LINHA))
        } else {
            l.add(Numero("Meus chamados", req.optInt("active"), Cor.VERDE))
        }
        return l
    }

    private fun curto(r: String): String = when (r) {
        "Na fila" -> "na fila"
        "Comigo" -> "comigo"
        "Sem responsável" -> "sem resp."
        "Meus chamados" -> "meus"
        "SLA em risco" -> "SLA risco"
        "SLA estourado" -> "SLA estour."
        else -> r.lowercase()
    }

    private fun corStatus(s: String): Int = when (s) {
        "OPEN" -> Cor.AZUL
        "IN_PROGRESS" -> Cor.VIOLETA
        "WAITING" -> Cor.LARANJA
        else -> Cor.CINZA
    }

    private fun corPrioridade(s: String): Int = when (s) {
        "URGENT", "CRITICAL" -> Cor.ROSA
        "HIGH" -> Cor.LARANJA
        "LOW" -> Cor.APAGADO
        else -> Cor.AZUL
    }

    private fun cartao(p: Pintor, x: Float, y: Float, w: Float, h: Float, n: Numero) {
        p.ret(x, y, w, h, 9f, n.cor)
        p.ret(x, y + 2.5f, w, h - 2.5f, 9f, Cor.CARD)
        p.texto(n.valor.toString(), x + w / 2, y + h * 0.60f, min(22f, h * 0.46f), Cor.BRANCO, 'H', 'C', w - 8f)
        p.texto(n.rotulo, x + w / 2, y + h * 0.88f, min(8.5f, h * 0.2f), Cor.CINZA, 'N', 'C', w - 6f)
    }

    private fun quando(ms: Long): String {
        val min = ((System.currentTimeMillis() - ms) / 60_000L).toInt()
        return when {
            min < 1 -> "agora"
            min < 60 -> "há $min min"
            else -> Fmt.hhmm(ms)
        }
    }

    override fun desenhar(p: Pintor, d: JSONObject, info: Info, classe: Char) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0
        val nums = numeros(d)
        if (classe == 'B') {
            // uma linha: "3 na fila  2 comigo  1 sem resp. ..."
            val y = p.barraTopo("HELPDESK", info)
            var x = p.barraX()
            val dir = p.larg - 12f
            for (n in nums) {
                val v = n.valor.toString()
                val r = " " + curto(n.rotulo)
                val wv = p.medir(v, 15f, 'H'); val wr = p.medir(r, 9f)
                if (x + wv + wr > dir) break
                val destaque = n.valor > 0 && (n.cor == Cor.LARANJA || n.cor == Cor.ROSA)
                p.texto(v, x, y, 15f, if (destaque) n.cor else Cor.BRANCO, 'H')
                p.texto(r, x + wv, y, 9f, Cor.CINZA)
                x += wv + wr + 10f
            }
            return
        }
        val y0 = p.cabecalho("HELPDESK", info, X0, 12f, classe == 'P')

        if (classe == 'P') {
            // pequeno: os 3 números principais em linhas
            var y = y0 + 6f
            val passo = max(14f, min(20f, (H - 12f - y) / 3f))
            for (n in nums.take(3)) {
                y += passo
                p.ret(X0, y - 9f, 3f, 11f, 1.5f, if (n.cor == Cor.LINHA) Cor.APAGADO else n.cor)
                p.texto(n.rotulo, X0 + 7f, y, 9.5f, Cor.CINZA, 'N', max = iw * 0.62f)
                p.texto(n.valor.toString(), W - X0, y, 13f, Cor.BRANCO, 'H', 'D')
            }
            return
        }

        // médio e grande: cartões com os números (3 por linha)
        val gap = 6f
        val porLinha = min(3, nums.size)
        val wc = (iw - gap * (porLinha - 1)) / porLinha
        val livre = H - 12f - y0 - 6f
        // médio baixo: uma linha só de cartões; senão duas
        val umaLinha = classe == 'M' && (livre - gap) / 2f < 34f
        val altC = when {
            classe != 'M' -> 46f
            umaLinha -> min(46f, livre)
            else -> min(46f, (livre - gap) / 2f)
        }
        val linhas = if (umaLinha) 1 else min(2, (nums.size + porLinha - 1) / porLinha)
        var y = y0 + 4f
        for (lin in 0 until linhas) {
            for (col in 0 until porLinha) {
                val i = lin * porLinha + col
                if (i >= nums.size) break
                cartao(p, X0 + col * (wc + gap), y, wc, altC, nums[i])
            }
            y += altC + gap
        }
        if (classe == 'M') return

        // grande: última novidade + chamados em aberto
        val nov = d.optJSONArray("novidades")
        val ult = nov?.optJSONObject(0)
        if (ult != null && y + 30f < H - 12f) {
            y += 12f
            p.texto("ÚLTIMA NOVIDADE · " + quando(ult.optLong("t")), X0, y, 8.5f, Cor.ROSA, 'B', max = iw)
            y += 13f
            p.texto(ult.optString("titulo"), X0, y, 10f, Cor.BRANCO, 'B', max = iw)
            y += 12f
            p.texto(ult.optString("texto"), X0, y, 9f, Cor.CINZA, 'N', max = iw)
            y += 4f
        }
        val ab = d.optJSONArray("abertos") ?: JSONArray()
        if (y + 34f > H - 12f) return
        y += 16f
        p.texto("CHAMADOS EM ABERTO", X0, y, 9.5f, Cor.CINZA, 'B')
        p.texto(ab.length().toString(), W - X0, y, 9f, Cor.CINZA, 'N', 'D')
        y += 6f
        if (ab.length() == 0) {
            p.texto("Nenhum chamado em aberto.", X0, y + 14f, 10f, Cor.APAGADO)
            return
        }
        val altL = 22f
        val cabe = max(0, ((H - 12f - y) / altL).toInt())
        val mostrar = min(cabe, ab.length())
        for (i in 0 until mostrar) {
            if (i == mostrar - 1 && mostrar < ab.length()) {
                p.texto("+ " + (ab.length() - i) + " chamados · toque para ver", X0, y + 14f, 9f, Cor.CINZA)
                break
            }
            val t = ab.optJSONObject(i) ?: continue
            p.ret(X0, y + 4f, iw, altL - 4f, 6f, Cor.CARD)
            p.ret(X0, y + 4f, 3f, altL - 4f, 1.5f, corPrioridade(t.optString("priority")))
            val base = y + 4f + (altL - 4f) / 2f + 3.5f
            val st = Engine.statusLabel(t.optString("status"))
            val ws = p.texto(st, W - X0 - 7f, base, 8.5f, corStatus(t.optString("status")), 'B', 'D')
            val wp = p.texto(t.optString("protocol"), X0 + 9f, base, 9.5f, Cor.BRANCO, 'B')
            p.texto(t.optString("title"), X0 + 9f + wp + 6f, base, 9.5f, Cor.CINZA, 'N', max = iw - wp - ws - 30f)
            y += altL
        }
    }
}
