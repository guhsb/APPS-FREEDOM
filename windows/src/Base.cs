using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Freedom
{
    /// <summary>Pastas do app no Windows (tudo dentro de %LOCALAPPDATA%\Freedom, só do usuário).</summary>
    public static class Pastas
    {
        public static string Raiz
        {
            get
            {
                var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Freedom");
                Directory.CreateDirectory(p);
                return p;
            }
        }

        public static string Sub(string nome)
        {
            var p = Path.Combine(Raiz, nome);
            Directory.CreateDirectory(p);
            return p;
        }

        public static string Downloads
        {
            get
            {
                var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                Directory.CreateDirectory(p);
                return p;
            }
        }
    }

    public static class Relogio
    {
        public static long Agora() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
        public static string HHmm(long ms) { return DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime().ToString("HH:mm"); }
    }

    /// <summary>Configurações guardadas em arquivo (equivalente às SharedPreferences do Android).</summary>
    public sealed class Prefs
    {
        static readonly Dictionary<string, Prefs> todas = new Dictionary<string, Prefs>();
        readonly string arquivo;
        readonly object trava = new object();
        JSONObject dados;

        public static Prefs De(string nome)
        {
            lock (todas)
            {
                Prefs p;
                if (!todas.TryGetValue(nome, out p)) { p = new Prefs(nome); todas[nome] = p; }
                return p;
            }
        }

        Prefs(string nome)
        {
            arquivo = Path.Combine(Pastas.Sub("dados"), nome + ".json");
            try { dados = File.Exists(arquivo) ? new JSONObject(File.ReadAllText(arquivo, Encoding.UTF8)) : new JSONObject(); }
            catch (Exception) { dados = new JSONObject(); }
        }

        public string GetString(string k, string padrao = null) { lock (trava) { return dados.Has(k) && !dados.IsNull(k) ? dados.OptString(k) : padrao; } }
        public long GetLong(string k, long padrao = 0) { lock (trava) { return dados.Has(k) ? dados.OptLong(k, padrao) : padrao; } }
        public int GetInt(string k, int padrao = 0) { lock (trava) { return dados.Has(k) ? dados.OptInt(k, padrao) : padrao; } }
        public bool GetBool(string k, bool padrao = false) { lock (trava) { return dados.Has(k) ? dados.OptBoolean(k, padrao) : padrao; } }

        public Editor Edit() { return new Editor(this); }

        public sealed class Editor
        {
            readonly Prefs p;
            readonly List<KeyValuePair<string, object>> ops = new List<KeyValuePair<string, object>>();
            bool limpar;
            static readonly object REMOVER = new object();
            internal Editor(Prefs p) { this.p = p; }
            public Editor Put(string k, object v) { ops.Add(new KeyValuePair<string, object>(k, v)); return this; }
            public Editor Remove(string k) { ops.Add(new KeyValuePair<string, object>(k, REMOVER)); return this; }
            public Editor Clear() { limpar = true; ops.Clear(); return this; }

            public void Commit()
            {
                lock (p.trava)
                {
                    if (limpar) p.dados = new JSONObject();
                    foreach (var op in ops)
                    {
                        if (op.Value == REMOVER) p.dados.Remove(op.Key);
                        else if (op.Value is int) p.dados.Put(op.Key, (long)(int)op.Value);
                        else p.dados.Put(op.Key, op.Value);
                    }
                    p.Salvar();
                }
            }
        }

        void Salvar()
        {
            try
            {
                var tmp = arquivo + ".tmp";
                File.WriteAllText(tmp, dados.ToString(), new UTF8Encoding(false));
                if (File.Exists(arquivo)) File.Replace(tmp, arquivo, null);
                else File.Move(tmp, arquivo);
            }
            catch (Exception) { }
        }
    }

    /// <summary>Login do app: a senha fica criptografada pelo Windows (DPAPI, só este usuário deste PC abre).</summary>
    public static class Store
    {
        static readonly byte[] SAL = Encoding.UTF8.GetBytes("freedom-helpdesk");
        static Prefs P { get { return Prefs.De("login"); } }

        public static void SalvarLogin(string email, string senha)
        {
            var cifrado = ProtectedData.Protect(Encoding.UTF8.GetBytes(senha), SAL, DataProtectionScope.CurrentUser);
            P.Edit().Put("email", email).Put("senha", Convert.ToBase64String(cifrado)).Commit();
        }

        public static string Email() { return P.GetString("email"); }

        public static KeyValuePair<string, string>? Login()
        {
            var e = P.GetString("email");
            var s = P.GetString("senha");
            if (e == null || s == null) return null;
            try
            {
                var aberto = ProtectedData.Unprotect(Convert.FromBase64String(s), SAL, DataProtectionScope.CurrentUser);
                return new KeyValuePair<string, string>(e, Encoding.UTF8.GetString(aberto));
            }
            catch (Exception) { return null; }
        }

        public static bool Logado() { return P.GetString("senha") != null; }

        public static void Sair()
        {
            P.Edit().Clear().Commit();
            Prefs.De("cache").Edit().Clear().Commit();
        }
    }

    public class ErroLogin : IOException { public ErroLogin(string m) : base(m) { } }
    public class SemAcesso : IOException { public SemAcesso(string m) : base(m) { } }

    /// <summary>Acesso ao site relatorios.cbfreedom.com.br (sessão por cookie, igual ao navegador).</summary>
    public sealed class Api
    {
        public const string SITE = "https://relatorios.cbfreedom.com.br";
        public const string BASE = SITE + "/api/v1";
        readonly string email, senha;
        public string Cookie { get; private set; }
        public readonly List<Cookie> Cookies = new List<Cookie>();

        public Api(string email, string senha, string cookie = "")
        {
            this.email = email; this.senha = senha; Cookie = cookie ?? "";
        }

        public static string Versao
        {
            get { var v = Assembly.GetExecutingAssembly().GetName().Version; return v.Major + "." + v.Minor; }
        }

        public static string Mensagem(Exception e)
        {
            var w = e as WebException;
            if (w != null)
            {
                switch (w.Status)
                {
                    case WebExceptionStatus.NameResolutionFailure:
                    case WebExceptionStatus.ConnectFailure:
                    case WebExceptionStatus.Timeout:
                    case WebExceptionStatus.ConnectionClosed:
                        return "sem conexão com a internet";
                    case WebExceptionStatus.TrustFailure:
                    case WebExceptionStatus.SecureChannelFailure:
                        return "erro de conexão segura com o site";
                }
            }
            return string.IsNullOrEmpty(e.Message) ? "erro ao atualizar" : e.Message;
        }

        HttpWebRequest Abrir(string url, string metodo)
        {
            var r = (HttpWebRequest)WebRequest.Create(url);
            r.Method = metodo;
            r.Timeout = 25000;
            r.ReadWriteTimeout = 25000;
            r.Accept = "application/json";
            r.UserAgent = "Freedom-Windows/" + Versao;
            r.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            r.AllowAutoRedirect = false;
            if (!string.IsNullOrEmpty(Cookie)) r.Headers[HttpRequestHeader.Cookie] = Cookie;
            return r;
        }

        static Engine.Resp Executar(HttpWebRequest r, byte[] corpo, string tipo)
        {
            if (corpo != null)
            {
                r.ContentType = tipo;
                r.ContentLength = corpo.Length;
                using (var s = r.GetRequestStream()) s.Write(corpo, 0, corpo.Length);
            }
            HttpWebResponse resp;
            try { resp = (HttpWebResponse)r.GetResponse(); }
            catch (WebException e)
            {
                if (e.Response == null) throw;
                resp = (HttpWebResponse)e.Response;
            }
            using (resp)
            using (var leitor = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return new Engine.Resp((int)resp.StatusCode, leitor.ReadToEnd());
        }

        public void Entrar()
        {
            var r = Abrir(BASE + "/auth/login", "POST");
            var pote = new CookieContainer();
            r.CookieContainer = pote;
            var corpo = new JSONObject().Put("login", email).Put("password", senha).Put("remember", true).ToString();
            var resp = Executar(r, Encoding.UTF8.GetBytes(corpo), "application/json; charset=utf-8");
            if (resp.Status == 400 || resp.Status == 401 || resp.Status == 422) throw new ErroLogin("e-mail ou senha incorretos");
            if (resp.Status < 200 || resp.Status > 299) throw new IOException("login falhou (HTTP " + resp.Status + ")");
            Cookies.Clear();
            var partes = new List<string>();
            foreach (Cookie c in pote.GetCookies(new Uri(BASE + "/")))
            {
                Cookies.Add(c);
                partes.Add(c.Name + "=" + c.Value);
            }
            Cookie = string.Join("; ", partes);
        }

        public JSONObject Get(string caminho)
        {
            var r = Bruto(caminho);
            if (r.Status == 401 || r.Status == 403) throw new SemAcesso("este login não tem acesso");
            if (r.Status == 204) return new JSONObject();      // sem dados para esse filtro (ex.: semana sem vendas): vazio, não erro
            if (r.Status != 200) throw new IOException("erro ao buscar dados (HTTP " + r.Status + ")");
            return string.IsNullOrWhiteSpace(r.Body) ? new JSONObject() : new JSONObject(r.Body);
        }

        public Engine.Resp Bruto(string caminho) { return Executar(Abrir(BASE + caminho, "GET"), null, null); }

        public Engine.Resp Enviar(string metodo, string caminho, JSONObject corpo)
        {
            var r = Abrir(BASE + caminho, metodo);
            return Executar(r, corpo == null ? null : Encoding.UTF8.GetBytes(corpo.ToString()), "application/json; charset=utf-8");
        }

        public Engine.Resp EnviarArquivo(string caminho, string nome, string tipo, byte[] dados)
        {
            var r = Abrir(BASE + caminho, "POST");
            var limite = "----freedom" + DateTime.UtcNow.Ticks;
            var seguro = nome.Replace("\"", "'").Replace("\r", "").Replace("\n", "");
            var cab = Encoding.UTF8.GetBytes("--" + limite + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + seguro + "\"\r\n" +
                "Content-Type: " + tipo + "\r\n\r\n");
            var fim = Encoding.UTF8.GetBytes("\r\n--" + limite + "--\r\n");
            var tudo = new byte[cab.Length + dados.Length + fim.Length];
            Buffer.BlockCopy(cab, 0, tudo, 0, cab.Length);
            Buffer.BlockCopy(dados, 0, tudo, cab.Length, dados.Length);
            Buffer.BlockCopy(fim, 0, tudo, cab.Length + dados.Length, fim.Length);
            return Executar(r, tudo, "multipart/form-data; boundary=" + limite);
        }

        /// <summary>Baixa um arquivo do site (anexos) para o destino. Devolve o código HTTP.</summary>
        public int Baixar(string caminho, string destino)
        {
            var r = Abrir(BASE + caminho, "GET");
            r.Accept = "*/*";
            HttpWebResponse resp;
            try { resp = (HttpWebResponse)r.GetResponse(); }
            catch (WebException e) { if (e.Response == null) throw; resp = (HttpWebResponse)e.Response; }
            using (resp)
            {
                if ((int)resp.StatusCode != 200) return (int)resp.StatusCode;
                using (var ent = resp.GetResponseStream())
                using (var sai = File.Create(destino)) ent.CopyTo(sai);
                return 200;
            }
        }

        public void Sair()
        {
            try { Executar(Abrir(BASE + "/auth/logout", "POST"), new byte[0], "application/json"); } catch (Exception) { }
        }
    }

    /// <summary>Módulos que o login tem no site (helpdesk, commercial, logistics...).</summary>
    public static class Acesso
    {
        public const string HELPDESK = "helpdesk";
        static Prefs P { get { return Prefs.De("acesso"); } }

        public static void Salvar(JSONObject me)
        {
            var arr = me.OptJSONArray("modules");
            if (arr == null) return;
            P.Edit().Put("modulos", arr.ToString()).Put("perfil", me.OptString("role")).Put("nome", me.OptString("display_name")).Commit();
        }

        public static void Atualizar(Api api) { try { Salvar(api.Get("/auth/me")); } catch (Exception) { } }

        public static HashSet<string> Modulos()
        {
            var s = P.GetString("modulos");
            if (s == null) return null;
            try
            {
                var a = new JSONArray(s);
                var r = new HashSet<string>();
                for (int i = 0; i < a.Length; i++) r.Add(a.OptString(i).ToLowerInvariant());
                return r;
            }
            catch (Exception) { return null; }
        }

        public static bool Tem(string modulo) { var m = Modulos(); return m == null || m.Contains(modulo.ToLowerInvariant()); }
        public static bool Helpdesk() { return Tem(HELPDESK); }
        public static bool Painel() { return Paineis.ParaAbaPainel().Count > 0; }
        public static string Perfil() { return P.GetString("perfil", ""); }
        public static string Nome() { return P.GetString("nome", ""); }
        public static void Limpar() { P.Edit().Clear().Commit(); }
    }
}
