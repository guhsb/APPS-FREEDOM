using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using Microsoft.Win32;

namespace Freedom
{
    /// <summary>Atualização pelo GitHub (Releases): baixa o Freedom-Windows.exe novo e troca o atual.</summary>
    public static class Atualizacao
    {
        public const string REPO = "guhsb/APPS-FREEDOM";
        const string ARQUIVO = "Freedom-Windows.exe";
        public static volatile bool Baixando;
        public static volatile int Progresso;
        public static volatile string Erro;
        static Prefs P { get { return Prefs.De("atualizacao"); } }

        public static int VersaoAtual() { return Assembly.GetExecutingAssembly().GetName().Version.Minor; }

        public static JSONObject Nova()
        {
            var s = P.GetString("ultima");
            if (s == null) return null;
            try
            {
                var o = new JSONObject(s);
                return o.OptLong("versao") > VersaoAtual() && o.OptString("url").Length > 0 ? o : null;
            }
            catch (Exception) { return null; }
        }

        public static JSONObject Resumo()
        {
            var o = new JSONObject().Put("atual", Api.Versao).Put("baixando", Baixando).Put("progresso", (long)Progresso)
                .Put("conferido", P.GetLong("hora"));
            if (Erro != null) o.Put("erro", Erro);
            var n = Nova();
            if (n != null) o.Put("nova", n.OptLong("versao")).Put("notas", n.OptString("notas"));
            return o;
        }

        static HttpWebRequest Req(string url)
        {
            var r = (HttpWebRequest)WebRequest.Create(url);
            r.UserAgent = "Freedom-Windows";
            r.Timeout = 20000;
            r.ReadWriteTimeout = 60000;
            return r;
        }

        /// <summary>0 = em dia, 1 = tem nova, -1 = falhou.</summary>
        public static int Conferir(bool forcar)
        {
            long agora = Relogio.Agora();
            if (!forcar && agora - P.GetLong("hora") < 6 * 3600000L) return Nova() != null ? 1 : 0;
            try
            {
                var r = Req("https://api.github.com/repos/" + REPO + "/releases/latest");
                r.Accept = "application/vnd.github+json";
                string txt;
                using (var resp = (HttpWebResponse)r.GetResponse())
                using (var l = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) txt = l.ReadToEnd();
                var j = new JSONObject(txt);
                long versao;
                long.TryParse(new string(j.OptString("tag_name").Replace("v", "").ToCharArray()), out versao);
                string url = ""; long tam = -1;
                var assets = j.OptJSONArray("assets");
                if (assets != null)
                    for (int i = 0; i < assets.Length; i++)
                    {
                        var a = assets.OptJSONObject(i);
                        if (a != null && a.OptString("name") == ARQUIVO) { url = a.OptString("browser_download_url"); tam = a.OptLong("size", -1); }
                    }
                var notas = j.OptString("body");
                P.Edit().Put("ultima", new JSONObject().Put("versao", versao).Put("url", url).Put("tamanho", tam)
                    .Put("pagina", j.OptString("html_url")).Put("notas", notas.Length > 400 ? notas.Substring(0, 400) : notas).ToString())
                    .Put("hora", agora).Commit();
                return Nova() != null ? 1 : 0;
            }
            catch (Exception)
            {
                P.Edit().Put("hora", agora).Commit();
                return Nova() != null ? 1 : -1;
            }
        }

        /// <summary>Baixa a versão nova, troca o .exe e reabre o app. avisar() a cada 5%.</summary>
        public static bool BaixarEInstalar(Action avisar)
        {
            var n = Nova();
            if (n == null || Baixando) return false;
            Baixando = true; Progresso = 0; Erro = null;
            if (avisar != null) avisar();
            var exe = Instalacao.ExeAtual;
            var novo = exe + ".novo";
            try
            {
                var r = Req(n.OptString("url"));
                using (var resp = (HttpWebResponse)r.GetResponse())
                using (var ent = resp.GetResponseStream())
                using (var sai = File.Create(novo))
                {
                    long total = resp.ContentLength > 0 ? resp.ContentLength : n.OptLong("tamanho", -1);
                    var buf = new byte[65536];
                    long lido = 0; int ultimo = -1, k;
                    while ((k = ent.Read(buf, 0, buf.Length)) > 0)
                    {
                        sai.Write(buf, 0, k);
                        lido += k;
                        if (total > 0)
                        {
                            int pct = (int)Math.Min(100, lido * 100 / total);
                            if (pct / 5 != ultimo / 5) { Progresso = pct; ultimo = pct; if (avisar != null) avisar(); }
                        }
                    }
                }
                if (new FileInfo(novo).Length < 100000) throw new IOException("arquivo baixado incompleto");
                var velho = exe + ".velho";
                if (File.Exists(velho)) File.Delete(velho);
                File.Move(exe, velho);          // o Windows deixa renomear o .exe que está rodando
                File.Move(novo, exe);
                Process.Start(new ProcessStartInfo(exe, "--atualizado") { UseShellExecute = false });
                return true;
            }
            catch (Exception e)
            {
                Erro = "Não consegui atualizar: " + Api.Mensagem(e);
                try { if (File.Exists(novo)) File.Delete(novo); } catch (Exception) { }
                return false;
            }
            finally
            {
                Baixando = false;
                if (avisar != null) avisar();
            }
        }

