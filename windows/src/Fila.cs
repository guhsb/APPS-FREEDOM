using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Freedom
{
    /// <summary>Avisos gerais que aparecem perto do relógio (fila enviada, metas…). A janela mostra.</summary>
    public static class Avisos
    {
        /// <summary>(título, texto, caminho do site ou "painel:id" ou null)</summary>
        public static event Action<string, string, string> Mostrar;
        public static void Enviar(string titulo, string texto, string caminho) { var m = Mostrar; if (m != null) try { m(titulo, texto, caminho); } catch (Exception) { } }
    }

    /// <summary>
    /// Sem internet (igual ao Fila.kt do Android): guarda resposta/chamado novo para enviar quando a internet voltar
    /// e guarda a última resposta das consultas do Helpdesk para mostrar as telas offline.
    /// </summary>
    public static class Fila
    {
        static readonly object trava = new object();
        static Prefs P { get { return Prefs.De("fila"); } }
        static int enviando;

        public static bool Online() { try { return NetworkInterface.GetIsNetworkAvailable(); } catch (Exception) { return true; } }

        /// <summary>Erro de rede (sem sinal, site fora, tempo esgotado) — não é erro do site nem de login.</summary>
        public static bool SemInternet(Exception e)
        {
            if (!Online()) return true;
            for (var x = e; x != null; x = x.InnerException)
            {
                var w = x as System.Net.WebException;
                if (w != null && w.Response == null &&
                    (w.Status == System.Net.WebExceptionStatus.NameResolutionFailure || w.Status == System.Net.WebExceptionStatus.ConnectFailure ||
                     w.Status == System.Net.WebExceptionStatus.Timeout || w.Status == System.Net.WebExceptionStatus.ConnectionClosed ||
                     w.Status == System.Net.WebExceptionStatus.ReceiveFailure || w.Status == System.Net.WebExceptionStatus.SendFailure ||
                     w.Status == System.Net.WebExceptionStatus.KeepAliveFailure || w.Status == System.Net.WebExceptionStatus.ProxyNameResolutionFailure))
                    return true;
                if (x is System.Net.Sockets.SocketException || x is TimeoutException) return true;
            }
            return false;
        }

        static JSONArray Ler() { try { return new JSONArray(P.GetString("itens", "[]")); } catch (Exception) { return new JSONArray(); } }
        static void Gravar(JSONArray a) { P.Edit().Put("itens", a.ToString()).Commit(); }

        public static int Quantos() { lock (trava) return Ler().Length; }

        public static JSONArray DoChamado(int id)
        {
            var r = new JSONArray();
            JSONArray a; lock (trava) a = Ler();
            for (int i = 0; i < a.Length; i++)
            {
                var x = a.OptJSONObject(i);
                if (x != null && x.OptString("tipo") == "resposta" && x.OptInt("chamado") == id)
                    r.Put(new JSONObject().Put("texto", x.OptString("texto")).Put("criado", x.OptLong("criado")));
            }
            return r;
        }

        public static void AdicionarResposta(int id, string texto)
        {
            Adicionar(new JSONObject().Put("tipo", "resposta").Put("chamado", (long)id).Put("texto", texto));
        }

        public static void AdicionarChamado(string corpo)
        {
            string titulo = ""; try { titulo = new JSONObject(corpo).OptString("title"); } catch (Exception) { }
            Adicionar(new JSONObject().Put("tipo", "novo").Put("corpo", corpo).Put("titulo", titulo));
        }

        static void Adicionar(JSONObject item)
        {
            lock (trava)
            {
                var a = Ler();
                a.Put(item.Put("criado", Relogio.Agora()).Put("uid", Guid.NewGuid().ToString("N")));
                Gravar(a);
            }
            Helpdesk.AvisarTela();
        }

        /// <summary>Tenta mandar tudo o que está guardado; para no primeiro erro de internet.</summary>
        public static void Enviar()
        {
            if (Quantos() == 0 || !Online()) return;
            if (Interlocked.CompareExchange(ref enviando, 1, 0) != 0) return;
            try
            {
                while (true)
                {
                    JSONObject item; lock (trava) item = Ler().OptJSONObject(0);
                    if (item == null) break;
                    bool tirar = true;
                    try
                    {
                        if (item.OptString("tipo") == "resposta")
                        {
                            int id = item.OptInt("chamado");
                            bool semNet;
                            var r = Chamado.ResponderAgora(id, item.OptString("texto"), out semNet);
                            if (semNet) tirar = false;
                            else Avisos.Enviar(r.Ok ? "Resposta enviada" : "Não deu para enviar a resposta",
                                r.Ok ? "Sua resposta guardada sem internet foi enviada no chamado #" + id + "." : r.Mensagem + " (chamado #" + id + ")",
                                "/helpdesk/tickets/" + id);
                        }
                        else if (item.OptString("tipo") == "novo")
                        {
                            var r = Chamado.RequisicaoDireta("POST", "/helpdesk/tickets", item.OptString("corpo"));
                            if (r == null) tirar = false;
                            else
                            {
                                bool ok = r.Status >= 200 && r.Status < 300;
                                JSONObject novo = null; if (ok) try { novo = new JSONObject(r.Body); } catch (Exception) { }
                                var prot = novo != null ? novo.OptString("protocol") : "";
                                Avisos.Enviar(ok ? "Chamado aberto" + (prot.Length > 0 ? " · " + prot : "") : "Não deu para abrir o chamado",
                                    ok ? "O chamado \"" + item.OptString("titulo") + "\", guardado sem internet, foi aberto."
                                       : "\"" + item.OptString("titulo") + "\": o site recusou (HTTP " + r.Status + "). Abra de novo pelo app.",
                                    novo != null && novo.OptLong("id") > 0 ? "/helpdesk/tickets/" + novo.OptLong("id") : null);
                            }
                        }
                    }
                    catch (Exception) { tirar = false; }
                    if (!tirar) break;
                    lock (trava)
                    {
                        var a = Ler(); var b = new JSONArray();
                        for (int i = 0; i < a.Length; i++) { var x = a.OptJSONObject(i); if (x != null && x.OptString("uid") != item.OptString("uid")) b.Put(x); }
                        Gravar(b);
                    }
                    Helpdesk.AvisarTela();
                }
            }
            finally { Interlocked.Exchange(ref enviando, 0); }
        }

        public static void Limpar()
        {
            lock (trava) Gravar(new JSONArray());
            try { var d = Pastas.Sub("offline"); foreach (var f in Directory.GetFiles(d)) File.Delete(f); } catch (Exception) { }
        }

        // ---- respostas guardadas (para ver offline) ----
        static string Arquivo(string chave)
        {
            using (var sha = SHA1.Create())
            {
                var h = string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(chave)).Select(b => b.ToString("x2")));
                return Path.Combine(Pastas.Sub("offline"), h + ".json");
            }
        }

        public static void Guardar(string chave, string corpo)
        {
            try { File.WriteAllText(Arquivo(chave), new JSONObject().Put("t", Relogio.Agora()).Put("b", corpo).ToString(), new UTF8Encoding(false)); } catch (Exception) { }
        }

        /// <summary>(hora, corpo) ou null.</summary>
        public static KeyValuePair<long, string>? Guardado(string chave)
        {
            try
            {
                var f = Arquivo(chave);
                if (!File.Exists(f)) return null;
                var o = new JSONObject(File.ReadAllText(f, Encoding.UTF8));
                return new KeyValuePair<long, string>(o.OptLong("t"), o.OptString("b"));
            }
            catch (Exception) { return null; }
        }
    }

    /// <summary>Avisos de meta do painel Comercial (igual ao AvisosMeta.kt do Android).</summary>
    public static class Metas
    {
        static Prefs P { get { return Prefs.De("metas"); } }
        public static bool Ligado() { return P.GetBool("ligado", true); }
        public static void Ligar(bool sim) { P.Edit().Put("ligado", sim).Commit(); }

        /// <summary>Para não virar spam: tudo de uma atualização vira UM aviso; nada entre 19 h e 8 h; no máximo 8 por dia.</summary>
        public static List<string[]> Regular(List<string[]> avisos, string painel = "")
        {
            var vazio = new List<string[]>();
            if (avisos == null || avisos.Count == 0) return vazio;
            if (painel == "faturamento") return avisos;     // Faturamento de hoje: horário próprio (17:30–20:00), fora do limite do dia
            var agora = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zona());
            if (agora.Hour < 8 || agora.Hour >= 19) return vazio;
            var k = "qtd_" + agora.ToString("yyyy-MM-dd");
            long qtd = P.GetLong(k);
            if (qtd >= 8) return vazio;
            P.Edit().Put(k, qtd + 1).Commit();
            if (avisos.Count == 1) return avisos;
            return new List<string[]> { new[] { avisos.Count + " novidades do painel",
                string.Join("\n", avisos.Select(a => "• " + a[0] + (a[1].Length > 0 ? ": " + a[1] : ""))) } };
        }

        /// <summary>Registro dos avisos de um mês (igual ao Metas.Registro do Android).</summary>
        sealed class Reg
        {
            readonly Prefs p; readonly Prefs.Editor ed; readonly string mes; readonly HashSet<string> marcadas = new HashSet<string>();
            public readonly bool Primeira;
            public Reg(string mes) { p = P; ed = p.Edit(); this.mes = mes; Primeira = !p.GetBool("base_" + mes, false); }
            public bool Marcar(string k) { if (p.GetBool(k, false) || marcadas.Contains(k)) return false; marcadas.Add(k); ed.Put(k, true); return !Primeira; }
            public bool Tem(string k) { return p.GetBool(k, false); }
            public void Por(string k) { ed.Put(k, true); }
            public void Tirar(string k) { ed.Remove(k); }
            public double? Valor(string k) { var s = p.GetString(k); double v; return s != null && double.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out v) ? v : (double?)null; }
            public void Guardar(string k, double v) { ed.Put(k, v.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
            public void Fechar() { ed.Put("base_" + mes, true).Commit(); }
        }

        /// <summary>Horário agendado (ex.: "10:00") em que estamos: o último já passado, até "fim"; null fora disso.</summary>
        public static string Faixa(string[] horarios, string fim, int h, int m)
        {
            Func<string, int> min = x => int.Parse(x.Substring(0, 2)) * 60 + int.Parse(x.Substring(3, 2));
            int agora = h * 60 + m;
            if (agora > min(fim)) return null;
            return horarios.LastOrDefault(x => min(x) <= agora);
        }
        public static string FaixaFaturamento(int h, int m) { return Faixa(new[] { "11:30", "15:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00" }, "20:14", h, m); }

        /// <summary>"Faturamento de hoje" às 11:30 e 15:00 e de 30 em 30 minutos das 17:30 às 20:00 (dias úteis), com quanto entrou desde o aviso anterior.</summary>
        public static List<string[]> Faturamento(JSONObject d)
        {
            var out_ = new List<string[]>();
            var agora = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zona());
            if (agora.DayOfWeek == DayOfWeek.Saturday || agora.DayOfWeek == DayOfWeek.Sunday) return out_;
            var faixa = FaixaFaturamento(agora.Hour, agora.Minute); if (faixa == null) return out_;
            var dia = agora.ToString("yyyy-MM-dd");
            var dd = d.OptJSONObject("dia");
            if (dd == null || dd.OptString("data") != dia || N(dd, "valor") <= 0) return out_;
            var r = new Reg(dia.Substring(0, 7));
            if (r.Marcar("fat_" + dia + "_" + faixa))
            {
                double v = N(dd, "valor"); var antes = r.Valor("fatv_" + dia);
                var desde = antes != null && v > antes.Value ? " (+" + BrlK(v - antes.Value) + " desde o último aviso)" : "";
                out_.Add(new[] { "Faturamento de hoje: " + BrlK(v), Math.Round(N(dd, "pedidos")) + " pedidos faturados até " + faixa + desde + ". No mês: " + BrlK(N(d.OptJSONObject("mes"), "valor")) + "." });
                r.Guardar("fatv_" + dia, v);
            }
            r.Fechar();
            return out_;
        }

        static TimeZoneInfo Zona()
        {
            foreach (var id in new[] { "E. South America Standard Time", "America/Sao_Paulo" })
                try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch (Exception) { }
            return TimeZoneInfo.Local;
        }

        static double N(JSONObject o, string k)
        {
            if (o == null || !o.Has(k) || o.IsNull(k)) return 0;
            double d = o.OptDouble(k, double.NaN);
            return double.IsNaN(d) ? 0 : d;
        }

        static string Pct(double v) { return v.ToString("0.0", new System.Globalization.CultureInfo("pt-BR")) + "%"; }
        static string BrlK(double v)
        {
            var br = new System.Globalization.CultureInfo("pt-BR");
            if (v >= 1e7) return "R$ " + (v / 1e6).ToString("0.#", br) + " mi";
            if (v >= 1e6) return "R$ " + (v / 1e6).ToString("0.##", br) + " mi";
            if (v >= 1e3) return "R$ " + (v / 1e3).ToString("0.#", br) + " mil";
            return "R$ " + v.ToString("N2", br);
        }

        /// <summary>Avisos do gestor sobre cada vendedor (juntando num aviso só quando são vários): acima da média hoje,
        /// sem venda hoje (15 h+, se a equipe já vendeu hoje), abaixo do ritmo (14 h+, uma vez por dia), positivação batida (uma vez no mês).</summary>
        static void Equipe(JSONObject d, JSONArray vs, DateTime agora, Func<string, bool> marcar, List<string[]> out_)
        {
            var dia = agora.ToString("yyyy-MM-dd"); var mes = dia.Substring(0, 7);
            bool util = agora.DayOfWeek != DayOfWeek.Saturday && agora.DayOfWeek != DayOfWeek.Sunday;
            double dec = N(d, "dec"), idealP = N(d, "idealP");
            var lista = new List<JSONObject>();
            for (int i = 0; i < vs.Length; i++) { var v = vs.OptJSONObject(i); if (v != null) lista.Add(v); }
            Action<string, string, List<string[]>> junta = (um, varios, itens) =>
            {
                if (itens.Count == 1) out_.Add(new[] { itens[0][0] + " " + um, itens[0][1] });
                else if (itens.Count > 1) out_.Add(new[] { itens.Count + " vendedores " + varios,
                    string.Join(" · ", itens.Select(x => x[0] + (x[1].Length > 0 ? " (" + x[1].Split(new[] { " · " }, StringSplitOptions.None)[0] + ")" : ""))) });
            };
            var acima = new List<string[]>(); var sem = new List<string[]>(); var ritmo = new List<string[]>(); var pos = new List<string[]>();
            foreach (var v in lista)
            {
                var nome = v.OptString("nome");
                if (d.OptBoolean("temHoje") && util)
                {
                    double h = N(v, "hoje"), media = dec > 0 ? N(v, "valor") / dec : 0;
                    if (h > 0 && media > 0 && h >= media * 1.5 && marcar("acima_" + dia + "_" + nome))
                        acima.Add(new[] { nome, BrlK(h) + " hoje · média de " + BrlK(media) + " por dia" });
                    if (agora.Hour >= 15 && N(d, "hojeEquipe") > 0 && N(v, "meta") > 0 && h <= 0 && marcar("semvenda_" + dia + "_" + nome))
                        sem.Add(new[] { nome, "" });
                }
                if (util && agora.Hour >= 14 && N(v, "meta") > 0 && N(v, "valor") < N(v, "meta") && N(v, "p") < idealP - 0.10 && marcar("ritmo_" + dia + "_" + nome))
                    ritmo.Add(new[] { nome, Pct(N(v, "p") * 100) + " da meta · ideal " + Pct(idealP * 100) });
                if (N(v, "metaPos") > 0 && N(v, "pos") >= N(v, "metaPos") && marcar("pos_" + mes + "_" + nome))
                    pos.Add(new[] { nome, Math.Round(N(v, "pos")) + " de " + Math.Round(N(v, "metaPos")) + " clientes positivados" });
            }
            junta("vendeu acima da média hoje", "acima da média hoje", acima);
            junta("está sem venda hoje", "sem venda hoje", sem);
            junta("está abaixo do ritmo", "abaixo do ritmo", ritmo);
            junta("bateu a meta de positivação", "bateram a positivação", pos);
        }

        /// <summary>Marcos da meta (50/75/90%) e "voltou ao ritmo" — precisam ler e guardar estado.</summary>
        static void MarcosERitmo(JSONObject d, JSONArray vs, string mes, Func<string, bool> marcar, Prefs p, Prefs.Editor ed, bool primeira, List<string[]> out_)
        {
            double idealP = N(d, "idealP");
            var marcos = new List<string>(); var voltou = new List<string[]>();
            for (int i = 0; i < vs.Length; i++)
            {
                var v = vs.OptJSONObject(i); if (v == null || N(v, "meta") <= 0) continue;
                var nome = v.OptString("nome"); double pp = N(v, "p");
                int novo = 0;
                foreach (var m in new[] { 50, 75, 90 }) if (pp >= m / 100.0 && marcar("marco_" + mes + "_" + m + "_" + nome)) novo = m;
                if (novo > 0 && pp < 1) marcos.Add(nome + " passou de " + novo + "% (" + Pct(pp * 100) + ")");
                var k = "baixo_" + mes + "_" + nome;
                if (pp < idealP - 0.10) ed.Put(k, true);
                else if (pp >= idealP && p.GetBool(k, false)) { ed.Remove(k); if (!primeira) voltou.Add(new[] { nome, Pct(pp * 100) + " da meta · ideal " + Pct(idealP * 100) }); }
            }
            if (marcos.Count == 1) out_.Add(new[] { marcos[0].Split('(')[0].Trim() + " da meta", marcos[0] });
            else if (marcos.Count > 1) out_.Add(new[] { marcos.Count + " vendedores passaram de marcos da meta", string.Join(" · ", marcos) });
            if (voltou.Count == 1) out_.Add(new[] { voltou[0][0] + " voltou ao ritmo", voltou[0][1] });
            else if (voltou.Count > 1) out_.Add(new[] { voltou.Count + " vendedores voltaram ao ritmo", string.Join(" · ", voltou.Select(x => x[0])) });
        }

        static double? VendaDoDia(JSONObject m, string dia)
        {
            var dd = m.OptJSONArray("diario"); if (dd == null) return null;
            for (int i = 0; i < dd.Length; i++) { var x = dd.OptJSONObject(i); if (x != null && x.OptString("d") == dia) return N(x, "v"); }
            return null;
        }

        /// <summary>Os mesmos avisos do gestor, mas só com os números do próprio vendedor.</summary>
        static void Pessoal(JSONObject m, JSONObject s, DateTime agora, Func<string, bool> marcar, Prefs p, Prefs.Editor ed, bool primeira, List<string[]> out_)
        {
            var dia = agora.ToString("yyyy-MM-dd"); var mes = dia.Substring(0, 7);
            bool util = agora.DayOfWeek != DayOfWeek.Saturday && agora.DayOfWeek != DayOfWeek.Sunday;
            double meta = N(m, "meta"), pp = N(m, "p"), idealP = N(m, "idealP"), rest = N(m, "rest"), dec = N(m, "dec");
            var hojeV = VendaDoDia(m, dia);
            if (util && agora.Hour >= 8 && agora.Hour <= 11 && marcar("eu_manha_" + dia))
            {
                JSONObject ontem = null; var dd = m.OptJSONArray("diario");
                if (dd != null) for (int i = 0; i < dd.Length; i++)
                {
                    var x = dd.OptJSONObject(i); if (x == null) continue; var dt = x.OptString("d");
                    if (dt.Length != 10 || string.CompareOrdinal(dt, dia) >= 0) continue;
                    var dw = DateTime.ParseExact(dt, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture).DayOfWeek;
                    if (dw != DayOfWeek.Saturday && dw != DayOfWeek.Sunday) ontem = x;
                }
                var t = "";
                if (ontem != null) { var od = ontem.OptString("d"); t += "Ontem (" + od.Substring(8, 2) + "/" + od.Substring(5, 2) + ") você vendeu " + BrlK(N(ontem, "v")) + ". "; }
                t += "No mês: " + BrlK(N(m, "valor"));
                if (meta > 0) { t += " (" + Pct(pp * 100) + " da meta; ideal " + Pct(idealP * 100) + ")."; if (N(m, "falta") > 0 && rest > 0) t += " Para bater: " + BrlK(N(m, "porDia")) + " por dia útil."; }
                else t += ".";
                if (s != null && N(s, "meta") > 0) t += " Semana: " + BrlK(N(s, "valor")) + " de " + BrlK(N(s, "meta")) + ".";
                out_.Add(new[] { "Bom dia! Seu resumo", t });
            }
            if (meta <= 0) return;
            var fx = util ? Faixa(new[] { "10:00", "12:00", "14:00", "16:00" }, "17:59", agora.Hour, agora.Minute) : null;
            if (fx != null && marcar("eu_ritmo_" + dia + "_" + fx))
            {
                double dif = N(m, "valor") - N(m, "ideal");
                var t = Pct(pp * 100) + " da meta (ideal " + Pct(idealP * 100) + ") · " + (dif >= 0 ? BrlK(dif) + " acima do ideal" : BrlK(-dif) + " abaixo do ideal");
                if (hojeV != null) t += " · hoje: " + BrlK(hojeV.Value);
                if (N(m, "falta") > 0 && rest > 0) t += " · para bater: " + BrlK(N(m, "porDia")) + " por dia útil";
                out_.Add(new[] { "Seu ritmo às " + fx, t });
            }
            if (util && pp < 1 && rest >= 1 && rest <= 3 && marcar("eu_reta_" + dia))
                out_.Add(new[] { "Reta final: " + Math.Round(rest) + (rest == 1 ? " dia útil" : " dias úteis"), "Faltam " + BrlK(N(m, "falta")) + " para a sua meta de " + BrlK(meta) + ": " + BrlK(N(m, "porDia")) + " por dia útil." });
            int novo = 0;
            foreach (var k in new[] { 50, 75, 90 }) if (pp >= k / 100.0 && marcar("eu_marco_" + mes + "_" + k)) novo = k;
            if (novo > 0 && pp < 1) out_.Add(new[] { "Você passou de " + novo + "% da meta!", "Já são " + BrlK(N(m, "valor")) + " (" + Pct(pp * 100) + " da meta de " + BrlK(meta) + ")." });
            var kb = "eu_baixo_" + mes;
            if (pp < idealP - 0.10) ed.Put(kb, true);
            else if (pp >= idealP && p.GetBool(kb, false)) { ed.Remove(kb); if (!primeira) out_.Add(new[] { "Você voltou ao ritmo!", Pct(pp * 100) + " da meta; o ideal hoje é " + Pct(idealP * 100) + ". Continue assim." }); }
            if (util && hojeV != null && dec > 0 && N(m, "valor") > 0 && hojeV.Value >= 1.5 * N(m, "valor") / dec && marcar("eu_acima_" + dia))
                out_.Add(new[] { "Hoje você vendeu acima da sua média!", BrlK(hojeV.Value) + " hoje · sua média é " + BrlK(N(m, "valor") / dec) + " por dia." });
            if (N(m, "metaPos") > 0 && N(m, "pos") >= N(m, "metaPos") && marcar("eu_pos_" + mes))
                out_.Add(new[] { "Você bateu a meta de positivação!", Math.Round(N(m, "pos")) + " de " + Math.Round(N(m, "metaPos")) + " clientes positivados no mês." });
        }

        /// <summary>Resumo da manhã (8–11 h) e reta final do mês (últimos 3 dias úteis), para gestor/diretor.</summary>
        static void Resumos(JSONObject d, DateTime agora, Func<string, bool> marcar, List<string[]> out_)
        {
            if (agora.DayOfWeek == DayOfWeek.Saturday || agora.DayOfWeek == DayOfWeek.Sunday) return;
            var dia = agora.ToString("yyyy-MM-dd"); double meta = N(d, "meta"), rest = N(d, "rest");
            if (agora.Hour >= 8 && agora.Hour <= 11 && marcar("manha_" + dia))
            {
                JSONObject ontem = null; var dd = d.OptJSONArray("diario");
                if (dd != null) for (int i = 0; i < dd.Length; i++)
                {
                    var x = dd.OptJSONObject(i); if (x == null) continue; var dt = x.OptString("d");
                    if (dt.Length != 10 || string.CompareOrdinal(dt, dia) >= 0) continue;
                    var dw = DateTime.ParseExact(dt, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture).DayOfWeek;
                    if (dw != DayOfWeek.Saturday && dw != DayOfWeek.Sunday) ontem = x;
                }
                var t = "";
                if (ontem != null) { var od = ontem.OptString("d"); t += "Ontem (" + od.Substring(8, 2) + "/" + od.Substring(5, 2) + ") a equipe vendeu " + BrlK(N(ontem, "v")) + ". "; }
                t += "No mês: " + BrlK(N(d, "valor"));
                if (meta > 0) { t += " (" + Pct(N(d, "p") * 100) + " da meta; ideal " + Pct(N(d, "idealP") * 100) + ")."; if (N(d, "falta") > 0 && rest > 0) t += " Para bater: " + BrlK(N(d, "porDia")) + " por dia útil."; }
                else t += ".";
                out_.Add(new[] { "Bom dia! Resumo da equipe", t });
            }
            // ritmo da equipe 4x por dia (10 h, 12 h, 14 h, 16 h)
            var fx = Faixa(new[] { "10:00", "12:00", "14:00", "16:00" }, "17:59", agora.Hour, agora.Minute);
            if (fx != null && meta > 0 && marcar("ritmoeq_" + dia + "_" + fx))
            {
                double dif = N(d, "valor") - N(d, "ideal");
                var t = Pct(N(d, "p") * 100) + " da meta (ideal " + Pct(N(d, "idealP") * 100) + ") · " + (dif >= 0 ? BrlK(dif) + " acima do ideal" : BrlK(-dif) + " abaixo do ideal");
                if (d.OptBoolean("temHoje")) t += " · hoje: " + BrlK(N(d, "hojeEquipe"));
                if (N(d, "falta") > 0 && rest > 0) t += " · para bater: " + BrlK(N(d, "porDia")) + " por dia útil";
                out_.Add(new[] { "Ritmo da equipe às " + fx, t });
            }
            if (meta > 0 && N(d, "p") < 1 && rest >= 1 && rest <= 3 && marcar("reta_" + dia))
            {
                var vs = d.OptJSONArray("vendedores"); var perto = new List<JSONObject>();
                if (vs != null) for (int i = 0; i < vs.Length; i++) { var v = vs.OptJSONObject(i); if (v != null && N(v, "meta") > 0 && N(v, "p") >= 0.8 && N(v, "p") < 1) perto.Add(v); }
                var ps = string.Join(", ", perto.OrderByDescending(v => N(v, "p")).Take(4).Select(v => v.OptString("nome") + " (" + Pct(N(v, "p") * 100) + ")"));
                out_.Add(new[] { "Reta final: " + Math.Round(rest) + (rest == 1 ? " dia útil" : " dias úteis"),
                    "Faltam " + BrlK(N(d, "falta")) + " para a meta de " + BrlK(meta) + ": " + BrlK(N(d, "porDia")) + " por dia útil." + (ps.Length > 0 ? " Perto de bater: " + ps + "." : "") });
            }
        }

        public static List<string[]> Calcular(JSONObject d)
        {
            var out_ = new List<string[]>();
            if (d.Has("periodo")) return out_;
            var agora = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zona());
            var hoje = agora.Date;
            var mes = hoje.ToString("yyyy-MM");
            bool tarde = agora.Hour >= 14 && hoje.DayOfWeek != DayOfWeek.Saturday && hoje.DayOfWeek != DayOfWeek.Sunday;
            var p = P;
            bool primeira = !p.GetBool("base_" + mes, false);
            var ed = p.Edit();
            var marcadas = new HashSet<string>();
            Func<string, bool> marcar = k =>
            {
                if (p.GetBool(k, false) || marcadas.Contains(k)) return false;
                marcadas.Add(k); ed.Put(k, true);
                return !primeira;
            };
            Action<JSONObject, string> abaixo = (o, quem) =>
            {
                double pp = N(o, "p"), ideal = N(o, "idealP");
                if (!tarde || N(o, "meta") <= 0 || pp >= ideal - 0.10 || N(o, "rest") <= 0) return;
                if (!marcar("abaixo_" + hoje.ToString("yyyy-MM-dd"))) return;
                out_.Add(new[] { quem + " abaixo do ideal do mês",
                    "Vendido " + Pct(pp * 100) + " da meta; o ideal hoje é " + Pct(ideal * 100) + ". Para bater a meta de " + BrlK(N(o, "meta")) +
                    ", faltam " + BrlK(N(o, "falta")) + ": " + BrlK(N(o, "porDia")) + " por dia útil (" + Math.Round(N(o, "rest")) + " dias)." });
            };
            if (d.OptString("tipo") == "vendedor")
            {
                var s = d.OptJSONObject("semana"); var m = d.OptJSONObject("mes");
                if (s != null && N(s, "meta") > 0 && N(s, "p") >= 1 && marcar("sem_" + mes + "_" + s.OptString("titulo")))
                    out_.Add(new[] { "Meta da semana batida!", "Você vendeu " + BrlK(N(s, "valor")) + " na semana (" + Pct(N(s, "p") * 100) + " da meta de " + BrlK(N(s, "meta")) + ")." });
                if (m != null)
                {
                    if (N(m, "meta") > 0 && N(m, "p") >= 1) { if (marcar("mes_" + mes)) out_.Add(new[] { "Meta do mês batida!", "Você vendeu " + BrlK(N(m, "valor")) + " no mês (" + Pct(N(m, "p") * 100) + " da meta de " + BrlK(N(m, "meta")) + ")." }); }
                    Pessoal(m, s, agora, marcar, p, ed, primeira, out_);
                }
            }
            else
            {
                if (N(d, "meta") > 0 && N(d, "p") >= 1) { if (marcar("mes_" + mes)) out_.Add(new[] { "Meta do mês batida!", "A equipe faturou " + BrlK(N(d, "valor")) + " (" + Pct(N(d, "p") * 100) + " da meta de " + BrlK(N(d, "meta")) + ")." }); }
                else abaixo(d, "Equipe");
                var vs = d.OptJSONArray("vendedores"); var bateram = new List<string>();
                if (vs != null) for (int i = 0; i < vs.Length; i++)
                {
                    var v = vs.OptJSONObject(i); if (v == null) continue;
                    if (N(v, "meta") > 0 && N(v, "valor") >= N(v, "meta") && marcar("vend_" + mes + "_" + v.OptString("nome"))) bateram.Add(v.OptString("nome"));
                }
                if (bateram.Count == 1) out_.Add(new[] { bateram[0] + " bateu a meta do mês", "Parabéns! Veja o ranking no painel Comercial." });
                else if (bateram.Count > 1) out_.Add(new[] { bateram.Count + " vendedores bateram a meta", string.Join(", ", bateram) });
                if (vs != null) Equipe(d, vs, agora, marcar, out_);
                if (vs != null) MarcosERitmo(d, vs, mes, marcar, p, ed, primeira, out_);
                Resumos(d, agora, marcar, out_);
            }
            ed.Put("base_" + mes, true).Commit();
            return out_;
        }
    }
}
