package br.com.cbfreedom.comum

import android.content.Context

/**
 * Faz o login, confere os módulos do login, busca os números de cada painel liberado,
 * guarda no celular e redesenha os widgets.
 */
object Atualizador {

    @Volatile var atualizando = false
    private val trava = Any()

    /** true se a última tentativa foi há mais de "minutos". */
    fun velho(c: Context, minutos: Int): Boolean =
        System.currentTimeMillis() - Store.cache(c).getLong("tentativa", 0L) > minutos * 60_000L

    /** Devolve a mensagem de erro (ou null se tudo deu certo). */
    fun atualizar(c: Context): String? = synchronized(trava) {
        atualizando = true
        Widget.redesenharTodos(c)
        val agora = System.currentTimeMillis()
        val ed = Store.cache(c).edit().putLong("tentativa", agora)
        var erro: String? = null
        try {
            val l = Store.login(c) ?: throw ErroLogin("abra o app e faça o login")
            val api = Api(l.first, l.second)
            api.entrar()
            try {
                Acesso.atualizar(c, api)            // quais módulos este login tem
                for (p in Freedom.paineis) {
                    if (!Acesso.tem(c, p.modulo)) {
                        ed.remove("dados_" + p.id).putString("erro_" + p.id, "este login não tem acesso ao " + p.nomeModulo)
                        continue
                    }
                    try {
                        val d = p.buscar(api)
                        ed.putString("dados_" + p.id, d.toString()).putLong("hora_" + p.id, System.currentTimeMillis())
                            .remove("erro_" + p.id)
                    } catch (e: Exception) {
                        val m = Api.mensagem(e)
                        ed.putString("erro_" + p.id, m)
                        if (e is SemAcesso) ed.remove("dados_" + p.id)
                        if (erro == null) erro = m
                    }
                }
            } finally { api.sair() }
        } catch (e: Exception) {
            val m = Api.mensagem(e)
            for (p in Freedom.paineis) ed.putString("erro_" + p.id, m)
            erro = m
        }
        // só grava se a pessoa ainda está logada (não traz de volta dados depois de sair)
        if (Store.logado(c)) ed.commit()
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
