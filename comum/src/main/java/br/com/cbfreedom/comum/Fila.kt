package br.com.cbfreedom.comum

import android.app.Notification
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Sem internet:
 *  - guarda o que a pessoa mandou (resposta num chamado, chamado novo) e envia sozinho quando a internet volta;
 *  - guarda a última resposta de cada consulta do Helpdesk para mostrar as telas mesmo offline.
 */
object Fila {

    private const val PREFS = "fila"
    private val trava = Any()

    // ---------------- é falta de internet? ----------------

    fun online(c: Context): Boolean = try {
        val cm = c.getSystemService(ConnectivityManager::class.java)
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    } catch (_: Exception) { true }

    /** Erro de rede (sem sinal, site fora do ar, tempo esgotado) — não é erro do site nem de login. */
    fun semInternet(c: Context, e: Throwable?): Boolean {
        if (!online(c)) return true
        var x = e
        while (x != null) {
            if (x is java.net.UnknownHostException || x is java.net.ConnectException || x is java.net.SocketTimeoutException ||
                x is java.net.NoRouteToHostException || x is java.net.SocketException || x is java.io.InterruptedIOException ||
                x is javax.net.ssl.SSLException) return true
            x = x.cause
        }
        return false
    }

    // ---------------- fila de envio ----------------

    private fun ler(c: Context): JSONArray = try { JSONArray(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("itens", "[]")) } catch (_: Exception) { JSONArray() }
    private fun gravar(c: Context, a: JSONArray) { c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("itens", a.toString()).commit() }

    fun pendentes(c: Context): JSONArray = synchronized(trava) { ler(c) }
    fun quantos(c: Context): Int = synchronized(trava) { ler(c).length() }

    /** Respostas ainda não enviadas deste chamado (para mostrar na conversa como "aguardando internet"). */
    fun doChamado(c: Context, id: Int): JSONArray {
        val r = JSONArray()
        val a = pendentes(c)
        for (i in 0 until a.length()) {
            val x = a.optJSONObject(i) ?: continue
            if (x.optString("tipo") == "resposta" && x.optInt("chamado") == id) r.put(JSONObject().put("texto", x.optString("texto")).put("criado", x.optLong("criado")))
        }
        return r
    }

    fun adicionarResposta(c: Context, id: Int, texto: String) =
        adicionar(c, JSONObject().put("tipo", "resposta").put("chamado", id).put("texto", texto))

    fun adicionarChamado(c: Context, corpo: String) {
        val titulo = try { JSONObject(corpo).optString("title") } catch (_: Exception) { "" }
        adicionar(c, JSONObject().put("tipo", "novo").put("corpo", corpo).put("titulo", titulo))
    }

    private fun adicionar(c: Context, item: JSONObject) {
        synchronized(trava) {
            val a = ler(c)
            a.put(item.put("criado", System.currentTimeMillis()).put("uid", System.nanoTime().toString(36)))
            gravar(c, a)
        }
        agendar(c)
        Helpdesk.avisarTela()
    }

    @Volatile private var enviando = false

    /** Tenta mandar tudo o que está guardado. Para no primeiro erro de internet (tenta de novo depois). */
    fun enviar(c0: Context) {
        val c = c0.applicationContext
        if (enviando || quantos(c) == 0 || !online(c)) return
        enviando = true
        try {
            while (true) {
                val item = synchronized(trava) { ler(c).optJSONObject(0) } ?: break
                val tipo = item.optString("tipo")
                var tirar = true
                try {
                    if (tipo == "resposta") {
                        val id = item.optInt("chamado")
                        val r = Chamado.responderAgora(c, id, item.optString("texto"))
                        if (r.semInternet) { tirar = false }
                        else notificar(c, if (r.ok) "Resposta enviada" else "Não deu para enviar a resposta",
                            (if (r.ok) "Sua resposta guardada sem internet foi enviada no chamado #$id." else r.mensagem + " (chamado #$id)"),
                            "/helpdesk/tickets/$id")
                    } else if (tipo == "novo") {
                        val r = Chamado.requisicaoDireta(c, "POST", "/helpdesk/tickets", item.optString("corpo"))
                        if (r == null) tirar = false
                        else {
                            val ok = r.first in 200..299
                            val novo = if (ok) try { JSONObject(r.second) } catch (_: Exception) { null } else null
                            val prot = novo?.optString("protocol")?.takeIf { it.isNotEmpty() }
                            notificar(c, if (ok) "Chamado aberto" + (prot?.let { " · $it" } ?: "") else "Não deu para abrir o chamado",
                                if (ok) "O chamado \"" + item.optString("titulo") + "\", guardado sem internet, foi aberto."
                                else "\"" + item.optString("titulo") + "\": o site recusou (HTTP " + r.first + "). Abra de novo pelo app.",
                                novo?.optInt("id")?.takeIf { it > 0 }?.let { "/helpdesk/tickets/$it" })
                        }
                    }
                } catch (_: Exception) { tirar = false }
                if (!tirar) break
                synchronized(trava) {
                    val a = ler(c); val b = JSONArray()
                    for (i in 0 until a.length()) { val x = a.optJSONObject(i); if (x != null && x.optString("uid") != item.optString("uid")) b.put(x) }
                    gravar(c, b)
                }
                Helpdesk.avisarTela()
            }
        } finally { enviando = false }
        if (quantos(c) > 0) agendar(c)
    }

    private fun notificar(c: Context, titulo: String, texto: String, caminho: String?) {
        Helpdesk.criarCanais(c)
        val cod = 95_000 + (System.currentTimeMillis() % 4_000).toInt()
        val n = Notification.Builder(c, Helpdesk.CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setContentIntent(Helpdesk.abrirApp(c, caminho, cod))
            .setAutoCancel(true)
            .build()
        try { Helpdesk.nm(c).notify(cod, n) } catch (_: Exception) { }
    }

    /** Tarefa do Android que roda assim que a internet voltar (mesmo com o app fechado). */
    fun agendar(c: Context) {
        val js = c.getSystemService(JobScheduler::class.java) ?: return
        val job = JobInfo.Builder(7302, ComponentName(c, FilaTarefa::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build()
        try { js.schedule(job) } catch (_: Exception) { }
    }

    fun limpar(c: Context) {
        synchronized(trava) { gravar(c, JSONArray()) }
        try { File(c.filesDir, "offline").deleteRecursively() } catch (_: Exception) { }
    }

    // ---------------- respostas guardadas (para ver offline) ----------------

    private fun arquivo(c: Context, chave: String): File {
        val h = MessageDigest.getInstance("SHA-1").digest(chave.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(File(c.filesDir, "offline").apply { mkdirs() }, "$h.json")
    }

    fun guardar(c: Context, chave: String, corpo: String) {
        try { arquivo(c, chave).writeText(JSONObject().put("t", System.currentTimeMillis()).put("b", corpo).toString()) } catch (_: Exception) { }
    }

    /** (hora em que foi guardado, corpo) ou null. */
    fun guardado(c: Context, chave: String): Pair<Long, String>? = try {
        val f = arquivo(c, chave)
        if (!f.exists()) null else JSONObject(f.readText()).let { Pair(it.optLong("t"), it.optString("b")) }
    } catch (_: Exception) { null }
}

class FilaTarefa : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            try { Fila.enviar(applicationContext) } catch (_: Exception) { }
            jobFinished(params, Fila.quantos(applicationContext) > 0)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
