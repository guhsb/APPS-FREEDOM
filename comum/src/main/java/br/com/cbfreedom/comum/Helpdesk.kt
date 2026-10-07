package br.com.cbfreedom.comum

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Avisos do Helpdesk: consulta o site com o login guardado no app, descobre o que mudou nos chamados
 * (Engine) e mostra notificações. Também guarda o histórico mostrado na aba Helpdesk.
 */
object Helpdesk {

    const val SITE = "https://relatorios.cbfreedom.com.br"
    const val EXTRA_CAMINHO = "caminho"

    const val CANAL_AVISOS = "helpdesk_avisos"
    const val CANAL_MONITOR = "helpdesk_monitor"
    const val CANAL_SISTEMA = "helpdesk_sistema"

    const val NOTIF_MONITOR = 41
    const val NOTIF_LOGIN = 42
    const val NOTIF_GRUPO = 43
    const val NOTIF_INFO = 44
    private const val NOTIF_CHAMADO = 50_000
    private const val GRUPO = "helpdesk"

    val INTERVALOS = intArrayOf(1, 2, 5, 10, 15, 30)
    private const val MAX_FEED = 60

    /** A tela (aba Helpdesk) se registra aqui para ser avisada quando algo muda. */
    @Volatile var ouvinte: (() -> Unit)? = null
    @Volatile var verificando = false
    private val trava = Any()

    fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("helpdesk", Context.MODE_PRIVATE)

    // ---------------- configurações ----------------

    /** Avisos ligados: o login tem o módulo Helpdesk e a pessoa não desligou. */
    fun ativo(c: Context): Boolean = Acesso.helpdesk(c) && prefs(c).getBoolean("ativo", true)
    fun tempoReal(c: Context): Boolean = prefs(c).getBoolean("tempo_real", true)
    fun intervalo(c: Context): Int = prefs(c).getInt("intervalo", 2).coerceAtLeast(1)
    fun minhasAcoes(c: Context): Boolean = prefs(c).getBoolean("minhas_acoes", false)

    fun configurar(c: Context, cfg: JSONObject) {
        val ed = prefs(c).edit()
        if (cfg.has("ativo")) ed.putBoolean("ativo", cfg.optBoolean("ativo"))
        if (cfg.has("tempoReal")) ed.putBoolean("tempo_real", cfg.optBoolean("tempoReal"))
        if (cfg.has("minhasAcoes")) ed.putBoolean("minhas_acoes", cfg.optBoolean("minhasAcoes"))
        if (cfg.has("intervalo")) ed.putInt("intervalo", cfg.optInt("intervalo", 2).coerceIn(1, 60))
        ed.commit()
        aplicar(c)
    }

