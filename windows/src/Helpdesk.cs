using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;

namespace Freedom
{
    /// <summary>
    /// Avisos do Helpdesk no Windows: mesma lógica do app Android (sondagem a cada 15 s, verificação completa,
    /// histórico, diagnóstico). A janela mostra os avisos pelo evento Avisar.
    /// </summary>
    public static class Helpdesk
    {
        static readonly string[] SONDAS =
        {
            "/helpdesk/notifications/summary",
            "/helpdesk/workspace/tickets?view=queues&page=1&page_size=5",
            "/helpdesk/workspace/tickets?view=assigned&page=1&page_size=5",
            "/helpdesk/tickets?view=requester&page=1&page_size=5"
        };
        const int MAX_FEED = 60, SONDA_TOPO = 3, SONDA_RODIZIO = 2;

        /// <summary>Avisos para mostrar (só os que não são ações minhas).</summary>
        public static event Action<List<Engine.Note>> Avisar;
        /// <summary>Algo mudou (a tela se atualiza).</summary>
        public static event Action Mudou;

        public static volatile bool Verificando;
        static readonly object trava = new object();
        static int sondando;
        static readonly HashSet<int> forcar = new HashSet<int>();

        public static Prefs P { get { return Prefs.De("helpdesk"); } }

        public static bool Ativo() { return Acesso.Helpdesk() && P.GetBool("ativo", true); }
        public static int IntervaloSeg() { return Math.Max(15, Math.Min(3600, P.GetInt("intervalo_s", 15))); }
        public static long IntervaloCompletoMs() { int s = IntervaloSeg(); return s < 60 ? 120000L : s * 1000L; }
        public static bool MinhasAcoes() { return P.GetBool("minhas_acoes", false); }

        public static void Configurar(JSONObject cfg)
        {
            var ed = P.Edit();
            if (cfg.Has("ativo")) ed.Put("ativo", cfg.OptBoolean("ativo"));
            if (cfg.Has("tempoReal")) ed.Put("tempo_real", cfg.OptBoolean("tempoReal"));
            if (cfg.Has("minhasAcoes")) ed.Put("minhas_acoes", cfg.OptBoolean("minhasAcoes"));
            if (cfg.Has("intervalo")) ed.Put("intervalo_s", (long)Math.Max(15, Math.Min(3600, cfg.OptInt("intervalo", 15))));
            ed.Commit();
            AvisarTela();
        }

        public static void Sair()
        {
            P.Edit().Clear().Commit();
            lock (forcar) forcar.Clear();
            Fila.Limpar();
        }

        public static void AvisarTela() { var m = Mudou; if (m != null) try { m(); } catch (Exception) { } }

        static Engine.Fetcher Fetcher(Api api) { return c => api.Bruto(c); }

        public static Engine.Outcome Verificar(bool manual)
        {
            if (!manual && Verificando) return null;
            lock (trava) return VerificarAgora(manual);
        }

