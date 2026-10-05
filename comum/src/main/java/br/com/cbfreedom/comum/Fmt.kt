package br.com.cbfreedom.comum

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Formatos brasileiros: R$ 1.234,56 · 12,5% · 10:45 */
object Fmt {
    private val BR = Locale("pt", "BR")

    fun num(v: Double): String = String.format(BR, "%,.2f", v)
    fun brl(v: Double): String = "R$ " + num(v)
    private fun um(x: Double, casas: Int = 1): String {
        var s = String.format(BR, "%." + casas + "f", x)
        if (s.contains(",")) s = s.trimEnd('0').trimEnd(',')
        return s
    }
    fun brlK(v: Double): String = when {
        v >= 1e7 -> "R$ " + um(v / 1e6) + " mi"
        v >= 1e6 -> "R$ " + um(v / 1e6, 2) + " mi"
        v >= 1e3 -> "R$ " + um(v / 1e3) + " mil"
        else -> brl(v)
    }
    fun pct(v: Double): String = String.format(BR, "%.1f", v) + "%"
    fun int(v: Double): String = Math.round(v).toString()
    fun hhmm(ms: Long): String = SimpleDateFormat("HH:mm", BR).format(Date(ms))
    fun dataBR(s: String): String {
        val t = s.take(10)
        return if (t.length == 10) t.substring(8, 10) + "/" + t.substring(5, 7) + "/" + t.substring(0, 4) else ""
    }
}
