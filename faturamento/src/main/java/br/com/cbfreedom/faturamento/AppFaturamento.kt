package br.com.cbfreedom.faturamento

import android.app.Application
import br.com.cbfreedom.comum.Freedom

class AppFaturamento : Application() {
    override fun onCreate() {
        super.onCreate()
        Freedom.painel = PainelFaturamento
    }
}
