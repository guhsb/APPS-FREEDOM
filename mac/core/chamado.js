'use strict';
/**
 * Ações num chamado (mesmos endereços do site), igual ao Chamado.kt/Chamado.cs,
 * e a fila "sem internet" (guarda resposta/chamado novo e envia quando a conexão volta) — igual ao Fila.kt/Fila.cs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { EventEmitter } = require('events');
const { Pastas, Prefs, Store, Api, ErroLogin, agora } = require('./base');
const Helpdesk = require('./helpdesk');
const Engine = require('./engine');

const ERROS = {
  helpdesk_ticket_already_assigned: 'Este chamado já foi assumido por outro atendente.',
  stale_ticket_version: 'O chamado foi alterado por outro usuário. Tente de novo.',
  helpdesk_forbidden: 'Seu acesso de atendimento não está disponível.',
  resolved_helpdesk_ticket: 'Este chamado já foi resolvido.',
  invalid_ticket_transition: 'Esta alteração de status não está mais disponível.',
  invalid_helpdesk_assignee: 'O responsável escolhido não pode atender este chamado.',
  inactive_helpdesk_queue: 'O setor de destino não está disponível.'
};

// ================= sem internet =================
const avisos = new EventEmitter();     // 'aviso' (titulo, texto, caminho)
let online = true;
function semInternet(e) {
  if (!online) return true;
  for (let x = e; x; x = x.cause) {
    const cod = String(x.code || '');
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_CONNECT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT/.test(cod)) return true;
    if (x.name === 'TimeoutError' || x.name === 'AbortError' || x.message === 'fetch failed') return true;
  }
  return false;
}

const Fila = {
  avisos,
  get P() { return Prefs.de('fila'); },
  online() { return online; },
  /** Confere se tem internet (consulta o DNS do site). */
  async conferirConexao() {
    try { await dns.promises.lookup('relatorios.cbfreedom.com.br'); online = true; } catch (e) { online = false; }
    return online;
  },
  semInternet,
  ler() { try { const a = JSON.parse(this.P.getStr('itens', '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  gravar(a) { this.P.editar().put('itens', JSON.stringify(a)).commit(); },
  quantos() { return this.ler().length; },
  doChamado(id) { return this.ler().filter(x => x.tipo === 'resposta' && Number(x.chamado) === Number(id)).map(x => ({ texto: x.texto, criado: x.criado })); },
  adicionarResposta(id, texto) { this._adicionar({ tipo: 'resposta', chamado: Number(id), texto }); },
  adicionarChamado(corpo) { let titulo = ''; try { titulo = JSON.parse(corpo).title || ''; } catch (e) { } this._adicionar({ tipo: 'novo', corpo, titulo }); },
  _adicionar(item) {
    const a = this.ler(); a.push(Object.assign(item, { criado: agora(), uid: crypto.randomBytes(8).toString('hex') })); this.gravar(a);
    Helpdesk.avisarTela();
  },
  _enviando: false,
  async enviar() {
    if (this._enviando || this.quantos() === 0) return;
    if (!(await this.conferirConexao())) return;
    this._enviando = true;
    try {
      while (true) {
        const item = this.ler()[0];
        if (!item) break;
        let tirar = true;
        try {
          if (item.tipo === 'resposta') {
            const id = Number(item.chamado);
            const r = await Chamado.responderAgora(id, item.texto);
            if (r.semInternet) tirar = false;
            else avisos.emit('aviso', r.ok ? 'Resposta enviada' : 'Não deu para enviar a resposta',
              r.ok ? 'Sua resposta guardada sem internet foi enviada no chamado #' + id + '.' : r.mensagem + ' (chamado #' + id + ')', '/helpdesk/tickets/' + id);
          } else if (item.tipo === 'novo') {
            const r = await Chamado.requisicaoDireta('POST', '/helpdesk/tickets', item.corpo);
            if (r == null) tirar = false;
            else {
              const ok = r.status >= 200 && r.status < 300;
              let novo = null; if (ok) try { novo = JSON.parse(r.body); } catch (e) { }
              const prot = novo && novo.protocol ? novo.protocol : '';
              avisos.emit('aviso', ok ? 'Chamado aberto' + (prot ? ' · ' + prot : '') : 'Não deu para abrir o chamado',
                ok ? 'O chamado "' + item.titulo + '", guardado sem internet, foi aberto.' : '"' + item.titulo + '": o site recusou (HTTP ' + r.status + '). Abra de novo pelo app.',
                novo && novo.id ? '/helpdesk/tickets/' + novo.id : null);
            }
          }
        } catch (e) { tirar = false; }
        if (!tirar) break;
        this.gravar(this.ler().filter(x => x.uid !== item.uid));
        Helpdesk.avisarTela();
      }
    } finally { this._enviando = false; }
  },
  limpar() {
    this.gravar([]);
    try { const d = Pastas.sub('offline'); for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f)); } catch (e) { }
  },
  _arquivo(chave) { return path.join(Pastas.sub('offline'), crypto.createHash('sha1').update(chave).digest('hex') + '.json'); },
  guardar(chave, corpo) { try { fs.writeFileSync(this._arquivo(chave), JSON.stringify({ t: agora(), b: corpo })); } catch (e) { } },
  guardado(chave) { try { const o = JSON.parse(fs.readFileSync(this._arquivo(chave), 'utf8')); return [o.t, o.b]; } catch (e) { return null; } }
};

// ================= chamado =================
function erro(cod, corpo, padrao) {
  let codigo = '';
  try { const d = JSON.parse(corpo).detail; codigo = typeof d === 'string' ? d : (d && d.code) || ''; } catch (e) { }
  if (ERROS[codigo]) return ERROS[codigo];
  if (cod === 403 || cod === 404) return 'Você não tem (mais) acesso a este chamado.';
  if (cod === 409) return codigo.indexOf('resolved') >= 0 ? 'Este chamado já foi resolvido.' : 'Este chamado não aceita essa ação agora.';
  return padrao + ' (HTTP ' + cod + ')';
}

const R = (ok, mensagem, dados = null) => ({ ok, mensagem, dados });

const EXTENSOES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

async function api0() {
  const login = Store.login();
  if (!login) throw new ErroLogin('faça o login no app');
  const hp = Helpdesk.P;
  let api = new Api(login[0], login[1], hp.getStr('cookie', ''));
  if (!api.cookie) { await api.entrar(); hp.editar().put('cookie', api.cookie).commit(); }
  return { api, login, hp };
}

const Chamado = {
  /** Usa a sessão guardada; se venceu, entra de novo e repete. */
  async chamar(metodo, caminho, corpo) {
    let { api, login, hp } = await api0();
    const ir = () => metodo === 'GET' ? api.bruto(caminho) : api.enviar(metodo, caminho, corpo);
    let r = await ir();
    if (r.status === 401) { api = new Api(login[0], login[1]); await api.entrar(); hp.editar().put('cookie', api.cookie).commit(); r = await ir(); }
    online = true;
    return r;
  },

  /** Requisição genérica das telas (só endereços do Helpdesk). Status 0 = sem conexão. */
  async requisicao(metodo, caminho, corpo) {
    const m = String(metodo || '').toUpperCase();
    if (['GET', 'POST', 'PATCH'].indexOf(m) < 0) return { status: 0, body: 'método não permitido' };
    if (!caminho || !(caminho.startsWith('/helpdesk/') || caminho === '/auth/me') || caminho.indexOf('..') >= 0) return { status: 0, body: 'endereço não permitido' };
    try {
      const r = await this.chamar(m, caminho, corpo && String(corpo).trim() ? JSON.parse(corpo) : null);
      if (m === 'GET' && r.status === 200) Fila.guardar('GET ' + caminho, r.body);
      return r;
    } catch (e) {
      if (semInternet(e)) {
        online = false;
        if (m === 'GET') { const g = Fila.guardado('GET ' + caminho); if (g) return { status: 299, body: JSON.stringify({ _offline: g[0], _corpo: g[1] }) }; }
        if (m === 'POST' && caminho === '/helpdesk/tickets' && corpo && String(corpo).trim()) { Fila.adicionarChamado(corpo); return { status: 202, body: JSON.stringify({ _fila: true }) }; }
      }
      return { status: 0, body: 'Sem conexão com o site: ' + Api.mensagem(e) };
    }
  },

  async requisicaoDireta(metodo, caminho, corpo) {
    try { return await this.chamar(metodo, caminho, corpo && String(corpo).trim() ? JSON.parse(corpo) : null); }
    catch (e) { return semInternet(e) ? null : { status: 0, body: Api.mensagem(e) }; }
  },

  async historico(id) {
    try {
      const r = await this.chamar('GET', '/helpdesk/tickets/' + id + '/timeline', null);
      if (r.status !== 200) return R(false, erro(r.status, r.body, 'Não consegui abrir o chamado'));
      Fila.guardar('timeline ' + id, r.body);
      return R(true, '', Object.assign(JSON.parse(r.body), { pendentes: Fila.doChamado(id) }));
    } catch (e) {
      const g = semInternet(e) ? Fila.guardado('timeline ' + id) : null;
      if (g) try { return R(true, 'offline:' + g[0], Object.assign(JSON.parse(g[1]), { pendentes: Fila.doChamado(id), _offline: g[0] })); } catch (x) { }
      return R(false, 'Não consegui abrir o chamado: ' + Api.mensagem(e));
    }
  },

  async responderAgora(id, t) {
    try {
      const r = await this.chamar('POST', '/helpdesk/tickets/' + id + '/messages', { body: t });
      if (r.status >= 200 && r.status < 300) { this.depois(); return { ok: true, mensagem: 'Resposta enviada', semInternet: false }; }
      return { ok: false, mensagem: erro(r.status, r.body, 'Não consegui enviar a resposta'), semInternet: false };
    } catch (e) { return { ok: false, mensagem: 'Não consegui enviar: ' + Api.mensagem(e), semInternet: semInternet(e) }; }
  },

  async responder(id, texto) {
    const t = String(texto || '').trim();
    if (!t) return R(false, 'Escreva uma mensagem antes de enviar.');
    if (t.length > 10000) return R(false, 'A mensagem passou de 10.000 caracteres.');
    const r = await this.responderAgora(id, t);
    if (r.semInternet) { Fila.adicionarResposta(id, t); return R(true, 'Sem internet: a resposta foi guardada e vai ser enviada sozinha quando a internet voltar.'); }
    return R(r.ok, r.mensagem);
  },

  async operar(id, tipo, valor) {
    const v = String(valor || '').trim();
    try {
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const h = await this.historico(id);
        if (!h.ok) return h;
        if (h.dados._offline) return R(false, 'Sem internet: essa ação precisa de conexão.');
        const tk = h.dados.ticket;
        if (!tk) return R(false, 'Resposta inesperada do site.');
        const cap = h.dados.capabilities || {};
        const corpo = { version: Number(tk.version) || 0 };
        let metodo, caminho, ok;
        switch (tipo) {
          case 'assumir':
            if (!cap.can_take) return R(false, tk.assignee_user_id == null ? 'Você não pode assumir este chamado.' : 'Este chamado já tem responsável.');
            metodo = 'POST'; caminho = 'take'; ok = 'Chamado assumido'; break;
          case 'status':
            if (!cap.can_change_status) return R(false, 'Você não pode alterar o status deste chamado.');
            corpo.status = v; metodo = 'PATCH'; caminho = 'status'; ok = 'Status alterado para ' + Engine.statusLabel(v); break;
          case 'prioridade':
            if (!cap.can_change_priority) return R(false, 'Você não pode alterar a prioridade.');
            corpo.priority = v; metodo = 'PATCH'; caminho = 'priority'; ok = 'Prioridade alterada'; break;
          case 'responsavel':
            if (!cap.can_change_assignee) return R(false, 'Você não pode trocar o responsável.');
            corpo.assignee_user_id = /^\d+$/.test(v) ? Number(v) : null;
            metodo = 'PATCH'; caminho = 'assignee'; ok = v ? 'Responsável alterado' : 'Chamado ficou sem responsável'; break;
          case 'setor':
            if (!cap.can_transfer) return R(false, 'Você não pode transferir este chamado.');
            if (!/^\d+$/.test(v)) return R(false, 'Escolha o setor de destino.');
            corpo.queue_id = Number(v); metodo = 'PATCH'; caminho = 'queue'; ok = 'Chamado transferido'; break;
          case 'solucao':
            if (!cap.can_propose_solution) return R(false, 'Você não pode pedir a conclusão deste chamado.');
            if (!v) return R(false, 'Escreva a solução antes de enviar.');
            corpo.solution = v; metodo = 'POST'; caminho = 'solution'; ok = 'Solução enviada para aprovação'; break;
          case 'aceitar':
            if (!cap.can_review_solution) return R(false, 'Você não pode aprovar esta solução.');
            metodo = 'POST'; caminho = 'solution/accept'; ok = 'Solução aceita · chamado concluído'; break;
          case 'rejeitar':
            if (!cap.can_review_solution) return R(false, 'Você não pode rejeitar esta solução.');
            if (!v) return R(false, 'Escreva o motivo da rejeição.');
            corpo.reason = v; metodo = 'POST'; caminho = 'solution/reject'; ok = 'Solução rejeitada'; break;
          default: return R(false, 'Ação desconhecida.');
        }
        const r = await this.chamar(metodo, '/helpdesk/tickets/' + id + '/' + caminho, corpo);
        if (r.status >= 200 && r.status < 300) { this.depois(); return R(true, ok); }
        if (r.status === 409 && tentativa === 0 && r.body.indexOf('stale') >= 0) continue;
        return R(false, erro(r.status, r.body, 'Não consegui concluir'));
      }
      return R(false, 'O chamado mudou enquanto eu tentava. Tente de novo.');
    } catch (e) { return R(false, 'Não consegui concluir: ' + Api.mensagem(e)); }
  },

  async anexos(id) {
    try {
      const r = await this.chamar('GET', '/helpdesk/tickets/' + id + '/attachments', null);
      if (r.status !== 200) return R(false, erro(r.status, r.body, 'Não consegui ver os anexos'));
      const j = JSON.parse(r.body);
      return R(true, '', { items: Array.isArray(j) ? j : (j.items || []) });
    } catch (e) { return R(false, 'Não consegui ver os anexos: ' + Api.mensagem(e)); }
  },

  async anexar(id, arquivo) {
    const nome = path.basename(arquivo), ext = path.extname(arquivo).replace('.', '').toLowerCase();
    if (!EXTENSOES[ext]) return R(false, 'Tipo de arquivo não aceito. Use PDF, imagem (PNG/JPG), texto, Excel ou Word.');
    try {
      if (fs.statSync(arquivo).size > 10 * 1024 * 1024) return R(false, 'O arquivo passa de 10 MB.');
      const dados = fs.readFileSync(arquivo);
      let { api, login, hp } = await api0();
      let r = await api.enviarArquivo('/helpdesk/tickets/' + id + '/attachments', nome, EXTENSOES[ext], dados);
      if (r.status === 401) { api = new Api(login[0], login[1]); await api.entrar(); hp.editar().put('cookie', api.cookie).commit(); r = await api.enviarArquivo('/helpdesk/tickets/' + id + '/attachments', nome, EXTENSOES[ext], dados); }
      if (r.status >= 200 && r.status < 300) { this.depois(); return R(true, 'Arquivo anexado'); }
      if (r.status === 413) return R(false, 'O arquivo passa de 10 MB.');
      if (r.status === 409) return R(false, 'Este chamado já chegou no limite de anexos ou não aceita anexos agora.');
      return R(false, erro(r.status, r.body, 'Não consegui anexar'));
    } catch (e) { return R(false, 'Não consegui anexar: ' + Api.mensagem(e)); }
  },

  /** Baixa o anexo para a pasta Downloads. Devolve o caminho do arquivo (ou null). */
  async baixarAnexo(id, anexo, nome) {
    const l = await this.anexos(id); if (!l.ok) return null;
    const login = Store.login(); if (!login) return null;
    let seguro = String(nome || 'anexo').replace(/[\/\\:*?"<>|]/g, '_').trim() || 'anexo';
    const dir = Pastas.downloads();
    let destino = path.join(dir, seguro), n = 1;
    const ext = path.extname(seguro), base = path.basename(seguro, ext);
    while (fs.existsSync(destino)) destino = path.join(dir, base + ' (' + (n++) + ')' + ext);
    try {
      const api = new Api(login[0], login[1], Helpdesk.P.getStr('cookie', ''));
      return (await api.baixar('/helpdesk/tickets/' + id + '/attachments/' + anexo + '/download', destino)) === 200 ? destino : null;
    } catch (e) { return null; }
  },

  depois() { setTimeout(() => Helpdesk.verificar(true).catch(() => null), 0); }
};

module.exports = { Chamado, Fila };
