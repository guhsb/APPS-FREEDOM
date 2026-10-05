package br.com.cbfreedom.comum

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/** Tela do app: login (primeira vez) e depois a tela cheia com os números. */
class Tela : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0a0c12"))
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.textZoom = 100              // não deixa a letra grande do celular desmontar a tela
        s.allowFileAccess = false
        s.allowContentAccess = false
        web.addJavascriptInterface(Ponte(), "App")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean =
                !r.url.toString().startsWith("file:///android_asset/")
        }
        setContentView(web)
        carregar()
    }

    private fun carregar() {
        web.loadUrl("file:///android_asset/" + if (Store.logado(this)) Freedom.painel.tela else "login.html")
    }

    override fun onResume() {
        super.onResume()
        if (Store.logado(this) && Atualizador.velho(this, 2)) atualizarAgora()
    }

    private fun js(codigo: String) = runOnUiThread { web.evaluateJavascript(codigo, null) }
    private fun avisarPagina() = js("window.recebido && recebido()")

    private fun atualizarAgora() {
        Atualizador.atualizando = true
        avisarPagina()
        Atualizador.emSegundoPlano(this) { avisarPagina() }
    }

    private fun nomeApp(): String = applicationInfo.loadLabel(packageManager).toString()

    inner class Ponte {
        @JavascriptInterface
        fun nome(): String = nomeApp()

        @JavascriptInterface
        fun dados(): String {
            val c = Store.cache(this@Tela)
            val o = JSONObject()
            val txt = c.getString("dados", null)
            if (txt != null) try { o.put("dados", JSONObject(txt)) } catch (_: Exception) { }
            c.getString("erro", null)?.let { o.put("erro", it) }
            o.put("hora", c.getLong("hora", 0L))
            o.put("atualizando", Atualizador.atualizando)
            o.put("email", Store.email(this@Tela) ?: "")
            o.put("nome", nomeApp())
            return o.toString()
        }

        @JavascriptInterface
        fun atualizar() = atualizarAgora()

        @JavascriptInterface
        fun entrar(email: String, senha: String) {
            val e = email.trim()
            Thread {
                try {
                    Api(e, senha).entrar()          // confere se o login está certo antes de salvar
                    Store.salvarLogin(applicationContext, e, senha)
                    Tarefa.agendar(applicationContext)
                    Atualizador.atualizando = true
                    runOnUiThread { carregar() }
                    Atualizador.atualizar(applicationContext)
                    avisarPagina()
                } catch (x: Exception) {
                    js("erroLogin(" + JSONObject.quote(Api.mensagem(x)) + ")")
                }
            }.start()
        }

        @JavascriptInterface
        fun sair() {
            Store.sair(applicationContext)
            Tarefa.cancelar(applicationContext)
            Widget.redesenharTodos(applicationContext)
            runOnUiThread { carregar() }
        }
    }
}
