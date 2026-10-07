package br.com.cbfreedom.comum

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

/** Modo tempo real: fica em primeiro plano (aviso fixo) e verifica o Helpdesk no intervalo escolhido. */
class HelpdeskServico : Service() {

    private val h = Handler(Looper.getMainLooper())

    private fun deveRodar() = Helpdesk.ativo(this) && Helpdesk.tempoReal(this) && Store.logado(this)

    private val tick = object : Runnable {
        override fun run() {
            if (!deveRodar()) { parar(); return }
            Helpdesk.emSegundoPlano(applicationContext, false)
            h.postDelayed(this, Helpdesk.intervalo(this@HelpdeskServico) * 60_000L)
        }
    }

    /** Coloca em primeiro plano. Devolve false se o Android não deixou (ex.: reiniciado em segundo plano). */
    private fun emPrimeiroPlano(): Boolean = try {
        val n = Helpdesk.notifMonitor(this)
        if (Build.VERSION.SDK_INT >= 34) startForeground(Helpdesk.NOTIF_MONITOR, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(Helpdesk.NOTIF_MONITOR, n)
        true
    } catch (_: Exception) {
        false
    }

    private fun parar() {
        h.removeCallbacks(tick)
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Exception) { }
        stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // sem primeiro plano o Android encerraria o app; nesse caso o job e o alarme seguem verificando
        if (!emPrimeiroPlano() || !deveRodar()) { parar(); return START_NOT_STICKY }
        h.removeCallbacks(tick)
        h.post(tick)
        return START_STICKY
    }

    override fun onDestroy() {
        h.removeCallbacks(tick)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
