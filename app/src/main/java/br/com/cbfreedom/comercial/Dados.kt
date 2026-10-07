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
            val oMes = api.get("/dashboard/overview?$qMes")
            val oSem = api.get("/dashboard/overview?$qSem")
            val cSem = api.get("/dashboard/overview/charts?$qSem")
            vendedor(nome, oMes, oSem, cSem.optJSONArray("daily") ?: JSONArray(), iniSem, fimSem, hoje)
        } else {
            val o = api.get("/dashboard/overview?$qMes")
            val sv = api.get("/dashboard/sellers?$qMes")
            gestor(nome, o, sv)
        }
    }

    fun gestor(nome: String, o: JSONObject, sv: JSONObject): JSONObject {
        val fat = n(o, "sales_revenue"); val meta = n(o, "revenue_target")
        val t = n(o, "business_days_total"); val dec = n(o, "business_days_elapsed"); val rest = n(o, "business_days_remaining")
        val idealP = if (t > 0) dec / t else 0.0
        val falta = maxOf(0.0, meta - fat)
        // "sellers" traz todos os vendedores; "ranking" só os primeiros
        val todos = sv.optJSONArray("sellers")?.takeIf { it.length() > 0 } ?: sv.optJSONArray("ranking") ?: JSONArray()
        val lista = (0 until todos.length()).map { todos.getJSONObject(it) }.sortedByDescending { n(it, "revenue") }
        val vend = JSONArray()
        for (x in lista) {
            val vf = n(x, "revenue"); val vm = n(x, "meta_revenue")
            vend.put(JSONObject()
                .put("nome", x.optString("seller_name").replace("SUPERVISOR - ", "SUP. "))
                .put("valor", vf).put("meta", vm)
                .put("p", if (vm > 0) vf / vm else 0.0)
                .put("ideal", vm * idealP)
                .put("falta", maxOf(0.0, vm - vf))
                .put("pedidos", n(x, "order_count"))
                .put("clientes", n(x, "client_count")))
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