        static Engine.Outcome VerificarAgora(bool manual)
        {
            var p = P;
            long agora = Relogio.Agora();
            if (!manual)
            {
                if (!Ativo()) return null;
                long folga = Math.Max(30000L, IntervaloCompletoMs() / 2);
                if (agora - p.GetLong("ultima") < folga) return null;
            }
            if (!Acesso.Helpdesk()) { p.Edit().Put("status", "Este login não tem acesso ao Helpdesk").Commit(); return null; }
            var login = Store.Login();
            if (login == null) return null;
            Verificando = true;
            AvisarTela();
            var ed = p.Edit().Put("ultima", agora);
            HashSet<int> forca;
            lock (forcar) forca = new HashSet<int>(forcar);
            try
            {
                var api = new Api(login.Value.Key, login.Value.Value, p.GetString("cookie", ""));
                bool logou = false;
                if (api.Cookie.Length == 0) { api.Entrar(); logou = true; Acesso.Atualizar(api); }
                var o = Engine.Run(Fetcher(api), p.GetString("estado"), MinhasAcoes(), agora + 40000, forca);
                if ((o.SessionExpired || !o.Ok) && !logou)
                {
                    api = new Api(login.Value.Key, login.Value.Value);
                    api.Entrar(); logou = true;
                    Acesso.Atualizar(api);
                    o = Engine.Run(Fetcher(api), p.GetString("estado"), MinhasAcoes(), Relogio.Agora() + 40000, forca);
                }
                if (logou) ed.Put("cookie", api.Cookie);
                bool avisar = Ativo();
                if (o.SessionExpired) { ed.Put("status", "Este login não tem acesso ao Helpdesk"); Diag("Sem acesso ao Helpdesk (sessão recusada)"); }
                else if (!o.Ok) { ed.Put("status", "Não verificou: " + (o.Error ?? "erro")); Diag("Erro: " + (o.Error ?? "erro")); }
                else
                {
                    ed.Put("estado", o.NewState).Put("status", "ok").Put("monitorados", (long)o.Monitored).Remove("sonda");
                    lock (forcar) forcar.ExceptWith(forca);
                    var avisos = o.Notes.Where(n => !n.Silent).ToList();
                    if (o.Notes.Count > 0)
                    {
                        GuardarFeed(ed, o.Notes, agora);
                        if (avisar && avisos.Count > 0) { var a = Avisar; if (a != null) try { a(avisos); } catch (Exception) { } }
                    }
                    int minhas = o.Notes.Count - avisos.Count;
                    if (o.FirstRun) Diag("Primeira verificação: linha de base de " + o.Monitored + " chamados");
                    else if (o.Notes.Count > 0 || forca.Count > 0 || manual)
                        Diag("Verificação: " + o.Monitored + " chamados, " + avisos.Count + " novidade(s)" +
                             (minhas > 0 ? " + " + minhas + " sua(s)" : "") +
                             (avisos.Count == 0 ? "" : avisar ? " · avisou no Windows" : " · NÃO avisou: avisos desligados") +
                             (forca.Count > 0 ? " · conferiu " + string.Join(", ", forca.Select(x => "#" + x)) : "") +
                             string.Concat(avisos.Take(3).Select(n => "\n  " + n.Title + ": " + n.Text)));
                }
                return o;
            }
            catch (ErroLogin)
            {
                ed.Put("status", "O site recusou o login guardado. Saia e entre de novo no app.");
                Diag("Login recusado pelo site");
                return null;
            }
            catch (Exception e)
            {
                ed.Put("status", "Não verificou: " + Api.Mensagem(e));
                Diag("Erro: " + Api.Mensagem(e));
                return null;
            }
            finally
            {
                if (Store.Logado() && Store.Email() == login.Value.Key) ed.Commit();
                Verificando = false;
                AvisarTela();
            }
        }

