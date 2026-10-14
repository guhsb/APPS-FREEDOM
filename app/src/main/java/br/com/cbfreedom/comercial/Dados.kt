package br.com.cbfreedom.comercial

import br.com.cbfreedom.comum.Api
import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId

/** Busca os números no site e faz as mesmas contas dos painéis do computador e do iPhone. */
object Dados {

    private val ZONA: ZoneId = ZoneId.of("America/Sao_Paulo")

    fun n(o: JSONObject?, k: String): Double {
        if (o == null || !o.has(k) || o.isNull(k)) return 0.0
        return o.optString(k, "0").toDoubleOrNull() ?: o.optDouble(k, 0.0)
    }

    private fun iso(d: LocalDate) = d.toString()

    fun comercial(api: Api): JSONObject {
        val hoje = LocalDate.now(ZONA)
        val iniMes = hoje.withDayOfMonth(1)
        val fimMes = hoje.withDayOfMonth(hoje.lengthOfMonth())
        val qMes = "start_date=${iso(iniMes)}&end_date=${iso(fimMes)}"
        val me = api.get("/auth/me")
        val nome = me.optString("display_name", me.optString("seller_name", ""))
        return if (me.optString("role") == "seller") {
            val seg = hoje.with(DayOfWeek.MONDAY)
            val dom = seg.plusDays(6)
            val iniSem = if (seg.isBefore(iniMes)) iniMes else seg
            val fimSem = if (dom.isAfter(fimMes)) fimMes else dom
            val qSem = "start_date=${iso(iniSem)}&end_date=${iso(fimSem)}"
            // o mês é o principal (igual a escolher as datas do mês); a semana é extra: se falhar, fica zerada e o mês aparece igual
            val oMes = getOuVazio(api, "/dashboard/overview?$qMes")
            val oSem = opcional(api, "/dashboard/overview?$qSem")
            val cSem = opcional(api, "/dashboard/overview/charts?$qSem")
            val v = vendedor(nome, oMes, oSem, cSem.optJSONArray("daily") ?: JSONArray(), iniSem, fimSem, hoje)
            graficoDe(api, qMes, iniMes, fimMes, hoje)?.let { v.optJSONObject("mes")?.put("diario", it) }
            v.optJSONObject("mes")?.let { m -> anterior(api, iniMes, m.optDouble("dec", 0.0))?.let { m.put("anterior", it) } }
            v
        } else {
            val o = getOuVazio(api, "/dashboard/overview?$qMes")
            val sv = getOuVazio(api, "/dashboard/sellers?$qMes")
            val g = gestor(nome, o, sv, iniMes, fimMes, hoje)
            positivacaoVendedores(api, qMes, g)
            graficoDe(api, qMes, iniMes, fimMes, hoje)?.let { g.put("diario", it) }
            anterior(api, iniMes, g.optDouble("dec", 0.0))?.let { g.put("anterior", it) }
            g
        }
    }

    /** Dias úteis (seg a sex) do período: total, já passados (até hoje) e que faltam (inclui hoje). */
    private fun diasUteis(ini: LocalDate, fim: LocalDate, hoje: LocalDate): Triple<Double, Double, Double> {
        var t = 0; var dec = 0; var rest = 0
        var d = ini
        while (!d.isAfter(fim)) {
            if (d.dayOfWeek.value in 1..5) {
                t++
                if (!d.isAfter(hoje)) dec++
                if (!d.isBefore(hoje)) rest++
            }
            d = d.plusDays(1)
        }
        return Triple(t.toDouble(), dec.toDouble(), rest.toDouble())
    }

