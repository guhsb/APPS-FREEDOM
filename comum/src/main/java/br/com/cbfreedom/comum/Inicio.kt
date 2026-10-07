package br.com.cbfreedom.comum

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Depois de reiniciar o celular ou atualizar o app: religa a atualização do widget e os avisos do Helpdesk. */
class Inicio : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (!Store.logado(c)) return
        Tarefa.agendar(c)
        Helpdesk.aplicar(c)
    }
}
