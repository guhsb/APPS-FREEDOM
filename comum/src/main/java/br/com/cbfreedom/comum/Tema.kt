package br.com.cbfreedom.comum

import android.content.Context

/** Aparência do app: "claro" (padrão, igual ao site) ou "escuro". Escolhida em Helpdesk > Configurações. */
object Tema {
    private fun p(c: Context) = c.getSharedPreferences("aparencia", Context.MODE_PRIVATE)
    fun nome(c: Context): String = if (p(c).getString("tema", "claro") == "escuro") "escuro" else "claro"
    fun claro(c: Context): Boolean = nome(c) == "claro"
    fun definir(c: Context, t: String) { p(c).edit().putString("tema", if (t == "escuro") "escuro" else "claro").apply() }
}
