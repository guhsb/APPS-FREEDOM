'use strict';
/**
 * Interruptor remoto do app, comandado pelo arquivo controle.json do repositório no GitHub
 * (só quem pode fazer Push no repositório consegue mudar). Igual ao Controle.kt / Controle.cs:
 *   { "bloqueado": false, "mensagem": "", "bloquear": ["email@..."], "versaoMinima": 0 }
 * Sem internet, GitHub fora do ar ou arquivo sumido: mantém o último estado conhecido.
 */
const { Prefs, Store, agora } = require('./base');
const URL_CONTROLE = 'https://raw.githubusercontent.com/guhsb/APPS-FREEDOM/main/controle.json';

let versaoAtual = 0;
const C = {
  get P() { return Prefs.de('controle'); },
  definirVersao(v) { const p = String(v).split('.').map(Number); versaoAtual = (p[2] > 0 ? p[2] : p[1] || p[0]) || 0; },
  /** Busca o controle.json (no máximo a cada 10 min, ou na hora com forcar). */
  async conferir(forcar) {
    const t = agora();
    if (!forcar && t - this.P.getNum('hora', 0) < 10 * 60 * 1000) return;
    try {
      const r = await fetch(URL_CONTROLE + '?t=' + Math.floor(t / 60000), { headers: { 'User-Agent': 'Freedom-Mac', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10000) });
      if (r.status === 200) { const txt = await r.text(); JSON.parse(txt); this.P.editar().put('json', txt).put('hora', t).commit(); }
      else this.P.editar().put('hora', t).commit();
    } catch (e) { }
  },
  /** "3.4" -> número da publicação (3.0 = 21, cada versão +1, 3.10 -> 4.0); número sozinho já é a publicação. */
  numeroPublicacao(v) {
    const s = String(v == null ? '' : v).trim(); if (!s) return 0;
    if (s.indexOf('.') < 0) return Math.floor(Number(s)) || 0;
    const p = s.split('.').map(Number); if (!(p[0] >= 3)) return 0;
    return 21 + (p[0] - 3) * 11 + (p[1] || 0);
  },
  /** null = liberado; senão {tipo: todos|usuario|versao, mensagem}. */
  estado(email) {
    let o; try { o = JSON.parse(this.P.getStr('json') || 'null'); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return null;
    const msg = String(o.mensagem || '').trim();
    if (o.bloqueado === true) return { tipo: 'todos', mensagem: msg || 'Este app foi desativado pela empresa.' };
    const e = String(email != null ? email : (Store.email() || '')).trim().toLowerCase();
    if (e && Array.isArray(o.bloquear) && o.bloquear.some(x => String(x || '').trim().toLowerCase() === e))
      return { tipo: 'usuario', mensagem: msg || 'O acesso deste login ao app foi desativado.' };
    const min = C.numeroPublicacao(o.versaoMinima);
    if (min > 0 && versaoAtual > 0 && versaoAtual < min)
      return { tipo: 'versao', mensagem: 'Esta versão do app não pode mais ser usada. Atualize para a versão ' + o.versaoMinima + ' ou mais nova.' };
    return null;
  }
};
module.exports = C;
