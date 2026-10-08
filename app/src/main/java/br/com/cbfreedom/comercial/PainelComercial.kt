package br.com.cbfreedom.comercial

import br.com.cbfreedom.comum.Api
import br.com.cbfreedom.comum.Cor
import br.com.cbfreedom.comum.Fmt
import br.com.cbfreedom.comum.Info
import br.com.cbfreedom.comum.Painel
import br.com.cbfreedom.comum.Pintor
import br.com.cbfreedom.app.WidgetComercial
import org.json.JSONObject
import kotlin.math.max

/**
 * Painel do Comercial (módulo "commercial" do site). O perfil do login decide o que aparece:
 * vendedor (role = seller) vê a semana acumulativa + o mês; gestor/diretor vê o mês da equipe + vendedores.
 */
object PainelComercial : Painel {

    override val id = "comercial"
    override val titulo = "Freedom Comercial"
    override val nomeModulo = "Comercial"
    override val modulo = "commercial"
    override val tela = "painel-comercial.html"
    override val classeWidget = WidgetComercial::class.java

    override fun buscar(api: Api): JSONObject = Dados.comercial(api)

    override fun desenhar(p: Pintor, d: JSONObject, info: Info, classe: Char) {
        val vend = d.optString("tipo") == "vendedor"
        when {
            classe == 'B' -> barra(p, d, info, vend)
            // a tela grande do vendedor (semana + mês) precisa de mais altura
            vend -> vendedor(p, d, info, if (classe == 'G' && p.alt < 240f) 'M' else classe)
            else -> gestor(p, d, info, classe)
        }
    }

    /** Widget de uma linha: valor + % + barrinha. */
    private fun barra(p: Pintor, d: JSONObject, info: Info, vend: Boolean) {
        val o = if (vend) d.optJSONObject("semana") ?: JSONObject() else d
        val y = p.barraTopo(if (vend) o.optString("titulo", "SEMANA") else "FATURAMENTO DO MÊS", info)
        val x = p.barraX()
        val dir = p.larg - 12f
        val wp = p.texto(Fmt.pct(o.v("p") * 100), dir, y, 11f, Cor.BRANCO, 'B', 'D')
        val max = dir - wp - 8f - x
        p.texto(p.reaisQueCabe(o.v("valor"), 16f, max), x, y, 16f, Cor.BRANCO, 'H', max = max)
        p.barra(x, y + 5f, dir - x, 3.5f, o.v("p"), o.v("idealP"), if (o.v("valor") >= o.v("ideal")) Cor.AZUL else Cor.ROSA)
    }

    private fun JSONObject.v(k: String): Double = optDouble(k, 0.0).let { if (it.isNaN()) 0.0 else it }
    private fun pos(o: JSONObject): String = Fmt.int(o.v("pos")) + "/" + Fmt.int(o.v("metaPos"))
    private fun nomeCurto(s: String): String = s.replace(Regex("^SUPERVISOR\\s*-\\s*", RegexOption.IGNORE_CASE), "SUP. ")

    private const val X0 = 14f

    /** Valor grande + % + barra. y = linha de base do valor. Devolve o y logo abaixo da barra. */
    private fun bloco(p: Pintor, o: JSONObject, y: Float, tamV: Float, tamP: Float, altBarra: Float, corOk: Int, corRuim: Int): Float {
        val iw = p.larg - 2 * X0
        val wp = p.texto(Fmt.pct(o.v("p") * 100), p.larg - X0, y, tamP, Cor.BRANCO, 'B', 'D')
        p.texto(p.reaisQueCabe(o.v("valor"), tamV * 0.8f, iw - wp - 8f), X0, y, tamV, Cor.BRANCO, 'H', max = iw - wp - 8f)
        val yb = y + 7f
        p.barra(X0, yb, iw, altBarra, o.v("p"), o.v("idealP"), if (o.v("valor") >= o.v("ideal")) corOk else corRuim)
        return yb + altBarra
    }

    // ---------------- GESTOR ----------------
    private fun gestor(p: Pintor, d: JSONObject, info: Info, cl: Char) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0
        val y0 = p.cabecalho("FATURAMENTO DO MÊS", info, X0, 12f, cl == 'P')
        val metaT = Triple("Meta", Fmt.brlK(d.v("meta")), null as Int?)
        val idealT = Triple("Ideal", Fmt.brlK(d.v("ideal")), null as Int?)
        val faltaT = Triple("Falta", Fmt.brlK(d.v("falta")), null as Int?)
        val porDiaT = Triple("Por dia", if (d.v("rest") > 0) Fmt.brlK(d.v("porDia")) else "—", null as Int?)
        val posT = Triple("Positivação", pos(d), Cor.VERDE as Int?)
        val diasT = Triple("Dias", Fmt.int(d.v("dec")) + "/" + Fmt.int(d.v("T")), null as Int?)

