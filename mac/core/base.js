'use strict';
/**
 * Base do Freedom para Mac (igual ao Base.cs do Windows e ao Store/Api do Android):
 * pastas, preferências em arquivo, login guardado (Keychain do Mac), acesso ao site e módulos do login.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SITE = process.env.FREEDOM_TESTE_SITE || 'https://relatorios.cbfreedom.com.br';   // a variável é só para os testes
const BASE = SITE + '/api/v1';

// ---------------- pastas ----------------
const Pastas = {
  raiz: path.join(os.homedir(), '.freedom'),
  iniciar(dir) { this.raiz = dir; fs.mkdirSync(dir, { recursive: true }); },
  sub(nome) { const d = path.join(this.raiz, nome); fs.mkdirSync(d, { recursive: true }); return d; },
  downloads() { const d = path.join(os.homedir(), 'Downloads'); try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } return d; }
};

const agora = () => Date.now();

// ---------------- preferências (um JSON por nome) ----------------
const todas = {};
class Prefs {
  constructor(nome) {
    this.arquivo = path.join(Pastas.sub('dados'), nome + '.json');
    try { this.dados = JSON.parse(fs.readFileSync(this.arquivo, 'utf8')); } catch (e) { this.dados = {}; }
  }
  static de(nome) { return todas[nome] || (todas[nome] = new Prefs(nome)); }
  get(k, padrao = null) { return Object.prototype.hasOwnProperty.call(this.dados, k) && this.dados[k] !== null ? this.dados[k] : padrao; }
  getStr(k, p = null) { const v = this.get(k, p); return v == null ? v : String(v); }
  getNum(k, p = 0) { const v = Number(this.get(k, p)); return isFinite(v) ? v : p; }
  getBool(k, p = false) { const v = this.get(k, p); return typeof v === 'boolean' ? v : p; }
  editar() {
    const self = this, ops = []; let limpar = false;
    const ed = {
      put(k, v) { ops.push([k, v]); return ed; },
      remove(k) { ops.push([k, undefined]); return ed; },
      clear() { limpar = true; ops.length = 0; return ed; },
      commit() {
        if (limpar) self.dados = {};
        for (const [k, v] of ops) { if (v === undefined) delete self.dados[k]; else self.dados[k] = v; }
        self.salvar();
      }
    };
    return ed;
  }
  salvar() {
    try {
      const tmp = this.arquivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.dados));
      fs.renameSync(tmp, this.arquivo);
    } catch (e) { }
  }
}

// ---------------- login guardado ----------------
// A senha é cifrada com o safeStorage do Electron (no Mac usa o Chaveiro/Keychain do usuário).
let cifra = {
  disponivel: () => false,
  cifrar: s => Buffer.from(s, 'utf8'),
  abrir: b => b.toString('utf8')
};
const Store = {
  usarCifra(c) { cifra = c; },
  get P() { return Prefs.de('login'); },
  salvarLogin(email, senha) {
    const segura = cifra.disponivel();
    const dados = segura ? cifra.cifrar(senha) : Buffer.from(senha, 'utf8');
    this.P.editar().put('email', email).put('senha', dados.toString('base64')).put('cifrada', segura).commit();
  },
  email() { return this.P.getStr('email'); },
  login() {
    const e = this.P.getStr('email'), s = this.P.getStr('senha');
    if (!e || !s) return null;
    try {
      const b = Buffer.from(s, 'base64');
      return [e, this.P.getBool('cifrada') ? cifra.abrir(b) : b.toString('utf8')];
    } catch (x) { return null; }
  },
  logado() { return !!this.P.getStr('senha'); },
  sair() { this.P.editar().clear().commit(); Prefs.de('cache').editar().clear().commit(); }
};

class ErroLogin extends Error { constructor(m) { super(m); this.name = 'ErroLogin'; } }
class SemAcesso extends Error { constructor(m) { super(m); this.name = 'SemAcesso'; } }

let VERSAO = '0.0';
let AGENTE = 'Freedom-Mac';

// ---------------- acesso ao site ----------------
class Api {
  constructor(email, senha, cookie = '') { this.email = email; this.senha = senha; this.cookie = cookie || ''; this.cookies = []; }

  static get versao() { return VERSAO; }
  static definirVersao(v) { VERSAO = v; AGENTE = 'Freedom-Mac/' + v; }

  static mensagem(e) {
    if (!e) return 'erro ao atualizar';
    const c = e.cause || {};
    const cod = c.code || e.code || '';
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT|UND_ERR_SOCKET/.test(cod) || e.name === 'TimeoutError' || e.name === 'AbortError')
      return 'sem conexão com a internet';
    if (/CERT|SSL|TLS/.test(cod)) return 'erro de conexão segura com o site';
    if (e.message === 'fetch failed') return 'sem conexão com a internet';
    return e.message || 'erro ao atualizar';
  }

  async executar(metodo, url, corpo, tipo, accept = 'application/json') {
    const h = { 'Accept': accept, 'User-Agent': AGENTE };
    if (this.cookie) h['Cookie'] = this.cookie;
    if (corpo != null && tipo) h['Content-Type'] = tipo;
    const r = await fetch(url, { method: metodo, headers: h, body: corpo == null ? undefined : corpo, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    return r;
  }

  async entrar() {
    const corpo = JSON.stringify({ login: this.email, password: this.senha, remember: true });
    const r = await this.executar('POST', BASE + '/auth/login', corpo, 'application/json; charset=utf-8');
    await r.arrayBuffer().catch(() => null);
    if (r.status === 400 || r.status === 401 || r.status === 422) throw new ErroLogin('e-mail ou senha incorretos');
    if (r.status < 200 || r.status > 299) throw new Error('login falhou (HTTP ' + r.status + ')');
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    this.cookies = sc.map(Api.lerCookie).filter(Boolean);
    this.cookie = this.cookies.map(c => c.name + '=' + c.value).join('; ');
  }

  /** "nome=valor; Path=/; HttpOnly; Secure; Max-Age=..." -> {name, value, path, httpOnly, secure, expirationDate} */
  static lerCookie(linha) {
    const partes = String(linha).split(';').map(s => s.trim());
    const [nv, ...atr] = partes;
    const i = nv.indexOf('='); if (i <= 0) return null;
    const c = { name: nv.slice(0, i), value: nv.slice(i + 1), path: '/', httpOnly: false, secure: false };
    for (const a of atr) {
      const [k, ...v] = a.split('='); const kk = k.toLowerCase(), vv = v.join('=');
      if (kk === 'path') c.path = vv || '/';
      else if (kk === 'httponly') c.httpOnly = true;
      else if (kk === 'secure') c.secure = true;
      else if (kk === 'max-age') { const n = Number(vv); if (isFinite(n)) c.expirationDate = Math.floor(Date.now() / 1000) + n; }
      else if (kk === 'expires') { const t = Date.parse(vv); if (isFinite(t)) c.expirationDate = Math.floor(t / 1000); }
      else if (kk === 'samesite') c.sameSite = vv.toLowerCase() === 'none' ? 'no_restriction' : vv.toLowerCase();
    }
    return c;
  }

  async bruto(caminho) {
    const r = await this.executar('GET', BASE + caminho, null, null);
    return { status: r.status, body: await r.text() };
  }

  async get(caminho) {
    let r = await this.bruto(caminho);
    // site instável por um instante (500/502/503/504): espera um pouco e tenta de novo uma vez
    if ([500, 502, 503, 504].indexOf(r.status) >= 0) { await new Promise(ok => setTimeout(ok, 1500)); r = await this.bruto(caminho); }
    if (r.status === 401 || r.status === 403) throw new SemAcesso('este login não tem acesso');
    if (r.status === 204) return {};      // sem dados para esse filtro (ex.: semana sem vendas): vazio, não erro
    if (r.status !== 200) throw new Error('erro ao buscar dados (HTTP ' + r.status + ')');
    return String(r.body || '').trim() ? JSON.parse(r.body) : {};
  }

  async enviar(metodo, caminho, corpo) {
    const r = await this.executar(metodo, BASE + caminho, corpo == null ? null : JSON.stringify(corpo), 'application/json; charset=utf-8');
    return { status: r.status, body: await r.text() };
  }

  async enviarArquivo(caminho, nome, tipo, dados) {
    const f = new FormData();
    f.append('file', new Blob([dados], { type: tipo }), String(nome).replace(/["\r\n]/g, '_'));
    const h = { 'Accept': 'application/json', 'User-Agent': AGENTE };
    if (this.cookie) h['Cookie'] = this.cookie;
    const r = await fetch(BASE + caminho, { method: 'POST', headers: h, body: f, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    return { status: r.status, body: await r.text() };
  }

  /** Baixa um arquivo do site para o destino. Devolve o código HTTP. */
  async baixar(caminho, destino) {
    const r = await this.executar('GET', BASE + caminho, null, null, '*/*');
    if (r.status !== 200) { await r.arrayBuffer().catch(() => null); return r.status; }
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    return 200;
  }

  async sair() { try { const r = await this.executar('POST', BASE + '/auth/logout', '', 'application/json'); await r.text(); } catch (e) { } }
}

// ---------------- módulos do login ----------------
const Acesso = {
  HELPDESK: 'helpdesk',
  get P() { return Prefs.de('acesso'); },
  salvar(me) {
    if (!Array.isArray(me.modules)) return;
    this.P.editar().put('modulos', me.modules.map(x => String(x).toLowerCase())).put('permissoes', Array.isArray(me.permissions) ? me.permissions.map(String) : []).put('perfil', me.role || '').put('nome', me.display_name || '').commit();
  },
  async atualizar(api) {
    try { this.salvar(await api.get('/auth/me')); } catch (e) { }
    // administrador do Helpdesk (setores, equipes, SLA): o botão Admin aparece também para ele
    if (this.helpdesk()) try { const r = await api.bruto('/helpdesk/admin/access'); if (r.status === 200) this.P.editar().put('hd_admin', !!JSON.parse(r.body).can_access).commit(); else if (r.status === 403) this.P.editar().put('hd_admin', false).commit(); } catch (e) { }
  },
  modulos() { const m = this.P.get('modulos'); return Array.isArray(m) ? m : null; },
  tem(modulo) { const m = this.modulos(); return m == null || m.indexOf(String(modulo).toLowerCase()) >= 0; },
  helpdesk() { return this.tem(this.HELPDESK); },
  comercial() { return this.tem('commercial'); },
  logistica() { return this.tem('logistics'); },
  /** Administração do site: só quem tem permissão de usuários, auditoria ou De/Para (enquanto não souber, não mostra). */
  admin() { if (this.P.getBool('hd_admin', false)) return true; const p = this.P.get('permissoes'); return Array.isArray(p) && p.some(x => x === 'users:manage' || x === 'audit:view' || x === 'firebird_mappings:view'); },
  perfil() { return this.P.getStr('perfil', ''); },
  nome() { return this.P.getStr('nome', ''); },
  limpar() { this.P.editar().clear().commit(); }
};

module.exports = { SITE, BASE, Pastas, Prefs, Store, Api, Acesso, ErroLogin, SemAcesso, agora };
