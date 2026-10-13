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
                    else abaixo(m, "Você está");
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
            }
            ed.Put("base_" + mes, true).Commit();
            return out_;
        }
    }
}
