package br.com.cbfreedom.comercial

import android.content.Context
import br.com.cbfreedom.comum.Fmt
import br.com.cbfreedom.comum.Metas
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Avisos de meta do painel Comercial (cada um toca uma vez só):
 *  - meta do mês batida (equipe ou vendedor) e meta da semana batida (vendedor);
 *  - gestor: vendedores que bateram a meta do mês;
 *  - depois das 14 h em dia útil: mais de 10 pontos abaixo do ideal (uma vez por dia), com quanto vender por dia.
 *  - gestor/diretor, sobre cada vendedor (juntando num aviso só quando são vários):
 *      vendeu acima da média hoje · sem venda hoje (a partir das 15 h, se a equipe já vendeu hoje) ·
 *      abaixo do ritmo (14 h+, uma vez por dia) · bateu a meta de positivação (uma vez no mês).
 */
object AvisosMeta {
    private val ZONA = ZoneId.of("America/Sao_Paulo")
    private fun n(o: JSONObject?, k: String) = Dados.n(o, k)

    fun calcular(c: Context, d: JSONObject): List<Pair<String, String>> {
        if (d.has("periodo")) return emptyList()           // período escolhido na tela não avisa
        val hoje = LocalDate.now(ZONA)
        val mes = hoje.toString().take(7)
        val tarde = LocalTime.now(ZONA).hour >= 14 && hoje.dayOfWeek.value in 1..5
        val r = Metas.Registro(c, mes)
        val out = ArrayList<Pair<String, String>>()

        fun abaixo(o: JSONObject, quem: String) {
            val p = n(o, "p"); val ideal = n(o, "idealP")
            if (!tarde || n(o, "meta") <= 0 || p >= ideal - 0.10 || n(o, "rest") <= 0) return
            if (!r.marcar("abaixo_$hoje")) return
            out += Pair("$quem abaixo do ideal do mês",
                "Vendido ${Fmt.pct(p * 100)} da meta; o ideal hoje é ${Fmt.pct(ideal * 100)}. " +
                    "Para bater a meta de ${Fmt.brlK(n(o, "meta"))}, faltam ${Fmt.brlK(n(o, "falta"))}: " +
                    "${Fmt.brlK(n(o, "porDia"))} por dia útil (${Fmt.int(n(o, "rest"))} dias).")
        }

        if (d.optString("tipo") == "vendedor") {
            val s = d.optJSONObject("semana")
            val m = d.optJSONObject("mes")
            if (s != null && n(s, "meta") > 0 && n(s, "p") >= 1.0 && r.marcar("sem_${mes}_" + s.optString("titulo")))
                out += Pair("Meta da semana batida!", "Você vendeu ${Fmt.brlK(n(s, "valor"))} na semana " +
                    "(${Fmt.pct(n(s, "p") * 100)} da meta de ${Fmt.brlK(n(s, "meta"))}).")
            if (m != null) {
                if (n(m, "meta") > 0 && n(m, "p") >= 1.0) {
                    if (r.marcar("mes_$mes")) out += Pair("Meta do mês batida!", "Você vendeu ${Fmt.brlK(n(m, "valor"))} no mês " +
                        "(${Fmt.pct(n(m, "p") * 100)} da meta de ${Fmt.brlK(n(m, "meta"))}).")
                }
                pessoal(m, s, hoje, r, out)
            }
        } else {
            if (n(d, "meta") > 0 && n(d, "p") >= 1.0) {
                if (r.marcar("mes_$mes")) out += Pair("Meta do mês batida!", "A equipe faturou ${Fmt.brlK(n(d, "valor"))} " +
                    "(${Fmt.pct(n(d, "p") * 100)} da meta de ${Fmt.brlK(n(d, "meta"))}).")
            } else abaixo(d, "Equipe")
            resumos(d, hoje, r, out)
            val vs = d.optJSONArray("vendedores")
            val bateram = ArrayList<String>()
            if (vs != null) for (i in 0 until vs.length()) {
                val v = vs.optJSONObject(i) ?: continue
                if (n(v, "meta") > 0 && n(v, "valor") >= n(v, "meta") && r.marcar("vend_${mes}_" + v.optString("nome"))) bateram += v.optString("nome")
            }
            if (bateram.size == 1) out += Pair("${bateram[0]} bateu a meta do mês", "Parabéns! Veja o ranking no painel Comercial.")
            else if (bateram.size > 1) out += Pair("${bateram.size} vendedores bateram a meta", bateram.joinToString(", "))
            if (vs != null) equipe(d, vs, hoje, r, out)
        }
        r.fechar()
        return out
    }

