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
        private val primeira = !p.getBoolean(base, false)
        fun marcar(chave: String): Boolean {
            if (p.getBoolean(chave, false)) return false
            ed.putBoolean(chave, true)
            return !primeira
        }
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

    fun notificar(c: Context, painel: Painel, avisos: List<Pair<String, String>>) {
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