    /** Números de um período escolhido na tela (datas no formato AAAA-MM-DD). */
    fun periodo(api: Api, iniTxt: String, fimTxt: String): JSONObject {
        val ini = LocalDate.parse(iniTxt); val fim = LocalDate.parse(fimTxt)
        if (fim.isBefore(ini)) throw IllegalArgumentException("a data final é antes da inicial")
        val hoje = LocalDate.now(ZONA)
        val q = "start_date=${iso(ini)}&end_date=${iso(fim)}"
        val me = api.get("/auth/me")
        val nome = me.optString("display_name", me.optString("seller_name", ""))
        fun dm(d: LocalDate) = "%02d/%02d/%d".format(d.dayOfMonth, d.monthValue, d.year)
        val titulo = "${dm(ini)} a ${dm(fim)}"
        // período sem vendas: o site pode responder "sem dados" (4xx) em vez de zeros — vira painel vazio, não erro
        val o = getOuVazio(api, "/dashboard/overview?$q")
        val graf = graficoDe(api, q, ini, fim, hoje)
        return if (me.optString("role") == "seller") {
            val g = gestor(nome, o, JSONObject(), ini, fim, hoje)
            g.put("titulo", "PERÍODO $titulo")
            if (graf != null) g.put("diario", graf)
            JSONObject().put("tipo", "vendedor").put("nome", nome).put("periodo", titulo).put("mes", g)
                .put("semVendas", n(o, "sales_revenue") <= 0.0)
        } else {
            val sv = getOuVazio(api, "/dashboard/sellers?$q")
            val g = gestor(nome, o, sv, ini, fim, hoje).put("periodo", titulo)
            positivacaoVendedores(api, q, g)
            if (graf != null) g.put("diario", graf)
            g.put("semVendas", n(o, "sales_revenue") <= 0.0 && (g.optJSONArray("vendedores")?.length() ?: 0).let { k ->
                (0 until k).all { n(g.getJSONArray("vendedores").getJSONObject(it), "valor") <= 0.0 } })
        }
    }

