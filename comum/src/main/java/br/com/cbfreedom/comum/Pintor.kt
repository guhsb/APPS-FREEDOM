package br.com.cbfreedom.comum

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object Cor {
    val ROSA = Color.parseColor("#e84b8a")
    val AZUL = Color.parseColor("#4f7cff")
    val VERDE = Color.parseColor("#1fbf8f")
    val LARANJA = Color.parseColor("#f0a53a")
    val VIOLETA = Color.parseColor("#8b6cf0")
    val FUNDO = Color.parseColor("#0a0c12")
    val FUNDO_ROSA = Color.parseColor("#1a0f1c")
    val CARD = Color.parseColor("#12151f")
    val LINHA = Color.parseColor("#232838")
    val TRILHO = Color.parseColor("#1b2030")
    val BRANCO = Color.parseColor("#f2f4f8")
    val CINZA = Color.parseColor("#8b93a7")
    val APAGADO = Color.parseColor("#5d6578")
    val IDEAL = Color.parseColor("#c9ced9")
}

/**
 * Desenha o widget numa imagem. Todas as medidas são em "pontos" (como no widget do iPhone):
 * a imagem tem larg x alt pontos e k pixels por ponto. Assim o desenho fica igual em qualquer
 * celular e não muda com o tamanho da letra configurado no aparelho.
 */
class Pintor(val larg: Float, val alt: Float, k: Float, val logoImg: Bitmap?) {

