package br.com.cbfreedom.comum

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject

/**
 * Tela do app, com 3 abas embaixo:
 *  1. Helpdesk (principal) – avisos e chamados
 *  2. Site – o site relatorios.cbfreedom.com.br completo, já logado
 *  3. Painel – os números de cada área liberada para o login (Comercial, Faturamento…),
 *     os mesmos dos widgets. Com mais de um painel, aparece um seletor em cima.
 * As abas e os painéis aparecem conforme os módulos que o login tem no site (classe Acesso).
 * Sem login, mostra só a tela de login.
 */
class Tela : Activity() {

    companion object {
        const val EXTRA_ABA = "aba"
        const val EXTRA_PAINEL = "painel"
        const val ABA_HELPDESK = "helpdesk"
        const val ABA_SITE = "site"
        const val ABA_PAINEL = "painel"
        private const val ASSET = "file:///android_asset/"
        private const val REQ_ARQUIVO = 31
        private const val REQ_PERMISSAO = 32
        private const val HOST = "relatorios.cbfreedom.com.br"
        private val FUNDO = Color.parseColor("#0a0c12")
        private val FUNDO_BARRA = Color.parseColor("#0e1119")

        /** Faz os downloads gerados por JavaScript no site (blob:/data:) virem para o app salvar. */
        private const val GANCHO_DOWNLOAD = "(function(){" +
            "if(window.__fdHook)return;window.__fdHook=true;var blobs={};" +
            "var oc=URL.createObjectURL;URL.createObjectURL=function(o){var u=oc.apply(URL,arguments);" +
            "try{if(o instanceof Blob)blobs[u]=o;}catch(e){}return u;};" +
            "function send(b,n){var fr=new FileReader();fr.onloadend=function(){FreedomArquivos.salvar(String(fr.result),n||'');};fr.readAsDataURL(b);}" +
            "window.__fdSave=function(h,n){var b=blobs[h];if(b){send(b,n);return;}" +
            "if(h.indexOf('data:')===0){FreedomArquivos.salvar(h,n||'');return;}" +
            "fetch(h).then(function(r){return r.blob();}).then(function(b){send(b,n);}).catch(function(){FreedomArquivos.falhou();});};" +
            "var ck=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){var h=this.href||'';" +
            "if(h.indexOf('blob:')===0||h.indexOf('data:')===0){window.__fdSave(h,this.getAttribute('download'));return;}" +
            "return ck.apply(this,arguments);};" +
            "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a'):null;" +
            "if(!a)return;var h=a.href||'';if(h.indexOf('blob:')===0||h.indexOf('data:')===0){e.preventDefault();e.stopPropagation();" +
            "window.__fdSave(h,a.getAttribute('download'));}},true);" +
            "})();"
    }

    private lateinit var conteudo: FrameLayout
    private lateinit var linhaAbas: View
    private lateinit var barraAbas: LinearLayout
    private lateinit var webApp: WebView          // login e aba Helpdesk
    private var webSite: WebView? = null
    private var caixaPainel: LinearLayout? = null
    private var chipsPainel: LinearLayout? = null
    private var framePaineis: FrameLayout? = null
    private val websPainel = LinkedHashMap<String, WebView>()
    private var painelAtual: String? = null
    private var caixaSite: FrameLayout? = null
    private var progresso: ProgressBar? = null
    private lateinit var selo: TextView
    private val abas = LinkedHashMap<String, Pair<ImageView, TextView>>()
    private val itensAba = HashMap<String, View>()
    private var avisoSite: View? = null
    private var urlComErro: String? = null

    private var aba = ABA_HELPDESK
    private var paginaApp = ""
    private var arquivoCallback: ValueCallback<Array<Uri>>? = null
    private var logandoSite = false
    private var ultimoLoginSite = 0L
    private var destinoSite: String? = null
    private var pediuPermissoes = false

    // =====================================================================================
    // Montagem da tela
    // =====================================================================================

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        Helpdesk.criarCanais(this)

