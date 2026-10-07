package br.com.cbfreedom.faturamento

import android.graphics.Color
import br.com.cbfreedom.comum.Api
import br.com.cbfreedom.comum.Cor
import br.com.cbfreedom.comum.Fmt
import br.com.cbfreedom.comum.Info
import br.com.cbfreedom.comum.Painel
import br.com.cbfreedom.comum.Pintor
import br.com.cbfreedom.comum.SemAcesso
import br.com.cbfreedom.app.WidgetFaturamento
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min

/**
 * Painel do Faturamento (módulo "logistics" do site): faturamento do dia por tipo de pedido,
 * total do mês, Standby e PEND da equipe.
 */
object PainelFaturamento : Painel {

    override val id = "faturamento"
    override val titulo = "Freedom Faturamento"
    override val nomeModulo = "Faturamento"
    override val modulo = "logistics"
    override val tela = "painel-faturamento.html"
    override val classeWidget = WidgetFaturamento::class.java
    override val fundoRosado = true

    private val MESES = listOf("JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
        "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO")
    private val CORES = mapOf("V" to "#1fbf8f", "C" to "#8b6cf0", "1" to "#4f7cff", "B" to "#f0a53a", "P" to "#2bb673",
        "O" to "#e5484d", "D" to "#3b82f6", "Q" to "#f59e0b", "M" to "#10b981", "T" to "#f97316", "5" to "#a855f7",
        "7" to "#ef4444", "6" to "#7c3aed", "A" to "#60a5fa")

    private fun n(o: JSONObject?, k: String): Double {
        if (o == null || !o.has(k) || o.isNull(k)) return 0.0
        return o.optString(k, "0").toDoubleOrNull() ?: o.optDouble(k, 0.0)
    }

    // ---------------- DADOS ----------------
    override fun buscar(api: Api): JSONObject {
        val fat: JSONObject
        val snaps: JSONObject
        try {
            fat = api.get("/logistics/billing/daily")
            snaps = api.get("/logistics/report/snapshots")
        } catch (e: SemAcesso) {
            throw SemAcesso("este login não tem acesso ao faturamento")
        }
        val dia = fat.optJSONObject("latest_day") ?: JSONObject()
        val hoje = LocalDate.now(ZoneId.of("America/Sao_Paulo"))
        val mesIso = hoje.toString().take(7)
        var totalMes = 0.0
        val dias = fat.optJSONArray("days") ?: JSONArray()
        for (i in 0 until dias.length()) {
            val d = dias.getJSONObject(i)
            if (d.optString("invoice_date").take(7) == mesIso) totalMes += n(d, "total_value")
        }
        val tiposArr = dia.optJSONArray("types") ?: JSONArray()
        val tipos = (0 until tiposArr.length()).map { tiposArr.getJSONObject(it) }.sortedByDescending { n(it, "value") }
        val tiposOut = JSONArray()
        for (t in tipos) tiposOut.put(JSONObject()
            .put("codigo", t.optString("order_type_code")).put("nome", t.optString("order_type_label"))
            .put("valor", n(t, "value")).put("pedidos", n(t, "order_count")))
        val items = snaps.optJSONArray("items") ?: JSONArray()
        var snap: JSONObject? = null
        for (i in 0 until items.length()) {
            val it = items.getJSONObject(i)
            if (snap == null || n(it, "id") > n(snap, "id")) snap = it
        }
        return JSONObject()
            .put("dia", JSONObject()
                .put("data", dia.optString("invoice_date").take(10))
                .put("valor", n(dia, "total_value"))
                .put("pedidos", n(dia, "order_count"))
                .put("tipos", tiposOut))
            .put("mes", JSONObject().put("nome", MESES[hoje.monthValue - 1]).put("valor", totalMes))
            .put("standby", n(snap, "standby_value"))
            .put("pend", n(snap, "team_pending"))
    }

    // ---------------- DESENHO ----------------
    private const val X0 = 14f

    private fun cor(codigo: String): Int = try { Color.parseColor(CORES[codigo] ?: "#8b93a7") } catch (_: Exception) { Cor.CINZA }

    private class Tipo(val codigo: String, val nome: String, val valor: Double, val pedidos: Double)

