package br.com.cbfreedom.comercial

import android.content.Context
import br.com.cbfreedom.comum.Fmt
import br.com.cbfreedom.comum.Metas
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Avisos do painel Comercial (cada um toca uma vez só), com textos curtos para caber na notificação:
 *  - meta do mês / da semana batida; vendedores que bateram a meta; bom dia; reta final; marcos 50/75/90%;
 *  - gestor/diretor às 10, 12, 14 e 16 h: um aviso com quem está ACIMA do ritmo e outro com quem está ABAIXO (só nomes);
 *  - vendeu acima da média hoje · sem venda hoje (15 h+) · voltou ao ritmo · bateu a positivação.
 *  - vendedor: os mesmos, só com os números dele.
 */
object AvisosMeta {
    private val ZONA = ZoneId.of("America/Sao_Paulo")
    private val RITMO = listOf("10:00", "12:00", "14:00", "16:00")
    private fun n(o: JSONObject?, k: String) = Dados.n(o, k)
    private fun p0(v: Double) = Math.round(v * 100).toString() + "%"
    private fun hh(fx: String) = if (fx.endsWith(":00")) fx.take(2).toInt().toString() + "h" else fx.replace(":", "h")
    private fun dias(rest: Double) = Fmt.int(rest) + (if (rest == 1.0) " dia útil" else " dias úteis")

    fun calcular(c: Context, d: JSONObject): List<Pair<String, String>> {
        if (d.has("periodo")) return emptyList()           // período escolhido na tela não avisa
        val hoje = LocalDate.now(ZONA)
        val mes = hoje.toString().take(7)
        val r = Metas.Registro(c, mes)
        val out = ArrayList<Pair<String, String>>()

        if (d.optString("tipo") == "vendedor") {
            val s = d.optJSONObject("semana")
            val m = d.optJSONObject("mes")
            if (s != null && n(s, "meta") > 0 && n(s, "p") >= 1.0 && r.marcar("sem_${mes}_" + s.optString("titulo")))
                out += Pair("Meta da semana batida!", "${Fmt.brlK(n(s, "valor"))} (${p0(n(s, "p"))})")
            if (m != null) {
                if (n(m, "meta") > 0 && n(m, "p") >= 1.0) {
                    if (r.marcar("mes_$mes")) out += Pair("Meta do mês batida!", "${Fmt.brlK(n(m, "valor"))} (${p0(n(m, "p"))})")
                }
                pessoal(m, hoje, r, out)
            }
        } else {
            if (n(d, "meta") > 0 && n(d, "p") >= 1.0 && r.marcar("mes_$mes"))
                out += Pair("Meta do mês batida!", "Equipe: ${Fmt.brlK(n(d, "valor"))} (${p0(n(d, "p"))})")
            val vs = d.optJSONArray("vendedores")
            val bateram = ArrayList<String>()
            if (vs != null) for (i in 0 until vs.length()) {
                val v = vs.optJSONObject(i) ?: continue
                if (n(v, "meta") > 0 && n(v, "valor") >= n(v, "meta") && r.marcar("vend_${mes}_" + v.optString("nome"))) bateram += v.optString("nome")
            }
            if (bateram.size == 1) out += Pair("${bateram[0]} bateu a meta do mês!", "Parabéns!")
            else if (bateram.size > 1) out += Pair("${bateram.size} vendedores bateram a meta", bateram.joinToString(", "))
            if (vs != null) equipe(d, vs, hoje, r, out)
            resumos(d, hoje, r, out)
        }
        r.fechar()
        return out
    }

