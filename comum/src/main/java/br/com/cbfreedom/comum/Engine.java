package br.com.cbfreedom.comum;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Detecção de alterações no Helpdesk (Java puro + org.json, sem dependências do Android,
 * para poder ser testado fora do celular).
 *
 * Fluxo: busca as listas de chamados da API do site, compara com o último estado salvo,
 * consulta o histórico (timeline) dos chamados que mudaram e gera as notificações.
 */
public final class Engine {

    public interface Fetcher {
        Resp get(String path) throws Exception;
    }

    public static final class Resp {
        public final int status;
        public final String body;

        public Resp(int status, String body) {
            this.status = status;
            this.body = body == null ? "" : body;
        }
    }

    /** Uma notificação a ser exibida (uma por chamado). */
    public static final class Note {
        public int ticketId;
        public String title;
        public String text;
        public final List<String> lines = new ArrayList<String>();
        public String path;
        public boolean isNew;
        /** Ação feita por mim mesmo: entra só no histórico do app, sem notificação. */
        public boolean silent;
    }

    public static final class Outcome {
        public boolean ok;
        public boolean sessionExpired;
        public boolean firstRun;
        public String error;
        public String newState;
        public int monitored;
        public final List<Note> notes = new ArrayList<Note>();
    }

    static final String API = "/helpdesk"; // relativo a Api.BASE (/api/v1)
    static final int MAX_TIMELINES = 30;   // máximo de históricos consultados por verificação
    static final int MAX_TIMELINES_FIRST = 60; // na primeira verificação (linha de base)
    static final int ROTATE_ACTIVE = 10;   // chamados ativos re-checados por rodízio a cada verificação
    static final int MAX_LINES = 6;

    static final String[] LISTS = {
            API + "/tickets?page=1&page_size=100",
            API + "/tickets?view=requester&page=1&page_size=100",
            API + "/workspace/tickets?view=queues&page=1&page_size=100",
            API + "/workspace/tickets?view=assigned&page=1&page_size=100",
    };

    private Engine() {
    }

    public static Outcome run(Fetcher f, String stateJson, boolean notifyOwn, long deadline) {
        return run(f, stateJson, notifyOwn, deadline, null);
    }