    override fun desenhar(p: Pintor, d: JSONObject, info: Info, classe: Char) {
        val dia = d.optJSONObject("dia") ?: JSONObject()
        val arr = dia.optJSONArray("tipos") ?: JSONArray()
        val tipos = (0 until arr.length()).map { arr.getJSONObject(it) }
            .map { Tipo(it.optString("codigo"), it.optString("nome"), n(it, "valor"), n(it, "pedidos")) }
        val mes = d.optJSONObject("mes") ?: JSONObject()
        when (classe) {
            'P' -> pequeno(p, d, dia, mes, info)
            'M' -> medio(p, d, dia, mes, tipos, info)
            else -> grande(p, d, dia, mes, tipos, info)
        }
    }

    private fun pedidos(v: Double) = Fmt.int(v) + if (Math.round(v) == 1L) " pedido" else " pedidos"

    private fun pequeno(p: Pintor, d: JSONObject, dia: JSONObject, mes: JSONObject, info: Info) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0
        p.logo(X0, 12f, 18f)
        p.horario(info, W - X0, 12f)
        val y = 12f + 18f + 30f
        p.valorRS(n(dia, "valor"), X0, y, 21f, 'E', iw)
        p.texto("Hoje " + Fmt.dataBR(dia.optString("data")).take(5) + " · " + Fmt.int(n(dia, "pedidos")) + " ped.", X0, y + 14f, 9f, Cor.CINZA, 'N', max = iw)
        val linhas = listOf(Triple("Mês", n(mes, "valor"), Cor.ROSA), Triple("Standby", n(d, "standby"), Cor.LARANJA), Triple("PEND", n(d, "pend"), Cor.VIOLETA))
        var yb = H - 12f - 2 * 14f
        for (l in linhas) {
            p.ret(X0, yb - 8.5f, 3f, 10f, 1.5f, l.third)
            p.texto(l.first, X0 + 7f, yb, 9f, Cor.CINZA)
            p.texto(Fmt.brlK(l.second), W - X0, yb, 10f, Cor.BRANCO, 'B', 'D')
            yb += 14f
        }
    }

    private fun cartao(p: Pintor, x: Float, y: Float, w: Float, h: Float, cor: Int, rotulo: String, valor: String, tamV: Float, r: Float) {
        p.ret(x, y, w, h, r, cor)
        p.ret(x, y + 2.5f, w, h - 2.5f, r, Cor.CARD)
        val tr = min(9f, h * 0.22f)
        p.texto(rotulo, x + w / 2, y + 4f + h * 0.36f, tr, Cor.CINZA, 'N', 'C', w - 10f)
        p.texto(valor, x + w / 2, y + h * 0.80f, tamV, Cor.BRANCO, 'H', 'C', w - 10f)
    }

    private fun medio(p: Pintor, d: JSONObject, dia: JSONObject, mes: JSONObject, tipos: List<Tipo>, info: Info) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0
        val y0 = p.cabecalho("FATURAMENTO DO DIA", info, X0, 12f, false)
        val altC = 38f
        val yC = H - 12f - altC
        // valor + data/pedidos, centralizados no espaço entre o cabeçalho e a linha dos tipos
        val livre = yC - 22f - y0
        val yv = y0 + max(0f, (livre - 30f) / 2f) + 26f
        p.texto(Fmt.dataBR(dia.optString("data")), W - X0, yv - 13f, 10f, Cor.CINZA, 'N', 'D')
        p.texto(pedidos(n(dia, "pedidos")), W - X0, yv, 10f, Cor.CINZA, 'N', 'D')
        p.valorRS(n(dia, "valor"), X0, yv, 30f, 'E', iw - 74f)
        // tipos de pedido numa linha
        val yt = yC - 9f
        var x = X0
        for (t in tipos) {
            val rot = t.nome + " "
            val vv = Fmt.brlK(t.valor)
            val w = 7f + p.medir(rot, 9f) + p.medir(vv, 9f, 'B')
            if (x + w > W - X0) break
            p.ret(x, yt - 8.5f, 3f, 11f, 1.5f, cor(t.codigo))
            val a = p.texto(rot, x + 7f, yt, 9f, Cor.CINZA)
            p.texto(vv, x + 7f + a, yt, 9f, Cor.BRANCO, 'B')
            x += w + 10f
        }
        // três cartões
        val gap = 6f
        val wc = (iw - 2 * gap) / 3f
        val cs = listOf(Triple("Total de " + mes.optString("nome").lowercase(), n(mes, "valor"), Cor.ROSA),
            Triple("Standby", n(d, "standby"), Cor.LARANJA), Triple("PEND equipe", n(d, "pend"), Cor.VIOLETA))
        for ((i, c) in cs.withIndex()) cartao(p, X0 + i * (wc + gap), yC, wc, altC, c.third, c.first, Fmt.brlK(c.second), 12f, 9f)
    }

    private fun grande(p: Pintor, d: JSONObject, dia: JSONObject, mes: JSONObject, tipos: List<Tipo>, info: Info) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0; val cx = W / 2
        p.horario(info, W - X0, 12f)
        val baixo = H < 330f
        val hl = if (baixo) 32f else 42f
        p.logo(cx, 14f, hl, 'C')
        var y = 14f + hl + 16f
        p.texto("FATURAMENTO DO DIA", cx, y, 11f, Cor.CINZA, 'B', 'C')
        val tv = if (baixo) 34f else 40f
        y += tv + 4f
        p.valorRS(n(dia, "valor"), cx, y, tv, 'C', iw)
        y += 15f
        p.texto(Fmt.dataBR(dia.optString("data")) + " · " + pedidos(n(dia, "pedidos")), cx, y, 10f, Cor.CINZA, 'N', 'C')
        y += 10f

        // parte de baixo (fixa): total do mês, cartões, rodapé
        val yRod = H - 10f
        val altC = 50f
        val yC = yRod - 12f - altC
        val altPill = 28f
        val yPill = yC - 10f - altPill

        // tipos de pedido (quantos couberem)
        val wChip = min(iw, 300f)
        val altChip = 24f
        val espaco = yPill - 8f - y
        var cabe = max(0, (espaco / (altChip + 5f)).toInt())
        if (cabe < tipos.size && cabe > 0 && espaco - cabe * (altChip + 5f) < 13f) cabe -= 1
        cabe = min(cabe, tipos.size)
        val resto = tipos.drop(cabe)
        val usado = cabe * (altChip + 5f) + if (resto.isNotEmpty()) 13f else 0f
        var yc = y + max(0f, (espaco - usado) / 2f)
        for (t in tipos.take(cabe)) {
            val x = cx - wChip / 2
            p.ret(x, yc, wChip, altChip, 7f, Cor.CARD)
            p.ret(x, yc, 3f, altChip, 1.5f, cor(t.codigo))
            val base = yc + altChip / 2 + 4f
            val wp = p.texto(Fmt.int(t.pedidos) + " ped.", x + wChip - 8f, base, 8f, Cor.CINZA, 'N', 'D')
            val wv = p.texto(Fmt.brl(t.valor), x + wChip - 8f - wp - 8f, base, 11f, Cor.BRANCO, 'B', 'D')
            p.texto(t.nome, x + 10f, base, 10f, Cor.CINZA, 'N', max = wChip - 30f - wp - wv)
            yc += altChip + 5f
        }
        if (resto.isNotEmpty()) {
            val s = "+ " + resto.size + (if (resto.size > 1) " tipos: " else " tipo: ") + Fmt.brlK(resto.sumOf { it.valor })
            p.texto(s, cx, yc + 7f, 9f, Cor.CINZA, 'N', 'C')
        }

        // total do mês (pílula)
        val rot = "TOTAL DE " + mes.optString("nome")
        val vm = Fmt.brl(n(mes, "valor"))
        val wPill = min(iw, p.medir(rot, 9f, 'S') + 10f + p.medir(vm, 14f, 'H') + 26f)
        val xp = cx - wPill / 2
        p.ret(xp, yPill, wPill, altPill, altPill / 2, Cor.CARD)
        p.borda(xp, yPill, wPill, altPill, altPill / 2, Cor.LINHA)
        val a = p.texto(rot, xp + 13f, yPill + 18f, 9f, Cor.CINZA, 'S')
        p.texto(vm, xp + 13f + a + 10f, yPill + 19f, 14f, Cor.BRANCO, 'H', max = wPill - a - 36f)

        // cartões Standby e PEND
        val gap = 10f
        val wc = (iw - gap) / 2f
        cartao(p, X0, yC, wc, altC, Cor.LARANJA, "Standby", Fmt.brl(n(d, "standby")), 15f, 12f)
        cartao(p, X0 + wc + gap, yC, wc, altC, Cor.VIOLETA, "PEND da equipe (faturável)", Fmt.brl(n(d, "pend")), 15f, 12f)

        val hm = if (info.hora > 0) Fmt.hhmm(info.hora) else "--:--"
        p.texto("Atualizado às $hm · toque no horário para atualizar", cx, yRod, 8f, Cor.APAGADO, 'N', 'C', iw)
    }
}