        val raiz = LinearLayout(this)
        raiz.orientation = LinearLayout.VERTICAL
        raiz.setBackgroundColor(FUNDO)
        conteudo = FrameLayout(this)
        raiz.addView(conteudo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        linhaAbas = View(this)
        linhaAbas.setBackgroundColor(Color.parseColor("#232838"))
        raiz.addView(linhaAbas, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        barraAbas = criarAbas()
        raiz.addView(barraAbas, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)))
        setContentView(raiz)

        webApp = novaWebLocal()
        conteudo.addView(webApp, cheio())
        // aberto de novo pelo Android (pela lista de recentes ou depois de fechado): não repete o aviso/aba antigos
        val doHistorico = estado != null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        carregar(if (doHistorico) null else intent)
    }

    private fun dp(v: Int): Int = Math.round(v * resources.displayMetrics.density)
    private fun cheio() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    private fun criarAbas(): LinearLayout {
        val barra = LinearLayout(this)
        barra.orientation = LinearLayout.HORIZONTAL
        barra.setBackgroundColor(FUNDO_BARRA)
        val itens = listOf(
            Triple(ABA_HELPDESK, "Helpdesk", R.drawable.ic_aba_helpdesk),
            Triple(ABA_SITE, "Site", R.drawable.ic_aba_site),
            Triple(ABA_PAINEL, "Painel", R.drawable.ic_aba_painel)
        )
        val tv = TypedValue()
        theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true)
        for ((id, rotulo, icone) in itens) {
            val item = LinearLayout(this)
            item.orientation = LinearLayout.VERTICAL
            item.gravity = Gravity.CENTER
            if (tv.resourceId != 0) item.setBackgroundResource(tv.resourceId)
            item.isClickable = true
            item.contentDescription = rotulo

            val caixa = FrameLayout(this)
            val img = ImageView(this)
            img.setImageResource(icone)
            caixa.addView(img, FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER))
            if (id == ABA_HELPDESK) {
                selo = TextView(this)
                selo.setTextColor(Color.WHITE)
                selo.textSize = 9f
                selo.gravity = Gravity.CENTER
                selo.setPadding(dp(4), 0, dp(4), 0)
                val fundo = GradientDrawable()
                fundo.cornerRadius = dp(8).toFloat()
                fundo.setColor(Cor.ROSA)
                selo.background = fundo
                selo.visibility = View.GONE
                caixa.addView(selo, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(15), Gravity.TOP or Gravity.END))
            }
            item.addView(caixa, LinearLayout.LayoutParams(dp(40), dp(28)))
            val txt = TextView(this)
            txt.text = rotulo
            txt.textSize = 11f
            txt.gravity = Gravity.CENTER
            item.addView(txt, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            item.setOnClickListener {
                // tocar de novo no Site volta para o início do site
                if (aba == id && id == ABA_SITE) webSite?.let { abrirUrlSite(Helpdesk.SITE + "/") } else selecionar(id)
            }
            item.setOnLongClickListener {
                if (id == ABA_SITE) { selecionar(ABA_SITE); webSite?.reload(); toast("Recarregando o site…"); true } else false
            }
            barra.addView(item, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
            abas[id] = Pair(img, txt)
            itensAba[id] = item
        }
        return barra
    }

    private fun pintarAbas() {
        for ((id, par) in abas) {
            val cor = if (id == aba) Cor.ROSA else Color.parseColor("#8b93a7")
            par.first.setColorFilter(cor)
            par.second.setTextColor(cor)
        }
    }

    private fun abaDisponivel(id: String): Boolean = when (id) {
        ABA_HELPDESK -> Acesso.helpdesk(this)
        ABA_PAINEL -> Acesso.painel(this)
        else -> true
    }

    /** Mostra só as abas dos módulos que o login tem no site (Helpdesk e/ou o Painel deste app). */
    private fun ajustarAbas() {
        for ((id, v) in itensAba) v.visibility = if (abaDisponivel(id)) View.VISIBLE else View.GONE
        if (Store.logado(this) && !abaDisponivel(aba)) {
            selecionar(listOf(ABA_HELPDESK, ABA_PAINEL, ABA_SITE).first { abaDisponivel(it) })
        }
        if (caixaPainel != null) montarChips()
    }

    private fun atualizarSelo() {
        if (!::selo.isInitialized) return
        val n = if (aba == ABA_HELPDESK) 0 else Helpdesk.naoVistos(this)
        selo.visibility = if (n > 0) View.VISIBLE else View.GONE
        selo.text = if (n > 9) "9+" else n.toString()
    }

    // =====================================================================================
    // Navegação
    // =====================================================================================

    private fun carregar(i: Intent?) {
        if (!Store.logado(this)) {
            linhaAbas.visibility = View.GONE
            barraAbas.visibility = View.GONE
            webSite?.visibility = View.GONE
            caixaSite?.visibility = View.GONE
            caixaPainel?.visibility = View.GONE
            webApp.visibility = View.VISIBLE
            if (paginaApp != "login") { webApp.loadUrl(ASSET + "login.html"); paginaApp = "login" }
            return
        }
        linhaAbas.visibility = View.VISIBLE
        barraAbas.visibility = View.VISIBLE
        if (paginaApp != "helpdesk") { webApp.loadUrl(ASSET + "helpdesk.html"); paginaApp = "helpdesk" }
        val caminho = i?.getStringExtra(Helpdesk.EXTRA_CAMINHO)
        val pedida = i?.getStringExtra(EXTRA_ABA)
        i?.getStringExtra(EXTRA_PAINEL)?.let { if (Freedom.porId(it) != null) painelAtual = it }
        i?.removeExtra(Helpdesk.EXTRA_CAMINHO)
        i?.removeExtra(EXTRA_ABA)
        i?.removeExtra(EXTRA_PAINEL)
        for ((id, v) in itensAba) v.visibility = if (abaDisponivel(id)) View.VISIBLE else View.GONE
        when {
            caminho != null -> abrirNoSite(caminho)
            pedida != null && abaDisponivel(pedida) -> selecionar(pedida)
            else -> selecionar(aba)
        }
        ajustarAbas()
        pedirPermissoes()
    }

    private fun selecionar(nova: String) {
        aba = nova
        webApp.visibility = if (nova == ABA_HELPDESK) View.VISIBLE else View.GONE
        if (nova == ABA_SITE) garantirSite(null)
        caixaSite?.visibility = if (nova == ABA_SITE) View.VISIBLE else View.GONE
        if (nova == ABA_PAINEL) garantirPainel()
        caixaPainel?.visibility = if (nova == ABA_PAINEL) View.VISIBLE else View.GONE
        pintarAbas()
        if (nova == ABA_HELPDESK) {
            Helpdesk.marcarVisto(this)
            avisarHelpdesk()
        }
        if (nova == ABA_PAINEL && Atualizador.velho(this, 2)) atualizarPainel()
        atualizarSelo()
    }

    private fun abrirNoSite(caminho: String) {
        // só abre na aba Site endereços do próprio site; o resto vai para o navegador
        if (caminho.contains("://") && Uri.parse(caminho).host != HOST) { abrirFora(caminho); return }
        val url = if (caminho.contains("://")) caminho else Helpdesk.SITE + (if (caminho.startsWith("/")) caminho else "/$caminho")
        val nova = webSite == null
        garantirSite(url)
        selecionar(ABA_SITE)
        if (!nova) abrirUrlSite(url)
    }

    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        setIntent(i)
        carregar(i)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val s = webSite
        if (aba == ABA_SITE && s != null && avisoSite?.visibility == View.VISIBLE) {
            avisoSite?.visibility = View.GONE
            if (s.canGoBack()) { s.goBack(); return }
        }
        if (aba == ABA_SITE && s != null) {
            // volta no histórico do site, pulando a tela de login (o app entra sozinho)
            val h = s.copyBackForwardList()
            var passos = -1
            while (h.currentIndex + passos >= 0 && (h.getItemAtIndex(h.currentIndex + passos)?.url ?: "").contains("/login")) passos--
            if (h.currentIndex + passos >= 0) { s.goBackOrForward(passos); return }
        }
        when {
            aba != ABA_HELPDESK && Store.logado(this) -> selecionar(ABA_HELPDESK)
            else -> super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        webApp.onResume(); webSite?.onResume(); websPainel.values.forEach { it.onResume() }
        Helpdesk.ouvinte = { runOnUiThread { avisarHelpdesk(); atualizarSelo(); if (Store.logado(this)) ajustarAbas() } }
        if (Store.logado(this)) {
            Helpdesk.aplicar(this)
            val p = Helpdesk.prefs(this)
            if (Helpdesk.ativo(this) && System.currentTimeMillis() - p.getLong("ultima", 0L) > Helpdesk.intervalo(this) * 60_000L)
                Helpdesk.emSegundoPlano(this, false)
            if (aba == ABA_PAINEL && Atualizador.velho(this, 2)) atualizarPainel()
            if (aba == ABA_HELPDESK) Helpdesk.marcarVisto(this)
            avisarHelpdesk()
            atualizarSelo()
            ajustarAbas()
        }
    }

    override fun onPause() {
        Helpdesk.ouvinte = null
        webApp.onPause(); webSite?.onPause(); websPainel.values.forEach { it.onPause() }
        try { CookieManager.getInstance().flush() } catch (_: Exception) { }
        super.onPause()
    }

    private fun js(w: WebView?, codigo: String) {
        if (w == null) return
        runOnUiThread { w.evaluateJavascript(codigo, null) }
    }

    private fun avisarHelpdesk() { if (paginaApp == "helpdesk") js(webApp, "window.recebidoHelpdesk && recebidoHelpdesk()") }
    private fun avisarPainel() = runOnUiThread { for (w in websPainel.values) w.evaluateJavascript("window.recebido && recebido()", null) }

    private fun atualizarPainel() {
        Atualizador.atualizando = true
        avisarPainel()
        Atualizador.emSegundoPlano(this) { avisarPainel(); runOnUiThread { if (Store.logado(this)) ajustarAbas() } }
    }

    private fun toast(t: String) = runOnUiThread { Toast.makeText(this, t, Toast.LENGTH_SHORT).show() }

    // =====================================================================================
    // Páginas do próprio app (login, Helpdesk e Painel)
    // =====================================================================================

    @SuppressLint("SetJavaScriptEnabled")
    private fun novaWebLocal(): WebView {
        val w = WebView(this)
        w.setBackgroundColor(FUNDO)
        val s = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.textZoom = 100              // não deixa a letra grande do celular desmontar a tela
        s.allowFileAccess = false
        s.allowContentAccess = false
        w.addJavascriptInterface(Ponte(), "App")
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url.toString()
                if (u.startsWith(ASSET)) return false
                if (r.url.host == HOST) abrirNoSite(u) else abrirFora(u)
                return true
            }
        }
        return w
    }

    /** Aba Painel: seletor (se tiver mais de um painel liberado) + a tela de cada painel. */
    private fun garantirPainel() {
        if (caixaPainel == null) {
            val caixa = LinearLayout(this)
            caixa.orientation = LinearLayout.VERTICAL
            caixa.setBackgroundColor(FUNDO)
            val chips = LinearLayout(this)
            chips.orientation = LinearLayout.HORIZONTAL
            chips.setPadding(dp(12), dp(10), dp(12), dp(4))
            val rolagem = android.widget.HorizontalScrollView(this)
            rolagem.isHorizontalScrollBarEnabled = false
            rolagem.addView(chips)
            caixa.addView(rolagem, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            val frame = FrameLayout(this)
            caixa.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            conteudo.addView(caixa, cheio())
            caixaPainel = caixa; chipsPainel = chips; framePaineis = frame
        }
        montarChips()
    }

    private fun montarChips() {
        val chips = chipsPainel ?: return
        val lista = Freedom.paraAbaPainel(this)
        chips.removeAllViews()
        (chips.parent as? View)?.visibility = if (lista.size > 1) View.VISIBLE else View.GONE
        if (lista.isEmpty()) return
        if (lista.none { it.id == painelAtual }) painelAtual = lista.first().id
        for (p in lista) {
            val t = TextView(this)
            t.text = p.nomeModulo
            t.textSize = 13f
            t.setPadding(dp(14), dp(7), dp(14), dp(7))
            val fundo = GradientDrawable()
            fundo.cornerRadius = dp(18).toFloat()
            val sel = p.id == painelAtual
            fundo.setColor(if (sel) Cor.ROSA else Color.parseColor("#12151f"))
            if (!sel) fundo.setStroke(dp(1), Color.parseColor("#232838"))
            t.background = fundo
            t.setTextColor(if (sel) Color.WHITE else Color.parseColor("#aab1c2"))
            t.setOnClickListener { painelAtual = p.id; montarChips() }
            val lp = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lp.marginEnd = dp(8)
            chips.addView(t, lp)
        }
        mostrarPainel(painelAtual!!)
    }

    private fun mostrarPainel(id: String) {
        val p = Freedom.porId(id) ?: return
        val frame = framePaineis ?: return
        var w = websPainel[id]
        if (w == null) {
            w = novaWebLocal()
            w.loadUrl(ASSET + p.tela)
            frame.addView(w, cheio())
            websPainel[id] = w
        }
        for ((k, v) in websPainel) v.visibility = if (k == id) View.VISIBLE else View.GONE
    }

    // =====================================================================================
    // Aba Site (site completo, logado automaticamente com o login do app)
    // =====================================================================================

    @SuppressLint("SetJavaScriptEnabled")
    private fun garantirSite(urlInicial: String?) {
        if (webSite != null) return
        val caixa = FrameLayout(this)
        val w = WebView(this)
        w.setBackgroundColor(Color.WHITE)
        val s = w.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.useWideViewPort = true
        s.loadWithOverviewMode = true
        s.builtInZoomControls = true
        s.displayZoomControls = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.userAgentString = s.userAgentString + " FreedomApp/" + packageName
        val cm = CookieManager.getInstance()
        cm.setAcceptCookie(true)
        cm.setAcceptThirdPartyCookies(w, true)
        w.addJavascriptInterface(PonteArquivos(), "FreedomArquivos")

        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                val esquema = (u.scheme ?: "").lowercase()
                if (esquema == "http" || esquema == "https") {
                    if (u.host == HOST) return false
                    abrirFora(u.toString()); return true
                }
                if (esquema == "blob" || esquema == "data" || esquema == "about") return false
                abrirFora(u.toString())
                return true
            }

            override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (url != null && url != urlComErro) avisoSite?.visibility = View.GONE
            }

            override fun onPageFinished(v: WebView, url: String?) {
                progresso?.visibility = View.GONE
                try { CookieManager.getInstance().flush() } catch (_: Exception) { }
                v.evaluateJavascript(GANCHO_DOWNLOAD, null)
            }

            override fun doUpdateVisitedHistory(v: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(v, url, isReload)
                // o site mandou para a tela de login: entra sozinho com o login do app e volta para onde ia
                if (url != null && url.contains("/login") && Store.logado(this@Tela) &&
                    System.currentTimeMillis() - ultimoLoginSite > 60_000L) {
                    destinoSite = destinoSite?.takeIf { !it.contains("/login") } ?: (Helpdesk.SITE + "/")
                    entrarNoSite()
                } else if (url != null && !url.contains("/login") && url.startsWith(Helpdesk.SITE)) {
                    destinoSite = url
                }
            }

            override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                if (r.isForMainFrame) semConexao(r.url.toString(), e.description?.toString() ?: "")
            }
        }

        w.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(v: WebView, p: Int) {
                progresso?.visibility = if (p < 100) View.VISIBLE else View.GONE
                progresso?.progress = p
            }

            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                arquivoCallback?.onReceiveValue(null)
                arquivoCallback = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                val tipos = params.acceptTypes.flatMap { it.split(",") }.map { it.trim() }.filter { it.contains("/") }
                if (tipos.isNotEmpty()) i.putExtra(Intent.EXTRA_MIME_TYPES, tipos.toTypedArray())
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                return try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(Intent.createChooser(i, "Escolher arquivo"), REQ_ARQUIVO)
                    true
                } catch (_: ActivityNotFoundException) {
                    arquivoCallback = null; false
                }
            }
        }

        w.setDownloadListener { url, ua, disposicao, mime, _ -> baixar(url, ua, disposicao, mime) }

        caixa.addView(w, cheio())
        val pb = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        pb.max = 100
        pb.progressTintList = android.content.res.ColorStateList.valueOf(Cor.ROSA)
        caixa.addView(pb, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP))
        val aviso = criarAvisoSemConexao()
        caixa.addView(aviso, cheio())
        avisoSite = aviso
        conteudo.addView(caixa, cheio())
        caixaSite = caixa
        progresso = pb
        webSite = w
        abrirUrlSite(urlInicial ?: (Helpdesk.SITE + "/"))
    }

    private fun abrirUrlSite(url: String) {
        val w = webSite ?: return
        destinoSite = url
        val temSessao = !CookieManager.getInstance().getCookie(Helpdesk.SITE).isNullOrEmpty()
        if (!temSessao && Store.logado(this)) entrarNoSite() else w.loadUrl(url)
    }

    /**
     * Faz o login no site com o e-mail/senha guardados, passa a sessão para o WebView e
     * abre o último endereço pedido (destinoSite).
     */
    private fun entrarNoSite() {
        if (logandoSite) return      // já está entrando: quando terminar, abre o destinoSite mais recente
        logandoSite = true
        ultimoLoginSite = System.currentTimeMillis()
        val app = applicationContext
        Thread {
            var cookies: List<String> = emptyList()
            try {
                val l = Store.login(app)
                if (l != null) {
                    val api = Api(l.first, l.second)
                    api.entrar()
                    cookies = api.setCookies.toList()
                }
            } catch (_: Exception) { }
            runOnUiThread {
                logandoSite = false
                if (!Store.logado(this)) return@runOnUiThread       // saiu enquanto entrava: não deixa a sessão no site
                try {
                    val cm = CookieManager.getInstance()
                    for (sc in cookies) cm.setCookie(Helpdesk.SITE, sc)
                    cm.flush()
                } catch (_: Exception) { }
                webSite?.loadUrl(destinoSite ?: (Helpdesk.SITE + "/"))
            }
        }.start()
    }

    /** Aviso "sem conexão" por cima do site (não entra no histórico do botão voltar). */
    private fun criarAvisoSemConexao(): View {
        val v = LinearLayout(this)
        v.orientation = LinearLayout.VERTICAL
        v.gravity = Gravity.CENTER
        v.setBackgroundColor(FUNDO)
        v.setPadding(dp(24), dp(24), dp(24), dp(24))
        v.isClickable = true
        val t = TextView(this)
        t.text = "Sem conexão"
        t.textSize = 20f
        t.setTextColor(Color.parseColor("#f2f4f8"))
        t.gravity = Gravity.CENTER
        v.addView(t)
        val m = TextView(this)
        m.tag = "motivo"
        m.textSize = 13f
        m.setTextColor(Color.parseColor("#8b93a7"))
        m.gravity = Gravity.CENTER
        m.setPadding(0, dp(8), 0, dp(18))
        v.addView(m)
        val b = TextView(this)
        b.text = "Tentar de novo"
        b.setTextColor(Color.WHITE)
        b.textSize = 15f
        b.setPadding(dp(24), dp(12), dp(24), dp(12))
        val fundo = GradientDrawable()
        fundo.cornerRadius = dp(10).toFloat()
        fundo.setColor(Cor.ROSA)
        b.background = fundo
        b.setOnClickListener {
            v.visibility = View.GONE
            val u = urlComErro ?: (Helpdesk.SITE + "/")
            urlComErro = null
            abrirUrlSite(u)
        }
        v.addView(b, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        v.visibility = View.GONE
        return v
    }

    private fun semConexao(url: String, motivo: String) {
        val v = avisoSite ?: return
        urlComErro = url
        v.findViewWithTag<TextView>("motivo")?.text = "Não foi possível abrir o site." + if (motivo.isNotEmpty()) "\n($motivo)" else ""
        v.visibility = View.VISIBLE
    }

    private fun abrirFora(url: String) {
        try {
            val i = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            else Intent(Intent.ACTION_VIEW, Uri.parse(url))
            i.addCategory(Intent.CATEGORY_BROWSABLE)
            i.component = null
            startActivity(i)
        } catch (_: Exception) {
            toast("Não foi possível abrir o link")
        }
    }

    private fun baixar(url: String, ua: String?, disposicao: String?, mime: String?) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            webSite?.evaluateJavascript("window.__fdSave&&window.__fdSave(" + JSONObject.quote(url) + ",'')", null)
            return
        }
        try {
            val nome = URLUtil.guessFileName(url, disposicao, mime)
            val r = DownloadManager.Request(Uri.parse(url))
            CookieManager.getInstance().getCookie(url)?.let { r.addRequestHeader("Cookie", it) }
            if (ua != null) r.addRequestHeader("User-Agent", ua)
            r.setTitle(nome)
            if (mime != null) r.setMimeType(mime)
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            if (Build.VERSION.SDK_INT >= 29) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nome)
            else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, nome)
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(r)
            toast("Baixando $nome…")
        } catch (_: Exception) {
            toast("Não consegui baixar o arquivo")
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_ARQUIVO) {
            var res: Array<Uri>? = null
            if (resultCode == RESULT_OK && data != null) {
                val clip = data.clipData
                res = if (clip != null && clip.itemCount > 0) Array(clip.itemCount) { clip.getItemAt(it).uri }
                else data.data?.let { arrayOf(it) }
            }
            arquivoCallback?.onReceiveValue(res)
            arquivoCallback = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    inner class PonteArquivos {
        @JavascriptInterface
        fun salvar(dataUrl: String, nome: String) {
            val app = applicationContext
            Thread {
                val ok = try { Arquivos.salvarDataUrl(app, dataUrl, nome) } catch (_: Exception) { false }
                toast(if (ok) "Arquivo salvo em Downloads" else "Não consegui salvar o arquivo")
            }.start()
        }

        @JavascriptInterface
        fun falhou() = toast("Não consegui salvar o arquivo")
    }

    // =====================================================================================
    // Permissões
    // =====================================================================================

    private fun pedirPermissoes() {
        if (pediuPermissoes || !Store.logado(this)) return
        pediuPermissoes = true
        val p = Helpdesk.prefs(this)
        if (Build.VERSION.SDK_INT >= 33 && Helpdesk.ativo(this) && !p.getBoolean("pediu_notif", false) &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            p.edit().putBoolean("pediu_notif", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_PERMISSAO)
            return
        }
        pedirBateria()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMISSAO) {
            avisarHelpdesk()
            pedirBateria()
        }
    }

    private fun pedirBateria() {
        val p = Helpdesk.prefs(this)
        if (!Helpdesk.ativo(this) || Helpdesk.bateriaLivre(this) || p.getBoolean("pediu_bateria", false) || isFinishing) return
        p.edit().putBoolean("pediu_bateria", true).apply()
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Avisos com a tela bloqueada")
            .setMessage("Para os avisos do Helpdesk chegarem mesmo com o celular parado, permita que o app funcione em segundo plano sem restrição de bateria.")
            .setPositiveButton("Permitir") { _, _ -> liberarBateria() }
            .setNegativeButton("Agora não", null)
            .show()
    }

    @SuppressLint("BatteryLife")
    private fun liberarBateria() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            try { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Exception) { }
        }
    }

    private fun abrirConfigNotificacoes() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_PERMISSAO)
            return
        }
        try {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        } catch (_: Exception) { }
    }

    // =====================================================================================
    // Ponte com as páginas do app (login.html, helpdesk.html, painel.html)
    // =====================================================================================

    private fun nomeApp(): String = applicationInfo.loadLabel(packageManager).toString()

    inner class Ponte {
        @JavascriptInterface
        fun nome(): String = nomeApp()

        /** Números de um painel (aba Painel / widget). */
        @JavascriptInterface
        fun dadosPainel(id: String): String {
            val o = JSONObject()
            val p = Freedom.porId(id)
            if (p != null) {
                Freedom.dados(this@Tela, p)?.let { txt -> try { o.put("dados", JSONObject(txt)) } catch (_: Exception) { } }
                val info = Freedom.info(this@Tela, p)
                info.erro?.let { o.put("erro", it) }
                o.put("hora", info.hora)
                o.put("titulo", p.nomeModulo)
            }
            o.put("atualizando", Atualizador.atualizando)
            o.put("email", Store.email(this@Tela) ?: "")
            o.put("nome", nomeApp())
            return o.toString()
        }

        /** Compatibilidade: primeiro painel liberado. */
        @JavascriptInterface
        fun dados(): String = dadosPainel(Freedom.paraAbaPainel(this@Tela).firstOrNull()?.id ?: "")

        @JavascriptInterface
        fun atualizar() = runOnUiThread { atualizarPainel() }

        @JavascriptInterface
        fun entrar(email: String, senha: String) {
            val e = email.trim()
            val app = applicationContext
            Thread {
                try {
                    val api = Api(e, senha)
                    api.entrar()                    // confere se o login está certo antes de salvar
                    Acesso.atualizar(app, api)      // quais módulos este login tem (Helpdesk, Comercial, Faturamento…)
                    api.sair()
                    Store.salvarLogin(app, e, senha)
                    Tarefa.agendar(app)
                    Atualizador.atualizando = true
                    runOnUiThread { aba = ABA_HELPDESK; carregar(null) }
                    try { Helpdesk.verificar(app, true) } catch (_: Exception) { }
                    runOnUiThread { Helpdesk.aplicar(this@Tela) }
                    Atualizador.atualizar(app)
                    avisarPainel()
                    avisarHelpdesk()
                } catch (x: Exception) {
                    js(webApp, "erroLogin(" + JSONObject.quote(Api.mensagem(x)) + ")")
                }
            }.start()
        }

        @JavascriptInterface
        fun sair() {
            val app = applicationContext
            Store.sair(app)
            Tarefa.cancelar(app)
            Helpdesk.sair(app)
            Acesso.limpar(app)
            Widget.redesenharTodos(app)
            runOnUiThread {
                try {
                    CookieManager.getInstance().removeAllCookies(null)
                    CookieManager.getInstance().flush()
                    WebStorage.getInstance().deleteAllData()
                } catch (_: Exception) { }
                caixaSite?.let { conteudo.removeView(it) }
                webSite?.destroy()
                webSite = null; caixaSite = null; progresso = null; avisoSite = null
                websPainel.values.forEach { it.destroy() }
                websPainel.clear()
                caixaPainel?.let { conteudo.removeView(it) }
                caixaPainel = null; chipsPainel = null; framePaineis = null; painelAtual = null
                aba = ABA_HELPDESK
                carregar(null)
            }
        }

        // ---- Helpdesk ----

        @JavascriptInterface
        fun helpdesk(): String = Helpdesk.resumoTela(this@Tela).toString()

        @JavascriptInterface
        fun verificarHelpdesk() {
            Helpdesk.emSegundoPlano(this@Tela, true) { o ->
                val msg = when {
                    o == null -> Helpdesk.prefs(this@Tela).getString("status", "")?.takeIf { it.isNotEmpty() && it != "ok" } ?: "Não consegui verificar agora"
                    o.sessionExpired -> "Este login não tem acesso ao Helpdesk"
                    !o.ok -> "Não verificou: " + (o.error ?: "erro")
                    o.notes.isEmpty() -> if (o.firstRun) "Avisos ativados" else "Nenhuma novidade"
                    else -> o.notes.size.toString() + " novidade(s)"
                }
                toast(msg)
                avisarHelpdesk()
            }
        }

        @JavascriptInterface
        fun configurarHelpdesk(json: String) {
            try { Helpdesk.configurar(applicationContext, JSONObject(json)) } catch (_: Exception) { }
            runOnUiThread {
                if (Helpdesk.ativo(this@Tela)) Helpdesk.aplicar(this@Tela)
                avisarHelpdesk()
            }
        }

        @JavascriptInterface
        fun abrirSite(caminho: String) = runOnUiThread { abrirNoSite(caminho) }

        @JavascriptInterface
        fun aba(nome: String) = runOnUiThread { selecionar(nome) }

        @JavascriptInterface
        fun liberarBateria() = runOnUiThread { this@Tela.liberarBateria() }

        @JavascriptInterface
        fun configurarNotificacoes() = runOnUiThread { abrirConfigNotificacoes() }
    }
}
