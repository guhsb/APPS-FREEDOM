using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Freedom
{
    /// <summary>
    /// "App" que as telas (as mesmas do celular) chamam pelo JavaScript.
    /// Mesmos nomes de métodos da Ponte do Android.
    /// </summary>
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.AutoDual)]
    public class Ponte
    {
        readonly Janela j;
        public Ponte(Janela j) { this.j = j; }

        static int N(object o) { try { return Convert.ToInt32(o); } catch (Exception) { return 0; } }
        static string Q(string s) { return JSONObject.Quote(s ?? ""); }
        void Ui(Action a) { try { j.BeginInvoke(a); } catch (Exception) { } }
        static void Fundo(Action a) { Helpdesk.EmSegundoPlano(a); }

        public string nome() { return "Freedom"; }
        public string plataforma() { return "windows"; }
        public string tema() { return Janela.Claro ? "claro" : "escuro"; }
        public void definirTema(string t) { Ui(() => j.DefinirTema(t)); }

        public string dadosPainel(string id) { return Atualizador.DadosPainel(id); }
        public string dados() { var l = Paineis.ParaAbaPainel(); return Atualizador.DadosPainel(l.Count > 0 ? l[0].Id : ""); }
        public void atualizar() { Ui(j.AtualizarPaineis); }

        /// <summary>Painel num período escolhido (não muda o que fica guardado).</summary>
        public void buscarPainel(string id, string inicio, string fim)
        {
            Fundo(() =>
            {
                JSONObject dados = null; string erro = "";
                try
                {
                    var p = Paineis.PorId(id);
                    var l = Store.Login();
                    if (l == null) throw new ErroLogin("faça o login");
                    var api = new Api(l.Value.Key, l.Value.Value);
                    api.Entrar();
                    try { if (p != null && p.BuscarPeriodo != null) dados = p.BuscarPeriodo(api, inicio, fim); } finally { api.Sair(); }
                    if (dados == null) erro = "este painel não tem escolha de período";
                }
                catch (Exception e) { erro = Api.Mensagem(e); }
                j.JsPainel("window.painelPeriodo && painelPeriodo(" + (dados != null ? dados.ToString() : "null") + "," + Q(erro) + ")");
            });
        }

        public void configurarAvisoMeta(bool ligado)
        {
            Metas.Ligar(ligado);
            j.JsPainel("window.F && F.toast && F.toast(" + Q(ligado ? "Avisos de meta ligados" : "Avisos de meta desligados") + ")");
        }

        // ---- imagem (PNG) dos painéis ----
        /// <summary>Copia a imagem para colar no WhatsApp, e-mail, Teams…</summary>
        public void copiarImagem(string base64)
        {
            byte[] dados;
            try { dados = Convert.FromBase64String(base64 ?? ""); } catch (Exception) { return; }
            Ui(() =>
            {
                try
                {
                    var png = new System.IO.MemoryStream(dados);
                    using (var img = System.Drawing.Image.FromStream(new System.IO.MemoryStream(dados)))
                    {
                        var obj = new DataObject();
                        obj.SetData(DataFormats.Bitmap, true, new System.Drawing.Bitmap(img));
                        obj.SetData("PNG", false, png);
                        Clipboard.SetDataObject(obj, true);
                    }
                    j.JsPainel("window.F && F.toast && F.toast('Imagem copiada. É só colar (Ctrl+V) no WhatsApp ou no e-mail.')");
                }
                catch (Exception e) { j.JsPainel("window.F && F.toast && F.toast(" + Q("Não consegui copiar: " + e.Message) + ")"); }
            });
        }

        /// <summary>Salva em Imagens\Freedom e mostra o arquivo no Explorer.</summary>
        public void salvarImagem(string base64, string nome)
        {
            Fundo(() =>
            {
                try
                {
                    var dados = Convert.FromBase64String(base64 ?? "");
                    var pasta = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Freedom");
                    System.IO.Directory.CreateDirectory(pasta);
                    var seguro = string.Join("_", (nome ?? "Freedom.png").Split(System.IO.Path.GetInvalidFileNameChars()));
                    if (!seguro.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) seguro += ".png";
                    var arq = System.IO.Path.Combine(pasta, seguro);
                    System.IO.File.WriteAllBytes(arq, dados);
                    try { Process.Start("explorer.exe", "/select,\"" + arq + "\""); } catch (Exception) { }
                    j.JsPainel("window.F && F.toast && F.toast('Imagem salva em Imagens › Freedom')");
                }
                catch (Exception e) { j.JsPainel("window.F && F.toast && F.toast(" + Q("Não consegui salvar: " + e.Message) + ")"); }
            });
        }

        public void entrar(string email, string senha)
        {
            var e = (email ?? "").Trim();
            Fundo(() =>
            {
                Controle.Conferir(true);
                var b = Controle.Estado(e);
                if (b != null) { j.JsApp("erroLogin(" + Q(b.OptString("mensagem")) + ")"); return; }
                try
                {
                    var api = new Api(e, senha);
                    api.Entrar();
                    Acesso.Atualizar(api);
                    api.Sair();
                    Store.SalvarLogin(e, senha);
                    Ui(() => j.Carregar(null));
                    Helpdesk.Verificar(true);
                    Ui(j.AtualizarPaineis);
                    Ui(j.AvisarHelpdesk);
                }
                catch (Exception x) { j.JsApp("erroLogin(" + Q(Api.Mensagem(x)) + ")"); }
            });
        }

        public void sair() { Ui(j.SairDoApp); }

        /// <summary>Interruptor remoto: {} = liberado; senão {tipo, mensagem} (a tela de login mostra o aviso).</summary>
        public string controle() { var b = Controle.Estado(); return b == null ? "{}" : b.ToString(); }

        // ---- Helpdesk ----
        public string helpdesk() { return Helpdesk.ResumoTela().ToString(); }

        public void verificarHelpdesk()
        {
            Fundo(() =>
            {
                Helpdesk.Verificar(true);
                Ui(j.AvisarHelpdesk);
            });
        }

        public void configurarHelpdesk(string json)
        {
            try { Helpdesk.Configurar(new JSONObject(json)); } catch (Exception) { }
            Ui(j.AvisarHelpdesk);
        }

        public void abrirSite(string caminho) { Ui(() => j.AbrirCaminho(caminho)); }
        public void siteDireto(string caminho) { Ui(() => j.AbrirNoSite(caminho)); }
        public void aba(string nome) { Ui(() => j.Selecionar(nome)); }
        public void abrirTela(string arquivo) { Ui(() => j.AbrirTela(arquivo ?? "")); }
        public void voltar() { Ui(j.VoltarApp); }

        // no Windows não há bateria/canal: abre as configurações de notificação do sistema
        public void liberarBateria() { }
        public void configurarNotificacoes() { try { Process.Start("ms-settings:notifications"); } catch (Exception) { } }
        public void configurarSom() { configurarNotificacoes(); }
        public void testarNotificacao() { Ui(j.Teste); }

        // ---- tela do chamado ----
        public void carregarChamado(object idO)
        {
            int id = N(idO);
            Fundo(() =>
            {
                var r = Chamado.Historico(id);
                j.JsApp("window.chamadoCarregado && chamadoCarregado(" + id + "," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + "," +
                        (r.Dados != null ? r.Dados.ToString() : "null") + ")");
            });
        }

        public void responderChamado(object idO, string texto)
        {
            int id = N(idO);
            Fundo(() =>
            {
                var r = Chamado.Responder(id, texto);
                j.JsApp("window.chamadoAcao && chamadoAcao(" + id + ",'responder'," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + ")");
            });
        }

        public void assumirChamado(object idO) { operarChamado(idO, "assumir", ""); }

        public void operarChamado(object idO, string tipo, string valor)
        {
            int id = N(idO);
            Fundo(() =>
            {
                var r = Chamado.Operar(id, tipo, valor);
                j.JsApp("window.chamadoAcao && chamadoAcao(" + id + "," + Q(tipo) + "," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + ")");
            });
        }

        public void anexosChamado(object idO)
        {
            int id = N(idO);
            Fundo(() =>
            {
                var r = Chamado.Anexos(id);
                var itens = r.Dados != null && r.Dados.OptJSONArray("items") != null ? r.Dados.OptJSONArray("items").ToString() : "[]";
                j.JsApp("window.chamadoAnexos && chamadoAnexos(" + id + "," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + "," + itens + ")");
            });
        }

        /// <summary>Anexo escolhido na tela "Abrir chamado": enviado depois que o chamado é criado.</summary>
        public void enviarAnexoNovo(object seqO, object idO, string nome, string tipo, string base64)
        {
            int seq = N(seqO), id = N(idO);
            Fundo(() =>
            {
                Chamado.Resultado r;
                try { r = Chamado.Anexar(id, nome ?? "arquivo", Convert.FromBase64String(base64 ?? "")); }
                catch (Exception) { r = new Chamado.Resultado(false, "Não consegui ler o arquivo"); }
                j.JsApp("window.novoAnexo && novoAnexo(" + seq + "," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + ")");
            });
        }

        public void anexarChamado(object idO)
        {
            int id = N(idO);
            Ui(() =>
            {
                using (var d = new OpenFileDialog
                {
                    Title = "Escolher arquivo para anexar",
                    Filter = "Arquivos aceitos|*.pdf;*.png;*.jpg;*.jpeg;*.txt;*.xls;*.xlsx;*.doc;*.docx|Todos os arquivos|*.*"
                })
                {
                    if (d.ShowDialog(j) != DialogResult.OK) { j.JsApp("window.chamadoAcao && chamadoAcao(" + id + ",'anexo',false,'')"); return; }
                    var arq = d.FileName;
                    j.JsApp("window.chamadoEnviandoAnexo && chamadoEnviandoAnexo(" + id + "," + Q(System.IO.Path.GetFileName(arq)) + ")");
                    Fundo(() =>
                    {
                        var r = Chamado.Anexar(id, arq);
                        j.JsApp("window.chamadoAcao && chamadoAcao(" + id + ",'anexo'," + (r.Ok ? "true" : "false") + "," + Q(r.Mensagem) + ")");
                    });
                }
            });
        }

        public void baixarAnexo(object idO, object anexoO, string nome)
        {
            int id = N(idO), anexo = N(anexoO);
            Fundo(() =>
            {
                var arq = Chamado.BaixarAnexo(id, anexo, nome);
                if (arq != null) try { Process.Start("explorer.exe", "/select,\"" + arq + "\""); } catch (Exception) { }
                else j.JsApp("window.F && F.toast && F.toast('Não consegui baixar o anexo')");
            });
        }

        /// <summary>Acesso direto à API do Helpdesk (só endereços do Helpdesk).</summary>
        public void api(object reqO, string metodo, string caminho, string corpo)
        {
            int req = N(reqO);
            Fundo(() =>
            {
                var r = Chamado.Requisicao(metodo, caminho, corpo);
                var cod = "window.apiResposta && apiResposta(" + req + "," + r.Status + "," + Q(r.Body) + ")";
                // a tela que pediu pode ser o Helpdesk ou o painel (dashboards): entrega para as duas, cada uma só pega o próprio número
                j.JsApp(cod);
                j.JsPainel(cod);
                j.JsDash(cod);
            });
        }

        // ---- atualização do app ----
        public void atualizarApp()
        {
            Fundo(() =>
            {
                // sempre confere o GitHub na hora: se saíram várias versões, baixa direto a última (não uma por vez)
                {
                    int r = Atualizacao.Conferir(true);
                    if (r <= 0)
                    {
                        j.JsApp("window.F && F.toast && F.toast(" + Q(r == 0 ? "O app já está na versão mais nova" : "Não consegui verificar agora") + ")");
                        Ui(j.AvisarTodas);
                        return;
                    }
                }
                if (Atualizacao.BaixarEInstalar(() => Ui(j.AvisarTodas))) Ui(j.EncerrarParaAtualizar);
            });
        }

        public void atualizarPeloNavegador() { try { Process.Start(Atualizacao.Pagina()); } catch (Exception) { } }

        public void copiarDiagnostico()
        {
            Ui(() =>
            {
                try { Clipboard.SetText(Helpdesk.TextoDiagnostico()); j.JsApp("window.F && F.toast && F.toast('Diagnóstico copiado. Cole na conversa com o suporte.')"); }
                catch (Exception) { }
            });
        }
    }
}
