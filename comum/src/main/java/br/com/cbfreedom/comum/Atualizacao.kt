package br.com.cbfreedom.comum

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Atualização do próprio app pelas versões publicadas no GitHub (Releases).
 * Confere de tempos em tempos; quando tem versão nova, avisa (aba Helpdesk + notificação)
 * e instala com o instalador do Android, que só aceita se o APK tiver a mesma assinatura do app instalado.
 */
object Atualizacao {

    /** Repositório onde o GitHub Actions publica o Freedom.apk. */
    const val REPO = "guhsb/APPS-FREEDOM"
    private const val ARQUIVO = "Freedom.apk"
    private const val NOTIF = 45
    private const val NOTIF_INSTALAR = 46
    private const val INTERVALO_MS = 6 * 3600_000L
    const val ACAO_STATUS = "br.com.cbfreedom.ATUALIZACAO_STATUS"

    enum class Conferencia { NOVA, EM_DIA, FALHOU }

    private val emAndamento = java.util.concurrent.atomic.AtomicBoolean(false)
    val baixando: Boolean get() = emAndamento.get()
    @Volatile var progresso = 0          // 0..100
    @Volatile var erro: String? = null
    /** A tela do app está aberta (o instalador pode abrir na frente). */
    @Volatile var telaAberta = false

    private fun p(c: Context): SharedPreferences = c.getSharedPreferences("atualizacao", Context.MODE_PRIVATE)

    fun versaoAtual(c: Context): Long = try {
        val i = c.packageManager.getPackageInfo(c.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    } catch (_: Exception) { 0L }

    fun nomeVersao(c: Context): String = try {
        c.packageManager.getPackageInfo(c.packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }

    /** Versão nova publicada (ou null se o app já está em dia). */
    fun nova(c: Context): JSONObject? {
        val s = p(c).getString("ultima", null) ?: return null
        val o = try { JSONObject(s) } catch (_: Exception) { return null }
        return if (o.optLong("versao") > versaoAtual(c) && o.optString("url").isNotEmpty()) o else null
    }

    /** O que a aba Helpdesk mostra sobre a versão do app. */
    fun resumo(c: Context): JSONObject {
        val o = JSONObject().put("atual", nomeVersao(c)).put("baixando", baixando).put("progresso", progresso)
            .put("conferido", p(c).getLong("hora", 0L))
        erro?.let { o.put("erro", it) }
        nova(c)?.let { o.put("nova", it.optLong("versao")).put("notas", it.optString("notas")) }
        return o
    }

    /**
     * Consulta o GitHub (no máximo a cada 6 h, ou na hora se forcar = true). Roda fora da tela principal.
     */
    fun conferir(c: Context, forcar: Boolean): Conferencia {
        val pr = p(c)
        val agora = System.currentTimeMillis()
        fun atual() = if (nova(c) != null) Conferencia.NOVA else Conferencia.EM_DIA
        if (!forcar && agora - pr.getLong("hora", 0L) < INTERVALO_MS) return atual()
        try {
            val con = URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection
            con.connectTimeout = 15000; con.readTimeout = 20000
            con.setRequestProperty("Accept", "application/vnd.github+json")
            con.setRequestProperty("User-Agent", "Freedom-Android")
            val cod = con.responseCode
            if (cod != 200) {
                con.disconnect(); pr.edit().putLong("hora", agora).apply()
                return if (nova(c) != null) Conferencia.NOVA else Conferencia.FALHOU
            }
            val r = JSONObject(con.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() })
            con.disconnect()
            val versao = r.optString("tag_name").filter { it.isDigit() }.toLongOrNull() ?: 0L
            var url = ""; var tamanho = -1L
            val assets = r.optJSONArray("assets")
            if (assets != null) for (i in 0 until assets.length()) {
                val a = assets.optJSONObject(i) ?: continue
                if (a.optString("name") == ARQUIVO) { url = a.optString("browser_download_url"); tamanho = a.optLong("size", -1L) }
            }
            val info = JSONObject().put("versao", versao).put("url", url).put("tamanho", tamanho)
                .put("pagina", r.optString("html_url")).put("notas", r.optString("body").take(400))
            pr.edit().putString("ultima", info.toString()).putLong("hora", agora).apply()
        } catch (_: Exception) {
            return if (nova(c) != null) Conferencia.NOVA else Conferencia.FALHOU     // sem internet: tenta na próxima
        }
        val n = nova(c) ?: return Conferencia.EM_DIA
        // avisa uma vez por versão
        if (pr.getLong("avisada", 0L) != n.optLong("versao")) {
            pr.edit().putLong("avisada", n.optLong("versao")).apply()
            notificar(c, "Nova versão do Freedom", "A versão " + n.optLong("versao") + " está disponível. Toque para atualizar.",
                Intent(c, Tela::class.java).putExtra(Tela.EXTRA_ATUALIZAR, true), NOTIF)
        }
        return Conferencia.NOVA
    }

    fun conferirEmSegundoPlano(c: Context, forcar: Boolean, depois: (() -> Unit)? = null) {
        val app = c.applicationContext
        Thread { try { conferir(app, forcar) } catch (_: Exception) { }; depois?.invoke() }.start()
    }

    /** O Android deixa este app instalar APKs? (opção "instalar apps desconhecidos" do Freedom) */
    fun podeInstalar(c: Context): Boolean = Build.VERSION.SDK_INT < 26 || c.packageManager.canRequestPackageInstalls()

    /**
     * Baixa o APK novo direto para o instalador do Android. avisar() é chamado a cada mudança de progresso.
     * Precisa rodar fora da tela principal.
     */
    fun baixarEInstalar(c0: Context, avisar: () -> Unit) {
        val c = c0.applicationContext
        val n = nova(c) ?: return
        if (!emAndamento.compareAndSet(false, true)) return     // já está baixando (toque duplo)
        progresso = 0; erro = null
        avisar()
        val pi = c.packageManager.packageInstaller
        var sessao = -1
        try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(c.packageName)
            val total = n.optLong("tamanho", -1L)
            if (total > 0) params.setSize(total)
            sessao = pi.createSession(params)
            pi.openSession(sessao).use { s ->
                var con = URL(n.optString("url")).openConnection() as HttpURLConnection
                con.connectTimeout = 20000; con.readTimeout = 60000
                con.setRequestProperty("User-Agent", "Freedom-Android")
                con.instanceFollowRedirects = true
                // o GitHub redireciona para outro endereço do próprio GitHub
                var saltos = 0
                while (con.responseCode in 300..399 && saltos < 5) {
                    val destino = con.getHeaderField("Location") ?: break
                    con.disconnect()
                    con = URL(URL(n.optString("url")), destino).openConnection() as HttpURLConnection
                    con.connectTimeout = 20000; con.readTimeout = 60000
                    con.setRequestProperty("User-Agent", "Freedom-Android")
                    saltos++
                }
                if (con.responseCode != 200) throw java.io.IOException("download falhou (HTTP " + con.responseCode + ")")
                val tam = if (con.contentLengthLong > 0) con.contentLengthLong else total
                s.openWrite(ARQUIVO, 0, if (tam > 0) tam else -1).use { out ->
                    con.inputStream.use { ent ->
                        val buf = ByteArray(64 * 1024)
                        var lido = 0L
                        var ultimo = -1
                        while (true) {
                            val k = ent.read(buf)
                            if (k < 0) break
                            out.write(buf, 0, k)
                            lido += k
                            if (tam > 0) {
                                val pct = (lido * 100 / tam).toInt().coerceIn(0, 100)
                                if (pct / 5 != ultimo / 5) { progresso = pct; ultimo = pct; avisar() }
                            }
                        }
                    }
                    s.fsync(out)
                }
                con.disconnect()
                progresso = 100
                val status = Intent(c, AtualizacaoRecebedor::class.java).setAction(ACAO_STATUS)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                s.commit(PendingIntent.getBroadcast(c, 11, status, flags).intentSender)
            }
        } catch (e: Exception) {
            erro = "Não consegui baixar a versão nova: " + Api.mensagem(e)
            if (sessao >= 0) try { pi.abandonSession(sessao) } catch (_: Exception) { }
        } finally {
            emAndamento.set(false)
            avisar()
        }
    }

