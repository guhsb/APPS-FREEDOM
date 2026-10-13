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
        const val EXTRA_ATUALIZAR = "atualizar"
        private val TELAS = setOf("lista.html", "novo.html")
        private val RE_CHAMADO = Regex("^(?:https://relatorios\\.cbfreedom\\.com\\.br)?/helpdesk/tickets/(\\d+)/?$")
        const val ABA_HELPDESK = "helpdesk"
        const val ABA_SITE = "site"
        const val ABA_PAINEL = "painel"
        private const val ASSET = "file:///android_asset/"
        private const val REQ_ARQUIVO = 31
        private const val REQ_ANEXO = 33
        private const val REQ_PERMISSAO = 32
        private const val HOST = "relatorios.cbfreedom.com.br"

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

        /**
         * Ajustes do site para a tela do celular: o resumo "Chamados" do cabeçalho saía cortado para fora da tela.
         * Aqui ele vira um quadro fixo dentro da tela, ganha um botão de fechar e as linhas de Atendimento
         * passam a abrir a Central de Atendimento.
         */
        private const val GANCHO_SITE = "(function(){" +
            "if(window.__fdSite)return;window.__fdSite=true;" +
            "var P='[aria-label=\"Resumo de chamados\"]';" +
            "var st=document.createElement('style');st.textContent=" +
            "'@media (max-width:900px){'+P+'{position:fixed!important;left:12px!important;right:12px!important;top:72px!important;" +
            "width:auto!important;max-width:none!important;max-height:calc(100vh - 96px);overflow:auto;" +
            "box-shadow:0 14px 40px rgba(0,0,0,.35)!important;z-index:2147483000!important;padding-top:34px!important}}'+" +
            "P+'>div,'+P+'>a{min-height:40px;align-items:center;cursor:pointer}'+" +
            "'.__fdX{position:absolute;top:4px;right:6px;border:0;background:transparent;font-size:22px;line-height:1;padding:6px 10px;color:#6b7084;z-index:2}';" +
            "document.head.appendChild(st);" +
            "function pn(){return document.querySelector(P);}" +
            "function bt(){var l=document.querySelectorAll('[aria-haspopup=\"dialog\"]');for(var i=0;i<l.length;i++){if(/Chamados/.test(l[i].getAttribute('aria-label')||l[i].textContent))return l[i];}return null;}" +
            "function fechar(){var b=bt();if(b&&b.getAttribute('aria-expanded')==='true')b.click();}" +
            "function ir(c){var a=document.querySelector('a[href=\"'+c+'\"]');if(a)a.click();else location.href=c;}" +
            "new MutationObserver(function(){var p=pn();if(p&&!p.querySelector('.__fdX')){if(getComputedStyle(p).position==='static')p.style.position='relative';" +
            "var x=document.createElement('button');x.type='button';x.className='__fdX';x.textContent='\u2715';x.setAttribute('aria-label','Fechar');p.appendChild(x);}})" +
            ".observe(document.body,{childList:true,subtree:true});" +
            "document.addEventListener('click',function(e){var p=pn();if(!p||!p.contains(e.target))return;" +
            "if(e.target.closest('.__fdX')){e.preventDefault();e.stopPropagation();fechar();return;}" +
            "var d=e.target.closest('div');if(d&&d.parentElement===p){e.preventDefault();fechar();ir('/helpdesk/workspace');}" +
            "var a=e.target.closest('a');if(a&&p.contains(a)){setTimeout(fechar,50);}" +
            "},true);" +
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
    /** Ícone normal (contorno) e ativo (preenchido) de cada aba. */
    private val iconesAba = HashMap<String, Pair<Int, Int>>()
    private var avisoSite: View? = null
    private var urlComErro: String? = null

    private var aba = ABA_HELPDESK
    private var paginaApp = ""
    private var arquivoCallback: ValueCallback<Array<Uri>>? = null
    private var anexoPendente = 0          // chamado que vai receber o arquivo escolhido
    private var fotoPendente: Pair<java.io.File, Uri>? = null   // foto que a câmera vai gravar
    private var logandoSite = false
    private var ultimoLoginSite = 0L
    private var destinoSite: String? = null
    private var pediuPermissoes = false

    // =====================================================================================
    // Montagem da tela
    // =====================================================================================

    // ---- cores da parte nativa (abas, seletor de painel, aviso sem conexão): seguem o tema claro/escuro ----
    private val claro by lazy { Tema.claro(this) }
    private fun cor(claro: String, escuro: String) = Color.parseColor(if (this.claro) claro else escuro)
    private val FUNDO by lazy { cor("#eef2f7", "#0b0d12") }
    private val FUNDO_BARRA by lazy { cor("#ffffff", "#10131b") }
    private val COR_INATIVA by lazy { cor("#6b7790", "#8b93a7") }
    private val COR_LINHA by lazy { cor("#e1e7ef", "#1d2230") }
    private val ROSA_SUAVE by lazy { cor("#fde4ee", "#2e1a26") }      // rosa suave atrás do ícone da aba ativa
    private val TEXTO by lazy { cor("#0f1b3d", "#ffffff") }
    private val TEXTO2 by lazy { cor("#4b5875", "#a3abbd") }
    private val CARTAO by lazy { cor("#ffffff", "#12151d") }
    private val SELECIONADO by lazy { cor("#e9eef6", "#232a3a") }

    private fun pintarJanela() {
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(FUNDO))
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = FUNDO
            window.navigationBarColor = FUNDO_BARRA
            window.decorView.systemUiVisibility = if (claro)
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0
        }
    }

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        Helpdesk.criarCanais(this)
        pintarJanela()

        val raiz = LinearLayout(this)
        raiz.orientation = LinearLayout.VERTICAL
        raiz.setBackgroundColor(FUNDO)
        conteudo = FrameLayout(this)
        raiz.addView(conteudo, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        linhaAbas = View(this)
        linhaAbas.setBackgroundColor(COR_LINHA)
        raiz.addView(linhaAbas, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        barraAbas = criarAbas()
        raiz.addView(barraAbas, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)))
        setContentView(raiz)

        webApp = novaWebLocal()
        conteudo.addView(webApp, cheio())
        // aberto de novo pelo Android (pela lista de recentes ou depois de fechado): não repete o aviso/aba antigos
        val doHistorico = estado != null || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        carregar(if (doHistorico) null else intent)
    }

    private fun dp(v: Int): Int = Math.round(v * resources.displayMetrics.density)
    private fun cheio() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    /** Barra de abas no estilo Material 3: ícone dentro de uma "pílula" que acende na aba ativa. */
    private fun criarAbas(): LinearLayout {
        val barra = LinearLayout(this)
        barra.orientation = LinearLayout.HORIZONTAL
        barra.setBackgroundColor(FUNDO_BARRA)
        barra.setPadding(dp(8), dp(8), dp(8), dp(6))
        val itens = listOf(
            Triple(ABA_HELPDESK, "Helpdesk", R.drawable.ic_aba_helpdesk),
            Triple(ABA_SITE, "Site", R.drawable.ic_aba_site),
            Triple(ABA_PAINEL, "Painel", R.drawable.ic_aba_painel)
        )
        iconesAba[ABA_HELPDESK] = Pair(R.drawable.ic_aba_helpdesk, R.drawable.ic_aba_helpdesk_ativa)
        iconesAba[ABA_SITE] = Pair(R.drawable.ic_aba_site, R.drawable.ic_aba_site_ativa)
        iconesAba[ABA_PAINEL] = Pair(R.drawable.ic_aba_painel, R.drawable.ic_aba_painel_ativa)
        for ((id, rotulo, icone) in itens) {
            val item = LinearLayout(this)
            item.orientation = LinearLayout.VERTICAL
            item.gravity = Gravity.CENTER_HORIZONTAL
            item.isClickable = true
            item.contentDescription = rotulo

            val pilula = FrameLayout(this)
            val img = ImageView(this)
            img.setImageResource(icone)
            pilula.addView(img, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
            if (id == ABA_HELPDESK) {
                selo = TextView(this)
                selo.setTextColor(Color.WHITE)
                selo.textSize = 9.5f
                selo.typeface = android.graphics.Typeface.DEFAULT_BOLD
                selo.gravity = Gravity.CENTER
                selo.minWidth = dp(17)
                selo.setPadding(dp(4), 0, dp(4), 0)
                val fundo = GradientDrawable()
                fundo.cornerRadius = dp(9).toFloat()
                fundo.setColor(Cor.ROSA)
                fundo.setStroke(dp(2), FUNDO_BARRA)
                selo.background = fundo
                selo.visibility = View.GONE
                val lp = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(17), Gravity.TOP or Gravity.END)
                lp.topMargin = dp(1); lp.marginEnd = dp(10)
                pilula.addView(selo, lp)
            }
            item.addView(pilula, LinearLayout.LayoutParams(dp(60), dp(32)))
            val txt = TextView(this)
            txt.text = rotulo
            txt.textSize = 12f
            txt.gravity = Gravity.CENTER
            txt.letterSpacing = 0.01f
            val lpT = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lpT.topMargin = dp(4)
            item.addView(txt, lpT)
            item.setOnClickListener {
                // tocar de novo no Site volta para o início do site
                when {
                    aba == id && id == ABA_SITE -> webSite?.let { abrirUrlSite(Helpdesk.SITE + "/") }
                    aba == id && id == ABA_HELPDESK && paginaApp == "sub" -> voltarHelpdesk()
                    else -> selecionar(id)
                }
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
            val ativa = id == aba
            val cor = if (ativa) Cor.ROSA else COR_INATIVA
            iconesAba[id]?.let { par.first.setImageResource(if (ativa) it.second else it.first) }
            par.first.setColorFilter(cor)
            par.second.setTextColor(if (ativa) TEXTO else COR_INATIVA)
            par.second.typeface = if (ativa) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
            val pilula = par.first.parent as? View ?: continue
            if (ativa) {
                val f = GradientDrawable()
                f.cornerRadius = dp(16).toFloat()
                f.setColor(ROSA_SUAVE)
                pilula.background = f
            } else pilula.background = null
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
        if (paginaApp != "helpdesk" && paginaApp != "sub") { webApp.loadUrl(ASSET + "helpdesk.html"); paginaApp = "helpdesk" }
        val caminho = i?.getStringExtra(Helpdesk.EXTRA_CAMINHO)
        val atualizar = i?.getBooleanExtra(EXTRA_ATUALIZAR, false) ?: false
        i?.removeExtra(EXTRA_ATUALIZAR)
        val pedida = i?.getStringExtra(EXTRA_ABA)
        i?.getStringExtra(EXTRA_PAINEL)?.let { if (Freedom.porId(it) != null) painelAtual = it }
        i?.removeExtra(Helpdesk.EXTRA_CAMINHO)
        i?.removeExtra(EXTRA_ABA)
        i?.removeExtra(EXTRA_PAINEL)
        for ((id, v) in itensAba) v.visibility = if (abaDisponivel(id)) View.VISIBLE else View.GONE
        when {
            caminho != null -> abrirCaminho(caminho)
            pedida != null && abaDisponivel(pedida) -> selecionar(pedida)
            else -> selecionar(aba)
        }
        if (atualizar) { if (paginaApp == "sub") voltarHelpdesk(); selecionar(ABA_HELPDESK); iniciarAtualizacao() }
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

    /** Chamado (/helpdesk/tickets/ID) abre na tela do app; o resto abre na aba Site. */
    private fun abrirCaminho(caminho: String) {
        val m = RE_CHAMADO.find(caminho.trim())
        val id = m?.groupValues?.get(1)?.toIntOrNull()
        if (id != null && Acesso.helpdesk(this)) abrirChamado(id) else abrirNoSite(caminho)
    }

    private fun abrirChamado(id: Int) {
        Helpdesk.nm(this).cancel(Helpdesk.idNotificacao(id))
        webApp.loadUrl(ASSET + "chamado.html#" + id)
        paginaApp = "sub"
        selecionar(ABA_HELPDESK)
    }

    /** Telas do Helpdesk dentro do app (lista de chamados, abrir chamado). */
    private fun abrirTela(arquivo: String) {
        val nome = arquivo.substringBefore('#')
        val resto = arquivo.substringAfter('#', "")
        if (nome !in TELAS || !resto.matches(Regex("[A-Za-z0-9_=&%.-]*"))) return
        webApp.loadUrl(ASSET + arquivo)
        paginaApp = "sub"
        selecionar(ABA_HELPDESK)
    }

    private var limparHistorico = false

    private fun voltarHelpdesk() {
        webApp.loadUrl(ASSET + "helpdesk.html")
        paginaApp = "helpdesk"
        limparHistorico = true
    }

    private fun voltarApp() {
        if (webApp.canGoBack()) webApp.goBack() else voltarHelpdesk()
    }

    // ---- atualização do app ----
    // o Android reinicia o app quando a pessoa libera "instalar apps desconhecidos": guarda o pedido no aparelho
    private var esperandoPermissaoInstalar: Boolean
        get() = System.currentTimeMillis() - getSharedPreferences("atualizacao", MODE_PRIVATE).getLong("pediu_permissao", 0L) < 10 * 60_000L
        set(v) { getSharedPreferences("atualizacao", MODE_PRIVATE).edit().putLong("pediu_permissao", if (v) System.currentTimeMillis() else 0L).apply() }

    private fun iniciarAtualizacao() {
        if (isFinishing || isDestroyed) return
        if (Atualizacao.nova(this) == null) {
            Thread {
                val r = Atualizacao.conferir(applicationContext, true)
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    when (r) {
                        Atualizacao.Conferencia.NOVA -> iniciarAtualizacao()
                        Atualizacao.Conferencia.EM_DIA -> toast("O app já está na versão mais nova")
                        Atualizacao.Conferencia.FALHOU -> toast("Não consegui verificar agora. Confira a internet e tente de novo.")
                    }
                    avisarHelpdesk()
                }
            }.start()
            return
        }
        if (!Atualizacao.podeInstalar(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permitir atualizar o app")
                .setMessage("Na próxima tela, ative \"Permitir desta fonte\" para o Freedom e volte. A atualização continua sozinha.")
                .setPositiveButton("Continuar") { _, _ ->
                    esperandoPermissaoInstalar = true
                    try {
                        startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                    } catch (_: Exception) { esperandoPermissaoInstalar = false; Atualizacao.abrirNoNavegador(this) }
                }
                .setNegativeButton("Agora não", null)
                .show()
            return
        }
        Thread { Atualizacao.baixarEInstalar(this) { avisarHelpdesk(); avisarPainel() } }.start()
    }

    // ---- anexos da tela do chamado ----

    /** Intent da câmera gravando direto num arquivo do app. */
    private fun intentCamera(): Intent? = try {
        val foto = Imagens.novaFoto(this)
        fotoPendente = foto
        val cam = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(android.provider.MediaStore.EXTRA_OUTPUT, foto.second)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        cam.clipData = android.content.ClipData.newRawUri("foto", foto.second)
        cam
    } catch (_: Exception) { null }

    private fun escolherAnexo(id: Int) {
        anexoPendente = id
        val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/png", "image/jpeg", "text/plain",
                "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
        val escolha = Intent.createChooser(i, "Anexar arquivo ou tirar foto")
        intentCamera()?.let { escolha.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(it)) }
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(escolha, REQ_ANEXO)
        } catch (_: ActivityNotFoundException) {
            anexoPendente = 0; toast("Nenhum app de arquivos encontrado")
        }
    }

    /** Botão "Tirar foto" da tela do chamado: abre a câmera direto. */
    private fun fotoAnexo(id: Int) {
        val cam = intentCamera() ?: return toast("Não consegui abrir a câmera")
        anexoPendente = id
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(cam, REQ_ANEXO)
        } catch (_: ActivityNotFoundException) {
            anexoPendente = 0; fotoPendente = null; toast("Nenhum app de câmera encontrado")
            js(webApp, "window.chamadoAcao && chamadoAcao($id,'anexo',false,'')")
        }
    }

    private fun enviarAnexo(id: Int, uri: Uri) {
        val app = applicationContext
        Thread {
            val r = try {
                var nome = "arquivo"
                var tamanho = -1L
                contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE), null, null, null)?.use { cur ->
                    if (cur.moveToFirst()) {
                        cur.getString(0)?.let { nome = it }
                        if (!cur.isNull(1)) tamanho = cur.getLong(1)
                    }
                }
                if (tamanho > 10L * 1024 * 1024) Chamado.Resultado(false, "O arquivo passa de 10 MB.")
                else {
                    val dados = contentResolver.openInputStream(uri)?.use { ent ->
                        val out = java.io.ByteArrayOutputStream()
                        val buf = ByteArray(64 * 1024); var total = 0
                        while (true) {
                            val k = ent.read(buf); if (k < 0) break
                            total += k
                            if (total > 10 * 1024 * 1024 + 1) break
                            out.write(buf, 0, k)
                        }
                        out.toByteArray()
                    } ?: ByteArray(0)
                    val tipo = contentResolver.getType(uri) ?: "application/octet-stream"
                    js(webApp, "window.chamadoEnviandoAnexo && chamadoEnviandoAnexo($id," + JSONObject.quote(nome) + ")")
                    Chamado.anexar(app, id, nome, tipo, dados)
                }
            } catch (e: Exception) { Chamado.Resultado(false, "Não consegui ler o arquivo: " + Api.mensagem(e)) }
            js(webApp, "window.chamadoAcao && chamadoAcao($id,'anexo'," + r.ok + "," + JSONObject.quote(r.mensagem) + ")")
        }.start()
    }

    private fun baixarAnexo(id: Int, anexo: Int, nome: String) {
        val app = applicationContext
        toast("Baixando $nome…")
        Thread {
            val prep = Chamado.preparoDownload(app, id, anexo)
            runOnUiThread {
                if (prep == null) { toast("Não consegui baixar o anexo"); return@runOnUiThread }
                try {
                    val seguro = nome.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "anexo" }
                    val r = DownloadManager.Request(Uri.parse(prep.first))
                    if (prep.second.isNotEmpty()) r.addRequestHeader("Cookie", prep.second)
                    r.setTitle(seguro)
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    if (Build.VERSION.SDK_INT >= 29) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, seguro)
                    else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, seguro)
                    (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(r)
                } catch (_: Exception) { toast("Não consegui baixar o anexo") }
            }
        }.start()
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
        if (aba == ABA_HELPDESK && paginaApp == "sub") { voltarApp(); return }
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
        Atualizacao.telaAberta = true
        if (esperandoPermissaoInstalar) {
            esperandoPermissaoInstalar = false
            if (Atualizacao.podeInstalar(this)) iniciarAtualizacao()
        }
        Helpdesk.ouvinte = { runOnUiThread { avisarHelpdesk(); atualizarSelo(); if (Store.logado(this)) ajustarAbas() } }
        if (Store.logado(this)) {
            Helpdesk.aplicar(this)
            val p = Helpdesk.prefs(this)
            if (Helpdesk.ativo(this) && System.currentTimeMillis() - p.getLong("ultima", 0L) > Helpdesk.intervaloCompletoMs(this))
                Helpdesk.emSegundoPlano(this, false)
            if (aba == ABA_PAINEL && Atualizador.velho(this, 2)) atualizarPainel()
            if (aba == ABA_HELPDESK) Helpdesk.marcarVisto(this)
            avisarHelpdesk()
            atualizarSelo()
            ajustarAbas()
            Atualizacao.conferirEmSegundoPlano(this, false) { avisarHelpdesk(); avisarPainel() }
        }
    }

    override fun onPause() {
        Helpdesk.ouvinte = null
        Atualizacao.telaAberta = false
        webApp.onPause(); webSite?.onPause(); websPainel.values.forEach { it.onPause() }
        try { CookieManager.getInstance().flush() } catch (_: Exception) { }
        super.onPause()
    }

    private fun js(w: WebView?, codigo: String) {
        if (w == null) return
        runOnUiThread { w.evaluateJavascript(codigo, null) }
    }

    private fun avisarHelpdesk() { if (paginaApp == "helpdesk" || paginaApp == "sub") js(webApp, "window.recebidoHelpdesk && recebidoHelpdesk()") }
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
            override fun onPageStarted(v: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                // qual tela do app está aberta (o voltar do celular depende disso)
                if (::webApp.isInitialized && v === webApp && url != null && url.startsWith(ASSET)) {
                    paginaApp = when {
                        url.contains("login.html") -> "login"
                        url.contains("helpdesk.html") -> "helpdesk"
                        else -> "sub"
                    }
                }
            }

            override fun onPageFinished(v: WebView, url: String?) {
                if (::webApp.isInitialized && v === webApp && limparHistorico && url != null && url.contains("helpdesk.html")) {
                    limparHistorico = false
                    v.clearHistory()
                }
            }

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
            // seletor de painel (controle segmentado)
            val chips = LinearLayout(this)
            chips.orientation = LinearLayout.HORIZONTAL
            chips.setPadding(dp(3), dp(3), dp(3), dp(3))
            val trilho = GradientDrawable()
            trilho.cornerRadius = dp(12).toFloat()
            trilho.setColor(CARTAO)
            trilho.setStroke(dp(1), COR_LINHA)
            chips.background = trilho
            val rolagem = android.widget.HorizontalScrollView(this)
            rolagem.isHorizontalScrollBarEnabled = false
            rolagem.isFillViewport = true
            rolagem.addView(chips, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            val lpR = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            lpR.setMargins(dp(16), dp(12), dp(16), dp(2))
            caixa.addView(rolagem, lpR)
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
            t.textSize = 13.5f
            t.gravity = Gravity.CENTER
            t.minWidth = dp(88)
            t.setPadding(dp(14), dp(8), dp(14), dp(8))
            val sel = p.id == painelAtual
            if (sel) {
                val fundo = GradientDrawable()
                fundo.cornerRadius = dp(9).toFloat()
                fundo.setColor(SELECIONADO)
                t.background = fundo
            }
            t.typeface = if (sel) android.graphics.Typeface.DEFAULT_BOLD else android.graphics.Typeface.DEFAULT
            t.setTextColor(if (sel) TEXTO else TEXTO2)
            t.setOnClickListener { painelAtual = p.id; montarChips() }
            chips.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
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
                v.evaluateJavascript(GANCHO_SITE, null)
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
        t.setTextColor(TEXTO)
        t.gravity = Gravity.CENTER
        v.addView(t)
        val m = TextView(this)
        m.tag = "motivo"
        m.textSize = 13f
        m.setTextColor(COR_INATIVA)
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
        if (requestCode == REQ_ANEXO) {
            val id = anexoPendente; anexoPendente = 0
            val foto = fotoPendente; fotoPendente = null
            val uri = if (resultCode == RESULT_OK) data?.data else null
            if (id > 0 && uri != null && uri != foto?.second) enviarAnexo(id, uri)
            else if (id > 0 && resultCode == RESULT_OK && foto != null && foto.first.length() > 0) {
                Thread { Imagens.reduzirFoto(foto.first); runOnUiThread { enviarAnexo(id, foto.second) } }.start()
            }
            else if (id > 0) js(webApp, "window.chamadoAcao && chamadoAcao($id,'anexo',false,'')")
            return
        }
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
                if (p.temAvisos) o.put("avisoMeta", Metas.ligado(this@Tela))
            }
            o.put("atualizando", Atualizador.atualizando)
            o.put("app", Atualizacao.resumo(this@Tela))
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

        /** Endereço do site: chamado abre na tela do app, o resto na aba Site. */
        @JavascriptInterface
        fun abrirSite(caminho: String) = runOnUiThread { abrirCaminho(caminho) }

        /** Sempre na aba Site (botão "Abrir no site" da tela do chamado). */
        @JavascriptInterface
        fun siteDireto(caminho: String) = runOnUiThread { abrirNoSite(caminho) }

        // ---- tela do chamado ----

        @JavascriptInterface
        fun carregarChamado(id: Int) {
            val app = applicationContext
            Thread {
                val r = Chamado.historico(app, id)
                js(webApp, "window.chamadoCarregado && chamadoCarregado(" + id + "," + r.ok + "," +
                    JSONObject.quote(r.mensagem) + "," + (r.dados?.toString() ?: "null") + ")")
            }.start()
        }

        @JavascriptInterface
        fun responderChamado(id: Int, texto: String) {
            val app = applicationContext
            Thread {
                val r = Chamado.responder(app, id, texto)
                js(webApp, "window.chamadoAcao && chamadoAcao(" + id + ",'responder'," + r.ok + "," + JSONObject.quote(r.mensagem) + ")")
            }.start()
        }

        @JavascriptInterface
        fun assumirChamado(id: Int) = operarChamado(id, "assumir", "")

        /** status · prioridade · responsavel · setor · solucao · aceitar · rejeitar · assumir */
        @JavascriptInterface
        fun operarChamado(id: Int, tipo: String, valor: String) {
            val app = applicationContext
            Thread {
                val r = Chamado.operar(app, id, tipo, valor)
                js(webApp, "window.chamadoAcao && chamadoAcao(" + id + "," + JSONObject.quote(tipo) + "," + r.ok + "," + JSONObject.quote(r.mensagem) + ")")
            }.start()
        }

        @JavascriptInterface
        fun anexosChamado(id: Int) {
            val app = applicationContext
            Thread {
                val r = Chamado.anexos(app, id)
                js(webApp, "window.chamadoAnexos && chamadoAnexos(" + id + "," + r.ok + "," + JSONObject.quote(r.mensagem) + "," +
                    (r.dados?.optJSONArray("items")?.toString() ?: "[]") + ")")
            }.start()
        }

        @JavascriptInterface
        fun configurarAvisoMeta(ligado: Boolean) { Metas.ligar(applicationContext, ligado); toast(if (ligado) "Avisos de meta ligados" else "Avisos de meta desligados") }

        @JavascriptInterface
        fun fotoChamado(id: Int) = runOnUiThread { fotoAnexo(id) }

        @JavascriptInterface
        fun anexarChamado(id: Int) = runOnUiThread { escolherAnexo(id) }

        @JavascriptInterface
        fun baixarAnexo(id: Int, anexo: Int, nome: String) = runOnUiThread { this@Tela.baixarAnexo(id, anexo, nome) }

        @JavascriptInterface
        fun copiarDiagnostico() = runOnUiThread {
            try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Diagnóstico Freedom", Helpdesk.textoDiagnostico(this@Tela)))
                toast("Diagnóstico copiado. Cole na conversa com o suporte.")
            } catch (_: Exception) { toast("Não consegui copiar") }
        }

        @JavascriptInterface
        fun voltar() = runOnUiThread { voltarApp() }

        /** Painel num período escolhido na tela (não muda o widget nem o que fica guardado). */
        @JavascriptInterface
        fun buscarPainel(id: String, inicio: String, fim: String) {
            val app = applicationContext
            val alvo = websPainel[id]
            Thread {
                val p = Freedom.porId(id)
                var dados: JSONObject? = null
                var erro = ""
                try {
                    val l = Store.login(app) ?: throw ErroLogin("faça o login")
                    val api = Api(l.first, l.second)
                    api.entrar()
                    try { dados = p?.buscarPeriodo(api, inicio, fim) } finally { api.sair() }
                    if (dados == null) erro = "este painel não tem escolha de período"
                } catch (e: Exception) { erro = Api.mensagem(e) }
                js(alvo, "window.painelPeriodo && painelPeriodo(" + (dados?.toString() ?: "null") + "," + JSONObject.quote(erro) + ")")
            }.start()
        }

        @JavascriptInterface
        fun abrirTela(arquivo: String) = runOnUiThread { this@Tela.abrirTela(arquivo) }

        // ---- imagem (PNG) dos painéis ----
        @JavascriptInterface
        fun compartilharImagem(base64: String, nome: String) {
            val dados = try { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) } catch (_: Exception) { return toast("Imagem inválida") }
            runOnUiThread {
                try { Imagens.compartilhar(this@Tela, dados, nome) }
                catch (e: Exception) { toast("Não consegui compartilhar: " + (e.message ?: "erro")) }
            }
        }

        @JavascriptInterface
        fun salvarImagem(base64: String, nome: String) {
            val app = applicationContext
            Thread {
                val onde = try { Arquivos.salvarImagem(app, android.util.Base64.decode(base64, android.util.Base64.DEFAULT), Arquivos.nome(nome, "image/png")) }
                           catch (_: Exception) { null }
                toast(if (onde != null) "Imagem salva em $onde" else "Não consegui salvar a imagem")
            }.start()
        }

        /** Acesso direto à API do Helpdesk (mesmos endereços do site) para as telas do app. */
        @JavascriptInterface
        fun api(req: Int, metodo: String, caminho: String, corpo: String) {
            val app = applicationContext
            Thread {
                val r = Chamado.requisicao(app, metodo, caminho, corpo)
                js(webApp, "window.apiResposta && apiResposta(" + req + "," + r.first + "," + JSONObject.quote(r.second) + ")")
            }.start()
        }

        // ---- atualização do app ----

        @JavascriptInterface
        fun atualizarApp() = runOnUiThread { iniciarAtualizacao() }

        @JavascriptInterface
        fun tema(): String = Tema.nome(this@Tela)

        /** Troca claro/escuro: salva e remonta a tela inteira (abas, painéis e telas) com as cores novas. */
        @JavascriptInterface
        fun definirTema(t: String) = runOnUiThread {
            if (t == Tema.nome(this@Tela)) return@runOnUiThread
            Tema.definir(this@Tela, t)
            Thread { Widget.redesenharTodos(applicationContext) }.start()     // widgets na tela inicial mudam junto
            recreate()
        }

        @JavascriptInterface
        fun atualizarPeloNavegador() = runOnUiThread { Atualizacao.abrirNoNavegador(this@Tela) }

        @JavascriptInterface
        fun aba(nome: String) = runOnUiThread { selecionar(nome) }

        @JavascriptInterface
        fun liberarBateria() = runOnUiThread { this@Tela.liberarBateria() }

        @JavascriptInterface
        fun configurarNotificacoes() = runOnUiThread { abrirConfigNotificacoes() }

        @JavascriptInterface
        fun testarNotificacao() {
            Helpdesk.testar(applicationContext)
            if (!Helpdesk.notificacoesPermitidas(applicationContext)) runOnUiThread { abrirConfigNotificacoes() }
        }

        /** Abre direto as configurações do canal dos avisos (som, aparecer na tela, tela de bloqueio). */
        @JavascriptInterface
        fun configurarSom() = runOnUiThread {
            try {
                startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, Helpdesk.CANAL_AVISOS))
            } catch (_: Exception) { abrirConfigNotificacoes() }
        }
    }
}
