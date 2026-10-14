package br.com.cbfreedom.comum

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/**
 * Atualização automática a cada 15 minutos (o menor intervalo que o Android permite), com internet:
 * números do widget/painel e, de reserva, os avisos do Helpdesk.
 */
class Tarefa : JobService() {

    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            val app = applicationContext
            try { Fila.enviar(app) } catch (_: Exception) { }
            try { Atualizador.atualizar(app) } catch (_: Exception) { }
            try { Atualizacao.conferir(app, false) } catch (_: Exception) { }   // versão nova do app (no máximo a cada 30 min)
            try {
                Helpdesk.verificar(app, false)
                Helpdesk.agendarAlarme(app)
                if (Helpdesk.ativo(app) && Helpdesk.tempoReal(app)) Helpdesk.iniciarServico(app)
            } catch (_: Exception) { }
            jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val ID = 7301

        fun agendar(c: Context) {
            if (!Store.logado(c)) return
            val js = c.getSystemService(JobScheduler::class.java) ?: return
            if (js.getPendingJob(ID) != null) return
            val job = JobInfo.Builder(ID, ComponentName(c, Tarefa::class.java))
                .setPeriodic(15 * 60_000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            try { js.schedule(job) } catch (_: Exception) { }
        }

        fun cancelar(c: Context) {
            c.getSystemService(JobScheduler::class.java)?.cancel(ID)
        }
    }
}
