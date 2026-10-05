package br.com.cbfreedom.comum

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject

/** Situação da última atualização, mostrada no canto do widget. */
class Info(val hora: Long, val erro: String?, val logado: Boolean, val atualizando: Boolean)

/** O que cada app (Comercial / Faturamento) precisa dizer: como buscar os dados e como desenhar o widget. */
interface Painel {
    val titulo: String                 // ex.: "Freedom Comercial"
    val tela: String                   // página da tela cheia, dentro de assets
    val fundoRosado: Boolean get() = false
    fun buscar(api: Api): JSONObject
    /** classe: 'P' = pequeno, 'M' = médio, 'G' = grande */
    fun desenhar(p: Pintor, d: JSONObject, info: Info, classe: Char)
}

object Freedom {
    lateinit var painel: Painel
    private var logoCache: Bitmap? = null

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
    fun render(w: Float, h: Float, k: Float, logo: Bitmap?, dadosTxt: String?, info: Info): Bitmap {
        val classe = classe(w, h)
        val z = zoom(w, h, classe)
        val p = Pintor(w / z, h / z, k * z, logo)
        p.fundo(painel.fundoRosado)
        val d = try { if (dadosTxt != null) JSONObject(dadosTxt) else null } catch (_: Exception) { null }
        when {
            !info.logado -> p.mensagem(painel.titulo, "Toque aqui para abrir o app e fazer o login.", null)
            d == null && info.atualizando -> p.mensagem(painel.titulo, "Buscando os números…", null)
            d == null -> p.mensagem(painel.titulo, "Não consegui atualizar: " + (info.erro ?: "toque no horário para tentar de novo"), info)
            else -> try { painel.desenhar(p, d, info, classe) } catch (e: Exception) {
                p.fundo(painel.fundoRosado)
                p.mensagem(painel.titulo, "Erro ao desenhar: " + (e.message ?: e.toString()), info)
            }
        }
        return p.bmp
    }

    fun imagem(c: Context, w: Float, h: Float, k: Float): Bitmap {
        val cache = Store.cache(c)
        val info = Info(cache.getLong("hora", 0L), cache.getString("erro", null), Store.logado(c), Atualizador.atualizando)
        return render(w, h, k, logo(c), cache.getString("dados", null), info)
    }
}
