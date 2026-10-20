using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Freedom
{
    /// <summary>
    /// Detecção de alterações no Helpdesk — tradução fiel do Engine.java do app Android
    /// (mesmas regras, para os dois apps avisarem as mesmas coisas).
    /// </summary>
    public static class Engine
    {
        public delegate Resp Fetcher(string caminho);

        public sealed class Resp
        {
            public readonly int Status;
            public readonly string Body;
            public Resp(int status, string body) { Status = status; Body = body ?? ""; }
        }

        public sealed class Note
        {
            public int TicketId;
            public string Title = "";
            public string Text = "";
            public readonly List<string> Lines = new List<string>();
            public string Path = "";
            public bool IsNew;
            /// <summary>Ação feita por mim mesmo: só entra no histórico do app, sem aviso.</summary>
            public bool Silent;
        }

        public sealed class Outcome
        {
            public bool Ok, SessionExpired, FirstRun;
            public string Error;
            public string NewState;
            public int Monitored;
            public readonly List<Note> Notes = new List<Note>();
        }

        const string API = "/helpdesk";
        public const int MAX_TIMELINES = 30;
        public const int MAX_TIMELINES_FIRST = 60;
        public const int ROTATE_ACTIVE = 10;
        const int MAX_LINES = 6;

        static readonly string[] LISTS =
        {
            API + "/tickets?page=1&page_size=100",
            API + "/tickets?view=requester&page=1&page_size=100",
            API + "/workspace/tickets?view=queues&page=1&page_size=100",
            API + "/workspace/tickets?view=assigned&page=1&page_size=100",
        };

        static long Agora() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }

        public static Outcome Run(Fetcher f, string stateJson, bool notifyOwn, long deadline, ISet<int> force = null)
        {
            if (force == null) force = new HashSet<int>();
            var outc = new Outcome();
            JSONObject state;
            try { state = string.IsNullOrEmpty(stateJson) ? new JSONObject() : new JSONObject(stateJson); }
            catch (Exception) { state = new JSONObject(); }
            JSONObject known = state.OptJSONObject("tickets");
            bool firstRun = known == null;
            if (known == null) known = new JSONObject();
            outc.FirstRun = firstRun;
            string wmCreated = state.OptString("wm_created", "");
            string wmUpdated = state.OptString("wm_updated", "");

            // 1) listas de chamados
            var current = new List<JSONObject>();
            var porId = new Dictionary<int, JSONObject>();
            var mine = new HashSet<int>();
            int okLists = 0;
            string lastErr = null;
            for (int li = 0; li < LISTS.Length; li++)
            {
                if (Agora() > deadline) { if (okLists == 0) lastErr = "o site demorou para responder"; break; }
                Resp r;
                try { r = f(LISTS[li]); }
                catch (Exception) { lastErr = "sem conexão com o servidor"; continue; }
                if (r.Status == 401) { outc.SessionExpired = true; outc.Error = "sessão expirada"; return outc; }
                if (r.Status != 200) { if (r.Status >= 500) lastErr = "servidor respondeu " + r.Status; continue; }
                try
                {
                    var items = new JSONObject(r.Body).OptJSONArray("items");
                    if (items != null)
                        for (int i = 0; i < items.Length; i++)
                        {
                            var t = items.OptJSONObject(i);
                            if (t == null || !t.Has("id")) continue;
                            int id = t.OptInt("id");
                            if (!porId.ContainsKey(id)) current.Add(t);
                            else current[current.IndexOf(porId[id])] = t;
                            porId[id] = t;
                            if (li == 1 || li == 3) mine.Add(id);
                        }
                    okLists++;
                }
                catch (Exception) { lastErr = "resposta inesperada do servidor"; }
            }
            if (okLists == 0) { outc.Error = lastErr ?? "não foi possível consultar o helpdesk"; return outc; }

            // 2) resumo
            JSONObject summary = null;
            if (Agora() < deadline)
                try { var r = f(API + "/notifications/summary"); if (r.Status == 200) summary = new JSONObject(r.Body); }
                catch (Exception) { }

            // 3) rodízio dos chamados ativos
            var activeIds = current.Where(t => IsActive(t.OptString("status"))).Select(t => t.OptInt("id")).ToList();
            activeIds.Sort();
            var rotate = new HashSet<int>();
            int rr = state.OptInt("rr", 0);
            if (activeIds.Count > 0)
            {
                int n = Math.Min(ROTATE_ACTIVE, activeIds.Count);
                for (int k = 0; k < n; k++) rotate.Add(activeIds[(rr + k) % activeIds.Count]);
                rr = (rr + n) % activeIds.Count;
            }

            // 4) chamado a chamado
            var newKnown = new JSONObject();
            string maxCreated = wmCreated, maxUpdated = wmUpdated;
            int timelinesLeft = firstRun ? MAX_TIMELINES_FIRST : MAX_TIMELINES;
            int newTicketsNotified = 0;
            var order = current.Where(t => mine.Contains(t.OptInt("id"))).Concat(current.Where(t => !mine.Contains(t.OptInt("id")))).ToList();

            foreach (var t in order)
            {
                int id = t.OptInt("id");
                string protocol = t.OptString("protocol", "#" + id);
                string title = t.OptString("title", "");
                string status = t.OptString("status", "");
                string priority = t.OptString("priority", "");
                string assignee = Str(t, "assignee_user_id");
                string queue = Str(t, "queue_id");
                string created = Ts(t.OptString("created_at", ""));
                string updated = Ts(t.OptString("updated_at", ""));
                int version = t.OptInt("version", 0);

                var old = known.OptJSONObject(id.ToString());
                // marca d'água do histórico por tipo (mensagens e eventos têm numeração própria no site)
                var oldWm = old != null ? old.OptJSONObject("wm") : null;
                var newWm = oldWm;

                bool isNew = false, unknownTouched = false, touched = false, versionChanged = false;
                var fieldChanges = new List<string>();
                if (old == null)
                {
                    if (!firstRun)
                    {
                        if (string.CompareOrdinal(created, wmCreated) > 0) isNew = true;
                        else if (string.CompareOrdinal(updated, wmUpdated) > 0) unknownTouched = true;
                    }
                }
                else
                {
                    if (status != old.OptString("status"))
                        fieldChanges.Add("Status: " + StatusLabel(old.OptString("status")) + " → " + StatusLabel(status));
                    if (priority != old.OptString("priority"))
                        fieldChanges.Add("Prioridade: " + PriorityLabel(old.OptString("priority")) + " → " + PriorityLabel(priority));
                    if (assignee != old.OptString("assignee"))
                        fieldChanges.Add(assignee.Length == 0 ? "Chamado ficou sem responsável" : "Responsável alterado");
                    if (queue != old.OptString("queue"))
                        fieldChanges.Add("Chamado transferido de fila");
                    versionChanged = version != old.OptInt("version", version);
                    touched = updated != old.OptString("updated") || versionChanged || fieldChanges.Count > 0;
                }
                touched = touched || isNew || unknownTouched;

                bool forced = force.Contains(id);
                bool wantTimeline = touched || forced || rotate.Contains(id) || (firstRun && IsActive(status));

                var lines = new List<string>();
                var ownSeen = new List<string>();
                bool timelineOk = false, anyOwn = false, anyOther = false;
                string requesterName = "", queueName = "";
                string sinceTs = old != null ? old.OptString("updated", "") : updated;

                if (wantTimeline && (timelinesLeft > 0 || forced) && Agora() < deadline)
                {
                    if (!forced) timelinesLeft--;
                    try
                    {
                        var r = f(API + "/tickets/" + id + "/timeline");
                        if (r.Status == 401) { outc.SessionExpired = true; outc.Error = "sessão expirada"; return outc; }
                        if (r.Status == 200)
                        {
                            var tl = new JSONObject(r.Body);
                            requesterName = tl.OptString("requester_name", "");
                            queueName = tl.OptString("queue_name", "");
                            var items = tl.OptJSONArray("items");
                            if (items != null) newWm = Watermarks(items);
                            var seen = new List<string>();
                            string openingBody = null;
                            if (items != null)
                                for (int i = 0; i < items.Length; i++)
                                {
                                    var it = items.OptJSONObject(i);
                                    if (it == null) continue;
                                    bool fresh;
                                    if (firstRun || (old == null && !isNew && !unknownTouched)) fresh = false;
                                    else if (isNew) fresh = true;
                                    else if (oldWm != null) fresh = IsFresh(oldWm, it);
                                    else fresh = touched && string.CompareOrdinal(Ts(it.OptString("created_at", "")), sinceTs) > 0;
                                    if (!fresh) continue;

                                    var actor = it.OptJSONObject("actor");
                                    bool own = actor != null && actor.OptBoolean("is_current_user", false);
                                    if (own) anyOwn = true; else anyOther = true;
                                    string type = it.OptString("type", "");
                                    if (own && !notifyOwn)
                                    {
                                        if (!(isNew && type == "EVENT"))
                                        {
                                            string ol = Describe(it, isNew);
                                            if (!string.IsNullOrEmpty(ol) && !ownSeen.Contains(ol)) ownSeen.Add(ol);
                                        }
                                        continue;
                                    }
                                    if (type == "OPENING") openingBody = Clean(it.OptString("body", ""));
                                    if (isNew && type == "EVENT") continue;
                                    if (isNew && type == "MESSAGE" && openingBody != null && openingBody == Clean(it.OptString("body", ""))) continue;
                                    string line = Describe(it, isNew);
                                    if (!string.IsNullOrEmpty(line) && !seen.Contains(line)) seen.Add(line);
                                }
                            lines.AddRange(seen);
                            timelineOk = true;
                        }
                    }
                    catch (Exception) { }
                }

                // decide se avisa
                Note note = null;
                if (isNew)
                {
                    bool ownTicket = timelineOk && anyOwn && !anyOther;
                    if (!ownTicket || notifyOwn)
                    {
                        note = new Note { IsNew = true };
                        note.Title = "Novo chamado " + protocol + (priority.Length > 0 ? " (" + PriorityLabel(priority) + ")" : "");
                        note.Text = title;
                        var head = new List<string> { title };
                        string meta = "";
                        if (requesterName.Length > 0) meta += "Aberto por " + requesterName;
                        if (queueName.Length > 0) meta += (meta.Length > 0 ? " · " : "") + "Fila " + queueName;
                        if (meta.Length > 0) head.Add(meta);
                        lines.InsertRange(0, head);
                        newTicketsNotified++;
                    }
                }
                else if (touched || lines.Count > 0)
                {
                    if (timelineOk)
                    {
                        if (lines.Count == 0)
                        {
                            if (anyOwn && !anyOther) { }
                            else if (fieldChanges.Count > 0) lines.AddRange(fieldChanges);
                            else if (versionChanged || unknownTouched) lines.Add("Chamado atualizado");
                        }
                    }
                    else if (touched)
                    {
                        if (fieldChanges.Count > 0) lines.AddRange(fieldChanges);
                        else if (versionChanged || unknownTouched) lines.Add("Chamado atualizado");
                    }
                    if (lines.Count > 0)
                    {
                        note = new Note();
                        note.Title = protocol + (title.Length > 0 ? " · " + title : "");
                        note.Text = lines[lines.Count - 1];
                    }
                }
                if (note == null && !notifyOwn && timelineOk && anyOwn && !anyOther)
                {
                    if (isNew)
                    {
                        note = new Note { IsNew = true, Title = "Você abriu o chamado " + protocol, Text = title };
                        lines = new List<string> { title };
                    }
                    else if (ownSeen.Count > 0)
                    {
                        note = new Note { Title = protocol + (title.Length > 0 ? " · " + title : "") };
                        lines = new List<string>(ownSeen);
                        note.Text = lines[lines.Count - 1];
                    }
                    if (note != null) note.Silent = true;
                }
                if (note != null)
                {
                    note.TicketId = id;
                    note.Path = "/helpdesk/tickets/" + id;
                    if (lines.Count > MAX_LINES)
                    {
                        int extra = lines.Count - MAX_LINES;
                        var keep = note.IsNew ? lines.Take(MAX_LINES).ToList() : lines.Skip(lines.Count - MAX_LINES).ToList();
                        keep.Add("+" + extra + " outra(s) atualização(ões)");
                        lines = keep;
                    }
                    note.Lines.AddRange(lines);
                    outc.Notes.Add(note);
                }

                var rec = new JSONObject()
                    .Put("protocol", protocol).Put("title", title).Put("status", status).Put("priority", priority)
                    .Put("assignee", assignee).Put("queue", queue).Put("updated", updated).Put("version", (long)version);
                if (newWm != null) rec.Put("wm", newWm);
                if (mine.Contains(id) || (old != null && old.OptBoolean("mine", false))) rec.Put("mine", true);
                newKnown.Put(id.ToString(), rec);
                if (string.CompareOrdinal(created, maxCreated) > 0) maxCreated = created;
                if (string.CompareOrdinal(updated, maxUpdated) > 0) maxUpdated = updated;
            }

            // mantém chamados antigos que saíram das listas (limitado)
            if (newKnown.Length < 800)
                foreach (var k in known.Keys)
                    if (!newKnown.Has(k)) { var velho = known.OptJSONObject(k); if (velho != null) velho.Put("fora", true); newKnown.Put(k, velho != null ? (object)velho : known.Opt(k)); }

            // 5) alertas do resumo
            if (summary != null)
            {
                var ws = summary.OptJSONObject("workspace");
                var oldSummary = state.OptJSONObject("summary");
                var ows = oldSummary != null ? oldSummary.OptJSONObject("workspace") : null;
                if (!firstRun && ws != null && ows != null)
                {
                    var sl = new List<string>();
                    int risk = ws.OptInt("sla_at_risk"), oRisk = ows.OptInt("sla_at_risk");
                    int br = ws.OptInt("sla_breached"), oBr = ows.OptInt("sla_breached");
                    int un = ws.OptInt("unassigned_active"), oUn = ows.OptInt("unassigned_active");
                    if (br > oBr) sl.Add("SLA estourado: " + br + " chamado(s)");
                    if (risk > oRisk) sl.Add("SLA em risco: " + risk + " chamado(s)");
                    if (un > oUn && newTicketsNotified == 0) sl.Add(un + " chamado(s) aguardando responsável na fila");
                    if (sl.Count > 0)
                    {
                        var n = new Note { TicketId = 0, Title = "Helpdesk · Central de Atendimento", Text = sl[0], Path = "/helpdesk/workspace" };
                        n.Lines.AddRange(sl);
                        outc.Notes.Add(n);
                    }
                }
            }

            // 6) avaliações novas: quem atende recebe a nota que o solicitante deu (a cada 4 min, no máximo)
            Avaliacoes(f, state, outc, deadline);

            state.Put("tickets", newKnown).Put("wm_created", maxCreated).Put("wm_updated", maxUpdated).Put("rr", (long)rr);
            if (summary != null) state.Put("summary", summary);
            outc.NewState = state.ToString();
            outc.Monitored = current.Count;
            outc.Ok = true;
            return outc;
        }

        // ------------------------------------------------------------------------------
        // sondagem rápida

        public static List<int> ProbeOrder(string stateJson)
        {
            var outl = new List<int>();
            try
            {
                var known = new JSONObject(stateJson).OptJSONObject("tickets");
                if (known == null) return outl;
                var recs = new Dictionary<int, JSONObject>();
                foreach (var k in known.Keys)
                {
                    var r = known.OptJSONObject(k);
                    int id;
                    if (r == null || !IsActive(r.OptString("status")) || !int.TryParse(k, out id)) continue;
                    recs[id] = r;
                }
                outl = recs.Keys.ToList();
                outl.Sort((a, b) =>
                {
                    bool ma = recs[a].OptBoolean("mine"), mb = recs[b].OptBoolean("mine");
                    if (ma != mb) return ma ? -1 : 1;
                    int c = string.CompareOrdinal(recs[b].OptString("updated"), recs[a].OptString("updated"));
                    return c != 0 ? c : b.CompareTo(a);
                });
            }
            catch (Exception) { }
            return outl;
        }

        public static long NumId(JSONObject it)
        {
            object o = it.Opt("id");
            long? l = Json.ComoLong(o);
            if (o is string) { long x; return long.TryParse((string)o, out x) ? x : -1; }
            return l ?? -1;
        }

        public static JSONObject Watermarks(JSONArray items)
        {
            var wm = new JSONObject();
            for (int i = 0; i < items.Length; i++)
            {
                var it = items.OptJSONObject(i);
                if (it == null) continue;
                string k = it.OptString("type", "");
                long iid = NumId(it);
                if (iid >= 0 && iid > wm.OptLong(k, -1)) wm.Put(k, iid);
                string t = Ts(it.OptString("created_at", ""));
                if (string.CompareOrdinal(t, wm.OptString(k + "@", "")) > 0) wm.Put(k + "@", t);
            }
            return wm;
        }

        public static bool IsFresh(JSONObject wm, JSONObject it)
        {
            string k = it.OptString("type", "");
            long iid = NumId(it);
            if (iid >= 0) return iid > wm.OptLong(k, -1);
            return string.CompareOrdinal(Ts(it.OptString("created_at", "")), wm.OptString(k + "@", "")) > 0;
        }

        public static bool Baselined(string stateJson, int id)
        {
            try
            {
                var r = new JSONObject(stateJson).OptJSONObject("tickets").OptJSONObject(id.ToString());
                return r != null && r.OptJSONObject("wm") != null;
            }
            catch (Exception) { return false; }
        }

        public static bool TimelineHasNew(string stateJson, int id, string timelineBody)
        {
            try
            {
                var r = new JSONObject(stateJson).OptJSONObject("tickets").OptJSONObject(id.ToString());
                var wm = r != null ? r.OptJSONObject("wm") : null;
                if (wm == null) return true;
                var items = new JSONObject(timelineBody).OptJSONArray("items");
                if (items == null) return false;
                for (int i = 0; i < items.Length; i++)
                {
                    var it = items.OptJSONObject(i);
                    if (it != null && IsFresh(wm, it)) return true;
                }
            }
            catch (Exception) { }
            return false;
        }

        // ------------------------------------------------------------------------------

        public static bool IsActive(string status)
        {
            return !(status == "RESOLVED" || status == "CLOSED" || status == "CANCELED" || status == "CANCELLED");
        }

        /// <summary>"2026-10-06T18:36:56.115322Z" -> "2026-10-06 18:36:56"</summary>
        public static string Ts(string s)
        {
            if (s == null) return "";
            s = s.Replace('T', ' ');
            return s.Length > 19 ? s.Substring(0, 19) : s;
        }

        static string Str(JSONObject o, string k) { return o.IsNull(k) ? "" : o.OptString(k, ""); }

        static readonly Regex Espacos = new Regex(@"\s+");
        public static string Clean(string s) { return s == null ? "" : Espacos.Replace(s, " ").Trim(); }

        static string Clip(string s, int max)
        {
            s = Clean(s);
            return s.Length > max ? s.Substring(0, max - 1) + "…" : s;
        }

        public static string Describe(JSONObject it, bool isNew)
        {
            string type = it.OptString("type", "");
            var actor = it.OptJSONObject("actor");
            string who = actor != null ? actor.OptString("name", "") : "";
            if (who.Length == 0) who = "Sistema";
            string body = it.OptString("body", "");
            if (type == "OPENING") return isNew ? Clip(body, 300) : null;
            if (type == "MESSAGE") return Clean(body).Length > 0 ? who + ": " + Clip(body, 300) : who + " enviou uma mensagem";
            if (type == "EVENT") return who + " " + EventText(it);
            return Clean(body).Length > 0 ? who + ": " + Clip(body, 300) : who + ": " + Humanize(type);
        }

        public static string EventText(JSONObject it)
        {
            string et = it.OptString("event_type", "");
            string oldV = LabelOf(it, "old"), newV = LabelOf(it, "new");
            var meta = it.OptJSONObject("metadata");
            if (et == "STATUS_CHANGED") return "alterou o status: " + StatusLabel(oldV) + " → " + StatusLabel(newV);
            if (et == "PRIORITY_CHANGED") return "alterou a prioridade: " + PriorityLabel(oldV) + " → " + PriorityLabel(newV);
            if (et == "ASSIGNEE_CHANGED") return newV.Length == 0 ? "removeu o responsável" : "definiu o responsável: " + newV;
            if (et.StartsWith("QUEUE") || et.Contains("TRANSFER")) return "transferiu o chamado" + (newV.Length > 0 ? " para a fila " + newV : "");
            if (et == "ATTACHMENT_ADDED")
            {
                string fn = meta != null ? meta.OptString("filename", "") : "";
                return "anexou um arquivo" + (fn.Length > 0 ? ": " + fn : "");
            }
            if (et == "SOLUTION_PROPOSED") return "enviou a solução e pediu a conclusão do chamado";
            if (et == "SOLUTION_ACCEPTED") return "aceitou a solução (chamado concluído)";
            if (et == "SOLUTION_REJECTED")
            {
                string motivo = meta != null ? meta.OptString("reason", "") : "";
                return "rejeitou a solução" + (motivo.Length > 0 ? ": " + Clip(motivo, 200) : "");
            }
            if (newV.Length > 0) return "encaminhou o chamado " + (oldV.Length > 0 ? "de " + oldV + " " : "") + "para " + newV;
            return Humanize(et);
        }

        static string LabelOf(JSONObject it, string p)
        {
            string l = it.IsNull(p + "_label") ? "" : it.OptString(p + "_label", "");
            if (l.Length == 0) l = it.IsNull(p + "_value") ? "" : it.OptString(p + "_value", "");
            return l;
        }

        static string Humanize(string code)
        {
            if (string.IsNullOrEmpty(code)) return "atualização";
            return code.Replace('_', ' ').ToLowerInvariant();
        }

        public static string StatusLabel(string s)
        {
            switch (s ?? "")
            {
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

        public static string PriorityLabel(string s)
        {
            switch (s ?? "")
            {
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
            static readonly string[] NOTAS = { "", "Péssimo", "Ruim", "Regular", "Bom", "Excelente" };

        /// <summary>Busca /helpdesk/ratings (só funciona para quem atende/administra) e avisa as avaliações novas.</summary>
        static void Avaliacoes(Fetcher f, JSONObject state, Outcome outc, long deadline)
        {
            long agora = Agora();
            if (agora - state.OptLong("rt_at", 0) < 4 * 60000L || agora > deadline) return;
            try
            {
                state.Put("rt_at", agora);
                // só as avaliações dos MEUS setores
                var ra = f(API + "/workspace/access");
                if (ra.Status != 200) return;
                var acc = new JSONObject(ra.Body);
                var qs = acc.OptJSONArray("queues");
                if (!acc.OptBoolean("can_access", true) || qs == null || qs.Length == 0) return;
                var items = new JSONArray();
                for (int q = 0; q < qs.Length && q < 8; q++)
                {
                    var qo = qs.OptJSONObject(q);
                    var qid = qo != null ? qo.OptString("id", "") : "";
                    if (qid.Length == 0 || Agora() > deadline) continue;
                    var r = f(API + "/ratings?page=1&page_size=20&queue_id=" + qid);
                    if (r.Status != 200) continue;
                    var its = new JSONObject(r.Body).OptJSONArray("items");
                    if (its != null) for (int k = 0; k < its.Length; k++) items.Put(its.Opt(k));
                }
                long antes = state.OptLong("rt_max", -1), maior = Math.Max(antes, 0);
                int avisadas = 0;
                if (items != null) for (int i = 0; i < items.Length; i++)
                {
                    var it = items.OptJSONObject(i);
                    if (it == null) continue;
                    long id = it.OptLong("id", 0);
                    if (id > maior) maior = id;
                    if (antes < 0 || id <= antes || avisadas >= 5) continue;
                    int nota = Math.Max(0, Math.Min(5, it.OptInt("rating")));
                    var est = new string('★', nota) + new string('☆', 5 - nota);
                    var n = new Note();
                    n.TicketId = it.OptInt("ticket_id");
                    n.Title = "Avaliação " + est + " " + NOTAS[nota] + " · " + it.OptString("protocol", "");
                    var quem = it.OptString("assignee_name", ""); if (string.IsNullOrEmpty(quem) || quem == "null") quem = "Não atribuído";
                    var com = it.OptString("comment", ""); if (com == "null") com = ""; com = com.Trim();
                    n.Text = quem + (com.Length == 0 ? "" : " · “" + com + "”");
                    n.Lines.Add(n.Text);
                    n.Path = n.TicketId > 0 ? "/helpdesk/tickets/" + n.TicketId : "/helpdesk/ratings";
                    outc.Notes.Add(n);
                    avisadas++;
                }
                state.Put("rt_max", maior);
            }
            catch (Exception) { }
        }
    }
}
