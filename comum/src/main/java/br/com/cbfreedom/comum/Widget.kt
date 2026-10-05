package br.com.cbfreedom.comum

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.widget.RemoteViews
import kotlin.math.min
import kotlin.math.sqrt

/** O widget da tela inicial. Tocar no horário atualiza; tocar no resto abre a tela cheia. */
class Widget : AppWidgetProvider() {

    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) desenhar(c, m, id)
        Tarefa.agendar(c)
        if (Store.logado(c) && Atualizador.velho(c, 10)) emSegundoPlano(c)
    }

    override fun onAppWidgetOptionsChanged(c: Context, m: AppWidgetManager, id: Int, novas: Bundle) {
        desenhar(c, m, id)
    }

    override fun onEnabled(c: Context) {
        Tarefa.agendar(c)
    }

    override fun onReceive(c: Context, i: Intent) {
        if (i.action == ACAO_ATUALIZAR) {
            emSegundoPlano(c)
            return
        }
        super.onReceive(c, i)
    }

    private fun emSegundoPlano(c: Context) {
        val pendente = goAsync()
        val app = c.applicationContext
        Thread {
            try { Atualizador.atualizar(app) } finally { pendente.finish() }
        }.start()
    }

    companion object {
        const val ACAO_ATUALIZAR = "br.com.cbfreedom.ATUALIZAR_WIDGET"

        fun redesenharTodos(c: Context) {
            try {
                val m = AppWidgetManager.getInstance(c)
                for (id in m.getAppWidgetIds(ComponentName(c, Widget::class.java))) desenhar(c, m, id)
            } catch (_: Exception) { }
        }

        fun desenhar(c: Context, m: AppWidgetManager, id: Int) {
            val o = m.getAppWidgetOptions(id)
            val deitado = c.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
            var w = o.getInt(if (deitado) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
            var h = o.getInt(if (deitado) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
            if (w <= 0) w = 250
            if (h <= 0) h = 110
            val dens = c.resources.displayMetrics.density
            // limita o tamanho da imagem (o Android recusa imagens muito grandes em widgets)
            var k = min(dens, sqrt(900_000f / (w.toFloat() * h.toFloat())))

            val abrir = PendingIntent.getActivity(
                c, 0, Intent(c, Tela::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val atualizar = PendingIntent.getBroadcast(
                c, 1, Intent(c, Widget::class.java).setAction(ACAO_ATUALIZAR),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            for (tentativa in 0..2) {
                try {
                    val rv = RemoteViews(c.packageName, R.layout.widget)
                    rv.setImageViewBitmap(R.id.img, Freedom.imagem(c, w.toFloat(), h.toFloat(), k))
                    rv.setOnClickPendingIntent(R.id.raiz, abrir)
                    rv.setOnClickPendingIntent(R.id.zona_atualizar, if (Store.logado(c)) atualizar else abrir)
                    m.updateAppWidget(id, rv)
                    return
                } catch (_: Exception) {
                    k *= 0.6f   // imagem grande demais para este celular: tenta menor
                }
            }
        }
    }
}
