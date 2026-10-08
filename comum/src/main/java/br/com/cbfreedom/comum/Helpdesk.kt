package br.com.cbfreedom.comum

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
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

    // canal novo (com som e vibração definidos); o antigo "helpdesk_avisos" é apagado
    const val CANAL_AVISOS = "helpdesk_chamados"
    private const val CANAL_ANTIGO = "helpdesk_avisos"
    const val CANAL_MONITOR = "helpdesk_monitor"
    const val CANAL_SISTEMA = "helpdesk_sistema"

    const val NOTIF_MONITOR = 41
    const val NOTIF_LOGIN = 42
    const val NOTIF_GRUPO = 43
    const val NOTIF_INFO = 44
    private const val NOTIF_CHAMADO = 50_000
    fun idNotificacao(ticketId: Int): Int = NOTIF_CHAMADO + ticketId
    private const val GRUPO = "helpdesk"

    /** Opções de "verificar a cada", em segundos. Abaixo de 1 min = sondagem rápida (só com a tela ligada). */
    val INTERVALOS = intArrayOf(15, 30, 60, 120, 300, 600, 900, 1800)
    private val SONDAS = listOf(
        "/helpdesk/notifications/summary",
        "/helpdesk/workspace/tickets?view=queues&page=1&page_size=5",
        "/helpdesk/workspace/tickets?view=assigned&page=1&page_size=5",
        "/helpdesk/tickets?view=requester&page=1&page_size=5"
    )
    private const val MAX_FEED = 60
    // sondagem do histórico: os 3 chamados mais importantes (meus primeiro) + 2 por rodízio a cada vez
    private const val SONDA_TOPO = 3
    private const val SONDA_RODIZIO = 2

    /** A tela (aba Helpdesk) se registra aqui para ser avisada quando algo muda. */
    @Volatile var ouvinte: (() -> Unit)? = null
    @Volatile var verificando = false
    private val trava = Any()
    private val sondando = java.util.concurrent.atomic.AtomicBoolean(false)
    /** Chamados em que a sondagem viu resposta nova: a verificação completa lê o histórico deles. */
    private val forcar: MutableSet<Int> = java.util.Collections.synchronizedSet(HashSet<Int>())

    fun prefs(c: Context): SharedPreferences = c.getSharedPreferences("helpdesk", Context.MODE_PRIVATE)

    // ---------------- configurações ----------------

    /** Avisos ligados: o login tem o módulo Helpdesk e a pessoa não desligou. */
    fun ativo(c: Context): Boolean = Acesso.helpdesk(c) && prefs(c).getBoolean("ativo", true)
    fun tempoReal(c: Context): Boolean = prefs(c).getBoolean("tempo_real", true)
    /** Intervalo escolhido, em segundos (padrão 15 s = quase na hora). */
    fun intervaloSeg(c: Context): Int = prefs(c).getInt("intervalo_s", 15).coerceIn(15, 3600)

    /** De quanto em quanto tempo faz a verificação completa (a sondagem rápida cobre o meio-tempo). */
    fun intervaloCompletoMs(c: Context): Long = intervaloSeg(c).let { if (it < 60) 120_000L else it * 1000L }

    /** Com a tela desligada o celular dorme: o alarme acorda no máximo a cada 1 min. */
    private fun intervaloAlarmeMs(c: Context): Long = maxOf(60_000L, intervaloSeg(c) * 1000L)

    fun textoIntervalo(s: Int): String = if (s < 60) "$s s" else (s / 60).toString() + " min"
    fun minhasAcoes(c: Context): Boolean = prefs(c).getBoolean("minhas_acoes", false)

    fun configurar(c: Context, cfg: JSONObject) {
        val ed = prefs(c).edit()
        if (cfg.has("ativo")) ed.putBoolean("ativo", cfg.optBoolean("ativo"))
        if (cfg.has("tempoReal")) ed.putBoolean("tempo_real", cfg.optBoolean("tempoReal"))
        if (cfg.has("minhasAcoes")) ed.putBoolean("minhas_acoes", cfg.optBoolean("minhasAcoes"))
        if (cfg.has("intervalo")) ed.putInt("intervalo_s", cfg.optInt("intervalo", 15).coerceIn(15, 3600))
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
        val quando = SystemClock.elapsedRealtime() + intervaloAlarmeMs(c)
        try {
            // modo tempo real: alarme exato (acorda na hora mesmo com a tela desligada)
            val exato = tempoReal(c) && (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms())
            if (exato) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, quando, intentAlarme(c))
            else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, quando, intentAlarme(c))
        } catch (_: Exception) {
            try { am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, quando, intentAlarme(c)) } catch (_: Exception) { }
        }
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
            val folga = maxOf(30_000L, intervaloCompletoMs(c) / 2)
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
        val forca: Set<Int> = synchronized(forcar) { HashSet(forcar) }
        return try {
            var api = Api(login.first, login.second, p.getString("cookie", "") ?: "")
            var logou = false
            if (api.cookie.isEmpty()) { api.entrar(); logou = true; Acesso.atualizar(c, api) }
            var o = Engine.run(fetcher(api), p.getString("estado", null), minhasAcoes(c), agora + 40_000L, forca)
            if ((o.sessionExpired || !o.ok) && !logou) {
                // sessão venceu (ou o site recusou a sessão guardada): entra de novo com o login e tenta outra vez
                api = Api(login.first, login.second)
                api.entrar(); logou = true
                Acesso.atualizar(c, api)
                o = Engine.run(fetcher(api), p.getString("estado", null), minhasAcoes(c), System.currentTimeMillis() + 40_000L, forca)
            }
            if (logou) ed.putString("cookie", api.cookie)
            val avisar = ativo(c)
            when {
                o.sessionExpired -> { ed.putString("status", "Este login não tem acesso ao Helpdesk"); diag(c, "Sem acesso ao Helpdesk (sessão recusada)") }
                !o.ok -> { ed.putString("status", "Não verificou: " + (o.error ?: "erro")); diag(c, "Erro: " + (o.error ?: "erro")) }
                else -> {
                    ed.putString("estado", o.newState).putString("status", "ok").putInt("monitorados", o.monitored)
                        .putBoolean("login_avisado", false)
                        .remove("sonda")      // a próxima sondagem rápida parte do estado atual
                    nm(c).cancel(NOTIF_LOGIN)
                    forcar.removeAll(forca)
                    val avisos = o.notes.filter { !it.silent }
                    if (o.notes.isNotEmpty()) {
                        guardarFeed(p, ed, o.notes, agora)
                        // ações minhas (silent) ficam só no histórico do app
                        if (avisar && avisos.isNotEmpty()) notificar(c, avisos, o.newState)
                    }
                    val minhas = o.notes.size - avisos.size
                    val porQue = when {
                        avisos.isEmpty() -> ""
                        !avisar -> " · NÃO avisou: avisos desligados"
                        !notificacoesPermitidas(c) -> " · NÃO avisou: notificações bloqueadas no Android"
                        else -> " · avisou no celular"
                    }
                    if (o.firstRun) diag(c, "Primeira verificação: linha de base de ${o.monitored} chamados")
                    else if (o.notes.isNotEmpty() || forca.isNotEmpty() || manual)
                        diag(c, "Verificação: ${o.monitored} chamados, ${avisos.size} novidade(s)" +
                            (if (minhas > 0) " + $minhas sua(s)" else "") + porQue +
                            (if (forca.isNotEmpty()) " · conferiu " + forca.joinToString(", ") { "#$it" } else "") +
                            avisos.take(3).joinToString("") { "\n  " + it.title + ": " + it.text })
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
            diag(c, "Erro: " + Api.mensagem(e))
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

    // ---------------- sondagem rápida ----------------

    /**
     * Consulta leve para perceber mudanças em segundos sem baixar tudo:
     *  - resumo + 5 chamados mais recentes de cada lista (novo chamado, status, prioridade, responsável);
     *  - histórico de alguns chamados ativos (os meus primeiro + rodízio), porque uma resposta nova
     *    nem sempre muda os dados do chamado na lista.
     * true = algo mudou (ou não deu para saber), false = nada mudou.
     */
    fun sondar(c: Context): Boolean {
        val p = prefs(c)
        val login = Store.login(c) ?: return false
        val cookie = p.getString("cookie", "") ?: ""
        if (cookie.isEmpty()) return true
        val api = Api(login.first, login.second, cookie)
        val sb = StringBuilder()
        for (caminho in SONDAS) {
            val r = try { api.bruto(caminho) } catch (_: Exception) { return false }   // sem internet: tenta depois
            if (r.first == 401) return true                                              // sessão venceu: verificação completa
            if (r.first != 200) continue
            try {
                val o = JSONObject(r.second)
                val itens = o.optJSONArray("items")
                if (itens == null) { sb.append(o.toString()).append('|'); continue }
                for (i in 0 until itens.length()) {
                    val t = itens.optJSONObject(i) ?: continue
                    // só o que muda quando o chamado muda (o SLA restante muda sozinho a cada minuto)
                    sb.append(t.optString("id")).append(':').append(t.optString("status")).append(':')
                        .append(t.optString("version")).append(':').append(t.optString("updated_at")).append(':')
                        .append(t.optString("priority")).append(':').append(t.optString("assignee_user_id")).append(';')
                }
                sb.append('|')
            } catch (_: Exception) { }
        }
        val marca = sb.toString().hashCode().toString() + ":" + sb.length
        val antes = p.getString("sonda", null)
        p.edit().putString("sonda", marca).apply()
        val mudouLista = antes != null && antes != marca
        if (mudouLista) diag(c, "Sondagem: as listas de chamados mudaram")

        // respostas: compara o último item do histórico com o que a última verificação viu
        var resposta = false
        val estado = p.getString("estado", null)
        if (estado != null) {
            val ordem = Engine.probeOrder(estado)
            val escolha = LinkedHashSet<Int>(ordem.take(SONDA_TOPO))
            val resto = ordem.drop(SONDA_TOPO)
            if (resto.isNotEmpty()) {
                val rr = p.getInt("sonda_rr", 0)
                for (k in 0 until minOf(SONDA_RODIZIO, resto.size)) escolha.add(resto[(rr + k) % resto.size])
                p.edit().putInt("sonda_rr", (rr + SONDA_RODIZIO) % resto.size).apply()
            }
            for (id in escolha) {
                val conhecido = Engine.knownLastItem(estado, id)
                if (conhecido < 0) {
                    // histórico ainda não lido: a verificação completa lê agora (só linha de base, sem aviso)
                    forcar.add(id); resposta = true; continue
                }
                val r = try { api.bruto("/helpdesk/tickets/$id/timeline") } catch (_: Exception) { break }
                if (r.first == 401) return true
                if (r.first != 200) continue
                if (Engine.maxItemId(r.second) > conhecido) {
                    forcar.add(id); resposta = true
                    diag(c, "Sondagem: item novo no histórico do chamado #$id")
                }
            }
        }
        return mudouLista || resposta
    }

    /**
     * Um "ciclo" do monitor: verificação completa quando passou o tempo dela; no meio-tempo, se o intervalo
     * for de segundos, faz a sondagem rápida e só verifica tudo quando algo mudou.
     */
    fun ciclo(c0: Context) {
        val c = c0.applicationContext
        if (!ativo(c) || !Store.logado(c) || verificando) return
        val agora = System.currentTimeMillis()
        val ultima = prefs(c).getLong("ultima", 0L)
        if (agora - ultima >= intervaloCompletoMs(c) - 5_000L) { verificar(c, false); return }
        if (intervaloSeg(c) >= 60 || !sondando.compareAndSet(false, true)) return   // uma sondagem por vez
        val mudou = try { sondar(c) } finally { sondando.set(false) }
        if (mudou) verificar(c, true)
    }

    fun cicloEmSegundoPlano(c: Context, depois: (() -> Unit)? = null) {
        val app = c.applicationContext
        Thread {
            try { ciclo(app) } catch (_: Exception) { }
            depois?.invoke()
        }.start()
    }

    /** Notificação de teste (para conferir som e aparência). */
    fun testar(c: Context) {
        criarCanais(c)
        val texto = "Assim chegam os avisos: novo chamado, resposta, mudança de status…"
        val b = Notification.Builder(c, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle("Teste · Helpdesk Freedom")
            .setContentText(texto)
            .setStyle(Notification.BigTextStyle().bigText(texto))
            .setContentIntent(abrirApp(c, null, NOTIF_INFO + 100))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
        try { nm(c).notify(NOTIF_INFO + 100, b.build()) } catch (_: Exception) { }
    }

    /** O canal dos avisos está com som e aparecendo por cima da tela? */
    fun canalOk(c: Context): Boolean = try {
        criarCanais(c)
        val ch = nm(c).getNotificationChannel(CANAL_AVISOS)
        ch != null && ch.importance >= NotificationManager.IMPORTANCE_HIGH && ch.sound != null
    } catch (_: Exception) { true }

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
                .put("texto", n.text).put("linhas", linhas).put("caminho", n.path).put("novo", n.isNew).put("meu", n.silent))
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
            .put("email", Store.email(c) ?: "").put("nome", Acesso.nome(c))
            .put("ativo", ativo(c)).put("tempoReal", tempoReal(c)).put("intervalo", intervaloSeg(c))
            .put("canalOk", canalOk(c))
            .put("minhasAcoes", minhasAcoes(c)).put("verificando", verificando)
            .put("ultima", p.getLong("ultima", 0L)).put("status", p.getString("status", "") ?: "")
            .put("monitorados", p.getInt("monitorados", 0))
            .put("notifOk", notificacoesPermitidas(c)).put("bateriaOk", bateriaLivre(c))
            .put("visto", p.getLong("visto", 0L))
        o.put("app", Atualizacao.resumo(c))
        o.put("diag", try { JSONArray(p.getString("diag", "[]")) } catch (_: Exception) { JSONArray() })
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

    // ---------------- diagnóstico ----------------

    /** Guarda um registro do que o monitor fez (últimos 50), para entender "por que não chegou o aviso". */
    @Synchronized
    fun diag(c: Context, texto: String) {
        val p = prefs(c)
        val arr = try { JSONArray(p.getString("diag", "[]")) } catch (_: Exception) { JSONArray() }
        val novo = JSONArray().put(JSONObject().put("t", System.currentTimeMillis()).put("x", texto.take(600)))
        for (i in 0 until minOf(arr.length(), 49)) novo.put(arr.get(i))
        p.edit().putString("diag", novo.toString()).apply()
    }

    fun textoDiagnostico(c: Context): String {
        val p = prefs(c)
        val sb = StringBuilder()
        sb.append("Freedom ").append(Atualizacao.nomeVersao(c)).append(" · Android ").append(Build.VERSION.RELEASE)
            .append(" · ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
        sb.append("Avisos: ").append(if (ativo(c)) "ligados" else "DESLIGADOS")
            .append(" · tempo real: ").append(if (tempoReal(c)) "sim" else "não")
            .append(" · a cada ").append(textoIntervalo(intervaloSeg(c)))
            .append(" · notificações: ").append(if (notificacoesPermitidas(c)) "permitidas" else "BLOQUEADAS")
            .append(" · som: ").append(if (canalOk(c)) "ok" else "SEM SOM")
            .append(" · bateria: ").append(if (bateriaLivre(c)) "liberada" else "RESTRITA")
            .append(" · minhas ações: ").append(if (minhasAcoes(c)) "avisa" else "não avisa").append('\n')
        val arr = try { JSONArray(p.getString("diag", "[]")) } catch (_: Exception) { JSONArray() }
        val f = java.text.SimpleDateFormat("dd/MM HH:mm:ss", java.util.Locale("pt", "BR"))
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            sb.append(f.format(java.util.Date(o.optLong("t")))).append("  ").append(o.optString("x")).append('\n')
        }
        return sb.toString()
    }

    fun marcarVisto(c: Context) {
        prefs(c).edit().putLong("visto", System.currentTimeMillis()).apply()
    }

    fun naoVistos(c: Context): Int {
        val p = prefs(c)
        val visto = p.getLong("visto", 0L)
        val feed = try { JSONArray(p.getString("feed", "[]")) } catch (_: Exception) { return 0 }
        var n = 0
        for (i in 0 until feed.length()) {
            val f = feed.optJSONObject(i) ?: continue
            if (f.optLong("t", 0L) > visto && !f.optBoolean("meu", false)) n++
        }
        return n
    }

    // ---------------- notificações ----------------

    fun nm(c: Context): NotificationManager = c.getSystemService(NotificationManager::class.java)

    fun criarCanais(c: Context) {
        val n = nm(c)
        try { n.deleteNotificationChannel(CANAL_ANTIGO) } catch (_: Exception) { }
        if (n.getNotificationChannel(CANAL_AVISOS) == null) {
            // importância alta = aparece por cima da tela, com som e vibração
            val avisos = NotificationChannel(CANAL_AVISOS, "Chamados do Helpdesk", NotificationManager.IMPORTANCE_HIGH)
            avisos.description = "Novos chamados, respostas e mudanças de status, prioridade e responsável"
            avisos.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            avisos.enableVibration(true)
            avisos.vibrationPattern = longArrayOf(0, 300, 150, 300)
            avisos.enableLights(true)
            avisos.lightColor = Cor.ROSA
            avisos.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            avisos.setShowBadge(true)
            n.createNotificationChannel(avisos)
        }
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

    private fun acao(c: Context, acao: String, x: Engine.Note, codigo: Int): PendingIntent {
        val i = Intent(c, ChamadoAcao::class.java).setAction(acao)
            .putExtra(Chamado.EXTRA_ID, x.ticketId).putExtra(Chamado.EXTRA_TITULO, x.title)
        // Responder precisa ser mutável: o Android coloca o texto digitado dentro do intent
        val mutavel = acao == Chamado.ACAO_RESPONDER
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (mutavel && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else if (mutavel) 0 else PendingIntent.FLAG_IMMUTABLE)
        return PendingIntent.getBroadcast(c, codigo, i, flags)
    }

    private fun notificar(c: Context, notas: List<Engine.Note>, estadoTxt: String?) {
        criarCanais(c)
        val n = nm(c)
        val agora = System.currentTimeMillis()
        val estado = try { JSONObject(estadoTxt ?: "{}") } catch (_: Exception) { JSONObject() }
        val tickets = estado.optJSONObject("tickets")
        val atendente = estado.optJSONObject("summary")?.optJSONObject("workspace") != null
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
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setGroup(GRUPO)
                .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            val rec = if (x.ticketId > 0) tickets?.optJSONObject(x.ticketId.toString()) else null
            if (rec != null && Engine.isActive(rec.optString("status"))) {
                // responder direto da notificação
                val entrada = RemoteInput.Builder(Chamado.CHAVE_TEXTO).setLabel("Sua resposta…").build()
                b.addAction(Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(c, R.drawable.ic_notificacao), "Responder",
                    acao(c, Chamado.ACAO_RESPONDER, x, id)).addRemoteInput(entrada).setAllowGeneratedReplies(false).build())
                // assumir: só para quem atende e se o chamado está sem responsável
                if (atendente && rec.optString("assignee").isEmpty()) b.addAction(Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(c, R.drawable.ic_notificacao), "Assumir",
                    acao(c, Chamado.ACAO_ASSUMIR, x, id + 1_000_000)).build())
            }
            try { n.notify(id, b.build()) } catch (_: Exception) { }
        }
        val s = Notification.Builder(c, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setColor(Cor.ROSA)
            .setContentTitle("Helpdesk")
            .setContentText("Novidades nos chamados")
            .setContentIntent(abrirApp(c, null, NOTIF_GRUPO))
            .setGroup(GRUPO).setGroupSummary(true).setAutoCancel(true)
            .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)   // só o aviso do chamado toca (não toca duas vezes)
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
        var s = "A cada " + textoIntervalo(intervaloSeg(c))
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
