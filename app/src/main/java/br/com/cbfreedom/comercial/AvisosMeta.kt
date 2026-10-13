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
                } else abaixo(m, "Você está")
            }
        } else {
            if (n(d, "meta") > 0 && n(d, "p") >= 1.0) {
                if (r.marcar("mes_$mes")) out += Pair("Meta do mês batida!", "A equipe faturou ${Fmt.brlK(n(d, "valor"))} " +
                    "(${Fmt.pct(n(d, "p") * 100)} da meta de ${Fmt.brlK(n(d, "meta"))}).")
            } else abaixo(d, "Equipe")
            val vs = d.optJSONArray("vendedores")
            val bateram = ArrayList<String>()
            if (vs != null) for (i in 0 until vs.length()) {
                val v = vs.optJSONObject(i) ?: continue
                if (n(v, "meta") > 0 && n(v, "valor") >= n(v, "meta") && r.marcar("vend_${mes}_" + v.optString("nome"))) bateram += v.optString("nome")
            }
            if (bateram.size == 1) out += Pair("${bateram[0]} bateu a meta do mês", "Parabéns! Veja o ranking no painel Comercial.")
            else if (bateram.size > 1) out += Pair("${bateram.size} vendedores bateram a meta", bateram.joinToString(", "))
        }
        r.fechar()
        return out
    }
}
