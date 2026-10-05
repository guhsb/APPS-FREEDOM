package br.com.cbfreedom.comercial

import android.app.Application
import br.com.cbfreedom.comum.Freedom

class AppComercial : Application() {
    override fun onCreate() {
        super.onCreate()
        Freedom.painel = PainelComercial
    }
}
