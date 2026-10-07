package br.com.cbfreedom.comum

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * Módulos que o login tem no site (vem de /auth/me -> "modules"): commercial, logistics, helpdesk...
 * O app mostra só o que a pessoa pode ver:
 *  - aba Helpdesk e avisos     -> módulo "helpdesk"
 *  - painéis e widgets          -> módulo de cada painel (Comercial = "commercial", Faturamento = "logistics", ...)
 * Dentro do Comercial, o próprio painel separa gestor e vendedor pelo perfil (role) do login.
 * Enquanto não souber (antes da primeira consulta), mostra tudo.
 */
object Acesso {

    const val HELPDESK = "helpdesk"

    private fun p(c: Context): SharedPreferences = c.getSharedPreferences("acesso", Context.MODE_PRIVATE)

    fun salvar(c: Context, me: JSONObject) {
        val arr = me.optJSONArray("modules") ?: return
        p(c).edit()
            .putString("modulos", arr.toString())
            .putString("perfil", me.optString("role"))
            .putString("nome", me.optString("display_name"))
            .commit()
        Widget.ajustarDisponiveis(c)
    }

    /** Busca os módulos no site com uma sessão já aberta. Erros são ignorados (fica o que já sabia). */
    fun atualizar(c: Context, api: Api) {
        try { salvar(c, api.get("/auth/me")) } catch (_: Exception) { }
    }

    fun modulos(c: Context): Set<String>? {
        val s = p(c).getString("modulos", null) ?: return null
        return try {
            val a = JSONArray(s)
            (0 until a.length()).map { a.optString(it).lowercase() }.toSet()
        } catch (_: Exception) { null }
    }

    fun tem(c: Context, modulo: String): Boolean = modulos(c)?.contains(modulo.lowercase()) ?: true

    fun helpdesk(c: Context): Boolean = tem(c, HELPDESK)

    /** Tem pelo menos um painel liberado. */
    fun painel(c: Context): Boolean = Freedom.paraAbaPainel(c).isNotEmpty()

    fun perfil(c: Context): String = p(c).getString("perfil", "") ?: ""

    fun limpar(c: Context) {
        p(c).edit().clear().commit()
        Widget.ajustarDisponiveis(c)
    }
}
