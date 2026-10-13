using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Freedom
{
    /// <summary>Um painel de números (Comercial, Faturamento...). Igual aos do app Android, sem o widget.</summary>
    public sealed class Painel
    {
        public string Id, NomeModulo, Modulo, Tela;
        public Func<Api, JSONObject> Buscar;
        public Func<Api, string, string, JSONObject> BuscarPeriodo;
        /// <summary>Avisos de meta (título, texto) a partir dos números novos.</summary>
        public Func<JSONObject, List<string[]>> Avisos;
    }

    public static class Paineis
    {
        public static readonly List<Painel> Todos = new List<Painel>
        {
            new Painel { Id = "comercial", NomeModulo = "Comercial", Modulo = "commercial", Tela = "painel-comercial.html", Buscar = Comercial, BuscarPeriodo = Periodo, Avisos = Metas.Calcular },
            new Painel { Id = "faturamento", NomeModulo = "Faturamento", Modulo = "logistics", Tela = "painel-faturamento.html", Buscar = Faturamento },
        };

        public static Painel PorId(string id) { return Todos.FirstOrDefault(p => p.Id == id); }
        public static List<Painel> ParaAbaPainel() { return Todos.Where(p => Acesso.Tem(p.Modulo)).ToList(); }

        // ---------------- contas (as mesmas do app e dos painéis do site) ----------------

        static double N(JSONObject o, string k)
        {
            if (o == null || !o.Has(k) || o.IsNull(k)) return 0;
            double d = o.OptDouble(k, double.NaN);
            return double.IsNaN(d) ? 0 : d;
        }

        static DateTime Hoje()
        {
            foreach (var id in new[] { "E. South America Standard Time", "America/Sao_Paulo" })
            {
                try { return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(id)).Date; }
                catch (Exception) { }
            }
            return DateTime.Now.Date;
        }

        static string Iso(DateTime d) { return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }

        static JSONObject Comercial(Api api)
        {
            var hoje = Hoje();
            var iniMes = new DateTime(hoje.Year, hoje.Month, 1);
            var fimMes = iniMes.AddMonths(1).AddDays(-1);
            var qMes = "start_date=" + Iso(iniMes) + "&end_date=" + Iso(fimMes);
            var me = api.Get("/auth/me");
            var nome = me.OptString("display_name", me.OptString("seller_name", ""));
            if (me.OptString("role") == "seller")
            {
                int dow = ((int)hoje.DayOfWeek + 6) % 7;      // segunda = 0
                var seg = hoje.AddDays(-dow);
                var dom = seg.AddDays(6);
                var iniSem = seg < iniMes ? iniMes : seg;
                var fimSem = dom > fimMes ? fimMes : dom;
                var qSem = "start_date=" + Iso(iniSem) + "&end_date=" + Iso(fimSem);
                var oMes = api.Get("/dashboard/overview?" + qMes);
                var oSem = api.Get("/dashboard/overview?" + qSem);
                var cSem = api.Get("/dashboard/overview/charts?" + qSem);
                var v = Vendedor(nome, oMes, oSem, cSem.OptJSONArray("daily") ?? new JSONArray(), iniSem, fimSem, hoje);
                var gv = GraficoDe(api, qMes, iniMes, fimMes, hoje);
                var mv = v.OptJSONObject("mes");
                if (gv != null && mv != null) mv.Put("diario", gv);
                if (mv != null) { var av = Anterior(api, iniMes, mv.OptDouble("dec", 0)); if (av != null) mv.Put("anterior", av); }
                return v;
            }
            var o = api.Get("/dashboard/overview?" + qMes);
            var sv = api.Get("/dashboard/sellers?" + qMes);
            var g = Gestor(nome, o, sv, iniMes, fimMes, hoje);
            var gg = GraficoDe(api, qMes, iniMes, fimMes, hoje);
            if (gg != null) g.Put("diario", gg);
            var ag = Anterior(api, iniMes, g.OptDouble("dec", 0));
            if (ag != null) g.Put("anterior", ag);
            return g;
        }

        static void DiasUteis(DateTime ini, DateTime fim, DateTime hoje, out double t, out double dec, out double rest)
        {
            t = 0; dec = 0; rest = 0;
            for (var d = ini; d <= fim; d = d.AddDays(1))
                if (d.DayOfWeek != DayOfWeek.Saturday && d.DayOfWeek != DayOfWeek.Sunday)
                {
                    t++;
                    if (d <= hoje) dec++;
                    if (d >= hoje) rest++;
                }
        }

        static JSONObject Periodo(Api api, string iniTxt, string fimTxt)
        {
            var ini = DateTime.ParseExact(iniTxt, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var fim = DateTime.ParseExact(fimTxt, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (fim < ini) throw new ArgumentException("a data final é antes da inicial");
            var hoje = Hoje();
            var q = "start_date=" + Iso(ini) + "&end_date=" + Iso(fim);
            var me = api.Get("/auth/me");
            var nome = me.OptString("display_name", me.OptString("seller_name", ""));
            var titulo = ini.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture) + " a " + fim.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
            // período sem vendas: o site pode responder "sem dados" (4xx) em vez de zeros — vira painel vazio, não erro
            var o = GetOuVazio(api, "/dashboard/overview?" + q);
            var graf = GraficoDe(api, q, ini, fim, hoje);
            if (me.OptString("role") == "seller")
            {
                var g = Gestor(nome, o, new JSONObject(), ini, fim, hoje).Put("titulo", "PERÍODO " + titulo);
                if (graf != null) g.Put("diario", graf);
                return new JSONObject().Put("tipo", "vendedor").Put("nome", nome).Put("periodo", titulo).Put("mes", g).Put("semVendas", N(o, "sales_revenue") <= 0);
            }
            var gp = Gestor(nome, o, GetOuVazio(api, "/dashboard/sellers?" + q), ini, fim, hoje).Put("periodo", titulo);
            if (graf != null) gp.Put("diario", graf);
            bool algum = false;
            var vs = gp.OptJSONArray("vendedores");
            if (vs != null) for (int i = 0; i < vs.Length; i++) if (N(vs.OptJSONObject(i), "valor") > 0) algum = true;
            gp.Put("semVendas", N(o, "sales_revenue") <= 0 && !algum);
            return gp;
        }

        /// <summary>Busca no site; "sem dados" (HTTP 400/404/422) vira objeto vazio. Login/acesso continuam dando erro.</summary>
        static JSONObject GetOuVazio(Api api, string caminho)
        {
            try { return api.Get(caminho); }
            catch (SemAcesso) { throw; }
            catch (ErroLogin) { throw; }
            catch (System.IO.IOException e)
            {
                if (System.Text.RegularExpressions.Regex.IsMatch(e.Message ?? "", "HTTP (400|404|422)")) return new JSONObject();
                throw;
            }
        }

        /// <summary>Mês passado até o mesmo dia útil (igual ao Android). null se falhar.</summary>
        static JSONObject Anterior(Api api, DateTime iniMes, double dec)
        {
            try
            {
                if (!(dec > 0)) return null;
                var pIni = iniMes.AddMonths(-1);
                var pUlt = pIni.AddMonths(1).AddDays(-1);
                var fim = pUlt; int cont = 0;
                for (var d = pIni; d <= pUlt; d = d.AddDays(1))
                    if (d.DayOfWeek != DayOfWeek.Saturday && d.DayOfWeek != DayOfWeek.Sunday) { cont++; if (cont >= dec) { fim = d; break; } }
                var o = api.Get("/dashboard/overview?start_date=" + Iso(pIni) + "&end_date=" + Iso(fim));
                return new JSONObject().Put("valor", N(o, "sales_revenue")).Put("ate", fim.ToString("dd/MM", CultureInfo.InvariantCulture));
            }
            catch (Exception) { return null; }
        }

        /// <summary>Busca o gráfico do site; se falhar, o painel continua sem ele.</summary>
        static JSONArray GraficoDe(Api api, string q, DateTime ini, DateTime fim, DateTime hoje)
        {
            try { return Diario(api.Get("/dashboard/overview/charts?" + q).OptJSONArray("daily"), ini, fim, hoje); }
            catch (Exception) { return null; }
        }

        /// <summary>Evolução dia a dia (d, v = vendido no dia, a = acumulado até hoje, i = ideal acumulado). Igual ao Android.</summary>
        public static JSONArray Diario(JSONArray lista, DateTime ini, DateTime fim, DateTime hoje)
        {
            if (lista == null || lista.Length == 0) return null;
            var itens = new List<JSONObject>();
            for (int k = 0; k < lista.Length; k++) if (lista.OptJSONObject(k) != null) itens.Add(lista.OptJSONObject(k));
            Func<string[], string> campo = nomes => nomes.FirstOrDefault(n => itens.Any(x => x.Opt(n) != null && !(x.Opt(n) is JNull)));
            var kDia = campo(new[] { "revenue", "sales_revenue", "daily_revenue", "total_revenue", "value" });
            var kAcum = campo(new[] { "cumulative_revenue", "revenue_cumulative", "accumulated_revenue", "cumulative_sales_revenue", "sales_revenue_cumulative" });
            if (kDia == null && kAcum == null) return null;
            var porDia = new Dictionary<string, JSONObject>();
            foreach (var x in itens)
            {
                var dt = x.OptString("sale_date", x.OptString("date"));
                porDia[dt.Length >= 10 ? dt.Substring(0, 10) : dt] = x;
            }
            var r = new JSONArray();
            double acum = 0, ideal = 0, antAcum = 0;
            for (var d = ini; d <= fim; d = d.AddDays(1))
            {
                JSONObject x; porDia.TryGetValue(Iso(d), out x);
                double v = kDia != null ? N(x, kDia) : 0;
                acum = kAcum != null && x != null && x.Opt(kAcum) != null && !(x.Opt(kAcum) is JNull) ? N(x, kAcum) : acum + v;
                if (kDia == null) v = Math.Max(0, acum - antAcum);
                antAcum = acum;
                if (x != null && x.Opt("ideal_cumulative_revenue") != null) ideal = N(x, "ideal_cumulative_revenue");
                var o = new JSONObject().Put("d", Iso(d)).Put("v", v).Put("i", ideal);
                if (d <= hoje) o.Put("a", acum);
                r.Put(o);
            }
            return r;
        }

        static double Primeiro(JSONObject o, params string[] ks)
        {
            foreach (var k in ks) if (o.Has(k) && !o.IsNull(k)) return N(o, k);
            return 0;
        }

        static JSONObject Gestor(string nome, JSONObject o, JSONObject sv, DateTime ini, DateTime fim, DateTime hoje)
        {
            double fat = N(o, "sales_revenue");
            double t = N(o, "business_days_total"), dec = N(o, "business_days_elapsed"), rest = N(o, "business_days_remaining");
            if (t <= 0) DiasUteis(ini, fim, hoje, out t, out dec, out rest);
            double idealP = t > 0 ? Math.Min(1, dec / t) : 0;
            var todos = sv.OptJSONArray("sellers");
            if (todos == null || todos.Length == 0) todos = sv.OptJSONArray("ranking") ?? new JSONArray();
            var lista = new List<JSONObject>();
            for (int i = 0; i < todos.Length; i++) if (todos.OptJSONObject(i) != null) lista.Add(todos.OptJSONObject(i));
            lista = lista.OrderByDescending(x => N(x, "revenue")).ToList();
            double meta = new[] { "revenue_target", "target_revenue", "revenue_goal", "meta_revenue" }.Select(k => N(o, k)).FirstOrDefault(v => v > 0);
            bool metaSoma = false;
            if (meta <= 0) { meta = lista.Sum(x => N(x, "meta_revenue")); metaSoma = meta > 0; }
            double falta = Math.Max(0, meta - fat);
            var vend = new JSONArray();
            foreach (var x in lista)
            {
                double vf = N(x, "revenue"), vm = N(x, "meta_revenue");
                vend.Put(new JSONObject()
                    .Put("nome", x.OptString("seller_name").Replace("SUPERVISOR - ", "SUP. "))
                    .Put("valor", vf).Put("meta", vm).Put("p", vm > 0 ? vf / vm : 0.0)
                    .Put("ideal", vm * idealP).Put("falta", Math.Max(0, vm - vf))
                    .Put("pedidos", N(x, "order_count")).Put("clientes", N(x, "client_count"))
                    .Put("pos", Primeiro(x, "positive_customer_count", "positive_customers", "positivation", "positivacao", "client_count"))
                    .Put("metaPos", Primeiro(x, "positive_customer_target", "positivation_target", "meta_positivation", "meta_positivacao", "client_target")));
            }
            return new JSONObject()
                .Put("tipo", "gestor").Put("nome", nome)
                .Put("valor", fat).Put("meta", meta).Put("p", meta > 0 ? fat / meta : 0.0)
                .Put("idealP", idealP).Put("ideal", meta * idealP)
                .Put("falta", falta).Put("porDia", rest > 0 ? falta / rest : 0.0)
                .Put("pos", N(o, "positive_customer_count")).Put("metaPos", N(o, "positive_customer_target"))
                .Put("pedidos", N(o, "order_count")).Put("ticket", N(o, "average_order_value"))
                .Put("projecao", N(o, "projected_revenue"))
                .Put("dec", dec).Put("T", t).Put("rest", rest)
                .Put("metaSoma", metaSoma)
                .Put("vendedores", vend);
        }

        /// <summary>Meta da semana ACUMULATIVA: o que faltou nas semanas anteriores entra na semana atual.</summary>
        static JSONObject Vendedor(string nome, JSONObject m, JSONObject s, JSONArray diario, DateTime ini, DateTime fim, DateTime hoje)
        {
            var util = new Dictionary<string, bool>();
            double ant = 0;
            for (int i = 0; i < diario.Length; i++)
            {
                var d = diario.OptJSONObject(i);
                if (d == null) continue;
                var k = d.OptString("sale_date");
                if (k.Length > 10) k = k.Substring(0, 10);
                double v = N(d, "ideal_cumulative_revenue");
                util[k] = v > ant + 0.001; ant = v;
            }
            Func<DateTime, bool> ehUtil = dia =>
            {
                bool u;
                if (util.TryGetValue(Iso(dia), out u)) return u;
                return dia.DayOfWeek != DayOfWeek.Saturday && dia.DayOfWeek != DayOfWeek.Sunday;
            };
            var dias = new List<DateTime>();
            for (var d = ini; d <= fim; d = d.AddDays(1)) dias.Add(d);
            var uteis = dias.Where(ehUtil).ToList();
            var passados = uteis.Where(d => d <= hoje).ToList();
            double t = N(m, "business_days_total"), dec = N(m, "business_days_elapsed"), rest = N(m, "business_days_remaining");
            double fatS = N(s, "sales_revenue"), fatM = N(m, "sales_revenue"), metaM = N(m, "revenue_target");
            double vendidoAntes = Math.Max(0, fatM - fatS);
            double duAntes = Math.Max(0, dec - passados.Count);
            double metaSem = t > 0 ? Math.Max(0, metaM * Math.Min(t, duAntes + uteis.Count) / t - vendidoAntes) : 0;
            double metaDia = uteis.Count > 0 ? metaSem / uteis.Count : 0;
            double idealS = metaDia * passados.Count;
            double faltaS = Math.Max(0, metaSem - fatS);
            int restam = Math.Max(uteis.Count(d => d > hoje), uteis.Contains(hoje) ? 1 : 0);
            double fixa = t > 0 ? metaM / t * uteis.Count : 0;
            double idM = t > 0 ? dec / t : 0;
            double faltaM = Math.Max(0, metaM - fatM);
            Func<DateTime, string> dm = d => d.ToString("dd/MM", CultureInfo.InvariantCulture);
            var semana = new JSONObject()
                .Put("titulo", "SEMANA " + dm(ini) + "–" + dm(fim))
                .Put("valor", fatS).Put("meta", metaSem)
                .Put("p", metaSem > 0 ? fatS / metaSem : 0.0)
                .Put("idealP", metaSem > 0 ? idealS / metaSem : 0.0).Put("ideal", idealS)
                .Put("falta", faltaS).Put("porDia", restam > 0 ? faltaS / restam : 0.0).Put("restam", (long)restam)
                .Put("pos", N(s, "positive_customer_count")).Put("metaPos", N(s, "positive_customer_target"))
                .Put("acumulado", metaSem - fixa);
            var mes = new JSONObject()
                .Put("titulo", "MÊS")
                .Put("valor", fatM).Put("meta", metaM)
                .Put("p", metaM > 0 ? fatM / metaM : 0.0)
                .Put("idealP", idM).Put("ideal", metaM * idM)
                .Put("falta", faltaM).Put("porDia", rest > 0 ? faltaM / rest : 0.0)
                .Put("pos", N(m, "positive_customer_count")).Put("metaPos", N(m, "positive_customer_target"))
                .Put("dec", dec).Put("T", t).Put("rest", rest);
            return new JSONObject().Put("tipo", "vendedor").Put("nome", nome).Put("semana", semana).Put("mes", mes);
        }

        static readonly string[] MESES = { "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO",
            "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO" };

        static JSONObject Faturamento(Api api)
        {
            JSONObject fat, snaps;
            try
            {
                fat = api.Get("/logistics/billing/daily");
                snaps = api.Get("/logistics/report/snapshots");
            }
            catch (SemAcesso) { throw new SemAcesso("este login não tem acesso ao faturamento"); }
            var dia = fat.OptJSONObject("latest_day") ?? new JSONObject();
            var hoje = Hoje();
            var mesIso = Iso(hoje).Substring(0, 7);
            double totalMes = 0;
            var dias = fat.OptJSONArray("days") ?? new JSONArray();
            for (int i = 0; i < dias.Length; i++)
            {
                var d = dias.OptJSONObject(i);
                if (d != null && d.OptString("invoice_date").StartsWith(mesIso)) totalMes += N(d, "total_value");
            }
            var tiposArr = dia.OptJSONArray("types") ?? new JSONArray();
            var tipos = new List<JSONObject>();
            for (int i = 0; i < tiposArr.Length; i++) if (tiposArr.OptJSONObject(i) != null) tipos.Add(tiposArr.OptJSONObject(i));
            var tiposOut = new JSONArray();
            foreach (var t in tipos.OrderByDescending(x => N(x, "value")))
                tiposOut.Put(new JSONObject().Put("codigo", t.OptString("order_type_code")).Put("nome", t.OptString("order_type_label"))
                    .Put("valor", N(t, "value")).Put("pedidos", N(t, "order_count")));
            var items = snaps.OptJSONArray("items") ?? new JSONArray();
            JSONObject snap = null;
            for (int i = 0; i < items.Length; i++)
            {
                var it = items.OptJSONObject(i);
                if (it != null && (snap == null || N(it, "id") > N(snap, "id"))) snap = it;
            }
            var data = dia.OptString("invoice_date");
            // todos os dias que o site mandou (para escolher outro dia e comparar na tela)
            var porData = new SortedDictionary<string, JSONObject>(StringComparer.Ordinal);
            for (int i = 0; i < dias.Length; i++)
            {
                var d = dias.OptJSONObject(i); if (d == null) continue;
                var dt = d.OptString("invoice_date"); if (dt.Length < 10) continue; dt = dt.Substring(0, 10);
                var o = new JSONObject().Put("d", dt).Put("v", N(d, "total_value")).Put("p", N(d, "order_count"));
                var tt = d.OptJSONArray("types");
                if (tt != null && tt.Length > 0)
                {
                    var ta = new JSONArray();
                    for (int k = 0; k < tt.Length; k++)
                    {
                        var t = tt.OptJSONObject(k); if (t == null) continue;
                        ta.Put(new JSONObject().Put("codigo", t.OptString("order_type_code")).Put("nome", t.OptString("order_type_label"))
                            .Put("valor", N(t, "value")).Put("pedidos", N(t, "order_count")));
                    }
                    o.Put("tipos", ta);
                }
                porData[dt] = o;
            }
            if (data.Length >= 10)
            {
                var u = data.Substring(0, 10);
                JSONObject o;
                if (!porData.TryGetValue(u, out o)) { o = new JSONObject().Put("d", u); porData[u] = o; }
                o.Put("v", N(dia, "total_value")).Put("p", N(dia, "order_count")).Put("tipos", tiposOut);
            }
            var listaDias = new JSONArray();
            foreach (var o in porData.Values.Skip(Math.Max(0, porData.Count - 70))) listaDias.Put(o);
            return new JSONObject()
                .Put("dias", listaDias)
                .Put("dia", new JSONObject().Put("data", data.Length > 10 ? data.Substring(0, 10) : data)
                    .Put("valor", N(dia, "total_value")).Put("pedidos", N(dia, "order_count")).Put("tipos", tiposOut))
                .Put("mes", new JSONObject().Put("nome", MESES[hoje.Month - 1]).Put("valor", totalMes))
                .Put("standby", N(snap, "standby_value"))
                .Put("pend", N(snap, "team_pending"));
        }
    }

    /// <summary>Busca os números de cada painel liberado e guarda (igual ao Atualizador do Android).</summary>
    public static class Atualizador
    {
        public static volatile bool Atualizando;
        static readonly object trava = new object();
        static Prefs Cache { get { return Prefs.De("cache"); } }

        public static bool Velho(int minutos) { return Relogio.Agora() - Cache.GetLong("tentativa", 0) > minutos * 60000L; }

        public static string Atualizar()
        {
            lock (trava)
            {
                Atualizando = true;
                var ed = Cache.Edit().Put("tentativa", Relogio.Agora());
                string erro = null;
                try
                {
                    var l = Store.Login();
                    if (l == null) throw new ErroLogin("abra o app e faça o login");
                    var api = new Api(l.Value.Key, l.Value.Value);
                    api.Entrar();
                    try
                    {
                        Acesso.Atualizar(api);
                        foreach (var p in Paineis.Todos)
                        {
                            if (!Acesso.Tem(p.Modulo)) { ed.Remove("dados_" + p.Id).Put("erro_" + p.Id, "este login não tem acesso ao " + p.NomeModulo); continue; }
                            try
                            {
                                var d = p.Buscar(api);
                                ed.Put("dados_" + p.Id, d.ToString()).Put("hora_" + p.Id, Relogio.Agora()).Remove("erro_" + p.Id);
                                if (p.Avisos != null && Metas.Ligado())
                                    try { foreach (var a in p.Avisos(d)) Freedom.Avisos.Enviar(a[0], a[1], "painel:" + p.Id); } catch (Exception) { }
                            }
                            catch (Exception e)
                            {
                                var m = Api.Mensagem(e);
                                ed.Put("erro_" + p.Id, m);
                                if (e is SemAcesso) ed.Remove("dados_" + p.Id);
                                if (erro == null) erro = m;
                            }
                        }
                    }
                    finally { api.Sair(); }
                }
                catch (Exception e)
                {
                    var m = Api.Mensagem(e);
                    foreach (var p in Paineis.Todos) ed.Put("erro_" + p.Id, m);
                    erro = m;
                }
                if (Store.Logado()) ed.Commit();
                Atualizando = false;
                return erro;
            }
        }

        /// <summary>O que a tela do painel recebe (mesmo formato do App.dadosPainel do Android).</summary>
        public static string DadosPainel(string id)
        {
            var o = new JSONObject();
            var p = Paineis.PorId(id);
            if (p != null)
            {
                var txt = Cache.GetString("dados_" + p.Id);
                if (txt != null) try { o.Put("dados", new JSONObject(txt)); } catch (Exception) { }
                var e = Cache.GetString("erro_" + p.Id);
                if (e != null) o.Put("erro", e);
                o.Put("hora", Cache.GetLong("hora_" + p.Id, 0)).Put("titulo", p.NomeModulo);
                if (p.Avisos != null) o.Put("avisoMeta", Metas.Ligado());
            }
            o.Put("atualizando", Atualizando).Put("email", Store.Email() ?? "").Put("nome", "Freedom");
            o.Put("app", Atualizacao.Resumo());
            return o.ToString();
        }
    }
}
