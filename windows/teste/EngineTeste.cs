using System;
using System.Collections.Generic;
using System.Linq;
using Freedom;

// Mesmos cenários do EngineTest do Android, rodando a tradução em C# (Engine.cs).
// Compilar/rodar (Linux com mono):  mcs -out:t.exe teste/EngineTeste.cs src/Json.cs src/Engine.cs && mono t.exe
static class EngineTeste
{
    static int fails;
    static void Check(bool c, string m) { Console.WriteLine((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; }

    class Fake
    {
        public SortedDictionary<int, JSONObject> Tickets = new SortedDictionary<int, JSONObject>();
        public Dictionary<int, JSONArray> Timelines = new Dictionary<int, JSONArray>();
        public JSONObject Summary = Sum(0, 0, 0);
        public int Status = 200;
        public bool Down;
        public int TimelineCalls;

        public Engine.Resp Get(string path)
        {
            if (Down) throw new System.IO.IOException("offline");
            if (Status != 200) return new Engine.Resp(Status, "{\"detail\":\"x\"}");
            if (path.Contains("/notifications/summary")) return new Engine.Resp(200, Summary.ToString());
            if (path.Contains("/timeline"))
            {
                TimelineCalls++;
                int id = int.Parse(System.Text.RegularExpressions.Regex.Replace(path, ".*/tickets/(\\d+)/timeline.*", "$1"));
                var tl = new JSONObject().Put("ticket", Tickets[id]).Put("requester_name", "Sillas Victor")
                    .Put("queue_name", "Contabilidade").Put("items", Timelines[id]);
                return new Engine.Resp(200, tl.ToString());
            }
            if (path.Contains("view=assigned")) return new Engine.Resp(422, "{\"detail\":[]}");
            var items = new JSONArray();
            foreach (var t in Tickets.Values) items.Put(t);
            return new Engine.Resp(200, new JSONObject().Put("items", items).Put("total", (long)items.Length).ToString());
        }

        public JSONObject Ticket(int id, string protocol, string status, string created, string updated)
        {
            var t = new JSONObject().Put("id", (long)id).Put("protocol", protocol).Put("title", "ICMS pedido " + id)
                .Put("status", status).Put("priority", "URGENT").Put("assignee_user_id", 29L).Put("queue_id", 9L)
                .Put("created_at", created).Put("updated_at", updated).Put("version", 1L);
            Tickets[id] = t;
            Timelines[id] = new JSONArray().Put(Item(id * 100, "OPENING", created, "Sillas Victor", false, "PEDIDO 118374 URGENTE"));
            return t;
        }

        public void Add(int ticketId, JSONObject it) { Timelines[ticketId].Put(it); }
    }

    static JSONObject Sum(int risk, int breached, int unassigned)
    {
        var ws = new JSONObject().Put("open", 0L).Put("unassigned_active", (long)unassigned).Put("sla_at_risk", (long)risk).Put("sla_breached", (long)breached);
        return new JSONObject().Put("workspace", ws);
    }

    static JSONObject Item(long id, string type, string at, string who, bool me, string body)
    {
        var a = new JSONObject().Put("id", 1L).Put("name", who).Put("is_current_user", me).Put("context", me ? "AGENT" : "REQUESTER");
        return new JSONObject().Put("id", id).Put("type", type).Put("created_at", at).Put("actor", a).Put("body", body);
    }

    static JSONObject Ev(long id, string at, string who, bool me, string et, string oldV, string newV)
    {
        return Item(id, "EVENT", at, who, me, "").Put("event_type", et)
            .Put("old_value", (object)oldV ?? JSONObject.NULL).Put("new_value", newV)
            .Put("old_label", (object)oldV ?? JSONObject.NULL).Put("new_label", newV);
    }

    static string state;
    static int Avisos(Engine.Outcome o) { return o.Notes.Count(x => !x.Silent); }

    static Engine.Outcome Run(Fake f, bool own, ISet<int> force = null)
    {
        var o = Engine.Run(f.Get, state, own, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 60000, force);
        if (o.Ok) state = o.NewState;
        foreach (var n in o.Notes) Console.WriteLine("       " + (n.Silent ? "(histórico) " : "") + "[" + n.Title + "] " + string.Join(" | ", n.Lines));
        return o;
    }

    static int Main()
    {
        var f = new Fake();
        f.Ticket(55, "CONT-08", "RESOLVED", "2026-10-06 18:27:05", "2026-10-06 18:37:04");
        f.Ticket(60, "CONT-09", "OPEN", "2026-10-07 10:00:00", "2026-10-07 10:00:00");

        Console.WriteLine("1) primeira execução");
        var o = Run(f, false);
        Check(o.Ok && o.FirstRun && o.Notes.Count == 0 && o.Monitored == 2, "sem avisos na primeira vez");

        Console.WriteLine("2) nada mudou");
        o = Run(f, false);
        Check(o.Ok && !o.FirstRun && o.Notes.Count == 0, "nenhum aviso");

        Console.WriteLine("3) novo chamado");
        f.Ticket(61, "CONT-10", "OPEN", "2026-10-07 11:00:00", "2026-10-07 11:00:00");
        f.Add(61, Item(6101, "MESSAGE", "2026-10-07 11:00:00", "Sillas Victor", false, "PEDIDO 118374 URGENTE"));
        f.Add(61, Ev(6102, "2026-10-07 11:00:00", "Sillas Victor", false, "QUEUE_ASSIGNED", null, "9"));
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].IsNew && o.Notes[0].Title.StartsWith("Novo chamado CONT-10"), "avisa novo chamado");
        Check(o.Notes.Count == 1 && string.Join("|", o.Notes[0].Lines).Contains("Aberto por Sillas Victor"), "quem abriu e a fila");
        Check(o.Notes.Count == 1 && o.Notes[0].Lines.Count == 3, "sem duplicar descrição/eventos");
        Check(o.Notes.Count == 1 && o.Notes[0].Path == "/helpdesk/tickets/61", "abre o chamado");

        Console.WriteLine("4) resposta de outra pessoa");
        f.Add(60, Item(6002, "MESSAGE", "2026-10-07 11:05:00", "Sillas Victor", false, "Conseguiu ver?"));
        f.Tickets[60].Put("updated_at", "2026-10-07 11:05:00");
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].Text == "Sillas Victor: Conseguiu ver?", "avisa a mensagem");

        Console.WriteLine("5) status por outra pessoa");
        f.Add(60, Ev(6003, "2026-10-07 11:06:00", "Ana Souza", false, "STATUS_CHANGED", "OPEN", "IN_PROGRESS"));
        f.Tickets[60].Put("status", "IN_PROGRESS").Put("updated_at", "2026-10-07 11:06:00").Put("version", 2L);
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].Text == "Ana Souza alterou o status: Aberto → Em andamento", "texto do status");

        Console.WriteLine("6) ação minha");
        f.Add(60, Item(6004, "MESSAGE", "2026-10-07 11:07:00", "Gustavo Batista", true, "Vou verificar"));
        f.Add(60, Ev(6005, "2026-10-07 11:07:01", "Gustavo Batista", true, "PRIORITY_CHANGED", "URGENT", "HIGH"));
        f.Tickets[60].Put("priority", "HIGH").Put("updated_at", "2026-10-07 11:07:01").Put("version", 3L);
        o = Run(f, false);
        Check(Avisos(o) == 0, "sem aviso por padrão");
        Check(o.Notes.Count == 1 && o.Notes[0].Silent && string.Join("|", o.Notes[0].Lines).Contains("Gustavo Batista: Vou verificar"), "vai pro histórico");

        Console.WriteLine("6b) minhas ações ligado");
        f.Add(60, Ev(6006, "2026-10-07 11:08:00", "Gustavo Batista", true, "ASSIGNEE_CHANGED", null, "Gustavo Batista"));
        f.Tickets[60].Put("updated_at", "2026-10-07 11:08:00");
        o = Run(f, true);
        Check(o.Notes.Count == 1 && !o.Notes[0].Silent && o.Notes[0].Text.Contains("definiu o responsável: Gustavo Batista"), "avisa quando ligado");

        Console.WriteLine("7) resposta sem mudar updated_at");
        f.Add(60, Item(6007, "MESSAGE", "2026-10-07 11:09:00", "Sillas Victor", false, "Obrigado!"));
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].Text.Contains("Obrigado!"), "detecta pelo rodízio");

        Console.WriteLine("8) anexo + reaberto");
        f.Add(55, Ev(5501, "2026-10-07 11:10:00", "Sillas Victor", false, "STATUS_CHANGED", "RESOLVED", "OPEN"));
        var att = Ev(5502, "2026-10-07 11:10:05", "Sillas Victor", false, "ATTACHMENT_ADDED", null, "36");
        att.Put("metadata", new JSONObject().Put("attachment_id", 36L).Put("filename", "nota.pdf"));
        f.Add(55, att);
        f.Tickets[55].Put("status", "OPEN").Put("updated_at", "2026-10-07 11:10:05").Put("version", 4L);
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].Lines.Count == 2 && o.Notes[0].Lines[1].Contains("anexou um arquivo: nota.pdf"), "status + anexo");

        Console.WriteLine("9) chamado antigo não é novo");
        f.Ticket(10, "LOG-01", "RESOLVED", "2026-10-01 09:00:00", "2026-10-01 10:00:00");
        o = Run(f, false);
        Check(o.Notes.Count == 0, "sem falso novo");

        Console.WriteLine("10) SLA em risco");
        f.Summary = Sum(2, 0, 0);
        o = Run(f, false);
        Check(o.Notes.Count == 1 && o.Notes[0].Text == "SLA em risco: 2 chamado(s)", "alerta de SLA");

        Console.WriteLine("11) sessão expirada");
        f.Status = 401;
        o = Run(f, false);
        Check(o.SessionExpired && !o.Ok, "detecta 401");
        f.Status = 200;

        Console.WriteLine("12) sem internet");
        f.Down = true;
        o = Run(f, false);
        Check(!o.Ok && o.Error != null && !o.SessionExpired, "erro sem perder estado");
        f.Down = false;
        o = Run(f, false);
        Check(o.Ok && o.Notes.Count == 0, "volta sem repetir");

        Console.WriteLine("13) muitos chamados");
        for (int i = 0; i < 60; i++) f.Ticket(200 + i, "X-" + i, "OPEN", "2026-10-05 08:00:00", "2026-10-05 08:00:00");
        f.TimelineCalls = 0;
        o = Run(f, false);
        Check(f.TimelineCalls <= Engine.MAX_TIMELINES, "consultou " + f.TimelineCalls + " históricos");
        f.TimelineCalls = 0;
        o = Run(f, false);
        Check(o.Notes.Count == 0 && f.TimelineCalls <= Engine.ROTATE_ACTIVE, "em repouso só o rodízio (" + f.TimelineCalls + ")");

        Console.WriteLine("14) sondagem");
        var ordem = Engine.ProbeOrder(state);
        Check(ordem.Count > 0 && !ordem.Contains(10), "só ativos (" + ordem.Count + ")");
        int alvo = ordem.FirstOrDefault(id => Engine.Baselined(state, id) && id >= 200);
        Check(alvo > 0, "chamado com histórico: " + alvo);
        Check(!Engine.TimelineHasNew(state, alvo, new JSONObject().Put("items", f.Timelines[alvo]).ToString()), "nada novo antes");
        f.Add(alvo, Item(alvo * 100 + 50, "MESSAGE", "2026-10-07 12:00:00", "Paolo Yoshitani", false, "Pode conferir a nota?"));
        Check(Engine.TimelineHasNew(state, alvo, new JSONObject().Put("items", f.Timelines[alvo]).ToString()), "percebe item novo");
        var force = new HashSet<int> { alvo };
        o = Run(f, false, force);
        Check(o.Notes.Any(n => n.TicketId == alvo && !n.Silent && n.Text == "Paolo Yoshitani: Pode conferir a nota?"), "avisa na hora");
        o = Run(f, false, force);
        Check(Avisos(o) == 0, "não repete");

        Console.WriteLine("15) resposta minha");
        f.Add(61, Item(6110, "MESSAGE", "2026-10-07 12:05:00", "Gustavo Batista", true, "Segue o pedido"));
        force = new HashSet<int> { 61 };
        o = Run(f, false, force);
        Check(Avisos(o) == 0 && o.Notes.Count == 1 && o.Notes[0].Silent, "só histórico");
        f.Add(61, Item(6111, "MESSAGE", "2026-10-07 12:06:00", "Paolo Yoshitani", false, "Recebido"));
        o = Run(f, false, force);
        Check(Avisos(o) == 1 && o.Notes[0].Text == "Paolo Yoshitani: Recebido", "outra pessoa avisa");

        Console.WriteLine("16) linha de base");
        var st = new JSONObject(state);
        st.OptJSONObject("tickets").OptJSONObject("230").Remove("wm");
        state = st.ToString();
        f.Add(230, Item(23050, "MESSAGE", "2026-10-07 12:30:00", "Paolo Yoshitani", false, "Mensagem antiga"));
        force = new HashSet<int> { 230 };
        o = Run(f, false, force);
        Check(Avisos(o) == 0 && Engine.Baselined(state, 230), "base sem aviso falso");
        f.Add(230, Item(23051, "MESSAGE", "2026-10-07 12:31:00", "Paolo Yoshitani", false, "Mensagem nova"));
        o = Run(f, false, force);
        Check(Avisos(o) == 1 && o.Notes[0].Text.Contains("Mensagem nova"), "depois avisa");

        Console.WriteLine("17) pedido de conclusão");
        f.Add(61, Ev(6120, "2026-10-07 12:40:00", "Paolo Yoshitani", false, "SOLUTION_PROPOSED", null, null));
        f.Tickets[61].Put("status", "PENDING_APPROVAL").Put("updated_at", "2026-10-07 12:40:00").Put("version", 5L);
        o = Run(f, false);
        Check(Avisos(o) == 1 && string.Join("|", o.Notes[0].Lines).Contains("pediu a conclusão"), "avisa o pedido");

        Console.WriteLine("18) numeração própria de mensagens e eventos");
        var t70 = f.Ticket(70, "LOG-20", "OPEN", "2026-10-07 13:00:00", "2026-10-07 13:00:00");
        f.Timelines[70] = new JSONArray();
        f.Add(70, Item(70, "OPENING", "2026-10-07 13:00:00", "Gustavo Batista", true, "Pedido sem coleta"));
        f.Add(70, Ev(9001, "2026-10-07 13:05:00", "Paolo Yoshitani", false, "ASSIGNEE_CHANGED", null, "Paolo Yoshitani"));
        f.Add(70, Ev(9002, "2026-10-07 13:05:01", "Paolo Yoshitani", false, "STATUS_CHANGED", "OPEN", "IN_PROGRESS"));
        t70.Put("status", "IN_PROGRESS").Put("updated_at", "2026-10-07 13:05:01").Put("version", 2L);
        o = Run(f, false);
        force = new HashSet<int> { 70 };
        o = Run(f, false, force);
        f.Add(70, Item(151, "MESSAGE", "2026-10-07 13:10:00", "Paolo Yoshitani", false, "Pode mandar o comprovante?"));
        Check(Engine.TimelineHasNew(state, 70, new JSONObject().Put("items", f.Timelines[70]).ToString()), "sondagem vê id menor");
        o = Run(f, false, force);
        Check(o.Notes.Any(n => n.TicketId == 70 && !n.Silent && n.Text.Contains("Pode mandar o comprovante?")), "avisa a resposta");
        f.Add(70, Item(152, "MESSAGE", "2026-10-07 13:12:00", "Paolo Yoshitani", false, "Chegou?"));
        o = Run(f, false, force);
        Check(Avisos(o) == 1 && o.Notes[0].Text.Contains("Chegou?"), "e a seguinte");

        Console.WriteLine("19) JSON: ida e volta");
        var j = new JSONObject("{\"a\":1,\"b\":\"x\\u00e9\\n\",\"c\":[1,2.5,null,true],\"d\":{\"e\":null}}");
        Check(j.OptInt("a") == 1 && j.OptString("b") == "xé\n" && j.OptJSONArray("c").Length == 4 && j.IsNull("e") && j.OptJSONObject("d").IsNull("e"), "lê o JSON");
        Check(new JSONObject(j.ToString()).ToString() == j.ToString(), "escreve igual");

        Console.WriteLine(fails == 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " FALHA(S)");
        return fails == 0 ? 0 : 1;
    }
}
