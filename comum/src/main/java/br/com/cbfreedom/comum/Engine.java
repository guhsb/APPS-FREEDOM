package br.com.cbfreedom.comum;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
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
        int okLists = 0;
        String lastErr = null;
        for (String path : LISTS) {
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
                        if (t != null && t.has("id")) current.put(t.optInt("id"), t);
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
        int timelinesLeft = MAX_TIMELINES;
        int newTicketsNotified = 0;

        for (JSONObject t : current.values()) {
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
            long lastItem = old != null ? old.optLong("last_item", -1) : -1;

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

            boolean wantTimeline = touched || rotate.contains(id) || (firstRun && isActive(status));

            List<String> lines = new ArrayList<String>();
            boolean timelineOk = false, anyOwn = false, anyOther = false;
            String requesterName = "", queueName = "";
            String sinceTs = old != null ? old.optString("updated", "") : updated;

            if (wantTimeline && timelinesLeft > 0 && System.currentTimeMillis() < deadline) {
                timelinesLeft--;
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
                        long maxId = lastItem;
                        Set<String> seen = new LinkedHashSet<String>();
                        String openingBody = null;
                        if (items != null) {
                            for (int i = 0; i < items.length(); i++) {
                                JSONObject it = items.optJSONObject(i);
                                if (it == null) continue;
                                long iid = it.optLong("id", -1);
                                if (iid > maxId) maxId = iid;
                                boolean fresh;
                                if (firstRun || (old == null && !isNew && !unknownTouched)) fresh = false;
                                else if (isNew) fresh = true;
                                else if (lastItem >= 0) fresh = iid > lastItem;
                                else fresh = ts(it.optString("created_at", "")).compareTo(sinceTs) > 0;
                                if (!fresh) continue;

                                JSONObject actor = it.optJSONObject("actor");
                                boolean own = actor != null && actor.optBoolean("is_current_user", false);
                                if (own) anyOwn = true;
                                else anyOther = true;
                                if (own && !notifyOwn) continue;

                                String type = it.optString("type", "");
                                if ("OPENING".equals(type)) openingBody = clean(it.optString("body", ""));
                                if (isNew && "EVENT".equals(type)) continue; // eventos automáticos da abertura
                                if (isNew && "MESSAGE".equals(type) && openingBody != null
                                        && openingBody.equals(clean(it.optString("body", "")))) continue;
                                String line = describe(it, isNew);
                                if (line != null && line.length() > 0) seen.add(line);
                            }
                        }
                        lines.addAll(seen);
                        lastItem = maxId;
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
                rec.put("last_item", lastItem);
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
                        newKnown.put(k, known.get(k));
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
        String s = humanize(et);
        if (oldV.length() > 0 || newV.length() > 0) s += ": " + (oldV.length() > 0 ? oldV + " → " : "") + newV;
        return s;
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
}
