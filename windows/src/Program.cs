using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows.Forms;

namespace Freedom
{
    static class Program
    {
        static Mutex unico;

        [STAThread]
        static int Main(string[] args)
        {
            // o .NET só abre 2 conexões por site de cada vez: os dashboards pedem várias consultas juntas
            ServicePointManager.DefaultConnectionLimit = 16;
            ServicePointManager.Expect100Continue = false;
            // as DLLs do WebView2 vão dentro do .exe (um arquivo só)
            AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
            {
                var nome = new AssemblyName(e.Name).Name + ".dll";
                using (var r = Assembly.GetExecutingAssembly().GetManifestResourceStream("dll/" + nome))
                {
                    if (r == null) return null;
                    var b = new byte[r.Length];
                    r.Read(b, 0, b.Length);
                    return Assembly.Load(b);
                }
            };
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; }
            catch (Exception) { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; }
            return Rodar(args);
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static int Rodar(string[] args)
        {
            if (args.Contains("--desinstalar"))
            {
                if (MessageBox.Show("Desinstalar o Freedom deste computador?", "Freedom", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                {
                    FecharOutro();
                    Instalacao.Desinstalar();
                    MessageBox.Show("O Freedom foi removido.", "Freedom");
                }
                return 0;
            }

            // aberto de fora da pasta do app (ex.: Downloads): instala/atualiza e abre a cópia instalada
            if (!Instalacao.RodandoInstalado() && !args.Contains("--portatil"))
            {
                FecharOutro();
                if (Instalacao.Instalar())
                {
                    Process.Start(new ProcessStartInfo(Instalacao.ExeInstalado, "--instalado") { UseShellExecute = false });
                    return 0;
                }
                // não conseguiu instalar: roda daqui mesmo
            }

            bool primeiro;
            unico = new Mutex(true, "Local\\Freedom-App-Unico", out primeiro);
            if (!primeiro && (args.Contains("--atualizado") || args.Contains("--instalado")))
            {
                // a versão anterior está fechando
                try { primeiro = unico.WaitOne(15000); } catch (AbandonedMutexException) { primeiro = true; }
            }
            if (!primeiro)
            {
                try { using (var ev = EventWaitHandle.OpenExisting("Local\\Freedom-Mostrar")) ev.Set(); } catch (Exception) { }
                return 0;
            }
            if (Instalacao.RodandoInstalado()) Instalacao.Registrar();
            try { var velho = Instalacao.ExeAtual + ".velho"; if (File.Exists(velho)) File.Delete(velho); } catch (Exception) { }
            ExtrairTelas();
            ExtrairCarregador();

            // erro inesperado numa tela não derruba o programa nem mostra a caixa de erro do .NET: anota e segue
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (s, e) => Anotar(e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (s, e) => Anotar(e.ExceptionObject as Exception);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var janela = new Janela(args.Contains("--oculto"));
            // outra cópia pediu para aparecer / fechar
            var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Freedom-Mostrar");
            var fechar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Freedom-Fechar");
            new Thread(() =>
            {
                var hs = new WaitHandle[] { mostrar, fechar };
                while (true)
                {
                    int i = WaitHandle.WaitAny(hs);
                    try
                    {
                        if (i == 0) janela.BeginInvoke((Action)janela.Mostrar);
                        else { janela.BeginInvoke((Action)janela.EncerrarParaAtualizar); return; }
                    }
                    catch (Exception) { }
                }
            }) { IsBackground = true }.Start();
            Application.Run(janela);
            GC.KeepAlive(unico);
            return 0;
        }

        /// <summary>Pede para a cópia aberta fechar (para instalar/atualizar por cima).</summary>
        static void FecharOutro()
        {
            try
            {
                using (var ev = EventWaitHandle.OpenExisting("Local\\Freedom-Fechar")) ev.Set();
                Thread.Sleep(2500);
            }
            catch (Exception) { }
        }

        /// <summary>Guarda o erro em %LOCALAPPDATA%\Freedom\erros.txt (só os últimos ~200 KB).</summary>
        static void Anotar(Exception e)
        {
            try
            {
                var arq = Path.Combine(Pastas.Raiz, "erros.txt");
                if (File.Exists(arq) && new FileInfo(arq).Length > 200000) File.Delete(arq);
                File.AppendAllText(arq, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " · " + (e == null ? "erro desconhecido" : e.ToString()) + Environment.NewLine + Environment.NewLine);
            }
            catch (Exception) { }
        }

        /// <summary>Telas (as mesmas do app do celular) vão dentro do .exe; copia para a pasta de dados.</summary>
        static void ExtrairTelas()
        {
            var destino = Pastas.Sub("www");
            var asm = Assembly.GetExecutingAssembly();
            foreach (var n in asm.GetManifestResourceNames().Where(x => x.StartsWith("www/")))
                try
                {
                    using (var r = asm.GetManifestResourceStream(n))
                    using (var f = File.Create(Path.Combine(destino, n.Substring(4)))) r.CopyTo(f);
                }
                catch (Exception) { }
        }

        /// <summary>WebView2Loader.dll (nativa) também vai dentro do .exe.</summary>
        static void ExtrairCarregador()
        {
            var pasta = Pastas.Sub("bin");
            var arq = Path.Combine(pasta, "WebView2Loader.dll");
            try
            {
                using (var r = Assembly.GetExecutingAssembly().GetManifestResourceStream("dll/WebView2Loader.dll"))
                {
                    if (r == null) return;
                    if (!File.Exists(arq) || new FileInfo(arq).Length != r.Length)
                        using (var f = File.Create(arq)) r.CopyTo(f);
                }
                DefinirCarregador(pasta);
            }
            catch (Exception) { }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static void DefinirCarregador(string pasta)
        {
            Microsoft.Web.WebView2.Core.CoreWebView2Environment.SetLoaderDllFolderPath(pasta);
        }
    }
}
