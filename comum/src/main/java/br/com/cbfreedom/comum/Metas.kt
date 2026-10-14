package br.com.cbfreedom.comum

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences

/**
 * Avisos de meta dos painéis (meta batida, vendedor bateu a meta, muito abaixo do ideal).
 * Cada aviso tem uma "chave" e só toca uma vez; na primeira atualização do mês só anota o que já
 * aconteceu (não avisa coisa velha).
 */
object Metas {
    const val CANAL = "metas_paineis"

    fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("metas", Context.MODE_PRIVATE)
    fun ligado(c: Context) = prefs(c).getBoolean("ligado", true)
    fun ligar(c: Context, sim: Boolean) { prefs(c).edit().putBoolean("ligado", sim).apply() }

    /** Registro de avisos de um mês: marcar(chave) devolve true se é para avisar agora. */
    class Registro(c: Context, mes: String) {
        private val p = prefs(c)
        private val ed = p.edit()
        private val base = "base_$mes"
        val primeira = !p.getBoolean(base, false)
        private val marcadas = HashSet<String>()
        fun marcar(chave: String): Boolean {
            if (p.getBoolean(chave, false) || chave in marcadas) return false
            marcadas += chave
            ed.putBoolean(chave, true)
            return !primeira
        }
        /** Estados que mudam (ex.: vendedor ficou abaixo do ritmo) e números guardados (ex.: Standby de manhã). */
        fun tem(chave: String) = p.getBoolean(chave, false)
        fun por(chave: String) { ed.putBoolean(chave, true) }
        fun tirar(chave: String) { ed.remove(chave) }
        fun valor(chave: String): Double? = p.getString(chave, null)?.toDoubleOrNull()
        fun guardar(chave: String, v: Double) { ed.putString(chave, v.toString()) }
        fun fechar() {
            ed.putBoolean(base, true)
            // apaga chaves de meses antigos (guarda só o atual e o anterior)
            val manter = setOf(base.removePrefix("base_"))
            for (k in p.all.keys) {
                val m = Regex("(\\d{4}-\\d{2})").find(k)?.value ?: continue
                if (m !in manter && m < manter.first().let { mesAnterior(it) }) ed.remove(k)
            }
            ed.apply()
        }
        private fun mesAnterior(m: String): String {
            val a = m.take(4).toInt(); val mm = m.drop(5).toInt()
            return if (mm == 1) "${a - 1}-12" else "%d-%02d".format(a, mm - 1)
        }
    }

    /**
     * Para não virar spam: tudo o que saiu numa atualização vira UM aviso só; nada entre 19 h e 8 h
     * (o que acontecer nesse horário é descartado, não acumula); no máximo 8 avisos de painel por dia.
     */
    /** Horário agendado (ex.: "10:00") em que estamos: o último já passado, até "fim"; null fora disso. */
    fun faixa(horarios: List<String>, fim: String, h: Int, m: Int): String? {
        fun min(s: String) = s.take(2).toInt() * 60 + s.drop(3).toInt()
        val agora = h * 60 + m
        if (agora > min(fim)) return null
        return horarios.lastOrNull { min(it) <= agora }
    }

    fun regular(c: Context, avisos: List<Pair<String, String>>, painel: String = ""): List<Pair<String, String>> {
        if (avisos.isEmpty()) return avisos
        val agora = java.time.ZonedDateTime.now(java.time.ZoneId.of("America/Sao_Paulo"))
        // Faturamento de hoje: tem horário próprio (17:30 a 20:00, de 30 em 30 min) e não conta no limite do dia
        if (painel == "faturamento") return avisos
        if (agora.hour < 8 || agora.hour >= 19) return emptyList()
        val p = prefs(c); val k = "qtd_" + agora.toLocalDate()
        val qtd = p.getInt(k, 0)
        if (qtd >= 8) return emptyList()
        p.edit().putInt(k, qtd + 1).apply()
        if (avisos.size == 1) return avisos
        return listOf(Pair("${avisos.size} novidades do painel", avisos.joinToString("\n") { "• " + it.first + (if (it.second.isNotEmpty()) ": " + it.second else "") }))
    }

    fun notificar(c: Context, painel: Painel, avisos0: List<Pair<String, String>>) {
        val avisos = regular(c, avisos0, painel.id)
        if (avisos.isEmpty()) return
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CANAL) == null) {
            val ch = NotificationChannel(CANAL, "Metas dos painéis", NotificationManager.IMPORTANCE_DEFAULT)
            ch.description = "Meta batida, vendedor que bateu a meta e equipe muito abaixo do ideal"
            nm.createNotificationChannel(ch)
        }
        for ((i, a) in avisos.withIndex()) {
            val cod = 96_000 + (a.first.hashCode() and 0xfff) + i
            val abrir = Intent(c, Tela::class.java).setAction("meta.$cod")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(Tela.EXTRA_ABA, "painel").putExtra(Tela.EXTRA_PAINEL, painel.id)
            val n = Notification.Builder(c, CANAL)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(Cor.ROSA)
                .setContentTitle(a.first)
                .setContentText(a.second)
                .setStyle(Notification.BigTextStyle().bigText(a.second))
                .setContentIntent(PendingIntent.getActivity(c, cod, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build()
            try { nm.notify(cod, n) } catch (_: Exception) { }
        }
    }
}