    val bmp: Bitmap = Bitmap.createBitmap(max(1, (larg * k).roundToInt()), max(1, (alt * k).roundToInt()), Bitmap.Config.ARGB_8888)
    private val cv = Canvas(bmp)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG)
    private val fp = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ip = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    init { cv.scale(k, k) }

    // N = normal, S = semi-negrito, B = negrito, H = extra-negrito
    private val fontes = HashMap<Char, Typeface>()
    private fun fonte(peso: Char): Typeface = fontes.getOrPut(peso) {
        when (peso) {
            'H' -> if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 900, false) else Typeface.DEFAULT_BOLD
            'S' -> if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 600, false) else Typeface.DEFAULT_BOLD
            'B' -> Typeface.DEFAULT_BOLD
            else -> Typeface.DEFAULT
        }
    }

    fun medir(t: String, tam: Float, peso: Char = 'N'): Float {
        tp.typeface = fonte(peso); tp.textSize = tam
        return tp.measureText(t)
    }

    /**
     * Escreve um texto. y = linha de base. alin: E = esquerda, C = centro, D = direita.
     * max > 0: diminui a letra (até 55%) e, se ainda não couber, corta com "…". Devolve a largura usada.
     */
    fun texto(t: String, x: Float, y: Float, tam: Float, cor: Int, peso: Char = 'N', alin: Char = 'E', max: Float = 0f): Float {
        tp.typeface = fonte(peso); tp.textSize = tam; tp.color = cor; tp.shader = null
        var s = t
        var w = tp.measureText(s)
        if (max > 0f && w > max) {
            tp.textSize = max(tam * 0.55f, tam * max / w)
            w = tp.measureText(s)
            if (w > max) {
                while (s.length > 1 && tp.measureText("$s…") > max) s = s.dropLast(1)
                s = "$s…"; w = tp.measureText(s)
            }
        }
        val xx = when (alin) { 'C' -> x - w / 2f; 'D' -> x - w; else -> x }
        cv.drawText(s, xx, y, tp)
        return w
    }

    /** Quebra um texto em linhas que cabem em "max". */
    fun quebrar(t: String, tam: Float, peso: Char, max: Float): List<String> {
        val linhas = ArrayList<String>()
        var atual = ""
        for (pal in t.split(" ")) {
            val tentativa = if (atual.isEmpty()) pal else "$atual $pal"
            if (atual.isNotEmpty() && medir(tentativa, tam, peso) > max) { linhas.add(atual); atual = pal } else atual = tentativa
        }
        if (atual.isNotEmpty()) linhas.add(atual)
        return linhas
    }

    fun ret(x: Float, y: Float, w: Float, h: Float, r: Float, cor: Int) {
        fp.shader = null; fp.style = Paint.Style.FILL; fp.color = cor
        cv.drawRoundRect(RectF(x, y, x + w, y + h), r, r, fp)
    }

    fun borda(x: Float, y: Float, w: Float, h: Float, r: Float, cor: Int, esp: Float = 1f) {
        fp.shader = null; fp.style = Paint.Style.STROKE; fp.strokeWidth = esp; fp.color = cor
        cv.drawRoundRect(RectF(x + esp / 2, y + esp / 2, x + w - esp / 2, y + h - esp / 2), r, r, fp)
        fp.style = Paint.Style.FILL
    }

    /** Fundo do widget (cantos arredondados). rosado = brilho rosa em cima, como no Faturamento do iPhone. */
    fun fundo(rosado: Boolean) {
        fp.style = Paint.Style.FILL
        fp.color = Cor.FUNDO
        fp.shader = if (rosado) LinearGradient(0f, 0f, 0f, alt * 0.6f, Cor.FUNDO_ROSA, Cor.FUNDO, Shader.TileMode.CLAMP) else null
        cv.drawRoundRect(RectF(0f, 0f, larg, alt), 18f, 18f, fp)
        fp.shader = null
    }

    /** Barra de progresso com a marca do "ideal de hoje". */
    fun barra(x: Float, y: Float, w: Float, h: Float, p: Double, idealP: Double?, cor: Int) {
        ret(x, y, w, h, h / 2, Cor.TRILHO)
        val cheio = max(h, (w * p.coerceIn(0.0, 1.0)).toFloat())
        if (p > 0) ret(x, y, cheio, h, h / 2, cor)
        if (idealP != null) {
            val ix = x + min(w - 2f, (w * idealP.coerceIn(0.0, 1.0)).toFloat())
            ret(ix - 1f, y - 1.5f, 2f, h + 3f, 1f, Cor.IDEAL)
        }
    }

    /** Desenha o logo com altura h. Devolve a largura. */
    fun logo(x: Float, y: Float, h: Float, alin: Char = 'E'): Float {
        val l = logoImg ?: return 0f
        val w = h * l.width / l.height
        val xx = when (alin) { 'C' -> x - w / 2; 'D' -> x - w; else -> x }
        cv.drawBitmap(l, null, RectF(xx, y, xx + w, y + h), ip)
        return w
    }

    /** "R$" pequeno rosa + número grande. Devolve a largura total. */
    fun valorRS(v: Double, x: Float, y: Float, tam: Float, alin: Char = 'E', max: Float = 0f): Float {
        var t = tam
        val num = Fmt.num(v)
        fun total() = medir("R$", t * 0.45f, 'H') + t * 0.12f + medir(num, t, 'H')
        if (max > 0f) while (total() > max && t > tam * 0.55f) t -= 0.5f
        val w = total()
        var xx = when (alin) { 'C' -> x - w / 2; 'D' -> x - w; else -> x }
        xx += texto("R$", xx, y - t * 0.30f, t * 0.45f, Cor.ROSA, 'H') + t * 0.12f
        texto(num, xx, y, t, Cor.BRANCO, 'H')
        return w
    }

    /** Pares "Rótulo valor" espalhados numa linha (primeiro à esquerda, último à direita). */
    fun linhaInfo(y: Float, x: Float, w: Float, pares: List<Triple<String, String, Int?>>, tam0: Float) {
        var tam = tam0
        fun larg(i: Int) = medir(pares[i].first + " ", tam) + medir(pares[i].second, tam, 'B')
        while (tam > tam0 * 0.7f && (pares.indices.sumOf { larg(it).toDouble() } + 8.0 * (pares.size - 1)) > w) tam -= 0.25f
        if (pares.size == 1) {
            texto(pares[0].first, x, y, tam, Cor.CINZA)
            texto(pares[0].second, x + w, y, tam, pares[0].third ?: Cor.BRANCO, 'B', 'D')
            return
        }
        val total = pares.indices.sumOf { larg(it).toDouble() }.toFloat()
        val gap = (w - total) / (pares.size - 1)
        var xx = x
        for (i in pares.indices) {
            val a = texto(pares[i].first + " ", xx, y, tam, Cor.CINZA)
            texto(pares[i].second, xx + a, y, tam, pares[i].third ?: Cor.BRANCO, 'B')
            xx += larg(i) + gap
        }
    }

    /** Canto de cima à direita: horário da última atualização + "toque para atualizar". */
    /** Widget estreito: o horário vira só "↻ 15:35" (não cabe o texto inteiro ao lado do logo). */
    val estreito: Boolean get() = larg < 235f

    fun horario(info: Info, dir: Float, y0: Float, compacto: Boolean = estreito) {
        val hm = if (info.hora > 0) Fmt.hhmm(info.hora) else "--:--"
        if (compacto) {
            val cor = if (info.erro != null && !info.atualizando) Cor.LARANJA else Cor.CINZA
            texto(if (info.atualizando) "↻ …" else (if (info.erro != null) "! " else "↻ ") + hm, dir, y0 + 10f, 9f, cor, 'B', 'D')
            return
        }
        if (info.atualizando) texto("atualizando…", dir, y0 + 8f, 8f, Cor.CINZA, 'B', 'D')
        else texto("↻ atualizado $hm", dir, y0 + 8f, 8f, Cor.CINZA, 'B', 'D')
        if (info.erro != null && !info.atualizando) texto("não atualizou · toque aqui", dir, y0 + 17f, 7f, Cor.LARANJA, 'N', 'D')
        else texto("toque aqui para atualizar", dir, y0 + 17f, 7f, Cor.APAGADO, 'N', 'D')
    }

    /** Logo + título + horário. Devolve o y onde o conteúdo começa. */
    fun cabecalho(titulo: String, info: Info, x0: Float, y0: Float, pequeno: Boolean): Float {
        val lw = logo(x0, y0, if (estreito) 17f else 20f)
        horario(info, larg - x0, y0)
        if (pequeno) {
            texto(titulo, x0, y0 + 32f, 9f, Cor.CINZA, 'B', max = larg - 2 * x0)
            return y0 + 36f
        }
        val tx = x0 + lw + 7f
        texto(titulo, tx, y0 + 13.5f, 10f, Cor.CINZA, 'B', max = larg - x0 - tx - (if (estreito) 44f else 104f))
        return y0 + 26f
    }

    /**
     * Widget de uma linha só (bem baixo): rótulo + horário em cima, valor grande embaixo e, opcional,
     * um texto à direita. Devolve o y da linha de base do valor.
     */
    fun barraTopo(rotulo: String, info: Info): Float {
        val x0 = 12f
        val comLogo = larg >= 230f
        val lw = if (comLogo) logo(x0, (alt - 22f) / 2f, 22f) + 10f else 0f
        horario(info, larg - x0, 6f, true)
        texto(rotulo, x0 + lw, alt / 2f - 4f, 8.5f, Cor.CINZA, 'B', max = larg - 2 * x0 - lw - 50f)
        return alt / 2f + 13f
    }

    fun barraX(): Float = if (larg >= 230f) 12f + (logoImg?.let { 22f * it.width / it.height } ?: 0f) + 10f else 12f

    /** Valor em reais que cabe na largura: completo (R$ 1.234,56) ou resumido (R$ 1,2 mil). */
    fun reaisQueCabe(v: Double, tam: Float, max: Float, peso: Char = 'H'): String =
        if (medir(Fmt.brl(v), tam, peso) <= max) Fmt.brl(v) else Fmt.brlK(v)

    /** Tela de aviso (sem login, sem dados, erro). */
    fun mensagem(titulo: String, msg: String, info: Info?) {
        val x0 = 14f
        if (alt < 90f) {
            // widget de uma linha: só o título e a mensagem
            if (info != null) horario(info, larg - 12f, 6f, true)
            texto(titulo, 12f, alt / 2f - 4f, 8.5f, Cor.CINZA, 'B', max = larg - 70f)
            texto(msg, 12f, alt / 2f + 12f, 9.5f, if (info?.erro != null) Cor.LARANJA else Cor.BRANCO, 'N', max = larg - 24f)
            return
        }
        logo(x0, 12f, 20f)
        if (info != null) horario(info, larg - x0, 12f)
        var y = 12f + 20f + 20f
        texto(titulo, x0, y, 14f, Cor.BRANCO, 'B', max = larg - 2 * x0)
        y += 17f
        for (l in quebrar(msg, 11f, 'N', larg - 2 * x0).take(max(1, ((alt - y) / 14f).toInt()))) {
            texto(l, x0, y, 11f, if (info?.erro != null) Cor.LARANJA else Cor.CINZA); y += 14f
        }
    }
}