        if (cl == 'P') {
            val livre = (H - 12f - 30f) - y0
            val y = y0 + max(0f, (livre - 32f) / 2f) + 18f
            bloco(p, d, y, 17f, 10f, 8f, Cor.AZUL, Cor.ROSA)
            p.linhaInfo(H - 12f - 15f, X0, iw, listOf(faltaT), 10f)
            p.linhaInfo(H - 12f, X0, iw, listOf(metaT), 10f)
            return
        }
        if (cl == 'M') {
            val baseInfo2 = H - 13f
            val baseInfo1 = baseInfo2 - 16f
            val livre = (baseInfo1 - 12f) - y0
            val y = y0 + max(0f, (livre - 43f) / 2f) + 22f
            bloco(p, d, y, 26f, 14f, 9f, Cor.AZUL, Cor.ROSA)
            p.linhaInfo(baseInfo1, X0, iw, listOf(metaT, idealT, faltaT), 10f)
            p.linhaInfo(baseInfo2, X0, iw, listOf(porDiaT, posT, diasT), 10f)
            return
        }
        // grande: resumo + lista de vendedores
        var y = bloco(p, d, y0 + 19f, 22f, 14f, 7f, Cor.AZUL, Cor.ROSA)
        y += 15f; p.linhaInfo(y, X0, iw, listOf(metaT, idealT, faltaT), 10f)
        y += 15f; p.linhaInfo(y, X0, iw, listOf(porDiaT, posT, diasT), 10f)
        y += 20f
        val vend = d.optJSONArray("vendedores")
        val total = vend?.length() ?: 0
        p.texto("VENDEDORES", X0, y, 10f, Cor.CINZA, 'B')
        p.texto("$total no total", W - X0, y, 9f, Cor.CINZA, 'N', 'D')
        y += 6f
        val livre = H - 12f - y
        // tamanho de cada linha: normal, compacto ou denso (o que couber todos)
        val niveis = listOf(floatArrayOf(23f, 11f, 9f, 3f), floatArrayOf(19f, 10f, 8f, 2.5f), floatArrayOf(15.5f, 9.5f, 7.5f, 2f))
        var nivel = niveis.last()
        var cabe = total
        val achou = niveis.firstOrNull { total * it[0] <= livre }
        if (achou != null) nivel = achou
        else cabe = max(1, ((livre - 12f) / nivel[0]).toInt())
        val idealP = d.v("idealP")
        for (i in 0 until minOf(cabe, total)) {
            val x = vend!!.getJSONObject(i)
            linhaVendedor(p, x, y, idealP, nivel)
            y += nivel[0]
        }
        if (total > cabe) p.texto("+ ${total - cabe} vendedores · toque para ver todos", X0, y + 10f, 9f, Cor.CINZA)
    }

    private fun linhaVendedor(p: Pintor, x: JSONObject, y: Float, idealP: Double, nv: FloatArray) {
        val W = p.larg; val iw = W - 2 * X0
        val tam = nv[1]; val det = nv[2]; val altB = nv[3]
        val base = y + tam + 1f
        val vf = x.v("valor"); val vm = x.v("meta")
        p.texto(if (vm > 0) Fmt.pct(vf / vm * 100) else "—", W - X0, base, tam - 1f, Cor.CINZA, 'B', 'D')
        val xv = W - X0 - 44f
        val wv = p.texto(Fmt.brlK(vf), xv, base, tam, Cor.BRANCO, 'B', 'D')
        val wn = p.texto(nomeCurto(x.optString("nome")), X0, base, tam, Cor.BRANCO, 'N', max = iw * 0.46f)
        if (vm > 0) {
            val f = max(0.0, vm - vf)
            val dir = xv - wv - 7f
            val espaco = dir - (X0 + wn + 6f)
            if (espaco > 34f) {
                if (f > 0) p.texto("falta " + Fmt.brlK(f), dir, base, det, Cor.CINZA, 'N', 'D', espaco)
                else p.texto("meta ✓", dir, base, det, Cor.VERDE, 'B', 'D', espaco)
            }
        }
        val yb = base + 3.5f
        if (vm > 0) p.barra(X0, yb, iw, altB, vf / vm, idealP, if (vf >= vm * idealP) Cor.AZUL else Cor.LARANJA)
        else p.barra(X0, yb, iw, altB, 0.0, null, Cor.TRILHO)
    }

    // ---------------- VENDEDOR ----------------
    private fun vendedor(p: Pintor, d: JSONObject, info: Info, cl: Char) {
        val W = p.larg; val H = p.alt; val iw = W - 2 * X0
        val s = d.optJSONObject("semana") ?: JSONObject()
        val m = d.optJSONObject("mes") ?: JSONObject()
        val y0 = p.cabecalho(s.optString("titulo", "SEMANA"), info, X0, 12f, cl == 'P')
        val metaT = Triple("Meta", Fmt.brlK(s.v("meta")), null as Int?)
        val idealT = Triple("Ideal", Fmt.brlK(s.v("ideal")), null as Int?)
        val faltaT = Triple("Falta", Fmt.brlK(s.v("falta")), null as Int?)
        val restam = s.v("restam") > 0
        val paraBater = Triple("Para bater", if (restam) Fmt.brlK(s.v("porDia")) + "/dia" else "—", null as Int?)
        val posT = Triple("Positivação", pos(s), Cor.VERDE as Int?)
        val acum = s.v("acumulado")
        val nota = when {
            acum >= 0.01 -> "inclui " + Fmt.brlK(acum) + " das semanas anteriores"
            acum <= -0.01 -> Fmt.brlK(-acum) + " a menos: você está adiantado"
            else -> null
        }

        if (cl == 'P') {
            val livre = (H - 12f - 30f) - y0
            val y = y0 + max(0f, (livre - 32f) / 2f) + 18f
            bloco(p, s, y, 17f, 10f, 8f, Cor.AZUL, Cor.ROSA)
            p.linhaInfo(H - 12f - 15f, X0, iw, listOf(faltaT), 10f)
            p.linhaInfo(H - 12f, X0, iw, listOf(Triple("Por dia", if (restam) Fmt.brlK(s.v("porDia")) else "—", null as Int?)), 10f)
            return
        }
        fun semana(baseInfo1: Float, topo: Float) {
            val livre = (baseInfo1 - 12f) - topo
            val y = topo + max(0f, (livre - 43f) / 2f) + 22f
            bloco(p, s, y, 26f, 14f, 9f, Cor.AZUL, Cor.ROSA)
            p.linhaInfo(baseInfo1, X0, iw, listOf(metaT, idealT, faltaT), 10f)
            p.linhaInfo(baseInfo1 + 15f, X0, iw, listOf(paraBater, posT), 10f)
            if (nota != null) p.texto(nota, X0, baseInfo1 + 28f, 9f, Cor.CINZA, 'N', max = iw)
        }
        if (cl == 'M') {
            // semana centralizada no espaço livre (sem buraco entre a barra e os números)
            val altGrupo = if (nota != null) 86f else 73f
            val topo = y0 + max(0f, (H - 12f - y0 - altGrupo) / 2f)
            if (topo + altGrupo > H - 6f) semana(H - 12f - (if (nota != null) 28f else 15f), y0)
            else semana(topo + 55f, topo)
            return
        }
        // grande: semana em cima, mês embaixo (o espaço que sobra fica dividido entre os dois)
        val altSemana = if (nota != null) 86f else 73f
        val altMes = 82f
        val sobra = max(12f, (H - 12f - y0) - altSemana - altMes)
        val t = y0 + sobra * 0.25f
        semana(t + 55f, t)
        var y = t + altSemana + sobra * 0.5f
        p.ret(X0, y - sobra * 0.25f - 5f, iw, 1f, 0f, Cor.LINHA)
        y += 10f
        p.texto("MÊS", X0, y, 10f, Cor.CINZA, 'B')
        p.texto("dia útil " + Fmt.int(m.v("dec")) + " de " + Fmt.int(m.v("T")), W - X0, y, 9f, Cor.CINZA, 'N', 'D')
        y = bloco(p, m, y + 24f, 20f, 13f, 7f, Cor.ROSA, Cor.ROSA)
        y += 15f
        p.linhaInfo(y, X0, iw, listOf(Triple("Meta", Fmt.brlK(m.v("meta")), null as Int?),
            Triple("Ideal", Fmt.brlK(m.v("ideal")), null as Int?), Triple("Falta", Fmt.brlK(m.v("falta")), null as Int?)), 10f)
        y += 15f
        p.linhaInfo(y, X0, iw, listOf(Triple("Por dia", if (m.v("rest") > 0) Fmt.brlK(m.v("porDia")) else "—", null as Int?),
            Triple("Positivação", pos(m), Cor.VERDE as Int?)), 10f)
    }
}