    /** Avisos do gestor sobre cada vendedor da equipe. */
    private fun equipe(d: JSONObject, vs: org.json.JSONArray, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        val dia = hoje.toString(); val mes = dia.take(7)
        val util = hoje.dayOfWeek.value in 1..5
        val hora = LocalTime.now(ZONA).hour
        val dec = n(d, "dec"); val idealP = n(d, "idealP")
        val lista = (0 until vs.length()).mapNotNull { vs.optJSONObject(it) }
        fun junta(um: String, varios: String, itens: List<Pair<String, String>>) {
            if (itens.size == 1) out += Pair(itens[0].first + " " + um, itens[0].second)
            else if (itens.size > 1) out += Pair("${itens.size} vendedores $varios", itens.joinToString(" · ") { it.first + (if (it.second.isNotEmpty()) " (" + resumo(it.second) + ")" else "") })
        }
        if (d.optBoolean("temHoje") && util) {
            // vendeu acima da média hoje (50% acima da média diária do mês)
            junta("vendeu acima da média hoje", "acima da média hoje", lista.filter { v ->
                val h = n(v, "hoje"); val media = if (dec > 0) n(v, "valor") / dec else 0.0
                h > 0 && media > 0 && h >= media * 1.5 && r.marcar("acima_${dia}_" + v.optString("nome"))
            }.map { v -> Pair(v.optString("nome"), "${Fmt.brlK(n(v, "hoje"))} hoje · média de ${Fmt.brlK(n(v, "valor") / dec)} por dia") })
            // sem venda hoje: só depois das 15 h e se a equipe já tem venda hoje (sinal de que a base do dia chegou)
            if (hora >= 15 && n(d, "hojeEquipe") > 0)
                junta("está sem venda hoje", "sem venda hoje", lista.filter { v ->
                    n(v, "meta") > 0 && n(v, "hoje") <= 0 && r.marcar("semvenda_${dia}_" + v.optString("nome"))
                }.map { v -> Pair(v.optString("nome"), "") })
        }
        // abaixo do ritmo do mês (10 pontos abaixo do ideal), depois das 14 h, uma vez por dia
        if (util && hora >= 14)
            junta("está abaixo do ritmo", "abaixo do ritmo", lista.filter { v ->
                n(v, "meta") > 0 && n(v, "valor") < n(v, "meta") && n(v, "p") < idealP - 0.10 && r.marcar("ritmo_${dia}_" + v.optString("nome"))
            }.map { v -> Pair(v.optString("nome"), "${Fmt.pct(n(v, "p") * 100)} da meta · ideal ${Fmt.pct(idealP * 100)}") })
        // marcos da meta do mês (50%, 75%, 90%): avisa só o maior que acabou de passar
        junta("passou de um marco da meta", "passaram de marcos da meta", lista.mapNotNull { v ->
            if (n(v, "meta") <= 0) return@mapNotNull null
            var novo = 0
            for (m in listOf(50, 75, 90)) if (n(v, "p") >= m / 100.0 && r.marcar("marco_${mes}_${m}_" + v.optString("nome"))) novo = m
            if (novo > 0 && n(v, "p") < 1.0) Pair(v.optString("nome"), "passou de $novo% da meta · ${Fmt.pct(n(v, "p") * 100)}") else null
        })
        // voltou ao ritmo: estava 10 pontos abaixo do ideal e agora está no ideal ou acima
        junta("voltou ao ritmo", "voltaram ao ritmo", lista.mapNotNull { v ->
            val k = "baixo_${mes}_" + v.optString("nome")
            if (n(v, "meta") <= 0) null
            else if (n(v, "p") < idealP - 0.10) { r.por(k); null }
            else if (n(v, "p") >= idealP && r.tem(k)) { r.tirar(k); if (r.primeira) null else Pair(v.optString("nome"), "${Fmt.pct(n(v, "p") * 100)} da meta · ideal ${Fmt.pct(idealP * 100)}") }
            else null
        })
        // bateu a meta de positivação (uma vez no mês)
        junta("bateu a meta de positivação", "bateram a positivação", lista.filter { v ->
            n(v, "metaPos") > 0 && n(v, "pos") >= n(v, "metaPos") && r.marcar("pos_${mes}_" + v.optString("nome"))
        }.map { v -> Pair(v.optString("nome"), "${Fmt.int(n(v, "pos"))} de ${Fmt.int(n(v, "metaPos"))} clientes positivados") })
    }

    private fun resumo(s: String) = s.substringBefore(" · ")

    /** Venda de um dia no gráfico do mês (null se não tiver). */
    private fun vendaDoDia(m: JSONObject, dia: String): Double? {
        val dd = m.optJSONArray("diario") ?: return null
        for (i in 0 until dd.length()) { val x = dd.optJSONObject(i) ?: continue; if (x.optString("d") == dia) return n(x, "v") }
        return null
    }