        public static string Pagina()
        {
            var n = Nova();
            return n != null && n.OptString("pagina").Length > 0 ? n.OptString("pagina") : "https://github.com/" + REPO + "/releases/latest";
        }
    }

    /// <summary>
    /// Instala o app na pasta do usuário (sem precisar de administrador): atalho no Menu Iniciar e na Área de Trabalho,
    /// abre junto com o Windows e aparece em "Aplicativos instalados" para desinstalar.
    /// </summary>
    public static class Instalacao
    {
        public static string Pasta { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Freedom"); } }
        public static string ExeInstalado { get { return Path.Combine(Pasta, "Freedom.exe"); } }
        public static string ExeAtual { get { return Process.GetCurrentProcess().MainModule.FileName; } }
        const string RUN = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string DESINST = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Freedom";

        public static bool RodandoInstalado()
        {
            return string.Equals(Path.GetFullPath(ExeAtual), Path.GetFullPath(ExeInstalado), StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Copia este .exe para a pasta do app e registra tudo. Devolve false se não conseguiu.</summary>
        public static bool Instalar()
        {
            try
            {
                Directory.CreateDirectory(Pasta);
                for (int i = 0; i < 20; i++)
                {
                    try { File.Copy(ExeAtual, ExeInstalado, true); break; }
                    catch (IOException) { if (i == 19) throw; System.Threading.Thread.Sleep(500); }   // a versão antiga ainda fechando
                }
                Registrar();
                return true;
            }
            catch (Exception) { return false; }
        }

        public static void Registrar()
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RUN)) k.SetValue("Freedom", "\"" + ExeInstalado + "\" --oculto");
                using (var k = Registry.CurrentUser.CreateSubKey(DESINST))
                {
                    k.SetValue("DisplayName", "Freedom");
                    k.SetValue("DisplayIcon", ExeInstalado);
                    k.SetValue("DisplayVersion", Api.Versao);
                    k.SetValue("Publisher", "Freedom Tech");
                    k.SetValue("InstallLocation", Pasta);
                    k.SetValue("UninstallString", "\"" + ExeInstalado + "\" --desinstalar");
                    k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
                Atalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Freedom.lnk"));
                Atalho(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Freedom.lnk"));
            }
            catch (Exception) { }
        }

        static void Atalho(string lnk)
        {
            try
            {
                var tipo = Type.GetTypeFromProgID("WScript.Shell");
                if (tipo == null) return;
                object sh = Activator.CreateInstance(tipo);
                object a = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
                var t = a.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, a, new object[] { ExeInstalado });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, a, new object[] { Pasta });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, a, new object[] { ExeInstalado + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, a, new object[] { "Freedom · Helpdesk, site e painéis" });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, a, null);
            }
            catch (Exception) { }
        }

        public static void Desinstalar()
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RUN, true)) if (k != null) k.DeleteValue("Freedom", false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(DESINST, false); } catch (Exception) { }
            foreach (var lnk in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Freedom.lnk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Freedom.lnk") })
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch (Exception) { }
            // apaga a pasta do programa e os dados depois que este processo fechar
            try
            {
                var cmd = "/c timeout /t 3 /nobreak >nul & rmdir /s /q \"" + Pasta + "\" & rmdir /s /q \"" + Pastas.Raiz + "\"";
                Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false });
            }
            catch (Exception) { }
        }

        public static bool IniciaComWindows()
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RUN)) return k != null && k.GetValue("Freedom") != null; }
            catch (Exception) { return false; }
        }
    }
}