    fun bateriaLivre(c: Context): Boolean =
        (c.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(c.packageName)

    fun notificacoesPermitidas(c: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return nm(c).areNotificationsEnabled()
    }

    // ---------------- agendamento ----------------

    /** Liga ou desliga tudo o que verifica o Helpdesk em segundo plano, conforme as configurações. */
    fun aplicar(c: Context) {
        val app = c.applicationContext
        if (!ativo(app) || !Store.logado(app)) {
            cancelarAlarme(app)
            app.stopService(Intent(app, HelpdeskServico::class.java))
            nm(app).cancel(NOTIF_MONITOR)
            return
        }
        Tarefa.agendar(app)          // reserva: a cada 15 min (o mesmo job que atualiza o widget)
        agendarAlarme(app)           // acorda o celular mesmo em modo soneca
        if (tempoReal(app)) iniciarServico(app)
        else app.stopService(Intent(app, HelpdeskServico::class.java))
    }

    fun iniciarServico(c: Context) {
        try {
            c.startForegroundService(Intent(c, HelpdeskServico::class.java))
        } catch (_: Exception) {
            // o Android não deixa iniciar agora (app em segundo plano): o job e o alarme continuam verificando
        }
    }

    private fun intentAlarme(c: Context): PendingIntent = PendingIntent.getBroadcast(
        c, 7, Intent(c, HelpdeskAlarme::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    fun agendarAlarme(c: Context) {
        if (!ativo(c) || !Store.logado(c)) return
        val am = c.getSystemService(AlarmManager::class.java) ?: return
        try {
            am.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + intervalo(c) * 60_000L, intentAlarme(c)
            )
        } catch (_: Exception) { }
    }

    fun cancelarAlarme(c: Context) {
        c.getSystemService(AlarmManager::class.java)?.cancel(intentAlarme(c))
    }

    fun sair(c: Context) {
        prefs(c).edit().clear().commit()
        aplicar(c)
        val n = nm(c)
        n.cancel(NOTIF_LOGIN); n.cancel(NOTIF_INFO); n.cancel(NOTIF_GRUPO)
    }

    // ---------------- verificação ----------------

    private fun fetcher(api: Api) = Engine.Fetcher { caminho ->
        val r = api.bruto(caminho)
        Engine.Resp(r.first, r.second)
    }

    /**
     * Consulta o Helpdesk e notifica o que mudou. manual = true ignora o intervalo mínimo.
     * Devolve null quando não verificou (desligado, sem login ou verificado há pouco).
     */
    fun verificar(c0: Context, manual: Boolean): Engine.Outcome? {
        if (!manual && verificando) return null      // já tem uma verificação em andamento
        return synchronized(trava) { verificarAgora(c0.applicationContext, manual) }
    }

    private fun verificarAgora(c: Context, manual: Boolean): Engine.Outcome? {
        val p = prefs(c)
        val agora = System.currentTimeMillis()
        if (!manual) {
            if (!ativo(c)) return null
            val folga = maxOf(30_000L, intervalo(c) * 60_000L / 2)
            if (agora - p.getLong("ultima", 0L) < folga) return null
        }
        if (!Acesso.helpdesk(c)) {
            p.edit().putString("status", "Este login não tem acesso ao Helpdesk").apply()
            return null
        }
        val login = Store.login(c) ?: return null
        verificando = true
        avisarTela()
        val wl = (c.getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "freedom:helpdesk")
        wl.setReferenceCounted(false)
        wl.acquire(90_000L)
        val ed = p.edit().putLong("ultima", agora)
        return try {
            var api = Api(login.first, login.second, p.getString("cookie", "") ?: "")
            var logou = false
            if (api.cookie.isEmpty()) { api.entrar(); logou = true; Acesso.atualizar(c, api) }
            var o = Engine.run(fetcher(api), p.getString("estado", null), minhasAcoes(c), agora + 40_000L)
            if ((o.sessionExpired || !o.ok) && !logou) {
                // sessão venceu (ou o site recusou a sessão guardada): entra de novo com o login e tenta outra vez
                api = Api(login.first, login.second)
                api.entrar(); logou = true
                Acesso.atualizar(c, api)
                o = Engine.run(fetcher(api), p.getString("estado", null), minhasAcoes(c), System.currentTimeMillis() + 40_000L)
            }
            if (logou) ed.putString("cookie", api.cookie)
            val avisar = ativo(c)
            when {
                o.sessionExpired -> ed.putString("status", "Este login não tem acesso ao Helpdesk")
                !o.ok -> ed.putString("status", "Não verificou: " + (o.error ?: "erro"))
                else -> {
                    ed.putString("estado", o.newState).putString("status", "ok").putInt("monitorados", o.monitored)
                        .putBoolean("login_avisado", false)
                    nm(c).cancel(NOTIF_LOGIN)
                    if (o.notes.isNotEmpty()) {
                        guardarFeed(p, ed, o.notes, agora)
                        if (avisar) notificar(c, o.notes)
                    }
                    if (o.firstRun && avisar) info(
                        c, "Avisos do Helpdesk ativados",
                        "Você vai ser avisado de novos chamados, respostas e mudanças de status, prioridade e responsável."
                    )
                }
            }
            o
        } catch (e: ErroLogin) {
            ed.putString("status", "O site recusou o login guardado. Saia e entre de novo no app.")
            if (!p.getBoolean("login_avisado", false)) {
                ed.putBoolean("login_avisado", true)
                aviso(c, NOTIF_LOGIN, "Login do Freedom recusado", "A senha mudou? Abra o app, saia e entre de novo para voltar a receber os avisos.")
            }
            null
        } catch (e: Exception) {
            ed.putString("status", "Não verificou: " + Api.mensagem(e))
            null
        } finally {
            // se a pessoa saiu (ou trocou de login) durante a verificação, descarta o resultado
            if (Store.logado(c) && Store.email(c) == login.first) {
                ed.commit()
                if (p.getString("status", "") == "ok") PainelHelpdesk.doMonitor(c)   // widget do Helpdesk
            }
            if (wl.isHeld) wl.release()
            verificando = false
            avisarTela()
            atualizarMonitor(c)
        }
    }

    fun emSegundoPlano(c: Context, manual: Boolean, depois: ((Engine.Outcome?) -> Unit)? = null) {
        val app = c.applicationContext
        Thread {
            val o = try { verificar(app, manual) } catch (_: Exception) { null }
            depois?.invoke(o)
        }.start()
    }

    fun avisarTela() {
        try { ouvinte?.invoke() } catch (_: Exception) { }
    }

    private fun guardarFeed(p: SharedPreferences, ed: SharedPreferences.Editor, notas: List<Engine.Note>, agora: Long) {
        val antigo = try { JSONArray(p.getString("feed", "[]")) } catch (_: Exception) { JSONArray() }
        val novo = JSONArray()
        for (n in notas) {
            val linhas = JSONArray()
            for (l in n.lines) linhas.put(l)
            novo.put(JSONObject().put("t", agora).put("id", n.ticketId).put("titulo", n.title)
                .put("texto", n.text).put("linhas", linhas).put("caminho", n.path).put("novo", n.isNew))
        }
        for (i in 0 until antigo.length()) {
            if (novo.length() >= MAX_FEED) break
            novo.put(antigo.get(i))
        }
        ed.putString("feed", novo.toString())
    }

    /** Tudo o que a aba Helpdesk mostra. */
    fun resumoTela(c: Context): JSONObject {
        val p = prefs(c)
        val o = JSONObject()
            .put("email", Store.email(c) ?: "")
            .put("ativo", ativo(c)).put("tempoReal", tempoReal(c)).put("intervalo", intervalo(c))
            .put("minhasAcoes", minhasAcoes(c)).put("verificando", verificando)
            .put("ultima", p.getLong("ultima", 0L)).put("status", p.getString("status", "") ?: "")
            .put("monitorados", p.getInt("monitorados", 0))
            .put("notifOk", notificacoesPermitidas(c)).put("bateriaOk", bateriaLivre(c))
            .put("visto", p.getLong("visto", 0L))
        o.put("feed", try { JSONArray(p.getString("feed", "[]")) } catch (_: Exception) { JSONArray() })
        val estado = try { JSONObject(p.getString("estado", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        estado.optJSONObject("summary")?.let { o.put("resumo", it) }
        val abertos = ArrayList<JSONObject>()
        estado.optJSONObject("tickets")?.let { ts ->
            val it = ts.keys()
            while (it.hasNext()) {
                val id = it.next()
                val t = ts.optJSONObject(id) ?: continue
                if (Engine.isActive(t.optString("status"))) abertos.add(JSONObject(t.toString()).put("id", id))
            }
        }
        abertos.sortByDescending { it.optString("updated") }
        val arr = JSONArray()
        for (t in abertos.take(40)) arr.put(t)
        o.put("abertos", arr)
        return o
    }

    fun marcarVisto(c: Context) {
        prefs(c).edit().putLong("visto", System.currentTimeMillis()).apply()
    }

    fun naoVistos(c: Context): Int {
        val p = prefs(c)
        val visto = p.getLong("visto", 0L)
        val feed = try { JSONArray(p.getString("feed", "[]")) } catch (_: Exception) { return 0 }
        var n = 0
        for (i in 0 until feed.length()) if ((feed.optJSONObject(i)?.optLong("t", 0L) ?: 0L) > visto) n++
        return n
    }

    // ---------------- notificações ----------------

    fun nm(c: Context): NotificationManager = c.getSystemService(NotificationManager::class.java)

    fun criarCanais(c: Context) {
        val n = nm(c)
        val avisos = NotificationChannel(CANAL_AVISOS, "Chamados do Helpdesk", NotificationManager.IMPORTANCE_HIGH)
        avisos.description = "Novos chamados, respostas e mudanças de status, prioridade e responsável"
        avisos.enableVibration(true)
        avisos.enableLights(true)
        avisos.lightColor = Cor.ROSA
        n.createNotificationChannel(avisos)
        val sis = NotificationChannel(CANAL_SISTEMA, "Avisos do app", NotificationManager.IMPORTANCE_DEFAULT)
        sis.description = "Login, downloads e avisos gerais"
        n.createNotificationChannel(sis)
        val mon = NotificationChannel(CANAL_MONITOR, "Monitoramento em segundo plano", NotificationManager.IMPORTANCE_LOW)
        mon.description = "Aviso fixo enquanto o modo tempo real está ligado"
        mon.setShowBadge(false)
        n.createNotificationChannel(mon)
    }

    fun abrirApp(c: Context, caminho: String?, codigo: Int): PendingIntent {
        val i = Intent(c, Tela::class.java).setAction("abrir.$codigo")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (caminho != null) i.putExtra(EXTRA_CAMINHO, caminho)
        return PendingIntent.getActivity(c, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun notificar(c: Context, notas: List<Engine.Note>) {
        criarCanais(c)
        val n = nm(c)
        val agora = System.currentTimeMillis()
        for (x in notas) {
            val id = NOTIF_CHAMADO + x.ticketId
            val b = Notification.Builder(c, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_notificacao)
                .setColor(Cor.ROSA)
                .setContentTitle(x.title)
                .setContentText(x.text)
                .setStyle(Notification.BigTextStyle().bigText(x.lines.joinToString("\n")))
                .setContentIntent(abrirApp(c, x.path, id))
                .setAutoCancel(true)
                .setWhen(agora).setShowWhen(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setGroup(GRUPO)
            try { n.notify(id, b.build()) } catch (_: Exception) { }
        }
        val s = Notification.Builder(c, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle("Helpdesk")
            .setContentText("Novidades nos chamados")
            .setContentIntent(abrirApp(c, null, NOTIF_GRUPO))
            .setGroup(GRUPO).setGroupSummary(true).setAutoCancel(true)
        try { n.notify(NOTIF_GRUPO, s.build()) } catch (_: Exception) { }
    }

    private fun aviso(c: Context, id: Int, titulo: String, texto: String) {
        criarCanais(c)
        val b = Notification.Builder(c, CANAL_SISTEMA)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle(titulo).setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setContentIntent(abrirApp(c, null, id))
            .setAutoCancel(true)
        try { nm(c).notify(id, b.build()) } catch (_: Exception) { }
    }

    private fun info(c: Context, titulo: String, texto: String) = aviso(c, NOTIF_INFO, titulo, texto)

    fun textoMonitor(c: Context): String {
        val p = prefs(c)
        val ultima = p.getLong("ultima", 0L)
        var s = "A cada " + intervalo(c) + " min"
        if (ultima > 0) s += " · última às " + Fmt.hhmm(ultima)
        val st = p.getString("status", "") ?: ""
        if (st.isNotEmpty() && st != "ok") s += " · " + st
        return s
    }

    fun notifMonitor(c: Context): Notification {
        criarCanais(c)
        return Notification.Builder(c, CANAL_MONITOR)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle("Monitorando o Helpdesk")
            .setContentText(textoMonitor(c))
            .setContentIntent(abrirApp(c, null, NOTIF_MONITOR))
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun atualizarMonitor(c: Context) {
        if (!ativo(c) || !tempoReal(c) || !Store.logado(c)) return
        try {
            if (nm(c).activeNotifications.any { it.id == NOTIF_MONITOR }) nm(c).notify(NOTIF_MONITOR, notifMonitor(c))
        } catch (_: Exception) { }
    }
}
