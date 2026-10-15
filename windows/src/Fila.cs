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
        /// <summary>Regula e garante que todo aviso tenha uma linha de texto embaixo do título.</summary>
        public static List<string[]> Regular(List<string[]> avisos, string painel = "")
        {
            var hora = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zona()).ToString("HH:mm");
            var padrao = painel == "faturamento" ? "Atualizado às " + hora : "Toque para abrir o painel";
            return RegularBruto(avisos, painel).Select(a => new[] { a[0], a.Length > 1 && !string.IsNullOrWhiteSpace(a[1]) ? a[1] : padrao }).ToList();
        }

        static List<string[]> RegularBruto(List<string[]> avisos, string painel)
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
            // "solo" (acima / abaixo do ritmo) sai como aviso próprio; o resto vira um aviso só, com os títulos
            var solo = avisos.Where(a => a.Length > 2 && a[2] == "solo").Select(a => new[] { a[0], a[1] }).ToList();
            var resto = avisos.Where(a => !(a.Length > 2 && a[2] == "solo")).ToList();
            if (resto.Count > 1) solo.Add(new[] { resto.Count + " novidades do painel", string.Join("\n", resto.Select(a => "• " + a[0])) });
            else solo.AddRange(resto);
            return solo;
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
                out_.Add(new[] { "Faturamento hoje: " + BrlK(v), "R$ " + v.ToString("N2", new System.Globalization.CultureInfo("pt-BR")) + " · até " + agora.ToString("HH:mm") });
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

        static string P0(double v) { return Math.Round(v * 100) + "%"; }
        static string Hh(string fx) { return fx.EndsWith(":00") ? int.Parse(fx.Substring(0, 2)) + "h" : fx.Replace(":", "h"); }
        static string Dias(double rest) { return Math.Round(rest) + (rest == 1 ? " dia útil" : " dias úteis"); }
        static readonly string[] RITMO = { "10:00", "12:00", "14:00", "16:00" };
        static bool Util(DateTime t) { return t.DayOfWeek != DayOfWeek.Saturday && t.DayOfWeek != DayOfWeek.Sunday; }

        /// <summary>Avisos do gestor sobre cada vendedor (juntando num aviso só quando são vários), só com os nomes.</summary>
        static void Equipe(JSONObject d, JSONArray vs, DateTime agora, string mes, Func<string, bool> marcar, Prefs p, Prefs.Editor ed, bool primeira, List<string[]> out_)
        {
            var dia = agora.ToString("yyyy-MM-dd");
            bool util = Util(agora);
            double dec = N(d, "dec"), idealP = N(d, "idealP");
            var lista = new List<JSONObject>();
            for (int i = 0; i < vs.Length; i++) { var v = vs.OptJSONObject(i); if (v != null) lista.Add(v); }
            Action<string, string, List<string>> junta = (um, varios, nomes) =>
            {
                if (nomes.Count == 1) out_.Add(new[] { nomes[0] + " " + um, "" });
                else if (nomes.Count > 1) out_.Add(new[] { nomes.Count + " vendedores " + varios, string.Join(", ", nomes) });
            };
            var acima = new List<string>(); var sem = new List<string>(); var pos = new List<string>(); var voltou = new List<string>();
            var marcos = new List<string[]>();
            foreach (var v in lista)
            {
                var nome = v.OptString("nome"); double pp = N(v, "p");
                if (d.OptBoolean("temHoje") && util)
                {
                    double h = N(v, "hoje"), media = dec > 0 ? N(v, "valor") / dec : 0;
                    if (h > 0 && media > 0 && h >= media * 1.5 && marcar("acima_" + dia + "_" + nome)) acima.Add(nome);
                    if (agora.Hour >= 15 && N(d, "hojeEquipe") > 0 && N(v, "meta") > 0 && h <= 0 && marcar("semvenda_" + dia + "_" + nome)) sem.Add(nome);
                }
                if (N(v, "meta") > 0)
                {
                    int novo = 0;
                    foreach (var m in new[] { 50, 75, 90 }) if (pp >= m / 100.0 && marcar("marco_" + mes + "_" + m + "_" + nome)) novo = m;
                    if (novo > 0 && pp < 1) marcos.Add(new[] { nome, novo.ToString() });
                    var k = "baixo_" + mes + "_" + nome;
                    if (pp < idealP - 0.10) ed.Put(k, true);
                    else if (pp >= idealP && p.GetBool(k, false)) { ed.Remove(k); if (!primeira) voltou.Add(nome); }
                }
                if (N(v, "metaPos") > 0 && N(v, "pos") >= N(v, "metaPos") && marcar("pos_" + mes + "_" + nome)) pos.Add(nome);
            }
            junta("vendeu acima da média hoje", "acima da média hoje", acima);
            junta("está sem venda hoje", "sem venda hoje", sem);
            if (marcos.Count == 1) out_.Add(new[] { marcos[0][0] + " passou de " + marcos[0][1] + "% da meta", "" });
            else if (marcos.Count > 1) out_.Add(new[] { marcos.Count + " vendedores passaram de marcos da meta", string.Join(", ", marcos.Select(x => x[0] + " " + x[1] + "%")) });
            junta("voltou ao ritmo", "voltaram ao ritmo", voltou);
            junta("bateu a positivação", "bateram a positivação", pos);
            // às 10, 12, 14 e 16 h: quem está acima e quem está abaixo do ritmo (dois avisos, só nomes)
            var fx = util ? Faixa(RITMO, "17:59", agora.Hour, agora.Minute) : null;
            if (fx != null && marcar("ritmoeq_" + dia + "_" + fx))
            {
                var com = idealP > 0 ? lista.Where(v => N(v, "meta") > 0).ToList() : new List<JSONObject>();
                var cima = com.Where(v => N(v, "p") >= idealP).OrderByDescending(v => N(v, "p")).Select(v => v.OptString("nome")).ToList();
                var baixo = com.Where(v => N(v, "p") < idealP).OrderBy(v => N(v, "p")).Select(v => v.OptString("nome")).ToList();
                if (cima.Count > 0) out_.Add(new[] { "Acima do ritmo (" + Hh(fx) + ")", string.Join(", ", cima), "solo" });
                if (baixo.Count > 0) out_.Add(new[] { "Abaixo do ritmo (" + Hh(fx) + ")", string.Join(", ", baixo), "solo" });
            }
        }

        static double? VendaDoDia(JSONObject m, string dia)
        {
            var dd = m.OptJSONArray("diario"); if (dd == null) return null;
            for (int i = 0; i < dd.Length; i++) { var x = dd.OptJSONObject(i); if (x != null && x.OptString("d") == dia) return N(x, "v"); }
            return null;
        }

        /// <summary>"Bom dia!" curto: % da meta no título; ontem e quanto por dia no texto.</summary>
        static string[] BomDia(JSONObject o, string dia, string quem)
        {
            JSONObject ontem = null; var dd = o.OptJSONArray("diario");
            if (dd != null) for (int i = 0; i < dd.Length; i++)
            {
                var x = dd.OptJSONObject(i); if (x == null) continue; var dt = x.OptString("d");
                if (dt.Length != 10 || string.CompareOrdinal(dt, dia) >= 0) continue;
                if (Util(DateTime.ParseExact(dt, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))) ontem = x;
            }
            var b = new List<string>();
            if (ontem != null) b.Add("Ontem " + BrlK(N(ontem, "v")));
            if (N(o, "meta") > 0 && N(o, "falta") > 0 && N(o, "rest") > 0) b.Add(BrlK(N(o, "porDia")) + "/dia p/ bater");
            else if (N(o, "meta") <= 0) b.Add("Mês " + BrlK(N(o, "valor")));
            return new[] { N(o, "meta") > 0 ? "Bom dia! " + quem + " em " + P0(N(o, "p")) + " da meta" : "Bom dia!", string.Join(" · ", b) };
        }

        /// <summary>Os mesmos avisos do gestor, mas só com os números do próprio vendedor.</summary>
        static void Pessoal(JSONObject m, DateTime agora, Func<string, bool> marcar, Prefs p, Prefs.Editor ed, bool primeira, List<string[]> out_)
        {
            var dia = agora.ToString("yyyy-MM-dd"); var mes = dia.Substring(0, 7);
            bool util = Util(agora);
            double meta = N(m, "meta"), pp = N(m, "p"), idealP = N(m, "idealP"), rest = N(m, "rest"), dec = N(m, "dec");
            var hojeV = VendaDoDia(m, dia);
            if (util && agora.Hour >= 8 && agora.Hour <= 11 && marcar("eu_manha_" + dia)) out_.Add(BomDia(m, dia, "Você está"));
            if (meta <= 0) return;
            var fx = util ? Faixa(RITMO, "17:59", agora.Hour, agora.Minute) : null;
            if (fx != null && marcar("eu_ritmo_" + dia + "_" + fx))
                out_.Add(new[] { "Seu ritmo " + Hh(fx) + ": " + P0(pp) + " da meta", N(m, "valor") >= N(m, "ideal") ? "Acima do ideal" : "Abaixo do ideal" });
            if (util && pp < 1 && rest >= 1 && rest <= 3 && marcar("eu_reta_" + dia))
                out_.Add(new[] { "Reta final: " + Dias(rest), "Faltam " + BrlK(N(m, "falta")) + " · " + BrlK(N(m, "porDia")) + "/dia" });
            int novo = 0;
            foreach (var k in new[] { 50, 75, 90 }) if (pp >= k / 100.0 && marcar("eu_marco_" + mes + "_" + k)) novo = k;
            if (novo > 0 && pp < 1) out_.Add(new[] { "Você passou de " + novo + "% da meta!", BrlK(N(m, "valor")) + " de " + BrlK(meta) });
            var kb = "eu_baixo_" + mes;
            if (pp < idealP - 0.10) ed.Put(kb, true);
            else if (pp >= idealP && p.GetBool(kb, false)) { ed.Remove(kb); if (!primeira) out_.Add(new[] { "Você voltou ao ritmo!", P0(pp) + " da meta" }); }
            if (util && hojeV != null && dec > 0 && N(m, "valor") > 0 && hojeV.Value >= 1.5 * N(m, "valor") / dec && marcar("eu_acima_" + dia))
                out_.Add(new[] { "Hoje acima da sua média!", BrlK(hojeV.Value) + " hoje" });
            if (N(m, "metaPos") > 0 && N(m, "pos") >= N(m, "metaPos") && marcar("eu_pos_" + mes))
                out_.Add(new[] { "Positivação batida!", Math.Round(N(m, "pos")) + " de " + Math.Round(N(m, "metaPos")) + " clientes" });
        }

        /// <summary>Bom dia (8–11 h) e reta final do mês (últimos 3 dias úteis), para gestor/diretor.</summary>
        static void Resumos(JSONObject d, DateTime agora, Func<string, bool> marcar, List<string[]> out_)
        {
            if (!Util(agora)) return;
            var dia = agora.ToString("yyyy-MM-dd"); double meta = N(d, "meta"), rest = N(d, "rest");
            if (agora.Hour >= 8 && agora.Hour <= 11 && marcar("manha_" + dia)) out_.Add(BomDia(d, dia, "Equipe"));
            if (meta > 0 && N(d, "p") < 1 && rest >= 1 && rest <= 3 && marcar("reta_" + dia))
            {
                var vs = d.OptJSONArray("vendedores"); var perto = new List<JSONObject>();
                if (vs != null) for (int i = 0; i < vs.Length; i++) { var v = vs.OptJSONObject(i); if (v != null && N(v, "meta") > 0 && N(v, "p") >= 0.8 && N(v, "p") < 1) perto.Add(v); }
                var ps = string.Join(", ", perto.OrderByDescending(v => N(v, "p")).Take(3).Select(v => v.OptString("nome")));
                out_.Add(new[] { "Reta final: " + Dias(rest), "Faltam " + BrlK(N(d, "falta")) + " · " + BrlK(N(d, "porDia")) + "/dia" + (ps.Length > 0 ? " · perto: " + ps : "") });
            }
        }

        public static List<string[]> Calcular(JSONObject d)
        {
            var out_ = new List<string[]>();
            if (d.Has("periodo")) return out_;
            var agora = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zona());
            var mes = agora.ToString("yyyy-MM");
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
            if (d.OptString("tipo") == "vendedor")
            {
                var s = d.OptJSONObject("semana"); var m = d.OptJSONObject("mes");
                if (s != null && N(s, "meta") > 0 && N(s, "p") >= 1 && marcar("sem_" + mes + "_" + s.OptString("titulo")))
                    out_.Add(new[] { "Meta da semana batida!", BrlK(N(s, "valor")) + " (" + P0(N(s, "p")) + ")" });
                if (m != null)
                {
                    if (N(m, "meta") > 0 && N(m, "p") >= 1 && marcar("mes_" + mes)) out_.Add(new[] { "Meta do mês batida!", BrlK(N(m, "valor")) + " (" + P0(N(m, "p")) + ")" });
                    Pessoal(m, agora, marcar, p, ed, primeira, out_);
                }
            }
            else
            {
                if (N(d, "meta") > 0 && N(d, "p") >= 1 && marcar("mes_" + mes)) out_.Add(new[] { "Meta do mês batida!", "Equipe: " + BrlK(N(d, "valor")) + " (" + P0(N(d, "p")) + ")" });
                var vs = d.OptJSONArray("vendedores"); var bateram = new List<string>();
                if (vs != null) for (int i = 0; i < vs.Length; i++)
                {
                    var v = vs.OptJSONObject(i); if (v == null) continue;
                    if (N(v, "meta") > 0 && N(v, "valor") >= N(v, "meta") && marcar("vend_" + mes + "_" + v.OptString("nome"))) bateram.Add(v.OptString("nome"));
                }
                if (bateram.Count == 1) out_.Add(new[] { bateram[0] + " bateu a meta do mês!", "Parabéns!" });
                else if (bateram.Count > 1) out_.Add(new[] { bateram.Count + " vendedores bateram a meta", string.Join(", ", bateram) });
                if (vs != null) Equipe(d, vs, agora, mes, marcar, p, ed, primeira, out_);
                Resumos(d, agora, marcar, out_);
            }
            ed.Put("base_" + mes, true).Commit();
            return out_;
        }
    }
}
