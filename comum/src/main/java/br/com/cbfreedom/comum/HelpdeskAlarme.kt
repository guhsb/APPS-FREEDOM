package br.com.cbfreedom.comum

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean

/** Alarme que acorda o celular (inclusive em modo soneca) para verificar o Helpdesk. */
class HelpdeskAlarme : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (!Helpdesk.ativo(c) || !Store.logado(c)) return
        Helpdesk.agendarAlarme(c)
        if (Helpdesk.verificando) return          // já tem uma verificação rodando
        val pendente = goAsync()
        val fechado = AtomicBoolean(false)
        val fechar = Runnable { if (fechado.compareAndSet(false, true)) try { pendente.finish() } catch (_: Exception) { } }
        // o Android dá ~60 s para um alarme: libera antes disso mesmo se o site estiver lento
        Handler(Looper.getMainLooper()).postDelayed(fechar, 50_000L)
        Helpdesk.cicloEmSegundoPlano(c) { fechar.run() }
    }
}
