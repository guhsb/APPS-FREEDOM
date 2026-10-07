package br.com.cbfreedom.comum

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.widget.RemoteViews
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Widget da tela inicial de um painel. Cada painel tem a sua classe (ex.: WidgetComercial), que só
 * diz qual é o painel. Tocar no horário atualiza; tocar no resto abre o app na aba Painel.
 */
abstract class Widget(private val painelId: String) : AppWidgetProvider() {

    private fun painel(): Painel? = Freedom.porId(painelId)

    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        val p = painel() ?: return
        for (id in ids) desenhar(c, m, id, p)
        Tarefa.agendar(c)
        if (Store.logado(c) && Atualizador.velho(c, 10)) emSegundoPlano(c)
    }

    override fun onAppWidgetOptionsChanged(c: Context, m: AppWidgetManager, id: Int, novas: Bundle) {
        val p = painel() ?: return
        desenhar(c, m, id, p)
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
                for (p in Freedom.paineis) {
                    for (id in m.getAppWidgetIds(ComponentName(c, p.classeWidget))) desenhar(c, m, id, p)
                }
            } catch (_: Exception) { }
        }

        /**
         * Deixa na lista de widgets do celular só os painéis que o login pode ver
         * (quem não tem acesso ao Comercial nem vê o widget do Comercial).
         */
        fun ajustarDisponiveis(c: Context) {
            val pm = c.packageManager
            for (p in Freedom.paineis) {
                val estado = if (Acesso.tem(c, p.modulo)) PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
                else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                try {
                    val comp = ComponentName(c, p.classeWidget)
                    if (pm.getComponentEnabledSetting(comp) != estado)
                        pm.setComponentEnabledSetting(comp, estado, PackageManager.DONT_KILL_APP)
                } catch (_: Exception) { }
            }
        }

        fun desenhar(c: Context, m: AppWidgetManager, id: Int, painel: Painel) {
            val o = m.getAppWidgetOptions(id)
            val deitado = c.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
            var w = o.getInt(if (deitado) AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
            var h = o.getInt(if (deitado) AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
            if (w <= 0) w = 250
            if (h <= 0) h = 110
            val dens = c.resources.displayMetrics.density
            // limita o tamanho da imagem (o Android recusa imagens muito grandes em widgets)
            var k = min(dens, sqrt(900_000f / (w.toFloat() * h.toFloat())))

            val n = Freedom.paineis.indexOf(painel).coerceAtLeast(0)
            val abrir = PendingIntent.getActivity(
                c, 100 + n * 2,
                Intent(c, Tela::class.java).setAction("painel." + painel.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(Tela.EXTRA_ABA, painel.aba).putExtra(Tela.EXTRA_PAINEL, painel.id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val atualizar = PendingIntent.getBroadcast(
                c, 101 + n * 2, Intent(c, painel.classeWidget).setAction(ACAO_ATUALIZAR),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            for (tentativa in 0..2) {
                try {
                    val rv = RemoteViews(c.packageName, R.layout.widget)
                    rv.setImageViewBitmap(R.id.img, Freedom.imagem(c, painel, w.toFloat(), h.toFloat(), k))
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