        /// <summary>Consulta leve (listas + histórico de alguns chamados). true = algo mudou.</summary>
        public static bool Sondar()
        {
            var p = P;
            var login = Store.Login();
            if (login == null) return false;
            var cookie = p.GetString("cookie", "");
            if (cookie.Length == 0) return true;
            var api = new Api(login.Value.Key, login.Value.Value, cookie);
            var sb = new StringBuilder();
            foreach (var caminho in SONDAS)
            {
                Engine.Resp r;
                try { r = api.Bruto(caminho); } catch (Exception) { return false; }
                if (r.Status == 401) return true;
                if (r.Status != 200) continue;
                try
                {
                    var o = new JSONObject(r.Body);
                    var itens = o.OptJSONArray("items");
                    if (itens == null) { sb.Append(o.ToString()).Append('|'); continue; }
                    for (int i = 0; i < itens.Length; i++)
                    {
                        var t = itens.OptJSONObject(i);
                        if (t == null) continue;
                        sb.Append(t.OptString("id")).Append(':').Append(t.OptString("status")).Append(':')
                          .Append(t.OptString("version")).Append(':').Append(t.OptString("updated_at")).Append(':')
                          .Append(t.OptString("priority")).Append(':').Append(t.OptString("assignee_user_id")).Append(';');
                    }
                    sb.Append('|');
                }
                catch (Exception) { }
            }
            var marca = sb.ToString().GetHashCode() + ":" + sb.Length;
            var antes = p.GetString("sonda");
            p.Edit().Put("sonda", marca).Commit();
            bool mudouLista = antes != null && antes != marca;
            if (mudouLista) Diag("Sondagem: as listas de chamados mudaram");

            bool resposta = false;
            var estado = p.GetString("estado");
            if (estado != null)
            {
                var ordem = Engine.ProbeOrder(estado);
                var escolha = new List<int>(ordem.Take(SONDA_TOPO));
                var resto = ordem.Skip(SONDA_TOPO).ToList();
                if (resto.Count > 0)
                {
                    int rr = p.GetInt("sonda_rr");
                    for (int k = 0; k < Math.Min(SONDA_RODIZIO, resto.Count); k++)
                    {
                        int id = resto[(rr + k) % resto.Count];
                        if (!escolha.Contains(id)) escolha.Add(id);
                    }
                    p.Edit().Put("sonda_rr", (long)((rr + SONDA_RODIZIO) % resto.Count)).Commit();
                }
                foreach (var id in escolha)
                {
                    if (!Engine.Baselined(estado, id)) { lock (forcar) forcar.Add(id); resposta = true; continue; }
                    Engine.Resp r;
                    try { r = api.Bruto("/helpdesk/tickets/" + id + "/timeline"); } catch (Exception) { break; }
                    if (r.Status == 401) return true;
                    if (r.Status != 200) continue;
                    if (Engine.TimelineHasNew(estado, id, r.Body))
                    {
                        lock (forcar) forcar.Add(id);
                        resposta = true;
                        Diag("Sondagem: item novo no histórico do chamado #" + id);
                    }
                }
            }
            return mudouLista || resposta;
        }

        /// <summary>Um ciclo do monitor (chamado a cada IntervaloSeg pela janela).</summary>
        public static void Ciclo()
        {
            try { Fila.Enviar(); } catch (Exception) { }      // o que ficou guardado sem internet
            if (!Ativo() || !Store.Logado() || Verificando) return;
            long agora = Relogio.Agora();
            if (agora - P.GetLong("ultima") >= IntervaloCompletoMs() - 5000) { Verificar(false); return; }
            if (IntervaloSeg() >= 60 || Interlocked.CompareExchange(ref sondando, 1, 0) != 0) return;
            bool mudou;
            try { mudou = Sondar(); } finally { Interlocked.Exchange(ref sondando, 0); }
            if (mudou) Verificar(true);
        }

        public static void EmSegundoPlano(Action acao)
        {
            new Thread(() => { try { acao(); } catch (Exception) { } }) { IsBackground = true }.Start();
        }

        static void GuardarFeed(Prefs.Editor ed, List<Engine.Note> notas, long agora)
        {
            JSONArray antigo;
            try { antigo = new JSONArray(P.GetString("feed", "[]")); } catch (Exception) { antigo = new JSONArray(); }
            var novo = new JSONArray();
            foreach (var n in notas)
            {
                var linhas = new JSONArray();
                foreach (var l in n.Lines) linhas.Put(l);
                novo.Put(new JSONObject().Put("t", agora).Put("id", (long)n.TicketId).Put("titulo", n.Title).Put("texto", n.Text)
                    .Put("linhas", linhas).Put("caminho", n.Path).Put("novo", n.IsNew).Put("meu", n.Silent));
            }
            for (int i = 0; i < antigo.Length && novo.Length < MAX_FEED; i++) novo.Put(antigo.Get(i));
            ed.Put("feed", novo.ToString());
        }

