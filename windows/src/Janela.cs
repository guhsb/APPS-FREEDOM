using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Freedom
{
    /// <summary>Janela principal: barra lateral (Helpdesk, Site, Painel), as telas e o ícone perto do relógio.</summary>
    public sealed class Janela : Form
    {
        public const string HOST = "app.freedom.local";
        public const string ASSET = "https://" + HOST + "/";
        const string SITE_HOST = "relatorios.cbfreedom.com.br";
        static readonly string[] TELAS = { "lista.html", "novo.html", "dash-helpdesk.html" };

        // cores da parte nativa (barra lateral, seletor de painel): seguem o tema claro (padrão, igual ao site) ou escuro
        public static bool Claro = Prefs.De("aparencia").GetString("tema", "claro") != "escuro";
        static Color C(int r, int g, int b, int r2, int g2, int b2) { return Claro ? Color.FromArgb(r, g, b) : Color.FromArgb(r2, g2, b2); }
        static Color FUNDO { get { return C(238, 242, 247, 11, 13, 18); } }
        static Color BARRA { get { return C(255, 255, 255, 16, 19, 27); } }
        static Color LINHA { get { return C(225, 231, 239, 29, 34, 48); } }
        static readonly Color ROSA = Color.FromArgb(232, 75, 138);
        static Color CINZA { get { return C(107, 119, 144, 139, 147, 167); } }
        static Color TEXTO { get { return C(15, 27, 61, 255, 255, 255); } }
        static Color PILULA { get { return C(253, 228, 238, 46, 26, 38); } }
        static Color SELECIONADO { get { return C(233, 238, 246, 35, 42, 58); } }

        readonly bool inicioOculto;
        readonly Panel nav = new Panel();
        readonly Panel conteudo = new Panel();
        readonly Dictionary<string, BotaoAba> abas = new Dictionary<string, BotaoAba>();
        WebView2 webApp, webSite, webPainel, webDash;
        // layout novo: barra de cima (abas em pílula, sino), atalhos da esquerda e a janelinha de avisos do sino
        readonly WebView2 webTopo = new WebView2 { Dock = DockStyle.Top, Height = 76, Visible = false };
        readonly WebView2 webRail = new WebView2 { Dock = DockStyle.Left, Width = 78, Visible = false };
        WebView2 webSino;
        bool sinoAberto;
        int sinoX = -1;   // centro do sino (na barra de cima), para a setinha da janelinha apontar para ele
        string helpSub = "inicio";
        readonly Dictionary<string, string> subs = new Dictionary<string, string>();   // página -> partes (abas) que ela tem
        string dashAtual;   // aba (comercial/logistica/admin) que está aberta no webDash
        static readonly Dictionary<string, string> DASH = new Dictionary<string, string> { { "comercial", "dash-comercial.html" }, { "logistica", "dash-logistica.html" }, { "admin", "admin.html" } };
        Panel caixaPainel;
        FlowLayoutPanel chips;
        CoreWebView2Environment env;
        readonly NotifyIcon bandeja = new NotifyIcon();
        readonly System.Windows.Forms.Timer monitor = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer paineis = new System.Windows.Forms.Timer();
        readonly System.Windows.Forms.Timer versao = new System.Windows.Forms.Timer();
        string caminhoPendente;
        string aba = "helpdesk", paginaApp = "", painelAtual, caminhoAviso, destinoSite;
        bool saindo, avisouBandeja, iniciou, criandoTelas;
        long ultimoLoginSite;
        internal readonly Ponte ponte;

        public Janela(bool oculto)
        {
            inicioOculto = oculto;
            ponte = new Ponte(this);
            Text = "Freedom";
            BackColor = FUNDO;
            ForeColor = TEXTO;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1200, 820);
            MinimumSize = new Size(820, 560);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            Font = new Font("Segoe UI", 9f);

            conteudo.Dock = DockStyle.Fill;
            conteudo.BackColor = FUNDO;
            Controls.Add(conteudo);
            MontarNav();   // barra lateral antiga: continua montada (estado das abas), mas não aparece mais
            webTopo.DefaultBackgroundColor = FUNDO; webRail.DefaultBackgroundColor = FUNDO;
            Controls.Add(webRail);
            Controls.Add(webTopo);
            Resize += (s, e) => PosicionarSino();

            bandeja.Icon = Icon ?? SystemIcons.Application;
            bandeja.Text = "Freedom";
            bandeja.Visible = true;
            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir o Freedom", null, (s, e) => Mostrar());
            menu.Items.Add("Verificar o Helpdesk agora", null, (s, e) => ponte.verificarHelpdesk());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair do Freedom", null, (s, e) => { saindo = true; Close(); });
            bandeja.ContextMenuStrip = menu;
            bandeja.DoubleClick += (s, e) => Mostrar();
            bandeja.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) Mostrar(); };
            bandeja.BalloonTipClicked += (s, e) =>
            {
                Mostrar();
                if (caminhoAviso == null) return;
                if (caminhoAviso == "atualizar") { ponte.atualizarApp(); return; }
                if (caminhoAviso.StartsWith("painel:")) { painelAtual = caminhoAviso.Substring(7); MontarChips(); Selecionar("painel"); }
                else AbrirCaminho(caminhoAviso);
            };
            // avisos gerais: fila enviada quando a internet voltou, metas dos painéis
            Avisos.Mostrar += (titulo, texto, caminho) =>
            {
                try
                {
                    BeginInvoke((Action)(() =>
                    {
                        caminhoAviso = caminho;
                        var t = titulo.Length > 63 ? titulo.Substring(0, 62) + "…" : titulo;
                        var x = texto.Length > 250 ? texto.Substring(0, 249) + "…" : texto;
                        Balao(8000, t, x);
                        AvisarHelpdesk();
                    }));
                }
                catch (Exception) { }
            };
            // a internet voltou: manda o que ficou guardado
            System.Net.NetworkInformation.NetworkChange.NetworkAvailabilityChanged += (s, e) =>
            {
                if (e.IsAvailable) Helpdesk.EmSegundoPlano(() => { System.Threading.Thread.Sleep(3000); Fila.Enviar(); });
            };

            Helpdesk.Avisar += notas => BeginInvoke((Action)(() => MostrarAvisos(notas)));
            Helpdesk.Mudou += () => { try { BeginInvoke((Action)(() => { AvisarHelpdesk(); AtualizarSelo(); AjustarAbas(); })); } catch (Exception) { } };

            monitor.Tick += (s, e) =>
            {
                monitor.Interval = Helpdesk.IntervaloSeg() * 1000;
                if (Store.Logado()) Helpdesk.EmSegundoPlano(Helpdesk.Ciclo);
            };
            paineis.Interval = 15 * 60 * 1000;
            paineis.Tick += (s, e) => { if (Store.Logado()) AtualizarPaineis(); };

            HandleCreated += (s, e) => { if (!iniciou) { iniciou = true; IniciarMonitor(); CriarTelas(); } };
            FormClosing += (s, e) =>
            {
                if (!saindo && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    Hide();
                    if (!avisouBandeja)
                    {
                        avisouBandeja = true;
                        bandeja.ShowBalloonTip(4000, "O Freedom continua aqui", "Os avisos do Helpdesk seguem chegando. Para abrir, clique no ícone perto do relógio.", ToolTipIcon.None);
                    }
                }
            };
            FormClosed += (s, e) => { bandeja.Visible = false; bandeja.Dispose(); };
            Resize += (s, e) => { if (WindowState == FormWindowState.Minimized) Hide(); };
        }

        protected override void SetVisibleCore(bool value)
        {
            // aberto junto com o Windows: começa escondido (só o ícone perto do relógio)
            if (inicioOculto && !IsHandleCreated) { CreateHandle(); value = false; }
            base.SetVisibleCore(value);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            BarraTitulo();
        }

        void BarraTitulo()
        {
            try { int sim = Claro ? 0 : 1; DwmSetWindowAttribute(Handle, 20, ref sim, 4); } catch (Exception) { }   // barra de título clara/escura
        }

        /// <summary>Troca claro/escuro: pinta de novo a parte nativa e recarrega as telas com as cores novas.</summary>
        public void DefinirTema(string t)
        {
            t = t == "escuro" ? "escuro" : "claro";
            Prefs.De("aparencia").Edit().Put("tema", t).Commit();
            Claro = t == "claro";
            BackColor = FUNDO; ForeColor = TEXTO; conteudo.BackColor = FUNDO; nav.BackColor = BARRA;
            if (caixaPainel != null) caixaPainel.BackColor = FUNDO;
            if (chips != null) chips.BackColor = FUNDO;
            webTopo.DefaultBackgroundColor = FUNDO; webRail.DefaultBackgroundColor = FUNDO;
            foreach (var w in new[] { webApp, webPainel, webDash, webTopo, webRail, webSino }) if (w != null && w.CoreWebView2 != null) { w.DefaultBackgroundColor = FUNDO; try { w.CoreWebView2.ExecuteScriptAsync("window.temaMudou&&temaMudou(" + "'" + t + "')"); } catch (Exception) { } }
            BarraTitulo();
            MontarChips();
            foreach (var b in abas.Values) b.Invalidate();
            nav.Invalidate();
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int valor, int tamanho);

        public void Mostrar()
        {
            if (webApp == null) CriarTelas();
            if (!Visible) Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
        }

        // ---------------- barra lateral ----------------

        sealed class BotaoAba : Control
        {
            public string Icone, Rotulo;
            public bool Ativa;
            public int Selo;
            public BotaoAba() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true); Cursor = Cursors.Hand; }

            protected override void OnPaint(PaintEventArgs e)
            {
                var g = e.Graphics;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                g.Clear(BARRA);
                var pilula = new Rectangle((Width - 52) / 2, 8, 52, 32);
                if (Ativa)
                    using (var b = new SolidBrush(PILULA))
                    using (var cam = Arredondado(pilula, 16)) g.FillPath(b, cam);
                DesenharIcone(g, Icone, Ativa, pilula, Ativa ? ROSA : CINZA);
                using (var f = new Font("Segoe UI", 8.5f, Ativa ? FontStyle.Bold : FontStyle.Regular))
                using (var b = new SolidBrush(Ativa ? TEXTO : CINZA))
                {
                    var sf = new StringFormat { Alignment = StringAlignment.Center };
                    g.DrawString(Rotulo, f, b, new RectangleF(0, 44, Width, 18), sf);
                }
                if (Selo > 0)
                {
                    var t = Selo > 9 ? "9+" : Selo.ToString();
                    var r = new Rectangle(pilula.Right - 18, pilula.Top - 2, 18, 18);
                    using (var b = new SolidBrush(ROSA)) g.FillEllipse(b, r);
                    using (var f = new Font("Segoe UI", 7f, FontStyle.Bold))
                    using (var b = new SolidBrush(Color.White))
                        g.DrawString(t, f, b, r, new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
                }
            }

            /// <summary>Ícones das abas desenhados em vetor (grade 24×24): contorno na aba normal, preenchido na ativa.
            /// Os mesmos desenhos do app do celular (res/drawable/ic_aba_*.xml).</summary>
            static void DesenharIcone(Graphics g, string id, bool ativa, Rectangle area, Color cor)
            {
                const float tam = 22f;
                var estado = g.Save();
                g.TranslateTransform(area.X + (area.Width - tam) / 2f, area.Y + (area.Height - tam) / 2f);
                g.ScaleTransform(tam / 24f, tam / 24f);
                using (var pen = new Pen(cor, 1.9f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round, LineJoin = System.Drawing.Drawing2D.LineJoin.Round })
                using (var cheio = new SolidBrush(cor))
                using (var leve = new SolidBrush(Color.FromArgb(72, cor)))
                {
                    if (id == "helpdesk")
                    {
                        using (var arco = new System.Drawing.Drawing2D.GraphicsPath())
                        {
                            arco.AddLine(4.6f, 14f, 4.6f, 12.4f);
                            arco.AddArc(4.6f, 5f, 14.8f, 14.8f, 180f, 180f);
                            arco.AddLine(19.4f, 12.4f, 19.4f, 14f);
                            g.DrawPath(pen, arco);
                        }
                        foreach (var x in new[] { 3f, 16.4f })
                            using (var c = Arredondado(x, 13f, 4.6f, 6.8f, 1.9f)) { if (ativa) g.FillPath(cheio, c); g.DrawPath(pen, c); }
                        using (var mic = new System.Drawing.Drawing2D.GraphicsPath())
                        {
                            mic.AddBezier(18.8f, 19.9f, 18.8f, 21.2f, 17.7f, 22.2f, 16.2f, 22.2f);
                            mic.AddLine(16.2f, 22.2f, 13.4f, 22.2f);
                            g.DrawPath(pen, mic);
                        }
                    }
                    else if (id == "site")
                    {
                        if (ativa) g.FillEllipse(leve, 3f, 3f, 18f, 18f);
                        g.DrawEllipse(pen, 3f, 3f, 18f, 18f);
                        g.DrawEllipse(pen, 8.1f, 3f, 7.8f, 18f);
                        g.DrawLine(pen, 3.4f, 9f, 20.6f, 9f);
                        g.DrawLine(pen, 3.4f, 15f, 20.6f, 15f);
                    }
                    else if (id == "comercial")
                    {
                        // gráfico subindo com seta
                        if (ativa) using (var area2 = new System.Drawing.Drawing2D.GraphicsPath()) { area2.AddLines(new[] { new PointF(3f, 17f), new PointF(9f, 11f), new PointF(13f, 15f), new PointF(21f, 7f), new PointF(21f, 20.5f), new PointF(3f, 20.5f) }); g.FillPath(leve, area2); }
                        g.DrawLines(pen, new[] { new PointF(3f, 17f), new PointF(9f, 11f), new PointF(13f, 15f), new PointF(21f, 7f) });
                        g.DrawLines(pen, new[] { new PointF(15f, 7f), new PointF(21f, 7f), new PointF(21f, 13f) });
                    }
                    else if (id == "logistica")
                    {
                        // caminhão
                        using (var c = Arredondado(2.5f, 6f, 11.5f, 10f, 1.6f)) { if (ativa) g.FillPath(cheio, c); g.DrawPath(pen, c); }
                        g.DrawLines(pen, new[] { new PointF(14f, 9.5f), new PointF(18f, 9.5f), new PointF(21.5f, 13f), new PointF(21.5f, 16f), new PointF(14f, 16f) });
                        using (var fundo = new SolidBrush(BARRA)) foreach (var x in new[] { 7f, 17.5f }) { g.FillEllipse(fundo, x - 2.1f, 15.9f, 4.2f, 4.2f); g.DrawEllipse(pen, x - 2.1f, 15.9f, 4.2f, 4.2f); }
                    }
                    else if (id == "admin")
                    {
                        // pessoa com escudo
                        if (ativa) g.FillEllipse(cheio, 5f, 3.5f, 8f, 8f);
                        g.DrawEllipse(pen, 5f, 3.5f, 8f, 8f);
                        using (var corpo = new System.Drawing.Drawing2D.GraphicsPath()) { corpo.AddArc(2.5f, 13.5f, 13f, 13f, 180f, 180f); g.DrawPath(pen, corpo); }
                        using (var esc = new System.Drawing.Drawing2D.GraphicsPath())
                        {
                            esc.AddLines(new[] { new PointF(18f, 10.5f), new PointF(21.8f, 12f), new PointF(21.8f, 15.5f), new PointF(18f, 19.5f), new PointF(14.2f, 15.5f), new PointF(14.2f, 12f) }); esc.CloseFigure();
                            if (ativa) g.FillPath(leve, esc); g.DrawPath(pen, esc);
                        }
                    }
                    else
                    {
                        var blocos = new[] { new[] { 3.5f, 3.5f, 7.2f, 9f }, new[] { 13.3f, 3.5f, 7.2f, 5.2f }, new[] { 13.3f, 11.3f, 7.2f, 9.2f }, new[] { 3.5f, 15.1f, 7.2f, 5.4f } };
                        foreach (var r in blocos)
                            using (var c = Arredondado(r[0], r[1], r[2], r[3], 1.9f)) { if (ativa) g.FillPath(cheio, c); g.DrawPath(pen, c); }
                    }
                }
                g.Restore(estado);
            }

            static System.Drawing.Drawing2D.GraphicsPath Arredondado(float x, float y, float w, float h, float raio)
            {
                var p = new System.Drawing.Drawing2D.GraphicsPath();
                float d = raio * 2;
                p.AddArc(x, y, d, d, 180, 90);
                p.AddArc(x + w - d, y, d, d, 270, 90);
                p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
                p.AddArc(x, y + h - d, d, d, 90, 90);
                p.CloseFigure();
                return p;
            }

            static System.Drawing.Drawing2D.GraphicsPath Arredondado(Rectangle r, int raio)
            {
                var p = new System.Drawing.Drawing2D.GraphicsPath();
                int d = raio * 2;
                p.AddArc(r.X, r.Y, d, d, 180, 90);
                p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
                p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
                p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
                p.CloseFigure();
                return p;
            }
        }

        void MontarNav()
        {
            nav.Dock = DockStyle.Left;
            nav.Width = 84;
            nav.BackColor = BARRA;
            nav.Paint += (s, e) => { using (var p = new Pen(LINHA)) e.Graphics.DrawLine(p, nav.Width - 1, 0, nav.Width - 1, nav.Height); };
            var itens = new[] { new[] { "helpdesk", "helpdesk", "Helpdesk" }, new[] { "comercial", "comercial", "Comercial" }, new[] { "logistica", "logistica", "Logística" }, new[] { "admin", "admin", "Admin" }, new[] { "painel", "painel", "Painel" }, new[] { "site", "site", "Site" } };
            int y = 12;
            foreach (var it in itens)
            {
                var b = new BotaoAba { Icone = it[1], Rotulo = it[2], Bounds = new Rectangle(0, y, 83, 68), Visible = false };
                var id = it[0];
                b.Click += (s, e) =>
                {
                    if (aba == id && id == "site") AbrirUrlSite(Api.SITE + "/");
                    else if (aba == id && id == "helpdesk" && paginaApp == "sub") VoltarHelpdesk();
                    else Selecionar(id);
                };
                nav.Controls.Add(b);
                abas[id] = b;
                y += 72;
            }
        }

        bool AbaDisponivel(string id)
        {
            if (id == "helpdesk") return Acesso.Helpdesk();
            if (id == "painel") return Acesso.Painel();
            if (id == "comercial") return Acesso.Comercial();
            if (id == "logistica") return Acesso.Logistica();
            if (id == "admin") return Acesso.Admin();
            return true;
        }

        void AjustarAbas()
        {
            if (webApp == null) return;
            bool logado = Store.Logado();
            nav.Visible = logado;
            webTopo.Visible = logado && webTopo.CoreWebView2 != null;
            webRail.Visible = logado && webRail.CoreWebView2 != null;
            if (!logado) Sino(false);
            int y = 12;
            foreach (var kv in abas)
            {
                bool v = logado && AbaDisponivel(kv.Key);
                kv.Value.Visible = v;
                if (v) { kv.Value.Top = y; y += 72; }
            }
            if (logado && !AbaDisponivel(aba)) Selecionar(new[] { "helpdesk", "comercial", "logistica", "painel", "site" }.First(AbaDisponivel));
            if (caixaPainel != null) MontarChips();
            AtualizarShell();
        }

        void PintarAbas() { foreach (var kv in abas) { kv.Value.Ativa = kv.Key == aba; kv.Value.Invalidate(); } }

        void AtualizarSelo()
        {
            BotaoAba b;
            if (!abas.TryGetValue("helpdesk", out b)) return;
            b.Selo = aba == "helpdesk" ? 0 : Helpdesk.NaoVistos();
            b.Invalidate();
            int n = Helpdesk.NaoVistos();
            bandeja.Text = n > 0 ? "Freedom · " + n + " novidade(s)" : "Freedom";
            AtualizarShell();
        }

        // ---------------- início ----------------

        void IniciarMonitor()
        {
            monitor.Interval = Helpdesk.IntervaloSeg() * 1000;
            monitor.Start();
            paineis.Start();
            if (Store.Logado())
            {
                Helpdesk.EmSegundoPlano(() => Helpdesk.Verificar(false));
                Helpdesk.EmSegundoPlano(() => Atualizador.Atualizar());
            }
            Helpdesk.EmSegundoPlano(ConferirVersao);
            // continua conferindo com o programa aberto (o Freedom fica o dia todo perto do relógio)
            versao.Interval = 30 * 60 * 1000;
            versao.Tick += (s, e) => Helpdesk.EmSegundoPlano(ConferirVersao);
            versao.Start();
        }

        async void CriarTelas()
        {
            if (webApp != null || criandoTelas) return;
            criandoTelas = true;
            try { await Iniciar(); } finally { criandoTelas = false; }
        }

        async Task Iniciar()
        {
            if (env != null && webApp != null) return;
            if (env == null) try
            {
                var pasta = Pastas.Sub("webview");
                env = await CoreWebView2Environment.CreateAsync(null, pasta, null);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "O Freedom precisa do \"Microsoft Edge WebView2 Runtime\" (já vem no Windows 11).\n\n" +
                    "Baixe em: https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\nDetalhe: " + ex.Message, "Freedom", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
                saindo = true; Close();
                return;
            }
            var w = new WebView2 { DefaultBackgroundColor = FUNDO, Dock = DockStyle.Fill };
            conteudo.Controls.Add(w);
            try { await Preparar(w); }
            catch (Exception) { try { conteudo.Controls.Remove(w); w.Dispose(); } catch (Exception) { } Reiniciar(); return; }
            webApp = w;
            var pend = caminhoPendente; caminhoPendente = null;
            Carregar(pend);
            await PrepararBarras();
        }

        async Task PrepararBarras()
        {
            try
            {
                await Preparar(webTopo); webTopo.CoreWebView2.Navigate(ASSET + "shell.html?modo=topo");
                await Preparar(webRail); webRail.CoreWebView2.Navigate(ASSET + "shell.html?modo=rail");
                AjustarAbas();
            }
            catch (Exception) { }
        }

        // ---------------- barras novas (topo, atalhos, sino) ----------------
        public string ShellJson()
        {
            var o = new JSONObject();
            bool logado = Store.Logado();
            var lista = new JSONArray();
            foreach (var it in new[] { new[] { "helpdesk", "Helpdesk" }, new[] { "comercial", "Comercial" }, new[] { "logistica", "Logística" }, new[] { "admin", "Admin" }, new[] { "painel", "Painel" }, new[] { "site", "Site" } })
                if (logado && AbaDisponivel(it[0])) lista.Put(new JSONArray().Put(it[0]).Put(it[1]));
            o.Put("logado", logado).Put("aba", aba).Put("abas", lista).Put("tema", Claro ? "claro" : "escuro")
             .Put("naoLidos", aba == "helpdesk" ? 0 : Helpdesk.NaoVistos()).Put("sino", sinoAberto).Put("helpSub", helpSub)
             .Put("helpdesk", Acesso.Helpdesk()).Put("email", Store.Email() ?? "").Put("nome", Acesso.Nome() ?? "");
            string pag; string sj;
            if (DASH.TryGetValue(aba, out pag) && subs.TryGetValue(pag, out sj)) try { o.Put("sub", new JSONObject(sj)); } catch (Exception) { }
            try { var wa = WebAtual(); string aj; if (wa != null && wa != webSite && wa.Source != null && acoesTela.TryGetValue(wa.Source.GetLeftPart(UriPartial.Query), out aj)) o.Put("acoes", new JSONObject(aj)); } catch (Exception) { }
            return o.ToString();
        }
        public void AtualizarShell()
        {
            Js(webTopo, "window.shellAtualizar&&shellAtualizar()");
            Js(webRail, "window.shellAtualizar&&shellAtualizar()");
            if (sinoAberto) Js(webSino, "window.recebidoHelpdesk&&recebidoHelpdesk()");
        }
        WebView2 WebAtual()
        {
            if (aba == "helpdesk") return webApp;
            if (aba == "painel") return webPainel;
            if (aba == "site") return webSite;
            return DASH.ContainsKey(aba) ? webDash : webApp;
        }
        public void IrAbaShell(string id)
        {
            Sino(false);
            if (aba == id && id == "site") AbrirUrlSite(Api.SITE + "/");
            else if (aba == id && id == "helpdesk" && paginaApp == "sub") { VoltarHelpdesk(); Js(webApp, "window.F&&F.entrar&&F.entrar()"); }
            else Selecionar(id);
        }
        /// <summary>Atalho da esquerda: troca a parte da tela aberta (Vendedores, Pedidos…).</summary>
        public void IrSub(string id)
        {
            id = System.Text.RegularExpressions.Regex.Replace(id ?? "", "[^A-Za-z0-9_-]", "");
            if (id.Length == 0) return;
            if (aba == "helpdesk")
            {
                helpSub = id;
                if (id == "inicio") VoltarHelpdesk();
                else if (id == "dash") AbrirTela("dash-helpdesk.html");
                else AbrirTela("lista.html#" + id);
                Js(webApp, "setTimeout(function(){window.F&&F.entrar&&F.entrar()},60)");
                AtualizarShell();
                return;
            }
            if (DASH.ContainsKey(aba)) JsDash("(function(){var b=document.querySelector('.tabs:not(.sub) [data-aba=\"" + id + "\"]');if(b)b.click();})()");
        }
        public void AcaoShell(string nome)
        {
            switch (nome)
            {
                case "imagem": case "excel": case "atualizar": Js(WebAtual(), "window.acaoRail&&acaoRail('" + nome + "')"); break;
                case "chamado": Sino(false); helpSub = ""; AbrirTela("novo.html"); break;
                case "claro": case "escuro": DefinirTema(nome); break;
                case "sair": ponte.sair(); break;
                case "config":
                    if (webApp == null || !AbaDisponivel("helpdesk")) break;
                    Sino(false);
                    webApp.CoreWebView2.Navigate(ASSET + "helpdesk.html?config=1"); paginaApp = "sub"; helpSub = "config";
                    Selecionar("helpdesk"); AtualizarShell(); break;
            }
        }
        readonly Dictionary<string, string> acoesTela = new Dictionary<string, string>();
        public void SubAbas(string json)
        {
            try { var a = new JSONObject(json ?? "{}"); if (a.OptInt("acoes", 0) == 1) { var u = a.OptString("url", ""); if (u.Length > 0) { acoesTela[u] = json; AtualizarShell(); } return; } } catch (Exception) { }
            try { var j = new JSONObject(json ?? "{}"); var pag = j.OptString("pagina", ""); if (pag.Length > 0) { subs[pag] = json; AtualizarShell(); } } catch (Exception) { }
        }
        /// <summary>Janelinha de avisos do sino (abre por cima da tela, embaixo do sino).</summary>
        public void Sino(bool abrir, int x) { if (x > 0) sinoX = x; Sino(abrir); }
        public async void Sino(bool abrir)
        {
            if (abrir && webSino == null)
            {
                var w = new WebView2 { DefaultBackgroundColor = FUNDO, Visible = false, Size = new Size(450, 580) };
                Controls.Add(w);
                webSino = w;
                try { await Preparar(w); w.CoreWebView2.Navigate(ASSET + "avisos.html?popup=1&fundo=1&recorte=1"); } catch (Exception) { webSino = null; try { Controls.Remove(w); w.Dispose(); } catch (Exception) { } return; }
            }
            sinoAberto = abrir && webSino != null;
            if (webSino != null)
            {
                PosicionarSino();
                webSino.Visible = sinoAberto;
                if (sinoAberto) { webSino.BringToFront(); webSino.Focus(); Js(webSino, "window.recebidoHelpdesk&&recebidoHelpdesk()"); }
            }
            AtualizarShell();
        }
        void PosicionarSino()
        {
            if (webSino == null) return;
            int w = 450, h = Math.Min(600, Math.Max(320, ClientSize.Height - 80));
            int cx = sinoX > 0 ? sinoX : ClientSize.Width - 330;
            int x = Math.Max(8, Math.Min(ClientSize.Width - w - 8, cx - w + 70));   // a janelinha fica embaixo do sino, alinhada pela direita
            webSino.Bounds = new Rectangle(x, 60, w, h);   // encosta na barra de cima: a setinha sai de dentro dela
            int seta = Math.Max(24, Math.Min(w - 34, cx - x));
            Js(webSino, "window.seta&&seta(" + seta + ")");
            // a janela do WebView2 não fica transparente: recorta o formato do cartão (cantos curvos + setinha)
            try
            {
                const int T = 10, R = 16;
                var p = new System.Drawing.Drawing2D.GraphicsPath();
                p.AddArc(0, T, R * 2, R * 2, 180, 90); p.AddArc(w - R * 2 - 1, T, R * 2, R * 2, 270, 90);
                p.AddArc(w - R * 2 - 1, h - R * 2 - 1, R * 2, R * 2, 0, 90); p.AddArc(0, h - R * 2 - 1, R * 2, R * 2, 90, 90); p.CloseFigure();
                var rg = new Region(p);
                var t = new System.Drawing.Drawing2D.GraphicsPath();
                t.AddPolygon(new[] { new Point(seta - 11, T + 1), new Point(seta, 0), new Point(seta + 11, T + 1) });
                rg.Union(t);
                var velho = webSino.Region; webSino.Region = rg; if (velho != null) velho.Dispose();
            }
            catch (Exception) { }
        }
        public void MarcarLidos() { Helpdesk.MarcarVisto(); AtualizarSelo(); AvisarHelpdesk(); }

        async Task Preparar(WebView2 w)
        {
            await PrepararTela(w);
        }

        /// <summary>Fecha e abre o Freedom de novo (no máximo 1 vez a cada 3 min, para não ficar em laço).</summary>
        public void Reiniciar()
        {
            if (InvokeRequired) { try { BeginInvoke((Action)Reiniciar); } catch (Exception) { } return; }
            if (saindo) return;
            var marca = Path.Combine(Pastas.Raiz, "reinicio.txt");
            try
            {
                long ult; if (File.Exists(marca) && long.TryParse(File.ReadAllText(marca), out ult) && DateTime.UtcNow.Ticks - ult < TimeSpan.FromMinutes(3).Ticks)
                {
                    Balao(10000, "Freedom", "A tela não carregou. Feche o Freedom pelo ícone perto do relógio (Sair) e abra de novo.");
                    return;
                }
                File.WriteAllText(marca, DateTime.UtcNow.Ticks.ToString());
                Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--atualizado") { UseShellExecute = false });
            }
            catch (Exception) { return; }
            EncerrarParaAtualizar();
        }

        async Task PrepararTela(WebView2 w)
        {
            await w.EnsureCoreWebView2Async(env);
            var c = w.CoreWebView2;
            c.ProcessFailed += (s, e) =>
            {
                if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) Reiniciar();
                else if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                    try { BeginInvoke((Action)(() => { try { c.Reload(); } catch (Exception) { } })); } catch (Exception) { }
            };
            c.SetVirtualHostNameToFolderMapping(HOST, Pastas.Sub("www"), CoreWebView2HostResourceAccessKind.Allow);
            c.AddHostObjectToScript("App", ponte);
            await c.AddScriptToExecuteOnDocumentCreatedAsync(
                "try{if(location.host==='" + HOST + "'){window.App=chrome.webview.hostObjects.sync.App;}}catch(e){}");
            c.Settings.AreDevToolsEnabled = false;
            c.Settings.IsStatusBarEnabled = false;
            c.Settings.IsZoomControlEnabled = true;
            c.NavigationStarting += (s, e) =>
            {
                if (e.Uri.StartsWith(ASSET))
                {
                    if (w == webApp) paginaApp = e.Uri.Contains("login.html") ? "login" : e.Uri.Contains("helpdesk.html") ? "helpdesk" : "sub";
                    return;
                }
                e.Cancel = true;
                AbrirExterno(e.Uri);
            };
            c.NewWindowRequested += (s, e) => { e.Handled = true; AbrirExterno(e.Uri); };
        }

        void AbrirExterno(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return;
            if (u.Host == SITE_HOST) AbrirCaminho(url);
            else if (u.Scheme == "https" || u.Scheme == "http" || u.Scheme == "mailto") try { Process.Start(url); } catch (Exception) { }
        }

        public void Carregar(string caminho)
        {
            if (webApp == null) return;
            if (!Store.Logado())
            {
                foreach (var w in new[] { webSite, webPainel, webDash }) if (w != null) w.Visible = false;
                if (caixaPainel != null) caixaPainel.Visible = false;
                webApp.Visible = true;
                if (paginaApp != "login") { webApp.CoreWebView2.Navigate(ASSET + "login.html"); paginaApp = "login"; }
                AjustarAbas();
                return;
            }
            if (paginaApp != "helpdesk" && paginaApp != "sub") { webApp.CoreWebView2.Navigate(ASSET + "helpdesk.html"); paginaApp = "helpdesk"; }
            AjustarAbas();
            if (caminho != null) AbrirCaminho(caminho); else Selecionar(aba);
        }

        public void Selecionar(string nova)
        {
            if (webApp == null) { aba = nova; return; }
            if (!AbaDisponivel(nova) && Store.Logado()) nova = new[] { "helpdesk", "comercial", "logistica", "painel", "site" }.First(AbaDisponivel);
            bool trocou = aba != nova;
            aba = nova;
            webApp.Visible = nova == "helpdesk" || !Store.Logado();
            if (nova == "site") GarantirSite(null);
            if (webSite != null) webSite.Visible = nova == "site";
            if (nova == "painel") GarantirPainel();
            if (caixaPainel != null) caixaPainel.Visible = nova == "painel";
            if (DASH.ContainsKey(nova)) GarantirDash(nova);
            if (webDash != null) webDash.Visible = DASH.ContainsKey(nova);
            PintarAbas();
            if (nova == "helpdesk") { Helpdesk.MarcarVisto(); AvisarHelpdesk(); }
            if (nova == "painel" && Atualizador.Velho(2)) AtualizarPaineis();
            AtualizarSelo();
            // a tela nova entra embaçada e sobe um pouco até ficar em foco
            if (trocou && nova != "site") Js(WebAtual(), "window.F&&F.entrar&&F.entrar()");
            AtualizarShell();
        }

        // ---------------- telas do Helpdesk ----------------

        static readonly System.Text.RegularExpressions.Regex RE_CHAMADO =
            new System.Text.RegularExpressions.Regex(@"^(?:https://relatorios\.cbfreedom\.com\.br)?/helpdesk/tickets/(\d+)/?$");

        public void AbrirCaminho(string caminho)
        {
            if (webApp == null) { caminhoPendente = caminho; CriarTelas(); return; }
            var m = RE_CHAMADO.Match((caminho ?? "").Trim());
            int id;
            if (m.Success && int.TryParse(m.Groups[1].Value, out id) && Acesso.Helpdesk()) AbrirChamado(id);
            else AbrirNoSite(caminho);
        }

        public void AbrirChamado(int id)
        {
            if (webApp == null) { caminhoPendente = "/helpdesk/tickets/" + id; CriarTelas(); return; }
            webApp.CoreWebView2.Navigate(ASSET + "chamado.html#" + id);
            paginaApp = "sub"; helpSub = "";
            Selecionar("helpdesk");
        }

        public void AbrirTela(string arquivo)
        {
            if (webApp == null) return;
            var nome = arquivo.Split('#')[0];
            var resto = arquivo.Contains("#") ? arquivo.Substring(arquivo.IndexOf('#') + 1) : "";
            if (!TELAS.Contains(nome) || !System.Text.RegularExpressions.Regex.IsMatch(resto, "^[A-Za-z0-9_=&%.-]*$")) return;
            webApp.CoreWebView2.Navigate(ASSET + arquivo);
            paginaApp = "sub";
            helpSub = nome == "dash-helpdesk.html" ? "dash" : nome == "lista.html" ? (resto.Split('&')[0] == "" ? "fila" : resto.Split('&')[0]) : "";
            Selecionar("helpdesk");
        }

        public void VoltarHelpdesk() { if (webApp == null) return; webApp.CoreWebView2.Navigate(ASSET + "helpdesk.html"); paginaApp = "helpdesk"; helpSub = "inicio"; AtualizarShell(); }

        public void VoltarApp()
        {
            if (webApp == null) return;
            if (webApp.CoreWebView2.CanGoBack && paginaApp == "sub") webApp.CoreWebView2.GoBack();
            else VoltarHelpdesk();
        }

        public void Js(WebView2 w, string codigo)
        {
            if (w == null) return;
            try { BeginInvoke((Action)(async () => { try { if (w.CoreWebView2 != null) await w.CoreWebView2.ExecuteScriptAsync(codigo); } catch (Exception) { } })); }
            catch (Exception) { }
        }

        public void JsApp(string codigo) { Js(webApp, codigo); }
        public void JsPainel(string codigo) { Js(webPainel, codigo); }
        public void JsDash(string codigo) { Js(webDash, codigo); }
        /// <summary>Aviso (toast) em qualquer tela aberta: painel, Comercial/Logística/Admin ou Helpdesk.</summary>
        public void JsToast(string codigo) { Js(webPainel, codigo); Js(webDash, codigo); Js(webApp, codigo); }

        public void AvisarHelpdesk() { if (paginaApp != "login") Js(webApp, "window.recebidoHelpdesk && recebidoHelpdesk()"); }
        public void AvisarPainel() { Js(webPainel, "window.recebido && recebido()"); }
        public void AvisarTodas() { AvisarHelpdesk(); AvisarPainel(); }

        public void AtualizarPaineis()
        {
            Atualizador.Atualizando = true;
            AvisarPainel();
            Helpdesk.EmSegundoPlano(() =>
            {
                Atualizador.Atualizar();
                try { BeginInvoke((Action)(() => { AvisarPainel(); AjustarAbas(); })); } catch (Exception) { }
            });
        }

        // ---------------- avisos ----------------

        void MostrarAvisos(List<Engine.Note> notas)
        {
            if (notas.Count == 0) return;
            string titulo, texto;
            if (notas.Count == 1)
            {
                var n = notas[0];
                titulo = n.Title;
                texto = string.Join("\n", n.Lines.Count > 0 ? n.Lines.Skip(Math.Max(0, n.Lines.Count - 3)) : new[] { n.Text });
                caminhoAviso = n.Path;
            }
            else
            {
                titulo = notas.Count + " novidades no Helpdesk";
                texto = string.Join("\n", notas.Take(4).Select(n => n.Title + ": " + n.Text));
                caminhoAviso = null;
            }
            if (titulo.Length > 63) titulo = titulo.Substring(0, 62) + "…";
            if (texto.Length > 250) texto = texto.Substring(0, 249) + "…";
            Balao(8000, titulo, texto);
            AtualizarSelo();
            AvisarHelpdesk();
        }

        public void Teste()
        {
            caminhoAviso = null;
            bandeja.ShowBalloonTip(6000, "Teste · Helpdesk Freedom", "Assim chegam os avisos: novo chamado, resposta, mudança de status…", ToolTipIcon.None);
        }

        // ---------------- Comercial, Logística e Administração (telas completas, iguais ao site) ----------------

        bool preparandoDash; int falhasDash;
        async void GarantirDash(string id)
        {
            // tela que falhou ao preparar (motor do WebView2 caiu): descarta e cria de novo, em vez de ficar em branco para sempre
            if (webDash != null && webDash.CoreWebView2 == null && !preparandoDash)
            {
                try { conteudo.Controls.Remove(webDash); webDash.Dispose(); } catch (Exception) { }
                webDash = null; dashAtual = null;
            }
            if (webDash == null)
            {
                var w = new WebView2 { DefaultBackgroundColor = FUNDO, Dock = DockStyle.Fill, Visible = false };
                conteudo.Controls.Add(w);
                w.BringToFront();
                webDash = w; preparandoDash = true;
                try { await Preparar(w); falhasDash = 0; }
                catch (Exception)
                {
                    preparandoDash = false;
                    try { conteudo.Controls.Remove(w); w.Dispose(); } catch (Exception) { }
                    if (webDash == w) { webDash = null; dashAtual = null; }
                    if (++falhasDash <= 1) { await Task.Delay(800); if (DASH.ContainsKey(aba)) GarantirDash(aba); }
                    else Reiniciar();   // falhou de novo: reabre o app sozinho
                    return;
                }
                preparandoDash = false;
                if (!DASH.ContainsKey(aba)) return;   // enquanto preparava, a pessoa foi para outra aba
                id = aba;
            }
            if (webDash.CoreWebView2 == null) return;   // ainda preparando: quem criou abre a tela certa
            webDash.BringToFront();
            webDash.Visible = aba == id;
            if (dashAtual != id) { dashAtual = id; webDash.CoreWebView2.Navigate(ASSET + DASH[id] + "#aba=1"); }
        }

        // ---------------- painel ----------------

        async void GarantirPainel()
        {
            if (caixaPainel == null)
            {
                caixaPainel = new Panel { Dock = DockStyle.Fill, BackColor = FUNDO };
                chips = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 52, Padding = new Padding(16, 12, 16, 0), BackColor = FUNDO, WrapContents = false };
                caixaPainel.Controls.Add(chips);
                conteudo.Controls.Add(caixaPainel);
                caixaPainel.BringToFront();
                var w = new WebView2 { DefaultBackgroundColor = FUNDO, Dock = DockStyle.Fill };
                caixaPainel.Controls.Add(w);
                w.BringToFront();
                try { await Preparar(w); }
                catch (Exception) { try { conteudo.Controls.Remove(caixaPainel); caixaPainel.Dispose(); } catch (Exception) { } caixaPainel = null; chips = null; Reiniciar(); return; }
                webPainel = w;
                MontarChips();
            }
            caixaPainel.Visible = aba == "painel";
        }

        void MontarChips()
        {
            if (chips == null) return;
            var lista = Paineis.ParaAbaPainel();
            chips.Controls.Clear();
            chips.Visible = lista.Count > 1;
            if (lista.Count == 0) return;
            if (lista.All(p => p.Id != painelAtual)) { painelAtual = lista[0].Id; if (webPainel != null) webPainel.CoreWebView2.Navigate(ASSET + lista[0].Tela); }
            else if (webPainel != null && webPainel.Source != null && !webPainel.Source.ToString().Contains(Paineis.PorId(painelAtual).Tela) && !webPainel.Source.ToString().Contains(painelAtual == "comercial" ? "dash-comercial.html" : "dash-logistica.html"))
                webPainel.CoreWebView2.Navigate(ASSET + Paineis.PorId(painelAtual).Tela);
            foreach (var p in lista)
            {
                bool sel = p.Id == painelAtual;
                var b = new Button
                {
                    Text = p.NomeModulo, AutoSize = true, FlatStyle = FlatStyle.Flat, Height = 32, Cursor = Cursors.Hand,
                    BackColor = sel ? SELECIONADO : FUNDO, ForeColor = sel ? TEXTO : CINZA,
                    Font = new Font("Segoe UI", 10f, sel ? FontStyle.Bold : FontStyle.Regular), Margin = new Padding(0, 0, 8, 0), Padding = new Padding(10, 0, 10, 0)
                };
                b.FlatAppearance.BorderColor = LINHA;
                var id = p.Id;
                b.Click += (s, e) => { painelAtual = id; MontarChips(); };
                chips.Controls.Add(b);
            }
        }

        // ---------------- site ----------------

        void GarantirSite(string url)
        {
            if (webSite != null) return;
            webSite = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.White, Visible = false };
            conteudo.Controls.Add(webSite);
            webSite.BringToFront();
            destinoSite = url ?? Api.SITE + "/";
            webSite.CoreWebView2InitializationCompleted += (s, e) =>
            {
                if (!e.IsSuccess) return;
                var c = webSite.CoreWebView2;
                c.Settings.IsStatusBarEnabled = false;
                c.NewWindowRequested += (s2, e2) =>
                {
                    Uri u;
                    if (Uri.TryCreate(e2.Uri, UriKind.Absolute, out u) && u.Host == SITE_HOST) { e2.Handled = true; c.Navigate(e2.Uri); }
                    else { e2.Handled = true; try { Process.Start(e2.Uri); } catch (Exception) { } }
                };
                c.NavigationStarting += (s2, e2) =>
                {
                    Uri u;
                    if (!Uri.TryCreate(e2.Uri, UriKind.Absolute, out u) || u.Host != SITE_HOST) return;
                    // caiu na tela de login do site: entra sozinho com o login do app
                    if (u.AbsolutePath.StartsWith("/login") && Store.Logado() && Relogio.Agora() - ultimoLoginSite > 20000)
                    {
                        e2.Cancel = true;
                        EntrarNoSite();
                    }
                };
                EntrarNoSite();
            };
            webSite.EnsureCoreWebView2Async(env);
        }

        void EntrarNoSite()
        {
            ultimoLoginSite = Relogio.Agora();
            var destino = destinoSite ?? Api.SITE + "/";
            Helpdesk.EmSegundoPlano(() =>
            {
                List<System.Net.Cookie> cookies = null;
                try
                {
                    var l = Store.Login();
                    if (l != null) { var api = new Api(l.Value.Key, l.Value.Value); api.Entrar(); cookies = api.Cookies; }
                }
                catch (Exception) { }
                BeginInvoke((Action)(() =>
                {
                    try
                    {
                        var cm = webSite.CoreWebView2.CookieManager;
                        if (cookies != null) foreach (var ck in cookies)
                        {
                            if (string.IsNullOrEmpty(ck.Domain)) ck.Domain = SITE_HOST;
                            cm.AddOrUpdateCookie(cm.CreateCookieWithSystemNetCookie(ck));
                        }
                        webSite.CoreWebView2.Navigate(destino);
                    }
                    catch (Exception) { }
                }));
            });
        }

        public void AbrirNoSite(string caminho)
        {
            if (string.IsNullOrEmpty(caminho)) caminho = "/";
            Uri u;
            if (caminho.Contains("://") && (!Uri.TryCreate(caminho, UriKind.Absolute, out u) || u.Host != SITE_HOST)) { AbrirExterno(caminho); return; }
            var url = caminho.Contains("://") ? caminho : Api.SITE + (caminho.StartsWith("/") ? caminho : "/" + caminho);
            bool nova = webSite == null;
            GarantirSite(url);
            Selecionar("site");
            if (!nova) AbrirUrlSite(url);
        }

        void AbrirUrlSite(string url)
        {
            destinoSite = url;
            if (webSite != null && webSite.CoreWebView2 != null) webSite.CoreWebView2.Navigate(url);
        }

        public void SairDoApp()
        {
            Store.Sair();
            Helpdesk.Sair();
            Acesso.Limpar();
            try { if (webSite != null && webSite.CoreWebView2 != null) webSite.CoreWebView2.CookieManager.DeleteAllCookies(); } catch (Exception) { }
            if (webSite != null) { conteudo.Controls.Remove(webSite); webSite.Dispose(); webSite = null; }
            if (caixaPainel != null) { conteudo.Controls.Remove(caixaPainel); caixaPainel.Dispose(); caixaPainel = null; webPainel = null; chips = null; }
            if (webDash != null) { conteudo.Controls.Remove(webDash); webDash.Dispose(); webDash = null; dashAtual = null; }
            aba = "helpdesk";
            paginaApp = "";
            Carregar(null);
        }

        /// <summary>Aviso perto do relógio. O Windows não aceita texto vazio (os avisos curtos só têm título): aí o título vira o texto.</summary>
        void Balao(int ms, string titulo, string texto)
        {
            titulo = (titulo ?? "").Trim(); texto = (texto ?? "").Trim();
            if (texto.Length == 0) { texto = titulo.Length > 0 ? titulo : "Freedom"; titulo = "Freedom"; }
            if (titulo.Length == 0) titulo = "Freedom";
            try { bandeja.ShowBalloonTip(ms, titulo, texto, ToolTipIcon.None); } catch (Exception) { }
        }

        public void EncerrarParaAtualizar() { saindo = true; Close(); }

        /// <summary>Confere se saiu versão nova; na primeira vez de cada versão, mostra a notificação (clicar já atualiza).</summary>
        void ConferirVersao()
        {
            // interruptor remoto (controle.json no GitHub): bloqueado = sai da conta e apaga o que guardou
            Controle.Conferir(false);
            if (Controle.PrecisaSair()) try { BeginInvoke((Action)SairDoApp); } catch (Exception) { }
            Atualizacao.Conferir(false);
            try { BeginInvoke((Action)AvisarTodas); } catch (Exception) { }
            var n = Atualizacao.Nova();
            if (n == null) return;
            var P = Prefs.De("atualizacao");
            if (P.GetLong("avisada") == n.OptLong("versao")) return;
            P.Edit().Put("avisada", n.OptLong("versao")).Commit();
            try
            {
                BeginInvoke((Action)(() =>
                {
                    caminhoAviso = "atualizar";
                    bandeja.ShowBalloonTip(10000, "Nova versão do Freedom", "A versão " + (n.OptString("nome").Length > 0 ? n.OptString("nome") : n.OptLong("versao").ToString()) + " está disponível. Clique aqui para atualizar.", ToolTipIcon.None);
                }));
            }
            catch (Exception) { }
        }
    }
}