    /** Página da versão no GitHub (plano B: baixar pelo navegador). */
    fun pagina(c: Context): String {
        val n = nova(c)
        return n?.optString("url")?.takeIf { it.isNotEmpty() } ?: n?.optString("pagina")?.takeIf { it.isNotEmpty() }
        ?: "https://github.com/$REPO/releases/latest"
    }

    fun notificar(c: Context, titulo: String, texto: String, abrir: Intent, id: Int) {
        Helpdesk.criarCanais(c)
        abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pi = PendingIntent.getActivity(c, id, abrir, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = Notification.Builder(c, Helpdesk.CANAL_SISTEMA)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle(titulo).setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setContentIntent(pi)
            .setAutoCancel(true)
        try { Helpdesk.nm(c).notify(id, b.build()) } catch (_: Exception) { }
    }

    internal fun resultado(c: Context, i: Intent) {
        val st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (st) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirmar = (if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                                 else i.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (telaAberta) {
                    try { c.startActivity(confirmar); return } catch (_: Exception) { }
                }
                // app em segundo plano: o Android não deixa abrir a tela sozinho, então avisa
                notificar(c, "Atualização baixada", "Toque para instalar a versão nova do Freedom.", confirmar, NOTIF_INSTALAR)
            }
            PackageInstaller.STATUS_SUCCESS -> { erro = null; Helpdesk.nm(c).cancel(NOTIF) }
            PackageInstaller.STATUS_FAILURE_ABORTED -> erro = null       // a pessoa cancelou
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                erro = "O Android recusou a versão nova (assinatura diferente). Desinstale o app e instale o Freedom.apk do GitHub."
            PackageInstaller.STATUS_FAILURE_STORAGE -> erro = "Sem espaço no celular para instalar a atualização."
            else -> erro = "A instalação falhou: " + (i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "erro $st")
        }
        Helpdesk.avisarTela()
    }

    fun abrirNoNavegador(c: Context) {
        try {
            c.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(pagina(c))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) { }
    }
}

/** Resposta do instalador do Android (pedir confirmação, instalado, falhou). */
class AtualizacaoRecebedor : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Atualizacao.ACAO_STATUS) Atualizacao.resultado(c, i)
    }
}