        public static JSONObject ResumoTela()
        {
            var p = P;
            var o = new JSONObject()
                .Put("email", Store.Email() ?? "").Put("nome", Acesso.Nome())
                .Put("ativo", Ativo()).Put("tempoReal", true).Put("intervalo", (long)IntervaloSeg())
                .Put("canalOk", true).Put("minhasAcoes", MinhasAcoes()).Put("verificando", Verificando)
                .Put("ultima", p.GetLong("ultima")).Put("status", p.GetString("status", ""))
                .Put("monitorados", (long)p.GetInt("monitorados")).Put("notifOk", true).Put("bateriaOk", true)
                .Put("visto", p.GetLong("visto")).Put("plataforma", "windows")
                .Put("fila", (long)Fila.Quantos()).Put("online", Fila.Online());
            o.Put("app", Atualizacao.Resumo());
            o.Put("diag", Lista(p.GetString("diag", "[]")));
            o.Put("feed", Lista(p.GetString("feed", "[]")));
            JSONObject estado;
            try { estado = new JSONObject(p.GetString("estado", "{}")); } catch (Exception) { estado = new JSONObject(); }
            var resumo = estado.OptJSONObject("summary");
            if (resumo != null) o.Put("resumo", resumo);
            var abertos = new List<JSONObject>();
            var ts = estado.OptJSONObject("tickets");
            if (ts != null)
                foreach (var id in ts.Keys)
                {
                    var t = ts.OptJSONObject(id);
                    if (t != null && Engine.IsActive(t.OptString("status"))) abertos.Add(new JSONObject(t.ToString()).Put("id", id));
                }
            var arr = new JSONArray();
            foreach (var t in abertos.OrderByDescending(x => x.OptString("updated"), StringComparer.Ordinal).Take(40)) arr.Put(t);
            o.Put("abertos", arr);
            return o;
        }

        static JSONArray Lista(string s) { try { return new JSONArray(s); } catch (Exception) { return new JSONArray(); } }

        public static void MarcarVisto() { P.Edit().Put("visto", Relogio.Agora()).Commit(); }

        public static int NaoVistos()
        {
            long visto = P.GetLong("visto");
            var feed = Lista(P.GetString("feed", "[]"));
            int n = 0;
            for (int i = 0; i < feed.Length; i++)
            {
                var f = feed.OptJSONObject(i);
                if (f != null && f.OptLong("t") > visto && !f.OptBoolean("meu")) n++;
            }
            return n;
        }

        public static void Diag(string texto)
        {
            lock (forcar)
            {
                var arr = Lista(P.GetString("diag", "[]"));
                var novo = new JSONArray().Put(new JSONObject().Put("t", Relogio.Agora()).Put("x", texto.Length > 600 ? texto.Substring(0, 600) : texto));
                for (int i = 0; i < Math.Min(arr.Length, 49); i++) novo.Put(arr.Get(i));
                P.Edit().Put("diag", novo.ToString()).Commit();
            }
        }

        public static string TextoDiagnostico()
        {
            var sb = new StringBuilder();
            sb.Append("Freedom para Windows ").Append(Api.Versao).Append(" · ").Append(Environment.OSVersion).Append('\n');
            sb.Append("Avisos: ").Append(Ativo() ? "ligados" : "DESLIGADOS").Append(" · a cada ").Append(IntervaloSeg()).Append(" s")
              .Append(" · minhas ações: ").Append(MinhasAcoes() ? "avisa" : "não avisa").Append('\n');
            var arr = Lista(P.GetString("diag", "[]"));
            for (int i = 0; i < arr.Length; i++)
            {
                var o = arr.OptJSONObject(i);
                if (o == null) continue;
                sb.Append(DateTimeOffset.FromUnixTimeMilliseconds(o.OptLong("t")).ToLocalTime().ToString("dd/MM HH:mm:ss"))
                  .Append("  ").Append(o.OptString("x")).Append('\n');
            }
            return sb.ToString();
        }
    }
}
