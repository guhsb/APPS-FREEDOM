package br.com.cbfreedom.comum

import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class ErroLogin(msg: String) : IOException(msg)
class SemAcesso(msg: String) : IOException(msg)

/** Acesso ao site relatorios.cbfreedom.com.br (sessão por cookie, igual ao navegador). */
class Api(private val email: String, private val senha: String) {

    companion object {
        const val BASE = "https://relatorios.cbfreedom.com.br/api/v1"

        /** Texto de erro amigável para mostrar no widget e na tela. */
        fun mensagem(e: Throwable): String = when (e) {
            is UnknownHostException, is ConnectException, is SocketTimeoutException -> "sem conexão com a internet"
            is SSLException -> "erro de conexão segura com o site"
            else -> e.message ?: "erro ao atualizar"
        }
    }

    private var cookie = ""

    private fun abrir(caminho: String): HttpURLConnection {
        val c = URL(BASE + caminho).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 25000
        c.setRequestProperty("Accept", "application/json")
        if (cookie.isNotEmpty()) c.setRequestProperty("Cookie", cookie)
        return c
    }

    fun entrar() {
        val c = abrir("/auth/login")
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        val corpo = JSONObject().put("login", email).put("password", senha).put("remember", true).toString()
        c.outputStream.use { it.write(corpo.toByteArray(Charsets.UTF_8)) }
        val cod = c.responseCode
        if (cod == 400 || cod == 401 || cod == 422) {
            c.disconnect(); throw ErroLogin("e-mail ou senha incorretos")
        }
        if (cod !in 200..299) {
            c.disconnect(); throw IOException("login falhou (HTTP $cod)")
        }
        val partes = mutableListOf<String>()
        for ((nome, valores) in c.headerFields) {
            if (nome != null && nome.equals("Set-Cookie", ignoreCase = true)) {
                for (v in valores) partes.add(v.substringBefore(";"))
            }
        }
        cookie = partes.joinToString("; ")
        try { c.inputStream.close() } catch (_: Exception) { }
        c.disconnect()
    }

    fun get(caminho: String): JSONObject {
        val c = abrir(caminho)
        val cod = c.responseCode
        if (cod == 401 || cod == 403) { c.disconnect(); throw SemAcesso("este login não tem acesso") }
        if (cod != 200) { c.disconnect(); throw IOException("erro ao buscar dados (HTTP $cod)") }
        val txt = c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        c.disconnect()
        return JSONObject(txt)
    }

    fun sair() {
        try {
            val c = abrir("/auth/logout"); c.requestMethod = "POST"; c.responseCode; c.disconnect()
        } catch (_: Exception) { }
    }
}
