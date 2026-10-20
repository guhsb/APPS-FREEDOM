using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Freedom
{
    /// <summary>Ações num chamado (mesmos endereços do site), igual ao Chamado.kt do Android.</summary>
    public static class Chamado
    {
        public sealed class Resultado
        {
            public readonly bool Ok; public readonly string Mensagem; public readonly JSONObject Dados;
            public Resultado(bool ok, string m, JSONObject d = null) { Ok = ok; Mensagem = m; Dados = d; }
        }

        static readonly Dictionary<string, string> ERROS = new Dictionary<string, string>
        {
            { "helpdesk_ticket_already_assigned", "Este chamado já foi assumido por outro atendente." },
            { "stale_ticket_version", "O chamado foi alterado por outro usuário. Tente de novo." },
            { "helpdesk_forbidden", "Seu acesso de atendimento não está disponível." },
            { "resolved_helpdesk_ticket", "Este chamado já foi resolvido." },
            { "invalid_ticket_transition", "Esta alteração de status não está mais disponível." },
            { "invalid_helpdesk_assignee", "O responsável escolhido não pode atender este chamado." },
            { "inactive_helpdesk_queue", "O setor de destino não está disponível." },
        };

        /// <summary>Usa a sessão guardada; se venceu, entra de novo e repete.</summary>
        static Engine.Resp Chamar(string metodo, string caminho, JSONObject corpo)
        {
            var login = Store.Login();
            if (login == null) throw new ErroLogin("faça o login no app");
            var hp = Helpdesk.P;
            var api = new Api(login.Value.Key, login.Value.Value, hp.GetString("cookie", ""));
            if (api.Cookie.Length == 0) { api.Entrar(); hp.Edit().Put("cookie", api.Cookie).Commit(); }
            var r = metodo == "GET" ? api.Bruto(caminho) : api.Enviar(metodo, caminho, corpo);
            if (r.Status == 401)
            {
                api = new Api(login.Value.Key, login.Value.Value);
                api.Entrar();
                hp.Edit().Put("cookie", api.Cookie).Commit();
                r = metodo == "GET" ? api.Bruto(caminho) : api.Enviar(metodo, caminho, corpo);
            }
            return r;
        }

        // Gravações que as telas do app podem fazer no site: só estas (as mesmas que o site faz na Logística e na Administração).
        static readonly KeyValuePair<string, System.Text.RegularExpressions.Regex>[] ESCRITAS = new[] {
            E("PUT", @"^/logistics/pending/orders/[^/]+/control$"),
            E("POST", @"^/logistics/standby/selections$"), E("PUT", @"^/logistics/standby/selections/\d+$"), E("DELETE", @"^/logistics/standby/selections/\d+$"),
            E("POST", @"^/logistics/report/snapshots$"),
            E("POST", @"^/logistics/report/products$"), E("PUT", @"^/logistics/report/products/\d+$"), E("DELETE", @"^/logistics/report/products/\d+$"),
            E("POST", @"^/logistics/billing/report/exclusions/(orders|customers|order-types)$"), E("DELETE", @"^/logistics/billing/report/exclusions/(orders|customers|order-types)/[^/]+$"),
            E("POST", @"^/logistics/billing/daily/exclusions/(customers|order-types)$"), E("DELETE", @"^/logistics/billing/daily/exclusions/(customers|order-types)/[^/]+$"),
            E("POST", @"^/admin/users$"), E("PATCH", @"^/admin/users/[^/]+$"), E("POST", @"^/admin/users/[^/]+/(activate|deactivate|reset-password)$")
        };
        static KeyValuePair<string, System.Text.RegularExpressions.Regex> E(string m, string re) { return new KeyValuePair<string, System.Text.RegularExpressions.Regex>(m, new System.Text.RegularExpressions.Regex(re)); }

        /// <summary>Helpdesk como antes; consultas de dashboards/Logística/Administração; e só as gravações da lista acima.</summary>
        public static bool Permitido(string m, string caminho)
        {
            if (caminho == null || caminho.Contains("..") || !caminho.StartsWith("/")) return false;
            var p = caminho.Split('?')[0];
            if (p.StartsWith("/helpdesk/admin/")) return m == "GET" || m == "POST" || m == "PATCH" || m == "PUT" || m == "DELETE";   // Administração do Helpdesk (o site confere quem pode)
            if (p.StartsWith("/helpdesk/")) return m == "GET" || m == "POST" || m == "PATCH";
            if (m == "GET") return p == "/auth/me" || p.StartsWith("/dashboard/") || p.StartsWith("/logistics/") ||
                p.StartsWith("/admin/users") || p.StartsWith("/admin/audit") || p.StartsWith("/admin/firebird-mappings");
            foreach (var e in ESCRITAS) if (e.Key == m && e.Value.IsMatch(p)) return true;
            return false;
        }

        /// <summary>Exportar Excel (POST /exports, igual ao site). Só relatórios do Comercial.</summary>
        public static Api.Arquivo Exportar(string json, out string nome)
        {
            var o = new JSONObject(json); var rel = o.OptString("report", "");
            nome = "Freedom_" + rel + ".xlsx";
            if (!System.Text.RegularExpressions.Regex.IsMatch(rel, "^(clients|bonuses|daily_evolution|managers|networks|overview|products|sellers)$")) return new Api.Arquivo { Status = 0 };
            var login = Store.Login();
            if (login == null) throw new ErroLogin("faça o login no app");
            var hp = Helpdesk.P;
            var api = new Api(login.Value.Key, login.Value.Value, hp.GetString("cookie", ""));
            if (api.Cookie.Length == 0) { api.Entrar(); hp.Edit().Put("cookie", api.Cookie).Commit(); }
            var r = api.BaixarPost("/exports", json, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            if (r.Status == 401) { api = new Api(login.Value.Key, login.Value.Value); api.Entrar(); hp.Edit().Put("cookie", api.Cookie).Commit(); r = api.BaixarPost("/exports", json, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
            var m = System.Text.RegularExpressions.Regex.Match(r.Disposicao, "filename\\*=UTF-8''([^;]+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (m.Success) nome = Uri.UnescapeDataString(m.Groups[1].Value);
            else { m = System.Text.RegularExpressions.Regex.Match(r.Disposicao, "filename=\"([^\"]+)\"", System.Text.RegularExpressions.RegexOptions.IgnoreCase); if (m.Success) nome = m.Groups[1].Value; }
            foreach (var ch in System.IO.Path.GetInvalidFileNameChars()) nome = nome.Replace(ch, '_');
            return r;
        }

        /// <summary>Requisição genérica das telas (só endereços do Helpdesk). Status 0 = sem conexão.</summary>
        public static Engine.Resp Requisicao(string metodo, string caminho, string corpo)
        {
            var m = (metodo ?? "").ToUpperInvariant();
            if (m != "GET" && m != "POST" && m != "PATCH" && m != "PUT" && m != "DELETE") return new Engine.Resp(0, "método não permitido");
            if (!Permitido(m, caminho)) return new Engine.Resp(0, "endereço não permitido");
            try
            {
                var r = Chamar(m, caminho, string.IsNullOrWhiteSpace(corpo) ? null : new JSONObject(corpo));
                if (m == "GET" && r.Status == 200) Fila.Guardar("GET " + caminho, r.Body);
                return r;
            }
            catch (Exception e)
            {
                if (Fila.SemInternet(e))
                {
                    // sem internet: consulta -> última resposta guardada; chamado novo -> guarda para enviar depois
                    if (m == "GET")
                    {
                        var g = Fila.Guardado("GET " + caminho);
                        if (g != null) return new Engine.Resp(299, new JSONObject().Put("_offline", g.Value.Key).Put("_corpo", g.Value.Value).ToString());
                    }
                    if (m == "POST" && caminho == "/helpdesk/tickets" && !string.IsNullOrWhiteSpace(corpo))
                    {
                        Fila.AdicionarChamado(corpo);
                        return new Engine.Resp(202, new JSONObject().Put("_fila", true).ToString());
                    }
                }
                return new Engine.Resp(0, "Sem conexão com o site: " + Api.Mensagem(e));
            }
        }

        /// <summary>Usado pela fila: resposta do site, ou null se continua sem internet.</summary>
        public static Engine.Resp RequisicaoDireta(string metodo, string caminho, string corpo)
        {
            try { return Chamar(metodo, caminho, string.IsNullOrWhiteSpace(corpo) ? null : new JSONObject(corpo)); }
            catch (Exception e) { return Fila.SemInternet(e) ? null : new Engine.Resp(0, Api.Mensagem(e)); }
        }

        static string Erro(int cod, string corpo, string padrao)
        {
            string codigo = "";
            try
            {
                var det = new JSONObject(corpo).Opt("detail");
                if (det is string) codigo = (string)det;
                else if (det is JSONObject) codigo = ((JSONObject)det).OptString("code");
            }
            catch (Exception) { }
            string t;
            if (ERROS.TryGetValue(codigo, out t)) return t;
            if (cod == 403 || cod == 404) return "Você não tem (mais) acesso a este chamado.";
            if (cod == 409) return codigo.Contains("resolved") ? "Este chamado já foi resolvido." : "Este chamado não aceita essa ação agora.";
            return padrao + " (HTTP " + cod + ")";
        }

        public static Resultado Historico(int id)
        {
            try
            {
                var r = Chamar("GET", "/helpdesk/tickets/" + id + "/timeline", null);
                if (r.Status != 200) return new Resultado(false, Erro(r.Status, r.Body, "Não consegui abrir o chamado"));
                Fila.Guardar("timeline " + id, r.Body);
                return new Resultado(true, "", new JSONObject(r.Body).Put("pendentes", Fila.DoChamado(id)));
            }
            catch (Exception e)
            {
                var g = Fila.SemInternet(e) ? Fila.Guardado("timeline " + id) : null;
                if (g != null)
                    try { return new Resultado(true, "offline:" + g.Value.Key, new JSONObject(g.Value.Value).Put("pendentes", Fila.DoChamado(id)).Put("_offline", g.Value.Key)); }
                    catch (Exception) { }
                return new Resultado(false, "Não consegui abrir o chamado: " + Api.Mensagem(e));
            }
        }

        public static Resultado Responder(int id, string texto)
        {
            var t = (texto ?? "").Trim();
            if (t.Length == 0) return new Resultado(false, "Escreva uma mensagem antes de enviar.");
            if (t.Length > 10000) return new Resultado(false, "A mensagem passou de 10.000 caracteres.");
            bool semNet;
            var r = ResponderAgora(id, t, out semNet);
            if (semNet)
            {
                Fila.AdicionarResposta(id, t);
                return new Resultado(true, "Sem internet: a resposta foi guardada e vai ser enviada sozinha quando a internet voltar.");
            }
            return r;
        }

        /// <summary>Envia de verdade (usado também pela fila quando a internet volta).</summary>
        public static Resultado ResponderAgora(int id, string t, out bool semInternet)
        {
            semInternet = false;
            try
            {
                var r = Chamar("POST", "/helpdesk/tickets/" + id + "/messages", new JSONObject().Put("body", t));
                if (r.Status >= 200 && r.Status < 300) { Depois(); return new Resultado(true, "Resposta enviada"); }
                return new Resultado(false, Erro(r.Status, r.Body, "Não consegui enviar a resposta"));
            }
            catch (Exception e) { semInternet = Fila.SemInternet(e); return new Resultado(false, "Não consegui enviar: " + Api.Mensagem(e)); }
        }

        public static Resultado Operar(int id, string tipo, string valor)
        {
            var v = (valor ?? "").Trim();
            try
            {
                for (int tentativa = 0; tentativa < 2; tentativa++)
                {
                    var h = Historico(id);
                    if (!h.Ok) return h;
                    var tk = h.Dados.OptJSONObject("ticket");
                    if (tk == null) return new Resultado(false, "Resposta inesperada do site.");
                    var cap = h.Dados.OptJSONObject("capabilities") ?? new JSONObject();
                    var corpo = new JSONObject().Put("version", (long)tk.OptInt("version"));
                    string metodo, caminho, ok;
                    switch (tipo)
                    {
                        case "assumir":
                            if (!cap.OptBoolean("can_take")) return new Resultado(false, tk.IsNull("assignee_user_id") ? "Você não pode assumir este chamado." : "Este chamado já tem responsável.");
                            metodo = "POST"; caminho = "take"; ok = "Chamado assumido"; break;
                        case "status":
                            if (!cap.OptBoolean("can_change_status")) return new Resultado(false, "Você não pode alterar o status deste chamado.");
                            corpo.Put("status", v); metodo = "PATCH"; caminho = "status"; ok = "Status alterado para " + Engine.StatusLabel(v); break;
                        case "prioridade":
                            if (!cap.OptBoolean("can_change_priority")) return new Resultado(false, "Você não pode alterar a prioridade.");
                            corpo.Put("priority", v); metodo = "PATCH"; caminho = "priority"; ok = "Prioridade alterada"; break;
                        case "responsavel":
                            if (!cap.OptBoolean("can_change_assignee")) return new Resultado(false, "Você não pode trocar o responsável.");
                            int pid;
                            corpo.Put("assignee_user_id", int.TryParse(v, out pid) ? (object)(long)pid : JSONObject.NULL);
                            metodo = "PATCH"; caminho = "assignee"; ok = v.Length == 0 ? "Chamado ficou sem responsável" : "Responsável alterado"; break;
                        case "setor":
                            if (!cap.OptBoolean("can_transfer")) return new Resultado(false, "Você não pode transferir este chamado.");
                            int q;
                            if (!int.TryParse(v, out q)) return new Resultado(false, "Escolha o setor de destino.");
                            corpo.Put("queue_id", (long)q); metodo = "PATCH"; caminho = "queue"; ok = "Chamado transferido"; break;
                        case "transferirResp":   // valor: "id\nmotivo" — o setor do chamado não muda, a pessoa ganha acesso só a ele
                        {
                            if (!cap.OptBoolean("can_transfer_assignee")) return new Resultado(false, "Você não pode transferir o responsável.");
                            int nl = v.IndexOf('\n'), np;
                            if (nl <= 0 || !int.TryParse(v.Substring(0, nl), out np)) return new Resultado(false, "Escolha o novo responsável.");
                            var mot = v.Substring(nl + 1).Trim();
                            if (mot.Length < 3) return new Resultado(false, "Escreva o motivo do encaminhamento.");
                            corpo.Put("assignee_user_id", (long)np).Put("reason", mot); metodo = "PATCH"; caminho = "assignee-transfer"; ok = "Responsável transferido"; break;
                        }
                        case "solucao":
                            if (!cap.OptBoolean("can_propose_solution")) return new Resultado(false, "Você não pode pedir a conclusão deste chamado.");
                            if (v.Length == 0) return new Resultado(false, "Escreva a solução antes de enviar.");
                            corpo.Put("solution", v); metodo = "POST"; caminho = "solution"; ok = "Solução enviada para aprovação"; break;
                        case "aceitar":
                            if (!cap.OptBoolean("can_review_solution")) return new Resultado(false, "Você não pode aprovar esta solução.");
                            metodo = "POST"; caminho = "solution/accept"; ok = "Solução aceita · chamado concluído"; break;
                        case "rejeitar":
                            if (!cap.OptBoolean("can_review_solution")) return new Resultado(false, "Você não pode rejeitar esta solução.");
                            if (v.Length == 0) return new Resultado(false, "Escreva o motivo da rejeição.");
                            corpo.Put("reason", v); metodo = "POST"; caminho = "solution/reject"; ok = "Solução rejeitada"; break;
                        default: return new Resultado(false, "Ação desconhecida.");
                    }
                    var r = Chamar(metodo, "/helpdesk/tickets/" + id + "/" + caminho, corpo);
                    if (r.Status >= 200 && r.Status < 300) { Depois(); return new Resultado(true, ok); }
                    if (r.Status == 409 && tentativa == 0 && r.Body.Contains("stale")) continue;
                    return new Resultado(false, Erro(r.Status, r.Body, "Não consegui concluir"));
                }
                return new Resultado(false, "O chamado mudou enquanto eu tentava. Tente de novo.");
            }
            catch (Exception e) { return new Resultado(false, "Não consegui concluir: " + Api.Mensagem(e)); }
        }

        public static Resultado Anexos(int id)
        {
            try
            {
                var r = Chamar("GET", "/helpdesk/tickets/" + id + "/attachments", null);
                if (r.Status != 200) return new Resultado(false, Erro(r.Status, r.Body, "Não consegui ver os anexos"));
                var t = r.Body.Trim();
                var arr = t.StartsWith("[") ? new JSONArray(t) : (new JSONObject(t).OptJSONArray("items") ?? new JSONArray());
                return new Resultado(true, "", new JSONObject().Put("items", arr));
            }
            catch (Exception e) { return new Resultado(false, "Não consegui ver os anexos: " + Api.Mensagem(e)); }
        }

        static readonly string[] EXTENSOES = { "pdf", "png", "jpg", "jpeg", "txt", "xls", "xlsx", "doc", "docx" };

        static string Tipo(string ext)
        {
            switch (ext)
            {
                case "pdf": return "application/pdf";
                case "png": return "image/png";
                case "jpg": case "jpeg": return "image/jpeg";
                case "txt": return "text/plain";
                case "xls": return "application/vnd.ms-excel";
                case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                case "doc": return "application/msword";
                case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                default: return "application/octet-stream";
            }
        }

        public static Resultado Anexar(int id, string arquivo)
        {
            try
            {
                if (new FileInfo(arquivo).Length > 10 * 1024 * 1024) return new Resultado(false, "O arquivo passa de 10 MB.");
                return Anexar(id, Path.GetFileName(arquivo), File.ReadAllBytes(arquivo));
            }
            catch (Exception e) { return new Resultado(false, "Não consegui anexar: " + Api.Mensagem(e)); }
        }

        /// <summary>Anexa um arquivo já lido (ex.: escolhido na tela "Abrir chamado").</summary>
        public static Resultado Anexar(int id, string nome, byte[] dados)
        {
            var ext = Path.GetExtension(nome).TrimStart('.').ToLowerInvariant();
            if (!EXTENSOES.Contains(ext)) return new Resultado(false, "Tipo de arquivo não aceito. Use PDF, imagem (PNG/JPG), texto, Excel ou Word.");
            try
            {
                if (dados.Length > 10 * 1024 * 1024) return new Resultado(false, "O arquivo passa de 10 MB.");
                var login = Store.Login();
                if (login == null) return new Resultado(false, "Faça o login no app.");
                var hp = Helpdesk.P;
                var api = new Api(login.Value.Key, login.Value.Value, hp.GetString("cookie", ""));
                if (api.Cookie.Length == 0) { api.Entrar(); hp.Edit().Put("cookie", api.Cookie).Commit(); }
                var r = api.EnviarArquivo("/helpdesk/tickets/" + id + "/attachments", nome, Tipo(ext), dados);
                if (r.Status == 401)
                {
                    api = new Api(login.Value.Key, login.Value.Value); api.Entrar(); hp.Edit().Put("cookie", api.Cookie).Commit();
                    r = api.EnviarArquivo("/helpdesk/tickets/" + id + "/attachments", nome, Tipo(ext), dados);
                }
                if (r.Status >= 200 && r.Status < 300) { Depois(); return new Resultado(true, "Arquivo anexado"); }
                if (r.Status == 413) return new Resultado(false, "O arquivo passa de 10 MB.");
                if (r.Status == 409) return new Resultado(false, "Este chamado já chegou no limite de anexos ou não aceita anexos agora.");
                return new Resultado(false, Erro(r.Status, r.Body, "Não consegui anexar"));
            }
            catch (Exception e) { return new Resultado(false, "Não consegui anexar: " + Api.Mensagem(e)); }
        }

        /// <summary>Baixa o anexo para a pasta Downloads. Devolve o caminho do arquivo (ou null).</summary>
        public static string BaixarAnexo(int id, int anexo, string nome)
        {
            var l = Anexos(id);      // renova a sessão se precisar
            if (!l.Ok) return null;
            var login = Store.Login();
            if (login == null) return null;
            var seguro = string.Concat((nome ?? "anexo").Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
            if (seguro.Trim().Length == 0) seguro = "anexo";
            var destino = Path.Combine(Pastas.Downloads, seguro);
            int n = 1;
            while (File.Exists(destino))
                destino = Path.Combine(Pastas.Downloads, Path.GetFileNameWithoutExtension(seguro) + " (" + (n++) + ")" + Path.GetExtension(seguro));
            try
            {
                var api = new Api(login.Value.Key, login.Value.Value, Helpdesk.P.GetString("cookie", ""));
                return api.Baixar("/helpdesk/tickets/" + id + "/attachments/" + anexo + "/download", destino) == 200 ? destino : null;
            }
            catch (Exception) { return null; }
        }

        static void Depois() { Helpdesk.EmSegundoPlano(() => Helpdesk.Verificar(true)); }
    }
}