    /** Os mesmos avisos do gestor, mas só com os números do próprio vendedor. */
    private fun pessoal(m: JSONObject, s: JSONObject?, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        val dia = hoje.toString(); val mes = dia.take(7)
        val util = hoje.dayOfWeek.value in 1..5
        val agora = LocalTime.now(ZONA); val hora = agora.hour
        val meta = n(m, "meta"); val p = n(m, "p"); val idealP = n(m, "idealP"); val rest = n(m, "rest"); val dec = n(m, "dec")
        val hojeV = vendaDoDia(m, dia)
        // bom dia
        if (util && hora in 8..11 && r.marcar("eu_manha_$dia")) {
            val dd = m.optJSONArray("diario")
            var ontem: JSONObject? = null
            if (dd != null) for (i in 0 until dd.length()) {
                val x = dd.optJSONObject(i) ?: continue
                val dt = x.optString("d"); if (dt >= dia || dt.length != 10) continue
                if (LocalDate.parse(dt).dayOfWeek.value in 1..5) ontem = x
            }
            val t = StringBuilder()
            if (ontem != null) { val dt = LocalDate.parse(ontem.optString("d")); t.append("Ontem (" + "%02d/%02d".format(dt.dayOfMonth, dt.monthValue) + ") você vendeu ${Fmt.brlK(n(ontem, "v"))}. ") }
            t.append("No mês: ${Fmt.brlK(n(m, "valor"))}")
            if (meta > 0) {
                t.append(" (${Fmt.pct(p * 100)} da meta; ideal ${Fmt.pct(idealP * 100)}).")
                if (n(m, "falta") > 0 && rest > 0) t.append(" Para bater: ${Fmt.brlK(n(m, "porDia"))} por dia útil.")
            } else t.append(".")
            if (s != null && n(s, "meta") > 0) t.append(" Semana: ${Fmt.brlK(n(s, "valor"))} de ${Fmt.brlK(n(s, "meta"))}.")
            out += Pair("Bom dia! Seu resumo", t.toString())
        }
        if (meta <= 0) return
        // seu ritmo 4x por dia
        val fx = if (util) Metas.faixa(listOf("10:00", "12:00", "14:00", "16:00"), "17:59", hora, agora.minute) else null
        if (fx != null && r.marcar("eu_ritmo_${dia}_$fx")) {
            val dif = n(m, "valor") - n(m, "ideal")
            val t = StringBuilder("${Fmt.pct(p * 100)} da meta (ideal ${Fmt.pct(idealP * 100)}) · ")
            t.append(if (dif >= 0) "${Fmt.brlK(dif)} acima do ideal" else "${Fmt.brlK(-dif)} abaixo do ideal")
            if (hojeV != null) t.append(" · hoje: ${Fmt.brlK(hojeV)}")
            if (n(m, "falta") > 0 && rest > 0) t.append(" · para bater: ${Fmt.brlK(n(m, "porDia"))} por dia útil")
            out += Pair("Seu ritmo às $fx", t.toString())
        }
        // reta final
        if (util && p < 1.0 && rest in 1.0..3.0 && r.marcar("eu_reta_$dia"))
            out += Pair("Reta final: " + Fmt.int(rest) + (if (rest == 1.0) " dia útil" else " dias úteis"),
                "Faltam ${Fmt.brlK(n(m, "falta"))} para a sua meta de ${Fmt.brlK(meta)}: ${Fmt.brlK(n(m, "porDia"))} por dia útil.")
        // marcos
        var novo = 0
        for (k in listOf(50, 75, 90)) if (p >= k / 100.0 && r.marcar("eu_marco_${mes}_$k")) novo = k
        if (novo > 0 && p < 1.0) out += Pair("Você passou de $novo% da meta!", "Já são ${Fmt.brlK(n(m, "valor"))} (${Fmt.pct(p * 100)} da meta de ${Fmt.brlK(meta)}).")
        // voltou ao ritmo
        if (p < idealP - 0.10) r.por("eu_baixo_$mes")
        else if (p >= idealP && r.tem("eu_baixo_$mes")) { r.tirar("eu_baixo_$mes"); if (!r.primeira) out += Pair("Você voltou ao ritmo!", "${Fmt.pct(p * 100)} da meta; o ideal hoje é ${Fmt.pct(idealP * 100)}. Continue assim.") }
        // acima da sua média hoje
        if (util && hojeV != null && dec > 0 && n(m, "valor") > 0 && hojeV >= 1.5 * n(m, "valor") / dec && r.marcar("eu_acima_$dia"))
            out += Pair("Hoje você vendeu acima da sua média!", "${Fmt.brlK(hojeV)} hoje · sua média é ${Fmt.brlK(n(m, "valor") / dec)} por dia.")
        // positivação
        if (n(m, "metaPos") > 0 && n(m, "pos") >= n(m, "metaPos") && r.marcar("eu_pos_$mes"))
            out += Pair("Você bateu a meta de positivação!", "${Fmt.int(n(m, "pos"))} de ${Fmt.int(n(m, "metaPos"))} clientes positivados no mês.")
    }

