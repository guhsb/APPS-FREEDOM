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

/**
 * Acesso ao site relatorios.cbfreedom.com.br (sessão por cookie, igual ao navegador).
 * cookieInicial: reaproveita uma sessão já aberta (usado pelo monitor do Helpdesk).
 */
class Api(private val email: String, private val senha: String, cookieInicial: String = "") {

    companion object {
        const val BASE = "https://relatorios.cbfreedom.com.br/api/v1"

        /** Texto de erro amigável para mostrar no widget e na tela. */
        fun mensagem(e: Throwable): String = when (e) {
            is UnknownHostException, is ConnectException, is SocketTimeoutException -> "sem conexão com a internet"
            is SSLException -> "erro de conexão segura com o site"
            else -> e.message ?: "erro ao atualizar"
        }
    }

    /** Cookie da sessão ("nome=valor; ...") para reaproveitar depois. */
    var cookie: String = cookieInicial
        private set

    /** Cabeçalhos Set-Cookie completos do login (para logar o WebView do site automaticamente). */
    val setCookies = mutableListOf<String>()

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
                for (v in valores) { setCookies.add(v); partes.add(v.substringBefore(";")) }
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
        // 204 = o site não tem dados para esse filtro (ex.: semana ainda sem vendas): vira "vazio", não erro
        if (cod == 204) { c.disconnect(); return JSONObject() }
        if (cod != 200) { c.disconnect(); throw IOException("erro ao buscar dados (HTTP $cod)") }
        val txt = c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        c.disconnect()
        return if (txt.isBlank()) JSONObject() else JSONObject(txt)
    }

    /** GET que não lança erro por código HTTP: devolve (código, corpo). Usado pelo monitor do Helpdesk. */
    fun bruto(caminho: String): Pair<Int, String> {
        val c = abrir(caminho)
        try {
            c.instanceFollowRedirects = false
            val cod = c.responseCode
            val fluxo = if (cod >= 400) c.errorStream else c.inputStream
            val txt = fluxo?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(cod, txt)
        } finally {
            c.disconnect()
        }
    }

    /** Define o método HTTP; PATCH não é aceito por todo HttpURLConnection, então força pelo campo interno. */
    private fun metodo(c: HttpURLConnection, m: String) {
        try {
            c.requestMethod = m
        } catch (e: java.net.ProtocolException) {
            val f = HttpURLConnection::class.java.getDeclaredField("method")
            f.isAccessible = true
            f.set(c, m)
        }
    }

    /** Requisição GET, POST ou PATCH com corpo JSON; não lança erro por código HTTP: devolve (código, corpo). */
    fun enviar(metodo: String, caminho: String, corpo: JSONObject?): Pair<Int, String> {
        val c = abrir(caminho)
        try {
            c.instanceFollowRedirects = false
            metodo(c, metodo)
            if (corpo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            }
            val cod = c.responseCode
            val fluxo = if (cod >= 400) c.errorStream else c.inputStream
            val txt = fluxo?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(cod, txt)
        } finally {
            c.disconnect()
        }
    }

    /** Envia um arquivo (multipart/form-data, campo "file"), como o site faz nos anexos. */
    fun enviarArquivo(caminho: String, nome: String, tipo: String, dados: ByteArray): Pair<Int, String> {
        val c = abrir(caminho)
        try {
            c.instanceFollowRedirects = false
            c.requestMethod = "POST"
            c.doOutput = true
            val limite = "----freedom" + System.currentTimeMillis()
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$limite")
            val nomeSeguro = nome.replace("\"", "'").replace("\r", "").replace("\n", "")
            val cab = ("--$limite\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$nomeSeguro\"\r\n" +
                "Content-Type: $tipo\r\n\r\n").toByteArray(Charsets.UTF_8)
            val fim = "\r\n--$limite--\r\n".toByteArray(Charsets.UTF_8)
            c.setFixedLengthStreamingMode(cab.size + dados.size + fim.size)
            c.outputStream.use { it.write(cab); it.write(dados); it.write(fim) }
            val cod = c.responseCode
            val fluxo = if (cod >= 400) c.errorStream else c.inputStream
            val txt = fluxo?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(cod, txt)
        } finally {
            c.disconnect()
        }
    }

    fun sair() {
        try {
            val c = abrir("/auth/logout"); c.requestMethod = "POST"; c.responseCode; c.disconnect()
        } catch (_: Exception) { }
    }
}
