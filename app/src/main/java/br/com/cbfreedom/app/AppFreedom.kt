package br.com.cbfreedom.app

import android.app.Application
import br.com.cbfreedom.comercial.PainelComercial
import br.com.cbfreedom.comum.Freedom
import br.com.cbfreedom.comum.PainelHelpdesk
import br.com.cbfreedom.faturamento.PainelFaturamento

/**
 * App único Freedom. Aqui ficam registrados os painéis (cada área da empresa).
 * O app mostra para cada pessoa só os painéis dos módulos que o login dela tem no site.
 *
 * Para adicionar um painel novo no futuro (ex.: Financeiro):
 *  1. crie o objeto do painel (como PainelFaturamento) com o módulo do site que libera ele;
 *  2. crie a página assets/painel-xxx.html e o widget (classe abaixo + res/xml/widget_xxx.xml + AndroidManifest);
 *  3. registre aqui embaixo.
 */
class AppFreedom : Application() {
    override fun onCreate() {
        super.onCreate()
        Freedom.registrar(PainelHelpdesk, PainelComercial, PainelFaturamento)
    }
}