    /** Avisos do gestor sobre cada vendedor da equipe (juntando num aviso só quando são vários). */
    private fun equipe(d: JSONObject, vs: org.json.JSONArray, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        val dia = hoje.toString(); val mes = dia.take(7)
        val util = hoje.dayOfWeek.value in 1..5
        val agora = LocalTime.now(ZONA); val hora = agora.hour
        val dec = n(d, "dec"); val idealP = n(d, "idealP")
        val lista = (0 until vs.length()).mapNotNull { vs.optJSONObject(it) }
        fun junta(um: String, varios: String, nomes: List<String>) {
            if (nomes.size == 1) out += Pair(nomes[0] + " " + um, "")
            else if (nomes.size > 1) out += Pair("${nomes.size} vendedores $varios", nomes.joinToString(", "))
        }
        if (d.optBoolean("temHoje") && util) {
            junta("vendeu acima da média hoje", "acima da média hoje", lista.filter { v ->
                val h = n(v, "hoje"); val media = if (dec > 0) n(v, "valor") / dec else 0.0
                h > 0 && media > 0 && h >= media * 1.5 && r.marcar("acima_${dia}_" + v.optString("nome"))
            }.map { it.optString("nome") })
            if (hora >= 15 && n(d, "hojeEquipe") > 0)
                junta("está sem venda hoje", "sem venda hoje", lista.filter { v ->
                    n(v, "meta") > 0 && n(v, "hoje") <= 0 && r.marcar("semvenda_${dia}_" + v.optString("nome"))
                }.map { it.optString("nome") })
        }
        // marcos da meta do mês (50%, 75%, 90%): só o maior que acabou de passar
        val marcos = lista.mapNotNull { v ->
            if (n(v, "meta") <= 0) return@mapNotNull null
            var novo = 0
            for (m in listOf(50, 75, 90)) if (n(v, "p") >= m / 100.0 && r.marcar("marco_${mes}_${m}_" + v.optString("nome"))) novo = m
            if (novo > 0 && n(v, "p") < 1.0) Pair(v.optString("nome"), novo) else null
        }
        if (marcos.size == 1) out += Pair("${marcos[0].first} passou de ${marcos[0].second}% da meta", "")
        else if (marcos.size > 1) out += Pair("${marcos.size} vendedores passaram de marcos da meta", marcos.joinToString(", ") { "${it.first} ${it.second}%" })
        // voltou ao ritmo: estava 10 pontos abaixo do ideal e agora está no ideal ou acima
        junta("voltou ao ritmo", "voltaram ao ritmo", lista.mapNotNull { v ->
            val k = "baixo_${mes}_" + v.optString("nome")
            if (n(v, "meta") <= 0) null
            else if (n(v, "p") < idealP - 0.10) { r.por(k); null }
            else if (n(v, "p") >= idealP && r.tem(k)) { r.tirar(k); if (r.primeira) null else v.optString("nome") }
            else null
        })
        junta("bateu a positivação", "bateram a positivação", lista.filter { v ->
            n(v, "metaPos") > 0 && n(v, "pos") >= n(v, "metaPos") && r.marcar("pos_${mes}_" + v.optString("nome"))
        }.map { it.optString("nome") })
        // às 10, 12, 14 e 16 h: quem está acima e quem está abaixo do ritmo (dois avisos, só nomes)
        val fx = if (util) Metas.faixa(RITMO, "17:59", hora, agora.minute) else null
        if (fx != null && r.marcar("ritmoeq_${dia}_$fx")) {
            val com = if (idealP > 0) lista.filter { n(it, "meta") > 0 } else emptyList()
            val acima = com.filter { n(it, "p") >= idealP }.sortedByDescending { n(it, "p") }.map { it.optString("nome") }
            val baixo = com.filter { n(it, "p") < idealP }.sortedBy { n(it, "p") }.map { it.optString("nome") }
            if (acima.isNotEmpty()) out += Pair(Metas.SOLO + "Acima do ritmo (${hh(fx)})", acima.joinToString(", "))
            if (baixo.isNotEmpty()) out += Pair(Metas.SOLO + "Abaixo do ritmo (${hh(fx)})", baixo.joinToString(", "))
        }
    }

    /** Venda de um dia no gráfico do mês (null se não tiver). */
    private fun vendaDoDia(m: JSONObject, dia: String): Double? {
        val dd = m.optJSONArray("diario") ?: return null
        for (i in 0 until dd.length()) { val x = dd.optJSONObject(i) ?: continue; if (x.optString("d") == dia) return n(x, "v") }
        return null
    }

    /** Último dia útil antes de hoje no gráfico do mês. */
    private fun ontem(o: JSONObject, dia: String): JSONObject? {
        val dd = o.optJSONArray("diario") ?: return null
        var ontem: JSONObject? = null
        for (i in 0 until dd.length()) {
            val x = dd.optJSONObject(i) ?: continue
            val dt = x.optString("d"); if (dt >= dia || dt.length != 10) continue
            if (LocalDate.parse(dt).dayOfWeek.value in 1..5) ontem = x
        }
        return ontem
    }

