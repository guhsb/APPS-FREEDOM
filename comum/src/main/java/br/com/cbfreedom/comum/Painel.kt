package br.com.cbfreedom.comum

import android.appwidget.AppWidgetProvider
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject

/** Situação da última atualização, mostrada no canto do widget. */
class Info(val hora: Long, val erro: String?, val logado: Boolean, val atualizando: Boolean)

/**
 * Um painel de números (aba Painel + widget da tela inicial). Cada área da empresa é um painel:
 * Comercial, Faturamento (logística)… Para criar um novo no futuro, basta implementar esta interface,
 * criar o widget dele e registrar em AppFreedom (pasta app/).
 */
interface Painel {
    val id: String                     // identificador curto, ex.: "comercial"
    val titulo: String                 // nome no widget, ex.: "Freedom Comercial"
    val nomeModulo: String             // nome na aba Painel, ex.: "Comercial"
    val modulo: String                 // módulo do site que libera este painel (ex.: "commercial", "logistics")
    val tela: String                   // página da tela cheia, dentro de assets
    val classeWidget: Class<out AppWidgetProvider>   // o widget deste painel
    val fundoRosado: Boolean get() = false
    val naAbaPainel: Boolean get() = true          // aparece na aba Painel do app (o Helpdesk tem aba própria)
    val aba: String get() = "painel"               // aba do app que o widget abre
    fun buscar(api: Api): JSONObject
    /** classe: 'P' = pequeno, 'M' = médio, 'G' = grande */
    fun desenhar(p: Pintor, d: JSONObject, info: Info, classe: Char)
}

object Freedom {
    /** Todos os painéis que o app conhece (registrados em AppFreedom). */
    val paineis = ArrayList<Painel>()
    private var logoCache: Bitmap? = null

    fun registrar(vararg p: Painel) {
        for (x in p) if (paineis.none { it.id == x.id }) paineis.add(x)
    }

    fun porId(id: String?): Painel? = paineis.firstOrNull { it.id == id }

    /** Painéis que o login atual pode ver (conforme os módulos que ele tem no site). */
    fun disponiveis(c: Context): List<Painel> = paineis.filter { Acesso.tem(c, it.modulo) }

    /** Os que aparecem na aba Painel (o Helpdesk tem aba própria, só o widget dele é painel). */
    fun paraAbaPainel(c: Context): List<Painel> = disponiveis(c).filter { it.naAbaPainel }

    fun logo(c: Context): Bitmap? {
        if (logoCache == null) logoCache = try { BitmapFactory.decodeResource(c.resources, R.drawable.logo) } catch (_: Exception) { null }
        return logoCache
    }

    /** Tamanho do widget em dp -> tipo de desenho e "zoom" para preencher bem o espaço. */
    fun classe(w: Float, h: Float): Char = when {
        w < 200f -> 'P'
        h < 230f -> 'M'
        else -> 'G'
    }

    fun zoom(w: Float, h: Float, classe: Char): Float {
        val z = when (classe) {
            'P' -> minOf(w / 155f, h / 155f)
            'M' -> minOf(w / 330f, h / 150f)
            else -> w / 330f
        }
        return z.coerceIn(0.8f, 1.35f)
    }

    /** Desenha a imagem do widget (w x h em dp, k = pixels por dp). Não depende do Android "vivo": dá para testar no PC. */
    fun render(painel: Painel, w: Float, h: Float, k: Float, logo: Bitmap?, dadosTxt: String?, info: Info, semAcesso: Boolean = false): Bitmap {
        val classe = classe(w, h)
        val z = zoom(w, h, classe)
        val p = Pintor(w / z, h / z, k * z, logo)
        p.fundo(painel.fundoRosado)
        val d = try { if (dadosTxt != null) JSONObject(dadosTxt) else null } catch (_: Exception) { null }
        when {
            !info.logado -> p.mensagem(painel.titulo, "Toque aqui para abrir o app e fazer o login.", null)
            semAcesso -> p.mensagem(painel.titulo, "Este login não tem acesso ao " + painel.nomeModulo + ". Toque para abrir o app.", null)
            d == null && info.atualizando -> p.mensagem(painel.titulo, "Buscando os números…", null)
            d == null -> p.mensagem(painel.titulo, "Não consegui atualizar: " + (info.erro ?: "toque no horário para tentar de novo"), info)
            else -> try { painel.desenhar(p, d, info, classe) } catch (e: Exception) {
                p.fundo(painel.fundoRosado)
                p.mensagem(painel.titulo, "Erro ao desenhar: " + (e.message ?: e.toString()), info)
            }
        }
        return p.bmp
    }

    fun info(c: Context, painel: Painel): Info {
        val cache = Store.cache(c)
        return Info(cache.getLong("hora_" + painel.id, 0L), cache.getString("erro_" + painel.id, null), Store.logado(c), Atualizador.atualizando)
    }

    fun dados(c: Context, painel: Painel): String? = Store.cache(c).getString("dados_" + painel.id, null)

    fun imagem(c: Context, painel: Painel, w: Float, h: Float, k: Float): Bitmap =
        render(painel, w, h, k, logo(c), dados(c, painel), info(c, painel), Store.logado(c) && !Acesso.tem(c, painel.modulo))
}
