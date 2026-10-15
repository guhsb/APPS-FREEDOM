package br.com.cbfreedom.comum

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Interruptor remoto do app, comandado pelo arquivo controle.json do repositório no GitHub
 * (só quem pode fazer Push no repositório consegue mudar):
 *   { "bloqueado": false, "mensagem": "", "bloquear": ["email@..."], "versaoMinima": 0 }
 * - bloqueado = true -> todos os apps saem da conta, apagam os dados guardados e não deixam entrar.
 * - bloquear -> só esses e-mails.
 * - versaoMinima -> versões mais velhas que esse número ficam travadas até atualizar.
 * Sem internet, GitHub fora do ar ou arquivo sumido: mantém o último estado conhecido (não bloqueia por engano).
 */
object Controle {
    private const val URL_CONTROLE = "https://raw.githubusercontent.com/" + Atualizacao.REPO + "/main/controle.json"
    private const val INTERVALO_MS = 10 * 60_000L

    private fun p(c: Context): SharedPreferences = c.getSharedPreferences("controle", Context.MODE_PRIVATE)

    /** Busca o controle.json (no máximo a cada 10 min, ou na hora com forcar). Roda fora da tela principal. */
    fun conferir(c: Context, forcar: Boolean = false) {
        val pr = p(c); val agora = System.currentTimeMillis()
        if (!forcar && agora - pr.getLong("hora", 0L) < INTERVALO_MS) return
        try {
            val con = URL("$URL_CONTROLE?t=" + agora / 60_000L).openConnection() as HttpURLConnection
            con.connectTimeout = 10000; con.readTimeout = 10000
            con.setRequestProperty("User-Agent", "Freedom-Android")
            con.setRequestProperty("Cache-Control", "no-cache")
            if (con.responseCode == 200) {
                val txt = con.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                JSONObject(txt)   // só guarda se for um JSON válido
                pr.edit().putString("json", txt).putLong("hora", agora).apply()
            } else pr.edit().putLong("hora", agora).apply()
            con.disconnect()
        } catch (_: Exception) { }
    }

    /** null = liberado; senão {tipo: todos|usuario|versao, mensagem}. */
    fun estado(c: Context, email: String? = Store.email(c)): JSONObject? {
        val o = try { JSONObject(p(c).getString("json", null) ?: return null) } catch (_: Exception) { return null }
        val msg = o.optString("mensagem", "").trim()
        if (o.optBoolean("bloqueado", false))
            return JSONObject().put("tipo", "todos").put("mensagem", msg.ifEmpty { "Este app foi desativado pela empresa." })
        val e = (email ?: "").trim().lowercase()
        val lista = o.optJSONArray("bloquear")
        if (e.isNotEmpty() && lista != null) for (i in 0 until lista.length())
            if (lista.optString(i).trim().lowercase() == e)
                return JSONObject().put("tipo", "usuario").put("mensagem", msg.ifEmpty { "O acesso deste login ao app foi desativado." })
        val min = numeroPublicacao(o.opt("versaoMinima"))
        if (min > 0 && Atualizacao.versaoAtual(c) in 1 until min)
            return JSONObject().put("tipo", "versao").put("mensagem", "Esta versão do app não pode mais ser usada. Atualize para a versão " + o.opt("versaoMinima") + " ou mais nova.")
        return null
    }

    /** "3.4" -> número da publicação (3.0 = 21, cada versão +1, 3.10 -> 4.0); um número sozinho já é a publicação. */
    fun numeroPublicacao(v: Any?): Long {
        val s = (v ?: "").toString().trim()
        if (s.isEmpty() || s == "null") return 0L
        if (!s.contains('.')) return s.toDoubleOrNull()?.toLong() ?: 0L
        val p = s.split('.'); val maj = p[0].toLongOrNull() ?: return 0L; val min = p.getOrNull(1)?.toLongOrNull() ?: 0L
        return if (maj < 3) 0L else 21 + (maj - 3) * 11 + min
    }

    /** Bloqueado: sai da conta e apaga tudo que o app guardou (login, números, avisos, fila sem internet). Devolve true se apagou algo. */
    fun aplicarSemTela(c: Context): Boolean {
        if (estado(c) == null || !Store.logado(c)) return false
        try { Tarefa.cancelar(c) } catch (_: Exception) { }
        try { Helpdesk.sair(c) } catch (_: Exception) { }
        try { Fila.limpar(c) } catch (_: Exception) { }
        try { Acesso.limpar(c) } catch (_: Exception) { }
        Store.sair(c)
        try { Metas.prefs(c).edit().clear().apply() } catch (_: Exception) { }
        try { Widget.redesenharTodos(c) } catch (_: Exception) { }
        return true
    }
}
