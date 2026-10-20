'use strict';
/**
 * Avisos do Helpdesk no Mac: mesma lógica do Android e do Windows (sondagem a cada 15 s, verificação completa,
 * histórico, diagnóstico). Quem mostra os avisos é o main.js (evento "avisar").
 */
const os = require('os');
const { EventEmitter } = require('events');
const { Prefs, Store, Api, Acesso, ErroLogin, agora } = require('./base');
const Engine = require('./engine');

const SONDAS = [
  '/helpdesk/notifications/summary',
  '/helpdesk/workspace/tickets?view=queues&page=1&page_size=5',
  '/helpdesk/workspace/tickets?view=assigned&page=1&page_size=5',
  '/helpdesk/tickets?view=requester&page=1&page_size=5'
];
const MAX_FEED = 60, SONDA_TOPO = 3, SONDA_RODIZIO = 2;

const ev = new EventEmitter();
const forcar = new Set();
let verificando = false, sondando = false, emVerificacao = null;
let fila = null;            // Fila (para o resumo da tela); ligado pelo index para evitar dependência circular

const H = {
  ev,
  usarFila(f) { fila = f; },
  get P() { return Prefs.de('helpdesk'); },
  get verificando() { return verificando; },

  ativo() { return Acesso.helpdesk() && this.P.getBool('ativo', true); },
  intervaloSeg() { return Math.max(15, Math.min(3600, this.P.getNum('intervalo_s', 15))); },
  intervaloCompletoMs() { const s = this.intervaloSeg(); return s < 60 ? 120000 : s * 1000; },
  minhasAcoes() { return this.P.getBool('minhas_acoes', false); },

  configurar(cfg) {
    const ed = this.P.editar();
    if ('ativo' in cfg) ed.put('ativo', !!cfg.ativo);
    if ('tempoReal' in cfg) ed.put('tempo_real', !!cfg.tempoReal);
    if ('minhasAcoes' in cfg) ed.put('minhas_acoes', !!cfg.minhasAcoes);
    if ('intervalo' in cfg) ed.put('intervalo_s', Math.max(15, Math.min(3600, Number(cfg.intervalo) || 15)));
    ed.commit();
    this.avisarTela();
  },

  sair() { this.P.editar().clear().commit(); forcar.clear(); if (fila) fila.limpar(); },
  avisarTela() { ev.emit('mudou'); },

  /** Verificação completa (uma de cada vez). */
  verificar(manual) {
    if (!manual && verificando) return Promise.resolve(null);
    if (emVerificacao) return emVerificacao.then(() => this.verificar(manual));
    emVerificacao = this._verificarAgora(manual).finally(() => { emVerificacao = null; });
    return emVerificacao;
  },

  async _verificarAgora(manual) {
    const p = this.P, t0 = agora();
    if (!manual) {
      if (!this.ativo()) return null;
      const folga = Math.max(30000, this.intervaloCompletoMs() / 2);
      if (t0 - p.getNum('ultima') < folga) return null;
    }
    if (!Acesso.helpdesk()) { p.editar().put('status', 'Este login não tem acesso ao Helpdesk').commit(); return null; }
    const login = Store.login();
    if (!login) return null;
    verificando = true; this.avisarTela();
    const ed = p.editar().put('ultima', t0);
    const forca = new Set(forcar);
    try {
      let api = new Api(login[0], login[1], p.getStr('cookie', ''));
      let logou = false;
      if (!api.cookie) { await api.entrar(); logou = true; await Acesso.atualizar(api); }
      const f = c => api.bruto(c);
      let o = await Engine.run(f, p.getStr('estado'), this.minhasAcoes(), t0 + 40000, forca);
      if ((o.sessionExpired || !o.ok) && !logou) {
        api = new Api(login[0], login[1]); await api.entrar(); logou = true; await Acesso.atualizar(api);
        o = await Engine.run(c => api.bruto(c), p.getStr('estado'), this.minhasAcoes(), agora() + 40000, forca);
      }
      if (logou) ed.put('cookie', api.cookie);
      const avisar = this.ativo();
      if (o.sessionExpired) { ed.put('status', 'Este login não tem acesso ao Helpdesk'); this.diag('Sem acesso ao Helpdesk (sessão recusada)'); }
      else if (!o.ok) { ed.put('status', 'Não verificou: ' + (o.error || 'erro')); this.diag('Erro: ' + (o.error || 'erro')); }
      else {
        ed.put('estado', o.newState).put('status', 'ok').put('monitorados', o.monitored).remove('sonda');
        for (const x of forca) forcar.delete(x);
        const avisos = o.notes.filter(n => !n.silent);
        if (o.notes.length > 0) {
          this._guardarFeed(ed, o.notes, t0);
          if (avisar && avisos.length > 0) ev.emit('avisar', avisos);
        }
        const minhas = o.notes.length - avisos.length;
        if (o.firstRun) this.diag('Primeira verificação: linha de base de ' + o.monitored + ' chamados');
        else if (o.notes.length > 0 || forca.size > 0 || manual)
          this.diag('Verificação: ' + o.monitored + ' chamados, ' + avisos.length + ' novidade(s)' + (minhas > 0 ? ' + ' + minhas + ' sua(s)' : '') +
            (avisos.length === 0 ? '' : avisar ? ' · avisou no Mac' : ' · NÃO avisou: avisos desligados') +
            (forca.size > 0 ? ' · conferiu ' + [...forca].map(x => '#' + x).join(', ') : '') +
            avisos.slice(0, 3).map(n => '\n  ' + n.title + ': ' + n.text).join(''));
      }
      return o;
    } catch (e) {
      if (e instanceof ErroLogin) { ed.put('status', 'O site recusou o login guardado. Saia e entre de novo no app.'); this.diag('Login recusado pelo site'); }
      else { ed.put('status', 'Não verificou: ' + Api.mensagem(e)); this.diag('Erro: ' + Api.mensagem(e)); }
      return null;
    } finally {
      if (Store.logado() && Store.email() === login[0]) ed.commit();
      verificando = false; this.avisarTela();
    }
  },

  /** Consulta leve (listas + histórico de alguns chamados). true = algo mudou. */
  async sondar() {
    const p = this.P, login = Store.login();
    if (!login) return false;
    const cookie = p.getStr('cookie', '');
    if (!cookie) return true;
    const api = new Api(login[0], login[1], cookie);
    let sb = '';
    for (const caminho of SONDAS) {
      let r;
      try { r = await api.bruto(caminho); } catch (e) { return false; }
      if (r.status === 401) return true;
      if (r.status !== 200) continue;
      try {
        const o = JSON.parse(r.body);
        if (!Array.isArray(o.items)) { sb += JSON.stringify(o) + '|'; continue; }
        for (const t of o.items) if (t) sb += [t.id, t.status, t.version, t.updated_at, t.priority, t.assignee_user_id].map(x => x == null ? '' : String(x)).join(':') + ';';
        sb += '|';
      } catch (e) { }
    }
    const marca = require('crypto').createHash('sha1').update(sb).digest('hex');
    const antes = p.getStr('sonda');
    p.editar().put('sonda', marca).commit();
    const mudouLista = antes != null && antes !== marca;
    if (mudouLista) this.diag('Sondagem: as listas de chamados mudaram');

    let resposta = false;
    const estado = p.getStr('estado');
    if (estado) {
      const ordem = Engine.probeOrder(estado);
      const escolha = ordem.slice(0, SONDA_TOPO), resto = ordem.slice(SONDA_TOPO);
      if (resto.length > 0) {
        const rr = p.getNum('sonda_rr');
        for (let k = 0; k < Math.min(SONDA_RODIZIO, resto.length); k++) { const id = resto[(rr + k) % resto.length]; if (escolha.indexOf(id) < 0) escolha.push(id); }
        p.editar().put('sonda_rr', (rr + SONDA_RODIZIO) % resto.length).commit();
      }
      for (const id of escolha) {
        if (!Engine.baselined(estado, id)) { forcar.add(id); resposta = true; continue; }
        let r;
        try { r = await api.bruto('/helpdesk/tickets/' + id + '/timeline'); } catch (e) { break; }
        if (r.status === 401) return true;
        if (r.status !== 200) continue;
        if (Engine.timelineHasNew(estado, id, r.body)) { forcar.add(id); resposta = true; this.diag('Sondagem: item novo no histórico do chamado #' + id); }
      }
    }
    return mudouLista || resposta;
  },

  /** Um ciclo do monitor (a cada intervaloSeg). */
  async ciclo() {
    try { if (fila) await fila.enviar(); } catch (e) { }
    if (!this.ativo() || !Store.logado() || verificando) return;
    if (agora() - this.P.getNum('ultima') >= this.intervaloCompletoMs() - 5000) { await this.verificar(false); return; }
    if (this.intervaloSeg() >= 60 || sondando) return;
    sondando = true;
    let mudou = false;
    try { mudou = await this.sondar(); } catch (e) { } finally { sondando = false; }
    if (mudou) await this.verificar(true);
  },

  _guardarFeed(ed, notas, t) {
    const antigo = this._lista(this.P.getStr('feed', '[]'));
    const novo = notas.map(n => ({ t, id: n.ticketId, titulo: n.title, texto: n.text, linhas: n.lines || [], caminho: n.path, novo: !!n.isNew, meu: !!n.silent }));
    for (const x of antigo) { if (novo.length >= MAX_FEED) break; novo.push(x); }
    ed.put('feed', JSON.stringify(novo));
  },
  _lista(s) { try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; } },

  resumoTela(app) {
    const p = this.P;
    const o = {
      email: Store.email() || '', nome: Acesso.nome(), ativo: this.ativo(), tempoReal: true, intervalo: this.intervaloSeg(),
      canalOk: true, minhasAcoes: this.minhasAcoes(), verificando, ultima: p.getNum('ultima'), status: p.getStr('status', ''),
      monitorados: p.getNum('monitorados'), notifOk: true, bateriaOk: true, visto: p.getNum('visto'), plataforma: 'mac',
      fila: fila ? fila.quantos() : 0, online: fila ? fila.online() : true,
      app, diag: this._lista(p.getStr('diag', '[]')), feed: this._lista(p.getStr('feed', '[]'))
    };
    let estado = {};
    try { estado = JSON.parse(p.getStr('estado', '{}')) || {}; } catch (e) { }
    if (estado.summary) o.resumo = estado.summary;
    const ts = estado.tickets || {};
    o.abertos = Object.keys(ts).filter(id => ts[id] && !ts[id].fora && Engine.isActive(String(ts[id].status || '')))
      .map(id => Object.assign({}, ts[id], { id })).sort((a, b) => (String(b.updated) > String(a.updated) ? 1 : String(b.updated) < String(a.updated) ? -1 : 0)).slice(0, 40);
    return o;
  },

  marcarVisto() { this.P.editar().put('visto', agora()).commit(); },
  naoVistos() {
    const visto = this.P.getNum('visto');
    return this._lista(this.P.getStr('feed', '[]')).filter(f => f && f.t > visto && !f.meu).length;
  },

  diag(texto) {
    const arr = this._lista(this.P.getStr('diag', '[]'));
    const novo = [{ t: agora(), x: texto.length > 600 ? texto.slice(0, 600) : texto }].concat(arr.slice(0, 49));
    this.P.editar().put('diag', JSON.stringify(novo)).commit();
  },

  textoDiagnostico() {
    const dois = n => ('0' + n).slice(-2);
    let s = 'Freedom para Mac ' + Api.versao + ' · macOS ' + os.release() + '\n';
    s += 'Avisos: ' + (this.ativo() ? 'ligados' : 'DESLIGADOS') + ' · a cada ' + this.intervaloSeg() + ' s · minhas ações: ' + (this.minhasAcoes() ? 'avisa' : 'não avisa') + '\n';
    for (const o of this._lista(this.P.getStr('diag', '[]'))) {
      const d = new Date(o.t);
      s += dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + ' ' + dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()) + '  ' + o.x + '\n';
    }
    return s;
  }
};

module.exports = H;
