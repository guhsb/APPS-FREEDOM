package br.com.cbfreedom.comum

import android.content.Context

/** Faz o login, busca os números, guarda no celular e redesenha os widgets. */
object Atualizador {

    @Volatile var atualizando = false
    private val trava = Any()

    /** true se a última tentativa foi há mais de "minutos". */
    fun velho(c: Context, minutos: Int): Boolean =
        System.currentTimeMillis() - Store.cache(c).getLong("tentativa", 0L) > minutos * 60_000L

    fun atualizar(c: Context): String? = synchronized(trava) {
        atualizando = true
        Widget.redesenharTodos(c)
        val agora = System.currentTimeMillis()
        val ed = Store.cache(c).edit().putLong("tentativa", agora)
        val erro: String? = try {
            val l = Store.login(c) ?: throw ErroLogin("abra o app e faça o login")
            val api = Api(l.first, l.second)
            api.entrar()
            val d = try { Freedom.painel.buscar(api) } finally { api.sair() }
            ed.putString("dados", d.toString()).putLong("hora", System.currentTimeMillis()).remove("erro")
            null
        } catch (e: Exception) {
            val m = Api.mensagem(e)
            ed.putString("erro", m)
            m
        }
        ed.commit()
        atualizando = false
        Widget.redesenharTodos(c)
        erro
    }

    fun emSegundoPlano(c: Context, depois: ((String?) -> Unit)? = null) {
        val app = c.applicationContext
        Thread {
            val e = atualizar(app)
            depois?.invoke(e)
        }.start()
    }
}