    private fun bomDia(o: JSONObject, dia: String, quem: String): Pair<String, String> {
        val b = ArrayList<String>()
        ontem(o, dia)?.let { b += "Ontem " + Fmt.brlK(n(it, "v")) }
        if (n(o, "meta") > 0 && n(o, "falta") > 0 && n(o, "rest") > 0) b += Fmt.brlK(n(o, "porDia")) + "/dia p/ bater"
        else if (n(o, "meta") <= 0) b += "Mês " + Fmt.brlK(n(o, "valor"))
        return Pair(if (n(o, "meta") > 0) "Bom dia! $quem em ${p0(n(o, "p"))} da meta" else "Bom dia!", b.joinToString(" · "))
    }

    /** Os mesmos avisos do gestor, mas só com os números do próprio vendedor. */
    private fun pessoal(m: JSONObject, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        val dia = hoje.toString(); val mes = dia.take(7)
        val util = hoje.dayOfWeek.value in 1..5
        val agora = LocalTime.now(ZONA); val hora = agora.hour
        val meta = n(m, "meta"); val p = n(m, "p"); val idealP = n(m, "idealP"); val rest = n(m, "rest"); val dec = n(m, "dec")
        val hojeV = vendaDoDia(m, dia)
        if (util && hora in 8..11 && r.marcar("eu_manha_$dia")) out += bomDia(m, dia, "Você está")
        if (meta <= 0) return
        val fx = if (util) Metas.faixa(RITMO, "17:59", hora, agora.minute) else null
        if (fx != null && r.marcar("eu_ritmo_${dia}_$fx"))
            out += Pair("Seu ritmo ${hh(fx)}: ${p0(p)} da meta", if (n(m, "valor") >= n(m, "ideal")) "Acima do ideal" else "Abaixo do ideal")
        if (util && p < 1.0 && rest in 1.0..3.0 && r.marcar("eu_reta_$dia"))
            out += Pair("Reta final: " + dias(rest), "Faltam ${Fmt.brlK(n(m, "falta"))} · ${Fmt.brlK(n(m, "porDia"))}/dia")
        var novo = 0
        for (k in listOf(50, 75, 90)) if (p >= k / 100.0 && r.marcar("eu_marco_${mes}_$k")) novo = k
        if (novo > 0 && p < 1.0) out += Pair("Você passou de $novo% da meta!", "${Fmt.brlK(n(m, "valor"))} de ${Fmt.brlK(meta)}")
        if (p < idealP - 0.10) r.por("eu_baixo_$mes")
        else if (p >= idealP && r.tem("eu_baixo_$mes")) { r.tirar("eu_baixo_$mes"); if (!r.primeira) out += Pair("Você voltou ao ritmo!", "${p0(p)} da meta") }
        if (util && hojeV != null && dec > 0 && n(m, "valor") > 0 && hojeV >= 1.5 * n(m, "valor") / dec && r.marcar("eu_acima_$dia"))
            out += Pair("Hoje acima da sua média!", Fmt.brlK(hojeV) + " hoje")
        if (n(m, "metaPos") > 0 && n(m, "pos") >= n(m, "metaPos") && r.marcar("eu_pos_$mes"))
            out += Pair("Positivação batida!", "${Fmt.int(n(m, "pos"))} de ${Fmt.int(n(m, "metaPos"))} clientes")
    }

    /** Bom dia (8–11 h) e reta final (últimos 3 dias úteis), para gestor/diretor. */
    private fun resumos(d: JSONObject, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        if (hoje.dayOfWeek.value !in 1..5) return
        val dia = hoje.toString(); val hora = LocalTime.now(ZONA).hour
        val meta = n(d, "meta"); val rest = n(d, "rest")
        if (hora in 8..11 && r.marcar("manha_$dia")) out += bomDia(d, dia, "Equipe")
        if (meta > 0 && n(d, "p") < 1.0 && rest in 1.0..3.0 && r.marcar("reta_$dia")) {
            val vs = d.optJSONArray("vendedores")
            val perto = (0 until (vs?.length() ?: 0)).mapNotNull { vs?.optJSONObject(it) }
                .filter { n(it, "meta") > 0 && n(it, "p") >= 0.8 && n(it, "p") < 1.0 }
                .sortedByDescending { n(it, "p") }.take(3).joinToString(", ") { it.optString("nome") }
            out += Pair("Reta final: " + dias(rest), "Faltam ${Fmt.brlK(n(d, "falta"))} · ${Fmt.brlK(n(d, "porDia"))}/dia" + (if (perto.isNotEmpty()) " · perto: $perto" else ""))
        }
    }
}