    /** Resumo da manhã (8 h–11 h, dias úteis) e reta final do mês (últimos 3 dias úteis), para gestor/diretor. */
    private fun resumos(d: JSONObject, hoje: LocalDate, r: Metas.Registro, out: ArrayList<Pair<String, String>>) {
        if (hoje.dayOfWeek.value !in 1..5) return
        val dia = hoje.toString(); val hora = LocalTime.now(ZONA).hour
        val meta = n(d, "meta"); val rest = n(d, "rest")
        if (hora in 8..11 && r.marcar("manha_$dia")) {
            // último dia útil antes de hoje, pelo gráfico do mês
            val dd = d.optJSONArray("diario")
            var ontem: JSONObject? = null
            if (dd != null) for (i in 0 until dd.length()) {
                val x = dd.optJSONObject(i) ?: continue
                val dt = x.optString("d"); if (dt >= dia || dt.length != 10) continue
                if (LocalDate.parse(dt).dayOfWeek.value in 1..5) ontem = x
            }
            val txt = StringBuilder()
            if (ontem != null) {
                val dt = LocalDate.parse(ontem.optString("d"))
                txt.append("Ontem (" + "%02d/%02d".format(dt.dayOfMonth, dt.monthValue) + ") a equipe vendeu ${Fmt.brlK(n(ontem, "v"))}. ")
            }
            txt.append("No mês: ${Fmt.brlK(n(d, "valor"))}")
            if (meta > 0) {
                txt.append(" (${Fmt.pct(n(d, "p") * 100)} da meta; ideal ${Fmt.pct(n(d, "idealP") * 100)}).")
                if (n(d, "falta") > 0 && rest > 0) txt.append(" Para bater: ${Fmt.brlK(n(d, "porDia"))} por dia útil.")
            } else txt.append(".")
            out += Pair("Bom dia! Resumo da equipe", txt.toString())
        }
        // ritmo da equipe 4x por dia (10 h, 12 h, 14 h, 16 h)
        val fx = Metas.faixa(listOf("10:00", "12:00", "14:00", "16:00"), "17:59", hora, LocalTime.now(ZONA).minute)
        if (fx != null && meta > 0 && r.marcar("ritmoeq_${dia}_$fx")) {
            val dif = n(d, "valor") - n(d, "ideal")
            val t = StringBuilder("${Fmt.pct(n(d, "p") * 100)} da meta (ideal ${Fmt.pct(n(d, "idealP") * 100)}) · ")
            t.append(if (dif >= 0) "${Fmt.brlK(dif)} acima do ideal" else "${Fmt.brlK(-dif)} abaixo do ideal")
            if (d.optBoolean("temHoje")) t.append(" · hoje: ${Fmt.brlK(n(d, "hojeEquipe"))}")
            if (n(d, "falta") > 0 && rest > 0) t.append(" · para bater: ${Fmt.brlK(n(d, "porDia"))} por dia útil")
            out += Pair("Ritmo da equipe às $fx", t.toString())
        }
        if (meta > 0 && n(d, "p") < 1.0 && rest in 1.0..3.0 && r.marcar("reta_$dia")) {
            val vs = d.optJSONArray("vendedores")
            val perto = (0 until (vs?.length() ?: 0)).mapNotNull { vs?.optJSONObject(it) }
                .filter { n(it, "meta") > 0 && n(it, "p") >= 0.8 && n(it, "p") < 1.0 }
                .sortedByDescending { n(it, "p") }.take(4)
                .joinToString(", ") { it.optString("nome") + " (" + Fmt.pct(n(it, "p") * 100) + ")" }
            out += Pair("Reta final: " + Fmt.int(rest) + (if (rest == 1.0) " dia útil" else " dias úteis"),
                "Faltam ${Fmt.brlK(n(d, "falta"))} para a meta de ${Fmt.brlK(meta)}: ${Fmt.brlK(n(d, "porDia"))} por dia útil." +
                    (if (perto.isNotEmpty()) " Perto de bater: $perto." else ""))
        }
    }
}
