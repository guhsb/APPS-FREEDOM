'use strict';
/**
 * Atualização pelo GitHub (Releases): baixa o Freedom-Mac.zip novo, troca o Freedom.app e reabre.
 * Igual à do Windows/Android (confere ao abrir e a cada 6 h).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { Prefs, agora } = require('./base');

const REPO = 'guhsb/APPS-FREEDOM';
const ARQUIVO = 'Freedom-Mac.zip';

let versaoAtual = 0;
const A = {
  baixando: false, progresso: 0, erro: null,
  get P() { return Prefs.de('atualizacao'); },
  definirVersao(v) { const p = String(v).split('.'); versaoAtual = Number(p[1] || p[0]) || 0; },
  nova() {
    try { const o = JSON.parse(this.P.getStr('ultima')); return o.versao > versaoAtual && o.url ? o : null; } catch (e) { return null; }
  },
  resumo(versaoTexto) {
    const o = { atual: versaoTexto, baixando: this.baixando, progresso: this.progresso, conferido: this.P.getNum('hora') };
    if (this.erro) o.erro = this.erro;
    const n = this.nova(); if (n) { o.nova = n.versao; o.notas = n.notas; }
    return o;
  },
  /** 0 = em dia, 1 = tem nova, -1 = falhou. */
  async conferir(forcar) {
    const t = agora();
    if (!forcar && t - this.P.getNum('hora') < 6 * 3600000) return this.nova() ? 1 : 0;
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest', { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Freedom-Mac' }, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      const versao = Number(String(j.tag_name || '').replace(/\D/g, '')) || 0;
      const a = (j.assets || []).find(x => x.name === ARQUIVO) || {};
      const notas = String(j.body || '');
      this.P.editar().put('ultima', JSON.stringify({ versao, url: a.browser_download_url || '', tamanho: a.size || -1, pagina: j.html_url || '', notas: notas.slice(0, 400) })).put('hora', t).commit();
      return this.nova() ? 1 : 0;
    } catch (e) { this.P.editar().put('hora', t).commit(); return this.nova() ? 1 : -1; }
  },
  pagina() { const n = this.nova(); return n && n.pagina ? n.pagina : 'https://github.com/' + REPO + '/releases/latest'; },

  /** Pasta do Freedom.app que está rodando (ou null se não estiver num .app). */
  bundle() {
    const m = process.execPath.match(/^(.*?\.app)\/Contents\/MacOS\//);
    return m ? m[1] : null;
  },

  /** Baixa, troca o app e reabre. avisar() a cada 5%. Devolve true se vai reiniciar. */
  async baixarEInstalar(avisar) {
    const n = this.nova(); if (!n || this.baixando) return false;
    const app = this.bundle(); if (!app) { this.erro = 'Atualize pela página de downloads.'; return false; }
    this.baixando = true; this.progresso = 0; this.erro = null; avisar && avisar();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freedom-'));
    try {
      const r = await fetch(n.url, { headers: { 'User-Agent': 'Freedom-Mac' }, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = Number(r.headers.get('content-length')) || n.tamanho || 0;
      const zip = path.join(tmp, ARQUIVO), sai = fs.createWriteStream(zip);
      let lido = 0, ultimo = -1;
      for await (const pedaco of r.body) {
        sai.write(pedaco); lido += pedaco.length;
        if (total > 0) { const pct = Math.min(100, Math.floor(lido * 100 / total)); if (Math.floor(pct / 5) !== Math.floor(ultimo / 5)) { this.progresso = pct; ultimo = pct; avisar && avisar(); } }
      }
      await new Promise(ok => sai.end(ok));
      if (fs.statSync(zip).size < 1000000) throw new Error('arquivo baixado incompleto');
      const dest = path.join(tmp, 'novo');
      execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dest]);
      const novo = fs.readdirSync(dest).find(x => x.endsWith('.app'));
      if (!novo) throw new Error('o pacote não tem o Freedom.app');
      try { execFileSync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', path.join(dest, novo)]); } catch (e) { }
      // um script espera este app fechar, troca a pasta e abre a versão nova
      const sh = path.join(tmp, 'trocar.sh');
      fs.writeFileSync(sh, '#!/bin/sh\nwhile kill -0 ' + process.pid + ' 2>/dev/null; do sleep 0.5; done\n' +
        'rm -rf "' + app + '.velho"\nmv "' + app + '" "' + app + '.velho" && mv "' + path.join(dest, novo) + '" "' + app + '" && rm -rf "' + app + '.velho"\n' +
        'open "' + app + '" --args --atualizado\n', { mode: 0o755 });
      spawn('/bin/sh', [sh], { detached: true, stdio: 'ignore' }).unref();
      return true;
    } catch (e) {
      this.erro = 'Não consegui atualizar: ' + (e.message || e);
      return false;
    } finally { this.baixando = false; avisar && avisar(); }
  }
};

module.exports = A;