    /**
     * force = chamados em que a sondagem rápida viu item novo no histórico: o histórico deles é consultado
     * mesmo que a lista não mostre alteração (algumas respostas não mudam o updated_at do chamado).
     */
    public static Outcome run(Fetcher f, String stateJson, boolean notifyOwn, long deadline, Set<Integer> force) {
        if (force == null) force = Collections.emptySet();
        Outcome out = new Outcome();
        JSONObject state;
        try {
            state = (stateJson == null || stateJson.length() == 0) ? new JSONObject() : new JSONObject(stateJson);
        } catch (JSONException e) {
            state = new JSONObject();
        }
        JSONObject known = state.optJSONObject("tickets");
        boolean firstRun = known == null;
        if (known == null) known = new JSONObject();
        out.firstRun = firstRun;
        String wmCreated = state.optString("wm_created", "");
        String wmUpdated = state.optString("wm_updated", "");

        // 1) Listas de chamados ------------------------------------------------------------
        Map<Integer, JSONObject> current = new LinkedHashMap<Integer, JSONObject>();
        Set<Integer> mine = new HashSet<Integer>();   // que eu abri (solicitante) ou que estão comigo
        int okLists = 0;
        String lastErr = null;
        for (int li = 0; li < LISTS.length; li++) {
            String path = LISTS[li];
            if (System.currentTimeMillis() > deadline) {
                if (okLists == 0) lastErr = "o site demorou para responder";
                break;
            }
            Resp r;
            try {
                r = f.get(path);
            } catch (Exception e) {
                lastErr = "sem conexão com o servidor";
                continue;
            }
            if (r.status == 401) {
                out.sessionExpired = true;
                out.error = "sessão expirada";
                return out;
            }
            if (r.status != 200) {
                if (r.status >= 500) lastErr = "servidor respondeu " + r.status;
                continue; // 403/422 = usuário sem acesso a essa visão
            }
            try {
                JSONArray items = new JSONObject(r.body).optJSONArray("items");
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject t = items.optJSONObject(i);
                        if (t != null && t.has("id")) {
                            current.put(t.optInt("id"), t);
                            if (li == 1 || li == 3) mine.add(t.optInt("id"));
                        }
                    }
                }
                okLists++;
            } catch (JSONException e) {
                lastErr = "resposta inesperada do servidor";
            }
        }
        if (okLists == 0) {
            out.error = lastErr != null ? lastErr : "não foi possível consultar o helpdesk";
            return out;
        }

        // 2) Resumo (contadores de SLA etc.) ------------------------------------------------
        JSONObject summary = null;
        if (System.currentTimeMillis() < deadline) try {
            Resp r = f.get(API + "/notifications/summary");
            if (r.status == 200) summary = new JSONObject(r.body);
        } catch (Exception ignored) {
        }

        // 3) Rodízio dos chamados ativos (garante que respostas novas sejam vistas) ---------
        List<Integer> activeIds = new ArrayList<Integer>();
        for (JSONObject t : current.values()) if (isActive(t.optString("status"))) activeIds.add(t.optInt("id"));
        Collections.sort(activeIds);
        Set<Integer> rotate = new HashSet<Integer>();
        int rr = state.optInt("rr", 0);
        if (!activeIds.isEmpty()) {
            int n = Math.min(ROTATE_ACTIVE, activeIds.size());
            for (int k = 0; k < n; k++) rotate.add(activeIds.get((rr + k) % activeIds.size()));
            rr = (rr + n) % activeIds.size();
        }

        // 4) Comparação chamado a chamado ---------------------------------------------------
        JSONObject newKnown = new JSONObject();
        String maxCreated = wmCreated, maxUpdated = wmUpdated;
        int timelinesLeft = firstRun ? MAX_TIMELINES_FIRST : MAX_TIMELINES;
        int newTicketsNotified = 0;

        // os chamados "meus" (que abri ou estão comigo) primeiro: são os que mais importam no limite de consultas
        List<JSONObject> order = new ArrayList<JSONObject>();
        for (JSONObject t : current.values()) if (mine.contains(t.optInt("id"))) order.add(t);
        for (JSONObject t : current.values()) if (!mine.contains(t.optInt("id"))) order.add(t);

        for (JSONObject t : order) {
            int id = t.optInt("id");
            String protocol = t.optString("protocol", "#" + id);
            String title = t.optString("title", "");
            String status = t.optString("status", "");
            String priority = t.optString("priority", "");
            String assignee = str(t, "assignee_user_id");
            String queue = str(t, "queue_id");
            String created = ts(t.optString("created_at", ""));
            String updated = ts(t.optString("updated_at", ""));
            int version = t.optInt("version", 0);

            JSONObject old = known.optJSONObject(String.valueOf(id));
            // marca d'água do histórico POR TIPO: no site, mensagens e eventos têm numeração própria
            // (uma resposta nova pode ter id menor que o último evento), então cada tipo é comparado com o seu
            JSONObject oldWm = old != null ? old.optJSONObject("wm") : null;
            JSONObject newWm = oldWm;

            boolean isNew = false, unknownTouched = false, touched = false, versionChanged = false;
            List<String> fieldChanges = new ArrayList<String>();
            if (old == null) {
                if (!firstRun) {
                    if (created.compareTo(wmCreated) > 0) isNew = true;
                    else if (updated.compareTo(wmUpdated) > 0) unknownTouched = true;
                }
            } else {
                if (!status.equals(old.optString("status")))
                    fieldChanges.add("Status: " + statusLabel(old.optString("status")) + " → " + statusLabel(status));
                if (!priority.equals(old.optString("priority")))
                    fieldChanges.add("Prioridade: " + priorityLabel(old.optString("priority")) + " → " + priorityLabel(priority));
                if (!assignee.equals(old.optString("assignee")))
                    fieldChanges.add(assignee.length() == 0 ? "Chamado ficou sem responsável" : "Responsável alterado");
                if (!queue.equals(old.optString("queue")))
                    fieldChanges.add("Chamado transferido de fila");
                versionChanged = version != old.optInt("version", version);
                touched = !updated.equals(old.optString("updated")) || versionChanged || !fieldChanges.isEmpty();
            }
            touched = touched || isNew || unknownTouched;

            boolean forced = force.contains(id);
            boolean wantTimeline = touched || forced || rotate.contains(id) || (firstRun && isActive(status));

            List<String> lines = new ArrayList<String>();
            Set<String> ownSeen = new LinkedHashSet<String>();
            boolean timelineOk = false, anyOwn = false, anyOther = false;
            String requesterName = "", queueName = "";
            String sinceTs = old != null ? old.optString("updated", "") : updated;

            if (wantTimeline && (timelinesLeft > 0 || forced) && System.currentTimeMillis() < deadline) {
                if (!forced) timelinesLeft--;
                try {
                    Resp r = f.get(API + "/tickets/" + id + "/timeline");
                    if (r.status == 401) {
                        out.sessionExpired = true;
                        out.error = "sessão expirada";
                        return out;
                    }
                    if (r.status == 200) {
                        JSONObject tl = new JSONObject(r.body);
                        requesterName = tl.optString("requester_name", "");
                        queueName = tl.optString("queue_name", "");
                        JSONArray items = tl.optJSONArray("items");
                        if (items != null) newWm = watermarks(items);
                        Set<String> seen = new LinkedHashSet<String>();
                        String openingBody = null;
                        if (items != null) {
                            for (int i = 0; i < items.length(); i++) {
                                JSONObject it = items.optJSONObject(i);
                                if (it == null) continue;
                                boolean fresh;
                                if (firstRun || (old == null && !isNew && !unknownTouched)) fresh = false;
                                else if (isNew) fresh = true;
                                else if (oldWm != null) fresh = isFresh(oldWm, it);
                                // histórico nunca lido: só conta como novo o que veio depois da última mudança
                                // conhecida do chamado; sem mudança, é só a linha de base (não avisa o que é antigo)
                                else fresh = touched && ts(it.optString("created_at", "")).compareTo(sinceTs) > 0;
                                if (!fresh) continue;

                                JSONObject actor = it.optJSONObject("actor");
                                boolean own = actor != null && actor.optBoolean("is_current_user", false);
                                if (own) anyOwn = true;
                                else anyOther = true;
                                String type = it.optString("type", "");
                                if (own && !notifyOwn) {
                                    // não notifica, mas guarda para o histórico do app
                                    if (!(isNew && "EVENT".equals(type))) {
                                        String ol = describe(it, isNew);
                                        if (ol != null && ol.length() > 0) ownSeen.add(ol);
                                    }
                                    continue;
                                }

                                if ("OPENING".equals(type)) openingBody = clean(it.optString("body", ""));
                                if (isNew && "EVENT".equals(type)) continue; // eventos automáticos da abertura
                                if (isNew && "MESSAGE".equals(type) && openingBody != null
                                        && openingBody.equals(clean(it.optString("body", "")))) continue;
                                String line = describe(it, isNew);
                                if (line != null && line.length() > 0) seen.add(line);
                            }
                        }
                        lines.addAll(seen);
                        timelineOk = true;
                    }
                } catch (Exception ignored) {
                }
            }

            // Decide se notifica
            Note note = null;
            if (isNew) {
                boolean ownTicket = timelineOk && anyOwn && !anyOther;
                if (!ownTicket || notifyOwn) {
                    note = new Note();
                    note.isNew = true;
                    note.title = "Novo chamado " + protocol + (priority.length() > 0 ? " (" + priorityLabel(priority) + ")" : "");
                    note.text = title;
                    List<String> head = new ArrayList<String>();
                    head.add(title);
                    String meta = "";
                    if (requesterName.length() > 0) meta += "Aberto por " + requesterName;
                    if (queueName.length() > 0) meta += (meta.length() > 0 ? " · " : "") + "Fila " + queueName;
                    if (meta.length() > 0) head.add(meta);
                    lines.addAll(0, head);
                    newTicketsNotified++;
                }
            } else if (touched || !lines.isEmpty()) {
                if (timelineOk) {
                    if (lines.isEmpty()) {
                        if (anyOwn && !anyOther) {
                            // alteração feita por mim mesmo -> silencioso
                        } else if (!fieldChanges.isEmpty()) {
                            lines.addAll(fieldChanges);
                        } else if (versionChanged || unknownTouched) {
                            lines.add("Chamado atualizado");
                        }
                    }
                } else if (touched) {
                    if (!fieldChanges.isEmpty()) lines.addAll(fieldChanges);
                    else if (versionChanged || unknownTouched) lines.add("Chamado atualizado");
                }
                if (!lines.isEmpty()) {
                    note = new Note();
                    note.title = protocol + (title.length() > 0 ? " · " + title : "");
                    note.text = lines.get(lines.size() - 1);
                }
            }
            if (note == null && !notifyOwn && timelineOk && anyOwn && !anyOther) {
                // só ações minhas: vai para o histórico do app sem tocar o celular
                if (isNew) {
                    note = new Note();
                    note.isNew = true;
                    note.title = "Você abriu o chamado " + protocol;
                    note.text = title;
                    lines = new ArrayList<String>();
                    lines.add(title);
                } else if (!ownSeen.isEmpty()) {
                    note = new Note();
                    note.title = protocol + (title.length() > 0 ? " · " + title : "");
                    lines = new ArrayList<String>(ownSeen);
                    note.text = lines.get(lines.size() - 1);
                }
                if (note != null) note.silent = true;
            }
            if (note != null) {
                note.ticketId = id;
                note.path = "/helpdesk/tickets/" + id;
                if (lines.size() > MAX_LINES) {
                    int extra = lines.size() - MAX_LINES;
                    List<String> keep = new ArrayList<String>(lines.subList(lines.size() - MAX_LINES, lines.size()));
                    if (note.isNew) keep = new ArrayList<String>(lines.subList(0, MAX_LINES));
                    keep.add("+" + extra + " outra(s) atualização(ões)");
                    lines = keep;
                }
                note.lines.addAll(lines);
                out.notes.add(note);
            }

            // Novo estado deste chamado
            try {
                JSONObject rec = new JSONObject();
                rec.put("protocol", protocol);
                rec.put("title", title);
                rec.put("status", status);
                rec.put("priority", priority);
                rec.put("assignee", assignee);
                rec.put("queue", queue);
                rec.put("updated", updated);
                rec.put("version", version);
                if (newWm != null) rec.put("wm", newWm);
                if (mine.contains(id) || (old != null && old.optBoolean("mine", false))) rec.put("mine", true);
                newKnown.put(String.valueOf(id), rec);
            } catch (JSONException ignored) {
            }
            if (created.compareTo(maxCreated) > 0) maxCreated = created;
            if (updated.compareTo(maxUpdated) > 0) maxUpdated = updated;
        }

        // Mantém chamados antigos que saíram das listas (limitado)
        if (newKnown.length() < 800) {
            Iterator<String> keys = known.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (!newKnown.has(k)) {
                    try {
                        // saiu das minhas listas (transferido/sem acesso): guarda, mas não mostra em "Chamados em aberto"
                        JSONObject velho = known.optJSONObject(k);
                        if (velho != null) velho.put("fora", true);
                        newKnown.put(k, velho != null ? velho : known.get(k));
                    } catch (JSONException ignored) {
                    }
                }
            }
        }

        // 5) Alertas do resumo (SLA / fila sem responsável) ---------------------------------
        if (summary != null) {
            JSONObject ws = summary.optJSONObject("workspace");
            JSONObject oldSummary = state.optJSONObject("summary");
            JSONObject ows = oldSummary != null ? oldSummary.optJSONObject("workspace") : null;
            if (!firstRun && ws != null && ows != null) {
                List<String> sl = new ArrayList<String>();
                int risk = ws.optInt("sla_at_risk", 0), oRisk = ows.optInt("sla_at_risk", 0);
                int br = ws.optInt("sla_breached", 0), oBr = ows.optInt("sla_breached", 0);
                int un = ws.optInt("unassigned_active", 0), oUn = ows.optInt("unassigned_active", 0);
                if (br > oBr) sl.add("SLA estourado: " + br + " chamado(s)");
                if (risk > oRisk) sl.add("SLA em risco: " + risk + " chamado(s)");
                if (un > oUn && newTicketsNotified == 0) sl.add(un + " chamado(s) aguardando responsável na fila");
                if (!sl.isEmpty()) {
                    Note n = new Note();
                    n.ticketId = 0;
                    n.title = "Helpdesk · Central de Atendimento";
                    n.text = sl.get(0);
                    n.lines.addAll(sl);
                    n.path = "/helpdesk/workspace";
                    out.notes.add(n);
                }
            }
        }

        // 6) Avaliações novas: quem atende recebe a nota que o solicitante deu (a cada 4 min, no máximo) ----
        avaliacoes(f, state, out, deadline);

        try {
            state.put("tickets", newKnown);
            state.put("wm_created", maxCreated);
            state.put("wm_updated", maxUpdated);
            state.put("rr", rr);
            if (summary != null) state.put("summary", summary);
        } catch (JSONException ignored) {
        }
        out.newState = state.toString();
        out.monitored = current.size();
        out.ok = true;
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // Sondagem rápida (usada pelo app entre as verificações completas)

    /** Chamados ativos do estado salvo, na ordem de prioridade da sondagem: os meus primeiro, mais recentes antes. */
    public static List<Integer> probeOrder(String stateJson) {
        List<Integer> out = new ArrayList<Integer>();
        try {
            JSONObject known = new JSONObject(stateJson).optJSONObject("tickets");
            if (known == null) return out;
            final Map<Integer, JSONObject> recs = new HashMap<Integer, JSONObject>();
            Iterator<String> it = known.keys();
            while (it.hasNext()) {
                String k = it.next();
                JSONObject r = known.optJSONObject(k);
                if (r == null || !isActive(r.optString("status"))) continue;
                try { recs.put(Integer.parseInt(k), r); } catch (NumberFormatException ignored) { }
            }
            out.addAll(recs.keySet());
            Collections.sort(out, new java.util.Comparator<Integer>() {
                public int compare(Integer a, Integer b) {
                    JSONObject ra = recs.get(a), rb = recs.get(b);
                    boolean ma = ra.optBoolean("mine", false), mb = rb.optBoolean("mine", false);
                    if (ma != mb) return ma ? -1 : 1;
                    int c = rb.optString("updated").compareTo(ra.optString("updated"));
                    return c != 0 ? c : b.compareTo(a);
                }
            });
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Id numérico do item (-1 se o site mandar outro formato). */
    static long numId(JSONObject it) {
        Object o = it.opt("id");
        if (o instanceof Number) return ((Number) o).longValue();
        try {
            return Long.parseLong(String.valueOf(o));
        } catch (Exception e) {
            return -1;
        }
    }

    /** Maior id e último horário de cada tipo de item (MESSAGE, EVENT, OPENING...). */
    static JSONObject watermarks(JSONArray items) {
        JSONObject wm = new JSONObject();
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                String k = it.optString("type", "");
                long iid = numId(it);
                if (iid >= 0 && iid > wm.optLong(k, -1)) wm.put(k, iid);
                String t = ts(it.optString("created_at", ""));
                if (t.compareTo(wm.optString(k + "@", "")) > 0) wm.put(k + "@", t);
            }
        } catch (JSONException ignored) {
        }
        return wm;
    }

    /** O item é posterior ao que já tinha sido visto do mesmo tipo? (tipo nunca visto = tudo novo) */
    static boolean isFresh(JSONObject wm, JSONObject it) {
        String k = it.optString("type", "");
        long iid = numId(it);
        if (iid >= 0) return iid > wm.optLong(k, -1);
        return ts(it.optString("created_at", "")).compareTo(wm.optString(k + "@", "")) > 0;
    }

    /** O histórico deste chamado já foi lido alguma vez (tem marca d'água)? */
    public static boolean baselined(String stateJson, int id) {
        try {
            JSONObject r = new JSONObject(stateJson).optJSONObject("tickets").optJSONObject(String.valueOf(id));
            return r != null && r.optJSONObject("wm") != null;
        } catch (Exception e) {
            return false;
        }
    }

    /** Sondagem: a resposta de /tickets/{id}/timeline tem item que a última verificação não viu? */
    public static boolean timelineHasNew(String stateJson, int id, String timelineBody) {
        try {
            JSONObject r = new JSONObject(stateJson).optJSONObject("tickets").optJSONObject(String.valueOf(id));
            JSONObject wm = r != null ? r.optJSONObject("wm") : null;
            if (wm == null) return true;
            JSONArray items = new JSONObject(timelineBody).optJSONArray("items");
            if (items == null) return false;
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null && isFresh(wm, it)) return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    public static boolean isActive(String status) {
        return !("RESOLVED".equals(status) || "CLOSED".equals(status) || "CANCELED".equals(status)
                || "CANCELLED".equals(status));
    }

    /** "2026-10-06T18:36:56.115322Z" ou "2026-10-06 18:36:56" -> "2026-10-06 18:36:56" */
    public static String ts(String s) {
        if (s == null) return "";
        s = s.replace('T', ' ');
        return s.length() > 19 ? s.substring(0, 19) : s;
    }

    static String str(JSONObject o, String key) {
        if (o.isNull(key)) return "";
        return o.optString(key, "");
    }

    static String clean(String s) {
        if (s == null) return "";
        return s.replaceAll("\\s+", " ").trim();
    }

    static String clip(String s, int max) {
        s = clean(s);
        return s.length() > max ? s.substring(0, max - 1) + "…" : s;
    }

    static String describe(JSONObject it, boolean isNew) {
        String type = it.optString("type", "");
        JSONObject actor = it.optJSONObject("actor");
        String who = actor != null ? actor.optString("name", "") : "";
        if (who.length() == 0) who = "Sistema";
        String body = it.optString("body", "");
        if ("OPENING".equals(type)) return isNew ? clip(body, 300) : null;
        if ("MESSAGE".equals(type)) {
            return clean(body).length() > 0 ? who + ": " + clip(body, 300) : who + " enviou uma mensagem";
        }
        if ("EVENT".equals(type)) return who + " " + eventText(it);
        return clean(body).length() > 0 ? who + ": " + clip(body, 300) : who + ": " + humanize(type);
    }

    static String eventText(JSONObject it) {
        String et = it.optString("event_type", "");
        String oldV = labelOf(it, "old");
        String newV = labelOf(it, "new");
        JSONObject meta = it.optJSONObject("metadata");
        if ("STATUS_CHANGED".equals(et)) return "alterou o status: " + statusLabel(oldV) + " → " + statusLabel(newV);
        if ("PRIORITY_CHANGED".equals(et)) return "alterou a prioridade: " + priorityLabel(oldV) + " → " + priorityLabel(newV);
        if ("ASSIGNEE_CHANGED".equals(et))
            return newV.length() == 0 ? "removeu o responsável" : "definiu o responsável: " + newV;
        if (et.startsWith("QUEUE") || et.contains("TRANSFER"))
            return "transferiu o chamado" + (newV.length() > 0 ? " para a fila " + newV : "");
        if ("ATTACHMENT_ADDED".equals(et)) {
            String fn = meta != null ? meta.optString("filename", "") : "";
            return "anexou um arquivo" + (fn.length() > 0 ? ": " + fn : "");
        }
        if ("SOLUTION_PROPOSED".equals(et)) return "enviou a solução e pediu a conclusão do chamado";
        if ("SOLUTION_ACCEPTED".equals(et)) return "aceitou a solução (chamado concluído)";
        if ("SOLUTION_REJECTED".equals(et)) {
            String motivo = meta != null ? meta.optString("reason", "") : "";
            return "rejeitou a solução" + (motivo.length() > 0 ? ": " + clip(motivo, 200) : "");
        }
        // outros eventos com origem/destino são transferências de setor (igual ao site)
        if (newV.length() > 0) return "encaminhou o chamado " + (oldV.length() > 0 ? "de " + oldV + " " : "") + "para " + newV;
        return humanize(et);
    }

    static String labelOf(JSONObject it, String prefix) {
        String l = it.isNull(prefix + "_label") ? "" : it.optString(prefix + "_label", "");
        if (l.length() == 0) l = it.isNull(prefix + "_value") ? "" : it.optString(prefix + "_value", "");
        return l;
    }

    static String humanize(String code) {
        if (code == null || code.length() == 0) return "atualização";
        String s = code.replace('_', ' ').toLowerCase();
        return s;
    }

    public static String statusLabel(String s) {
        if (s == null) return "";
        switch (s) {
            case "OPEN": return "Aberto";
            case "IN_PROGRESS": return "Em andamento";
            case "WAITING": return "Aguardando";
            case "REOPENED": return "Reaberto";
            case "WAITING_SUPPLIER": return "Aguardando fornecedor";
            case "PENDING_APPROVAL": return "Aguardando aprovação";
            case "RESOLVED": return "Resolvido";
            case "CLOSED": return "Fechado";
            case "CANCELED":
            case "CANCELLED": return "Cancelado";
            case "": return "—";
            default: return s;
        }
    }

    static String priorityLabel(String s) {
        if (s == null) return "";
        switch (s) {
            case "LOW": return "Baixa";
            case "MEDIUM": return "Média";
            case "NORMAL": return "Normal";
            case "HIGH": return "Alta";
            case "URGENT": return "Urgente";
            case "CRITICAL": return "Crítica";
            case "": return "—";
            default: return s;
        }
    }

    static final String[] NOTAS = {"", "Péssimo", "Ruim", "Regular", "Bom", "Excelente"};

    /** Busca /helpdesk/ratings (só funciona para quem atende/administra) e avisa as avaliações novas. */
    static void avaliacoes(Fetcher f, JSONObject state, Outcome out, long deadline) {
        long agora = System.currentTimeMillis();
        if (agora - state.optLong("rt_at", 0) < 4 * 60_000L || agora > deadline) return;
        try {
            state.put("rt_at", agora);
            // só as avaliações dos MEUS setores (o site pode devolver outras dentro do escopo amplo)
            Resp ra = f.get(API + "/workspace/access");
            if (ra.status != 200) return;
            JSONObject acc = new JSONObject(ra.body);
            JSONArray qs = acc.optJSONArray("queues");
            if (acc.optBoolean("can_access", true) == false || qs == null || qs.length() == 0) return;
            JSONArray items = new JSONArray();
            for (int q = 0; q < qs.length() && q < 8; q++) {
                JSONObject qo = qs.optJSONObject(q);
                String qid = qo != null ? qo.optString("id", "") : qs.optString(q, "");
                if (qid.length() == 0 || System.currentTimeMillis() > deadline) continue;
                Resp r = f.get(API + "/ratings?page=1&page_size=20&queue_id=" + qid);
                if (r.status != 200) continue;
                JSONArray its = new JSONObject(r.body).optJSONArray("items");
                if (its != null) for (int k = 0; k < its.length(); k++) items.put(its.opt(k));
            }
            long antes = state.optLong("rt_max", -1), maior = Math.max(antes, 0);
            int avisadas = 0;
            if (items != null) for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                long id = it.optLong("id", 0);
                if (id > maior) maior = id;
                if (antes < 0 || id <= antes || avisadas >= 5) continue;
                int nota = Math.max(0, Math.min(5, it.optInt("rating", 0)));
                StringBuilder est = new StringBuilder();
                for (int k = 0; k < 5; k++) est.append(k < nota ? "★" : "☆");
                Note n = new Note();
                n.ticketId = it.optInt("ticket_id", 0);
                n.title = "Avaliação " + est + " " + NOTAS[nota] + " · " + it.optString("protocol", "");
                String quem = it.isNull("assignee_name") ? "Não atribuído" : it.optString("assignee_name", "Não atribuído");
                String com = it.isNull("comment") ? "" : it.optString("comment", "").trim();
                n.text = quem + (com.isEmpty() ? "" : " · “" + com + "”");
                n.lines.add(n.text);
                n.path = n.ticketId > 0 ? "/helpdesk/tickets/" + n.ticketId : "/helpdesk/ratings";
                out.notes.add(n);
                avisadas++;
            }
            state.put("rt_max", maior);
        } catch (Exception ignored) {
        }
    }
}