    /**
     * A lista de vendedores do site não traz a positivação; ela vem do overview filtrado por vendedor
     * (o mesmo que o site faz ao escolher um vendedor no filtro). Busca 4 de cada vez; se falhar, fica o que tinha.
     */
    private fun positivacaoVendedores(api: Api, q: String, g: JSONObject) {
        val vs = g.optJSONArray("vendedores") ?: return
        val itens = (0 until minOf(vs.length(), 60)).map { vs.getJSONObject(it) }.filter { it.optString("chave").isNotEmpty() }
        if (itens.isEmpty()) return
        val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val fut = itens.map { v ->
                pool.submit(java.util.concurrent.Callable {
                    try { api.get("/dashboard/overview?$q&seller=" + java.net.URLEncoder.encode(v.optString("chave"), "UTF-8").replace("+", "%20")) } catch (_: Exception) { null }
                })
            }
            for ((v, f) in itens.zip(fut)) {
                val o = try { f.get(30, java.util.concurrent.TimeUnit.SECONDS) } catch (_: Exception) { null } ?: continue
                if (o.has("positive_customer_count")) v.put("pos", n(o, "positive_customer_count"))
                if (o.has("positive_customer_target")) v.put("metaPos", n(o, "positive_customer_target"))
            }
        } finally { pool.shutdownNow() }
    }

    /** Busca que não pode derrubar a tela: qualquer falha (menos login/acesso) vira objeto vazio. */
    private fun opcional(api: Api, caminho: String): JSONObject = try { api.get(caminho) } catch (e: Exception) {
        if (e is br.com.cbfreedom.comum.SemAcesso || e is br.com.cbfreedom.comum.ErroLogin) throw e
        JSONObject()
    }

    /** Busca no site; "sem dados" (HTTP 204/400/404/422) vira objeto vazio. Login/acesso continuam dando erro. */
    private fun getOuVazio(api: Api, caminho: String): JSONObject = try { api.get(caminho) } catch (e: java.io.IOException) {
        if (e is br.com.cbfreedom.comum.SemAcesso || e is br.com.cbfreedom.comum.ErroLogin) throw e
        if (Regex("HTTP (204|400|404|422)").containsMatchIn(e.message ?: "")) JSONObject() else throw e
    }

    /**
     * Mês passado até o mesmo dia útil (ex.: hoje é o 15º dia útil -> mês passado até o 15º dia útil).
     * valor = vendido nesse trecho; ate = dd/mm. Se falhar, o painel continua sem a comparação.
     */
    private fun anterior(api: Api, iniMes: LocalDate, dec: Double): JSONObject? = try {
        if (dec <= 0) null else {
            val pIni = iniMes.minusMonths(1).withDayOfMonth(1)
            val pUlt = pIni.withDayOfMonth(pIni.lengthOfMonth())
            var fim = pUlt; var cont = 0; var d = pIni
            while (!d.isAfter(pUlt)) {
                if (d.dayOfWeek.value in 1..5) { cont++; if (cont >= dec) { fim = d; break } }
                d = d.plusDays(1)
            }
            val o = api.get("/dashboard/overview?start_date=${iso(pIni)}&end_date=${iso(fim)}")
            JSONObject().put("valor", n(o, "sales_revenue")).put("ate", "%02d/%02d".format(fim.dayOfMonth, fim.monthValue))
        }
    } catch (_: Exception) { null }

    /** Busca o gráfico do site; se falhar, o painel continua sem ele. */
    private fun graficoDe(api: Api, q: String, ini: LocalDate, fim: LocalDate, hoje: LocalDate): JSONArray? =
        try { diario(api.get("/dashboard/overview/charts?$q").optJSONArray("daily"), ini, fim, hoje) } catch (_: Exception) { null }

    /**
     * Evolução dia a dia para o gráfico: d = data, v = vendido no dia, a = vendido acumulado (só até hoje),
     * i = ideal acumulado. Aceita os nomes de campo mais comuns; sem dados de venda devolve null.
     */
    fun diario(lista: JSONArray?, ini: LocalDate, fim: LocalDate, hoje: LocalDate): JSONArray? {
        if (lista == null || lista.length() == 0) return null
        val itens = (0 until lista.length()).mapNotNull { lista.optJSONObject(it) }
        fun campo(vararg nomes: String) = nomes.firstOrNull { k -> itens.any { it.has(k) && !it.isNull(k) } }
        val kDia = campo("revenue", "sales_revenue", "daily_revenue", "total_revenue", "value")
        val kAcum = campo("cumulative_revenue", "revenue_cumulative", "accumulated_revenue", "cumulative_sales_revenue", "sales_revenue_cumulative")
        if (kDia == null && kAcum == null) return null
        val porDia = HashMap<String, JSONObject>()
        for (x in itens) porDia[x.optString("sale_date", x.optString("date")).take(10)] = x
        val r = JSONArray()
        var acum = 0.0; var ideal = 0.0; var antAcum = 0.0
        var d = ini
        while (!d.isAfter(fim)) {
            val x = porDia[iso(d)]
            var v = if (kDia != null) n(x, kDia) else 0.0
            acum = if (kAcum != null && x != null && x.has(kAcum) && !x.isNull(kAcum)) n(x, kAcum) else acum + v
            if (kDia == null) v = maxOf(0.0, acum - antAcum)
            antAcum = acum
            if (x != null && x.has("ideal_cumulative_revenue")) ideal = n(x, "ideal_cumulative_revenue")
            val o = JSONObject().put("d", iso(d)).put("v", v).put("i", ideal)
            if (!d.isAfter(hoje)) o.put("a", acum)
            r.put(o)
            d = d.plusDays(1)
        }
        return r
    }

    private fun primeiro(o: JSONObject, vararg k: String): Double = k.firstOrNull { o.has(it) && !o.isNull(it) }?.let { n(o, it) } ?: 0.0

    fun gestor(nome: String, o: JSONObject, sv: JSONObject, ini: LocalDate, fim: LocalDate, hoje: LocalDate): JSONObject {
        val fat = n(o, "sales_revenue")
        var t = n(o, "business_days_total"); var dec = n(o, "business_days_elapsed"); var rest = n(o, "business_days_remaining")
        if (t <= 0) { val du = diasUteis(ini, fim, hoje); t = du.first; dec = du.second; rest = du.third }
        val idealP = if (t > 0) minOf(1.0, dec / t) else 0.0
        // "sellers" traz todos os vendedores; "ranking" só os primeiros
        val todos = sv.optJSONArray("sellers")?.takeIf { it.length() > 0 } ?: sv.optJSONArray("ranking") ?: JSONArray()
        val lista = (0 until todos.length()).map { todos.getJSONObject(it) }.sortedByDescending { n(it, "revenue") }
        // meta: a do site; se o site não mandar para este login, soma das metas dos vendedores
        var meta = listOf("revenue_target", "target_revenue", "revenue_goal", "meta_revenue").map { n(o, it) }.firstOrNull { it > 0 } ?: 0.0
        var metaSoma = false
        if (meta <= 0) { meta = lista.sumOf { n(it, "meta_revenue") }; metaSoma = meta > 0 }
        val falta = maxOf(0.0, meta - fat)
        val vend = JSONArray()
        for (x in lista) {
            val vf = n(x, "revenue"); val vm = n(x, "meta_revenue")
            vend.put(JSONObject()
                .put("nome", x.optString("seller_name").replace("SUPERVISOR - ", "SUP. "))
                .put("chave", x.optString("seller_name"))
                .put("valor", vf).put("meta", vm)
                .put("p", if (vm > 0) vf / vm else 0.0)
                .put("ideal", vm * idealP)
                .put("falta", maxOf(0.0, vm - vf))
                .put("pedidos", n(x, "order_count"))
                .put("clientes", n(x, "client_count"))
                // positivação do vendedor (o site pode mandar com nomes diferentes; sem meta, mostra só quantos)
                .put("pos", primeiro(x, "positive_customer_count", "positive_customers", "positivation", "positivacao", "client_count"))
                .put("metaPos", primeiro(x, "positive_customer_target", "positivation_target", "meta_positivation", "meta_positivacao", "client_target")))
        }
        return JSONObject()
            .put("tipo", "gestor").put("nome", nome)
            .put("valor", fat).put("meta", meta)
            .put("p", if (meta > 0) fat / meta else 0.0)
            .put("idealP", idealP).put("ideal", meta * idealP)
            .put("falta", falta).put("porDia", if (rest > 0) falta / rest else 0.0)
            .put("pos", n(o, "positive_customer_count")).put("metaPos", n(o, "positive_customer_target"))
            .put("pedidos", n(o, "order_count")).put("ticket", n(o, "average_order_value"))
            .put("projecao", n(o, "projected_revenue"))
            .put("dec", dec).put("T", t).put("rest", rest)
            .put("metaSoma", metaSoma)
            .put("vendedores", vend)
    }

    /** Meta da semana ACUMULATIVA: o que faltou nas semanas anteriores entra na semana atual. */
    fun vendedor(nome: String, m: JSONObject, s: JSONObject, diario: JSONArray,
                 ini: LocalDate, fim: LocalDate, hoje: LocalDate): JSONObject {
        // dia útil = dia em que o "ideal acumulado" do site sobe (feriados não contam)
        val util = HashMap<String, Boolean>()
        var ant = 0.0
        for (i in 0 until diario.length()) {
            val d = diario.getJSONObject(i)
            val k = d.optString("sale_date").take(10)
            val v = n(d, "ideal_cumulative_revenue")
            util[k] = v > ant + 0.001; ant = v
        }
        fun ehUtil(d: LocalDate) = util[iso(d)] ?: (d.dayOfWeek.value in 1..5)
        val dias = generateSequence(ini) { it.plusDays(1) }.takeWhile { !it.isAfter(fim) }.toList()
        val uteis = dias.filter { ehUtil(it) }
        val passados = uteis.filter { !it.isAfter(hoje) }
        val t = n(m, "business_days_total"); val dec = n(m, "business_days_elapsed"); val rest = n(m, "business_days_remaining")
        val fatS = n(s, "sales_revenue"); val fatM = n(m, "sales_revenue"); val metaM = n(m, "revenue_target")
        val vendidoAntes = maxOf(0.0, fatM - fatS)
        val duAntes = maxOf(0.0, dec - passados.size)
        val metaSem = if (t > 0) maxOf(0.0, metaM * minOf(t, duAntes + uteis.size) / t - vendidoAntes) else 0.0
        val metaDia = if (uteis.isNotEmpty()) metaSem / uteis.size else 0.0
        val idealS = metaDia * passados.size
        val faltaS = maxOf(0.0, metaSem - fatS)
        val restam = maxOf(uteis.count { it.isAfter(hoje) }, if (uteis.contains(hoje)) 1 else 0)
        val fixa = if (t > 0) metaM / t * uteis.size else 0.0
        val idM = if (t > 0) dec / t else 0.0
        val faltaM = maxOf(0.0, metaM - fatM)
        fun dm(d: LocalDate) = "%02d/%02d".format(d.dayOfMonth, d.monthValue)
        val semana = JSONObject()
            .put("titulo", "SEMANA ${dm(ini)}–${dm(fim)}")
            .put("valor", fatS).put("meta", metaSem)
            .put("p", if (metaSem > 0) fatS / metaSem else 0.0)
            .put("idealP", if (metaSem > 0) idealS / metaSem else 0.0).put("ideal", idealS)
            .put("falta", faltaS).put("porDia", if (restam > 0) faltaS / restam else 0.0).put("restam", restam)
            .put("pos", n(s, "positive_customer_count")).put("metaPos", n(s, "positive_customer_target"))
            .put("acumulado", metaSem - fixa)
        val mes = JSONObject()
            .put("titulo", "MÊS")
            .put("valor", fatM).put("meta", metaM)
            .put("p", if (metaM > 0) fatM / metaM else 0.0)
            .put("idealP", idM).put("ideal", metaM * idM)
            .put("falta", faltaM).put("porDia", if (rest > 0) faltaM / rest else 0.0)
            .put("pos", n(m, "positive_customer_count")).put("metaPos", n(m, "positive_customer_target"))
            .put("dec", dec).put("T", t).put("rest", rest)
        return JSONObject().put("tipo", "vendedor").put("nome", nome).put("semana", semana).put("mes", mes)
    }
}
