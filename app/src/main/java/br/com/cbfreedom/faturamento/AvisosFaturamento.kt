package br.com.cbfreedom.faturamento

import android.content.Context
import br.com.cbfreedom.comum.Fmt
import br.com.cbfreedom.comum.Metas
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Aviso do painel Faturamento: "Faturamento de hoje" às 11:30 e 15:00 e depois de 30 em 30 minutos
 * das 17:30 às 20:00 (dias úteis). Só o valor faturado, para caber na notificação.
 */
object AvisosFaturamento {
    private val ZONA = ZoneId.of("America/Sao_Paulo")
    private fun n(o: JSONObject?, k: String): Double {
        if (o == null || !o.has(k) || o.isNull(k)) return 0.0
        return o.optString(k, "0").toDoubleOrNull() ?: o.optDouble(k, 0.0)
    }

    private val HORARIOS = listOf("11:30", "15:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00")
    fun faixa(h: Int, m: Int): String? = Metas.faixa(HORARIOS, "20:14", h, m)

    fun calcular(c: Context, d: JSONObject): List<Pair<String, String>> {
        val hoje = LocalDate.now(ZONA)
        if (hoje.dayOfWeek.value !in 1..5) return emptyList()
        val agora = LocalTime.now(ZONA)
        val faixa = faixa(agora.hour, agora.minute) ?: return emptyList()
        val dia = hoje.toString()
        val dd = d.optJSONObject("dia") ?: return emptyList()
        if (dd.optString("data") != dia || n(dd, "valor") <= 0) return emptyList()
        val r = Metas.Registro(c, dia.take(7))
        val out = ArrayList<Pair<String, String>>()
        if (r.marcar("fat_${dia}_$faixa")) {
            val v = n(dd, "valor")
            out += Pair("Faturamento hoje: ${Fmt.brlK(v)}", Fmt.brl(v) + " · até " + "%02d:%02d".format(agora.hour, agora.minute))
            r.guardar("fatv_$dia", v)
        }
        r.fechar()
        return out
    }
}
