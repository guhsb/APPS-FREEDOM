'use strict';
/**
 * Freedom para Mac: mesmas telas e mesma lógica do app Android e do Freedom para Windows.
 *  - janela com barra lateral (Helpdesk, Site, Painel), as telas do app ficam em www/
 *  - avisos do Helpdesk e de metas nas notificações do macOS, ícone na barra de menus, número no ícone do Dock
 *  - abre junto com o Mac (escondido) e se atualiza pelo GitHub
 */
const { app, BrowserWindow, WebContentsView, ipcMain, Notification, Tray, Menu, nativeImage, nativeTheme, shell, dialog, clipboard, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');

const { SITE, Pastas, Store, Api, Acesso, Prefs } = require('./core/base');
const Helpdesk = require('./core/helpdesk');
const { Chamado, Fila } = require('./core/chamado');
const Paineis = require('./core/paineis');
const Atualizacao = require('./core/atualizacao');
const Controle = require('./core/controle');

const SITE_HOST = 'relatorios.cbfreedom.com.br';
const WWW = path.join(__dirname, 'www');
const TELAS = ['lista.html', 'novo.html', 'dash-helpdesk.html'];
const NAV = 78, TOPO = 76;   // layout novo: atalhos na esquerda e abas em pílula no topo (shell.html, modo mac)

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let janela = null, vApp = null, vSite = null, vPainel = null, tray = null;
let vDash = null, dashAtual = null, vSino = null, sinoAberto = false, sinoX = -1, helpSub = 'inicio';
const subs = {};   // página -> partes (abas) que ela tem
const DASH = { comercial: 'dash-comercial.html', logistica: 'dash-logistica.html', admin: 'admin.html' };
let aba = 'helpdesk', painelAtual = null, paginaApp = '', saindo = false, siteCarregado = false, ultimoLoginSite = 0;
let monitor = null, timerPaineis = null;

const url = arq => 'file://' + path.join(WWW, arq);
const logado = () => Store.logado();
// aparência: claro (padrão, igual ao site) ou escuro — escolhida em Helpdesk > Configurações
const temaClaro = () => Prefs.de('aparencia').getStr('tema', 'claro') !== 'escuro';
const corFundo = () => temaClaro() ? '#eef2f7' : '#0b0d12';
const resumoApp = () => Atualizacao.resumo(app.getVersion());

// ---------------- início ----------------
app.whenReady().then(() => {
  Pastas.iniciar(app.getPath('userData'));
  nativeTheme.themeSource = temaClaro() ? 'light' : 'dark';
  Store.usarCifra({ disponivel: () => safeStorage.isEncryptionAvailable(), cifrar: s => safeStorage.encryptString(s), abrir: b => safeStorage.decryptString(b) });
  Api.definirVersao(app.getVersion());
  Atualizacao.definirVersao(app.getVersion());
  Controle.definirVersao(app.getVersion());
  Helpdesk.usarFila(Fila);
  if (app.isPackaged) try { if (!Store.P.getBool('loginItem', false)) { app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true }); Store.P.editar().put('loginItem', true).commit(); } } catch (e) { }

  montarMenu();
  criarJanela();
  criarBandeja();

  Helpdesk.ev.on('avisar', notas => mostrarAvisos(notas));
  Helpdesk.ev.on('mudou', () => { avisarHelpdesk(); atualizarBarra(); });
  Paineis.ev.on('mudou', avisarPainel);
  Paineis.ev.on('meta', (t, x, id) => notificar(t, x, 'painel:' + id));
  Fila.avisos.on('aviso', (t, x, c) => notificar(t, x, c));

  const abriuEscondido = process.argv.includes('--oculto') || (app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAsHidden);
  if (!abriuEscondido) janela.show();

  iniciarMonitor();
});

app.on('second-instance', () => mostrar());
app.on('activate', () => mostrar());
app.on('before-quit', () => { saindo = true; });
app.on('window-all-closed', e => { /* continua rodando na barra de menus */ });

function mostrar() { if (!janela) return; if (janela.isMinimized()) janela.restore(); janela.show(); janela.focus(); }

function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Freedom', submenu: [{ role: 'about', label: 'Sobre o Freedom' }, { type: 'separator' },
      { label: 'Verificar o Helpdesk agora', click: () => Helpdesk.verificar(true) },
      { label: 'Procurar atualização', click: () => ponte.atualizarApp(vApp && vApp.webContents) },
      { type: 'separator' }, { role: 'hide', label: 'Ocultar o Freedom' }, { role: 'hideOthers', label: 'Ocultar os outros' }, { type: 'separator' },
      { label: 'Sair do Freedom', accelerator: 'Cmd+Q', click: () => { saindo = true; app.quit(); } }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' },
      { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Ver', submenu: [{ label: 'Helpdesk', accelerator: 'Cmd+1', click: () => selecionar('helpdesk') }, { label: 'Site', accelerator: 'Cmd+2', click: () => selecionar('site') },
      { label: 'Painel', accelerator: 'Cmd+3', click: () => selecionar('painel') },
      { label: 'Comercial', accelerator: 'Cmd+4', click: () => selecionar('comercial') }, { label: 'Logística', accelerator: 'Cmd+5', click: () => selecionar('logistica') },
      { label: 'Administração', accelerator: 'Cmd+6', click: () => selecionar('admin') }, { type: 'separator' },
      { label: 'Recarregar', accelerator: 'Cmd+R', click: () => { const v = vistaAtual(); if (v) v.webContents.reload(); } },
      { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho normal' }] },
    { label: 'Janela', submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom', label: 'Zoom' }, { label: 'Fechar janela', accelerator: 'Cmd+W', click: () => janela && janela.hide() }] }
  ]));
}

// ---------------- janela ----------------
function opcoesTela(preload) {
  return { webPreferences: { preload: path.join(__dirname, preload), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false } };
}

function criarJanela() {
  janela = new BrowserWindow({ width: 1180, height: 800, minWidth: 820, minHeight: 560, show: false, backgroundColor: corFundo(), title: 'Freedom',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  janela.loadURL(url('shell.html') + '?modo=mac');
  janela.webContents.on('did-finish-load', atualizarBarra);
  janela.on('close', e => { if (!saindo) { e.preventDefault(); janela.hide(); } });
  janela.on('resize', posicionar);
  janela.on('show', posicionar);

  vApp = new WebContentsView(opcoesTela('preload.js'));
  vApp.setBackgroundColor(corFundo());
  janela.contentView.addChildView(vApp);
  protegerNavegacao(vApp.webContents, true);
  vApp.webContents.on('did-start-navigation', (e) => {
    if (!e.isMainFrame) return;
    const u = e.url || '';
    if (u.startsWith('file://')) paginaApp = u.includes('login.html') ? 'login' : u.includes('helpdesk.html') ? 'helpdesk' : 'sub';
  });
  carregar(null);
}

function vistaAtual() { return aba === 'site' ? vSite : aba === 'painel' ? vPainel : DASH[aba] ? vDash : vApp; }

function posicionar() {
  if (!janela) return;
  const [w, h] = janela.getContentSize();
  const x = logado() ? NAV : 0, y = logado() ? TOPO : 0;
  const chips = aba === 'painel' && Paineis.paraAba().length > 1 ? 52 : 0;
  for (const v of [vApp, vSite, vPainel, vDash]) if (v) v.setBounds({ x, y, width: Math.max(0, w - x), height: Math.max(0, h - y) });
  if (vPainel) vPainel.setBounds({ x, y: y + chips, width: Math.max(0, w - x), height: Math.max(0, h - y - chips) });
  if (vSino) {
    const sw = 450, sh = Math.min(600, Math.max(320, h - 80)), cx = sinoX > 0 ? sinoX : w - 330, sx = Math.max(8, Math.min(w - sw - 8, cx - sw + 70));
    vSino.setBounds({ x: sx, y: 60, width: sw, height: sh });
    js(vSino.webContents, 'window.seta && seta(' + (cx - sx) + ')');
  }
}

function mostrarSo(v) {
  for (const x of [vApp, vSite, vPainel, vDash]) if (x) x.setVisible(x === v);
  posicionar();
}

function abasDisponiveis() {
  const r = [];
  if (Acesso.helpdesk()) r.push('helpdesk');
  if (Acesso.comercial()) r.push('comercial');
  if (Acesso.logistica()) r.push('logistica');
  if (Acesso.admin()) r.push('admin');
  if (Paineis.paraAba().length > 0) r.push('painel');
  r.push('site');
  return r;
}

function atualizarBarra() {
  if (!janela || janela.isDestroyed()) return;
  const n = aba === 'helpdesk' ? 0 : Helpdesk.naoVistos();
  janela.webContents.send('barra-estado', { tema: temaClaro() ? 'claro' : 'escuro', logado: logado(), abas: abasDisponiveis(), aba, selo: n,
    paineis: Paineis.paraAba().map(p => ({ id: p.id, nome: p.nomeModulo })), painel: painelAtual });
  js(janela.webContents, 'window.shellAtualizar && shellAtualizar()');
  if (sinoAberto && vSino) js(vSino.webContents, 'window.recebidoHelpdesk && recebidoHelpdesk()');
  const total = Helpdesk.naoVistos();
  try { app.dock && app.dock.setBadge(total > 0 ? String(total) : ''); } catch (e) { }
  if (tray) tray.setToolTip(total > 0 ? 'Freedom · ' + total + ' novidade(s)' : 'Freedom');
}

function carregar(caminho) {
  if (!logado()) {
    for (const v of [vSite, vPainel, vDash]) if (v) v.setVisible(false);
    vApp.setVisible(true);
    if (paginaApp !== 'login') { vApp.webContents.loadURL(url('login.html')); paginaApp = 'login'; }
    posicionar(); atualizarBarra();
    return;
  }
  if (paginaApp !== 'helpdesk' && paginaApp !== 'sub') { vApp.webContents.loadURL(url('helpdesk.html')); paginaApp = 'helpdesk'; }
  if (caminho) abrirCaminho(caminho); else selecionar(aba);
}

function selecionar(nova) {
  if (!logado()) return carregar(null);
  const disp = abasDisponiveis();
  if (disp.indexOf(nova) < 0) nova = ['helpdesk', 'comercial', 'logistica', 'painel', 'site'].find(x => disp.indexOf(x) >= 0);
  const trocou = aba !== nova;
  aba = nova;
  if (nova === 'site') garantirSite(null);
  if (nova === 'painel') garantirPainel();
  if (DASH[nova]) garantirDash(nova);
  mostrarSo(nova === 'site' ? vSite : nova === 'painel' ? vPainel : DASH[nova] ? vDash : vApp);
  if (nova === 'helpdesk') { Helpdesk.marcarVisto(); avisarHelpdesk(); }
  if (nova === 'painel' && Paineis.velho(2)) Paineis.atualizar();
  atualizarBarra();
  // a tela nova entra embaçada e sobe um pouco até ficar em foco
  if (trocou && nova !== 'site') { const v = vistaAtual(); if (v) js(v.webContents, 'window.F && F.entrar && F.entrar()'); }
}

// ---------------- barras novas (topo, atalhos, sino) ----------------
const acoesTela = {};
function shellJson() {
  const nomes = { helpdesk: 'Helpdesk', comercial: 'Comercial', logistica: 'Logística', admin: 'Admin', painel: 'Painel', site: 'Site' };
  const o = { logado: logado(), aba, abas: logado() ? abasDisponiveis().map(a => [a, nomes[a]]) : [], tema: temaClaro() ? 'claro' : 'escuro',
    naoLidos: aba === 'helpdesk' ? 0 : Helpdesk.naoVistos(), sino: sinoAberto, helpSub, helpdesk: Acesso.helpdesk(), email: Store.email() || '', nome: Acesso.nome() || '',
    paineis: Paineis.paraAba().map(p => ({ id: p.id, nome: p.nomeModulo })), painel: painelAtual };
  if (DASH[aba] && subs[DASH[aba]]) try { o.sub = JSON.parse(subs[DASH[aba]]); } catch (e) { }
  try { const v = aba !== 'site' && vistaAtual(); if (v) { const a = acoesTela[v.webContents.getURL().split('#')[0]]; if (a) o.acoes = a; } } catch (e) { }
  return JSON.stringify(o);
}
function irSub(id) {
  id = String(id || '').replace(/[^A-Za-z0-9_-]/g, ''); if (!id) return;
  if (aba === 'helpdesk') {
    if (id === 'inicio') voltarHelpdesk(); else if (id === 'dash') abrirTela('dash-helpdesk.html'); else abrirTela('lista.html#' + id);
    helpSub = id; js(vApp.webContents, 'setTimeout(function(){window.F&&F.entrar&&F.entrar()},60)'); atualizarBarra(); return;
  }
  if (DASH[aba] && vDash) js(vDash.webContents, "(function(){var b=document.querySelector('.tabs:not(.sub) [data-aba=\"" + id + "\"]');if(b)b.click();})()");
}
function sino(abrir) {
  if (abrir && !vSino) {
    vSino = new WebContentsView(opcoesTela('preload.js'));
    vSino.setBackgroundColor('#00000000');   // transparente: só o cartão arredondado aparece
    janela.contentView.addChildView(vSino);
    protegerNavegacao(vSino.webContents, true);
    vSino.webContents.loadURL(url('avisos.html') + '?popup=1');
  }
  sinoAberto = !!abrir && !!vSino;
  if (vSino) {
    if (sinoAberto) { try { janela.contentView.removeChildView(vSino); janela.contentView.addChildView(vSino); } catch (e) { } }   // por cima de tudo
    vSino.setVisible(sinoAberto); posicionar();
    if (sinoAberto) { vSino.webContents.focus(); js(vSino.webContents, 'window.recebidoHelpdesk && recebidoHelpdesk()'); }
  }
  atualizarBarra();
}

// ---------------- telas do app ----------------
const RE_CHAMADO = /^(?:https:\/\/relatorios\.cbfreedom\.com\.br)?\/helpdesk\/tickets\/(\d+)\/?$/;

function abrirCaminho(caminho) {
  const c = String(caminho || '').trim();
  if (c.startsWith('painel:')) { painelAtual = c.slice(7); garantirPainel(true); selecionar('painel'); return; }
  const m = c.match(RE_CHAMADO);
  if (m && Acesso.helpdesk()) abrirChamado(Number(m[1]));
  else abrirNoSite(c);
}

function abrirChamado(id) {
  vApp.webContents.loadURL(url('chamado.html') + '#' + id);
  paginaApp = 'sub'; helpSub = '';
  selecionar('helpdesk');
}

function abrirTela(arquivo) {
  const nome = String(arquivo).split('#')[0], resto = arquivo.indexOf('#') >= 0 ? arquivo.slice(arquivo.indexOf('#') + 1) : '';
  if (TELAS.indexOf(nome) < 0 || !/^[A-Za-z0-9_=&%.-]*$/.test(resto)) return;
  vApp.webContents.loadURL(url(nome) + (resto ? '#' + resto : ''));
  paginaApp = 'sub';
  helpSub = nome === 'dash-helpdesk.html' ? 'dash' : nome === 'lista.html' ? (resto.split('&')[0] || 'fila') : '';
  selecionar('helpdesk');
}

function voltarHelpdesk() { vApp.webContents.loadURL(url('helpdesk.html')); paginaApp = 'helpdesk'; helpSub = 'inicio'; atualizarBarra(); }
function voltarApp() {
  const h = vApp.webContents.navigationHistory;
  if (paginaApp === 'sub' && h && h.canGoBack()) h.goBack(); else voltarHelpdesk();
}

/** As telas do app só navegam dentro de www/; links do site abrem na aba Site; o resto no navegador. */
function protegerNavegacao(wc, local) {
  wc.setWindowOpenHandler(({ url: u }) => { abrirExterno(u); return { action: 'deny' }; });
  wc.on('will-navigate', (e, u) => {
    if (local && u.startsWith('file://' + WWW)) return;
    if (!local && u.includes('://' + SITE_HOST)) return;
    e.preventDefault(); abrirExterno(u);
  });
}

function abrirExterno(u) {
  let x; try { x = new URL(u); } catch (e) { return; }
  if (x.host === SITE_HOST) abrirCaminho(u);
  else if (['https:', 'http:', 'mailto:'].indexOf(x.protocol) >= 0) shell.openExternal(u);
}

// ---------------- avisos ----------------
function js(wc, codigo) { try { if (wc && !wc.isDestroyed()) wc.executeJavaScript(codigo, true).catch(() => null); } catch (e) { } }
function avisarHelpdesk() { if (paginaApp !== 'login') js(vApp && vApp.webContents, 'window.recebidoHelpdesk && recebidoHelpdesk()'); }
function avisarPainel() { js(vPainel && vPainel.webContents, 'window.recebido && recebido()'); }
function avisarTodas() { avisarHelpdesk(); avisarPainel(); }

/** Notificação "versão nova" (uma vez por versão). Clicar abre o app e já atualiza. */
function avisarVersaoNova() {
  const n = Atualizacao.nova(); if (!n) return;
  const P = Atualizacao.P; if (P.getNum('avisada') === n.versao) return;
  P.editar().put('avisada', n.versao).commit();
  if (!Notification.isSupported()) return;
  const nt = new Notification({ title: 'Nova versão do Freedom', body: 'A versão ' + (n.nome || n.versao) + ' está disponível. Clique para atualizar.', silent: false });
  nt.on('click', () => { mostrar(); ponte.atualizarApp(vApp && vApp.webContents); });
  nt.show();
}
const conferirVersao = forcar => conferirControle().then(() => Atualizacao.conferir(forcar)).then(() => { avisarTodas(); avisarVersaoNova(); }).catch(() => null);
/** Interruptor remoto (controle.json no GitHub): bloqueado = sai da conta e apaga o que o app guardou. */
async function conferirControle() {
  await Controle.conferir(false);
  if (Controle.estado() && logado()) {
    try { Fila.limpar(); } catch (e) { }
    try { Prefs.de('metas').editar().clear().commit(); } catch (e) { }
    ponte.sair();
  }
}

function notificar(titulo, texto, caminho) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: titulo, body: texto, silent: false });
  n.on('click', () => { mostrar(); if (caminho) abrirCaminho(caminho); });
  n.show();
}

function mostrarAvisos(notas) {
  const lista = notas.slice(0, 4);
  for (const n of lista) notificar(n.title, (n.lines && n.lines.length ? n.lines.slice(-3).join('\n') : n.text), n.path);
  if (notas.length > 4) notificar((notas.length - 4) + ' outras novidades no Helpdesk', notas.slice(4, 8).map(n => n.title).join('\n'), null);
  atualizarBarra(); avisarHelpdesk();
}

// ---------------- ícone na barra de menus ----------------
function criarBandeja() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'recursos', 'trayTemplate.png'));
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Freedom');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Freedom', click: mostrar },
    { label: 'Verificar o Helpdesk agora', click: () => Helpdesk.verificar(true) },
    { type: 'separator' },
    { label: 'Sair do Freedom', click: () => { saindo = true; app.quit(); } }
  ]));
}

// ---------------- Comercial, Logística e Administração (telas completas, iguais ao site) ----------------
function garantirDash(id) {
  if (!vDash) {
    vDash = new WebContentsView(opcoesTela('preload.js'));
    vDash.setBackgroundColor(corFundo());
    vDash.setVisible(false);
    janela.contentView.addChildView(vDash);
    protegerNavegacao(vDash.webContents, true);
  }
  if (dashAtual !== id) { dashAtual = id; vDash.webContents.loadURL(url(DASH[id]) + '#aba=1'); }
  posicionar();
}

// ---------------- painel ----------------
/** Dashboard completo de cada painel (abre por dentro do painel; o painel e o PNG continuam iguais). */
function dashDe(id) { return id === 'comercial' ? 'dash-comercial.html' : 'dash-logistica.html'; }

function garantirPainel(forcarTela) {
  const lista = Paineis.paraAba();
  if (!lista.length) return;
  if (!lista.some(p => p.id === painelAtual)) painelAtual = lista[0].id;
  const tela = Paineis.porId(painelAtual).tela;
  if (!vPainel) {
    vPainel = new WebContentsView(opcoesTela('preload.js'));
    vPainel.setBackgroundColor(corFundo());
    vPainel.setVisible(false);
    janela.contentView.addChildView(vPainel);
    protegerNavegacao(vPainel.webContents, true);
    vPainel.webContents.loadURL(url(tela));
  } else if (forcarTela || !(vPainel.webContents.getURL().includes(tela) || vPainel.webContents.getURL().includes(dashDe(painelAtual)))) vPainel.webContents.loadURL(url(tela));
  posicionar();
}

// ---------------- site (já logado) ----------------
function garantirSite(destino) {
  if (vSite) return false;
  vSite = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:site' } });
  vSite.setBackgroundColor('#ffffff');
  vSite.setVisible(false);
  janela.contentView.addChildView(vSite);
  const wc = vSite.webContents;
  protegerNavegacao(wc, false);
  wc.setWindowOpenHandler(({ url: u }) => {
    let x; try { x = new URL(u); } catch (e) { return { action: 'deny' }; }
    if (x.host === SITE_HOST) wc.loadURL(u); else shell.openExternal(u);
    return { action: 'deny' };
  });
  wc.on('did-start-navigation', e => {
    if (!e.isMainFrame) return;
    let x; try { x = new URL(e.url); } catch (y) { return; }
    // caiu na tela de login do site: entra sozinho com o login do app
    if (x.host === SITE_HOST && x.pathname.startsWith('/login') && logado() && Date.now() - ultimoLoginSite > 20000) entrarNoSite(destinoSite || SITE + '/');
  });
  wc.session.on('will-download', (e, item) => {
    const dir = Pastas.downloads(), ext = path.extname(item.getFilename()), base = path.basename(item.getFilename(), ext);
    let alvo = path.join(dir, item.getFilename()), n = 1;
    while (fs.existsSync(alvo)) alvo = path.join(dir, base + ' (' + (n++) + ')' + ext);
    item.setSavePath(alvo);
    item.once('done', (ev, estado) => { if (estado === 'completed') notificar('Download concluído', path.basename(alvo) + ' · pasta Downloads', null); });
  });
  destinoSite = destino || SITE + '/';
  entrarNoSite(destinoSite);
  posicionar();
  return true;
}
let destinoSite = null;

async function entrarNoSite(destino) {
  ultimoLoginSite = Date.now();
  try {
    const l = Store.login();
    if (l) {
      const api = new Api(l[0], l[1]); await api.entrar();
      for (const c of api.cookies) {
        await vSite.webContents.session.cookies.set({ url: SITE, name: c.name, value: c.value, path: c.path || '/', secure: true,
          httpOnly: c.httpOnly, expirationDate: c.expirationDate, sameSite: c.sameSite }).catch(() => null);
      }
    }
  } catch (e) { }
  if (vSite) vSite.webContents.loadURL(destino || SITE + '/');
}

function abrirNoSite(caminho) {
  let c = caminho || '/';
  if (c.indexOf('://') >= 0) { let x; try { x = new URL(c); } catch (e) { return; } if (x.host !== SITE_HOST) return abrirExterno(c); }
  const u = c.indexOf('://') >= 0 ? c : SITE + (c.startsWith('/') ? c : '/' + c);
  const nova = garantirSite(u);
  selecionar('site');
  if (!nova) { destinoSite = u; vSite.webContents.loadURL(u); }
}

// ---------------- monitor ----------------
function iniciarMonitor() {
  const ciclo = () => {
    clearTimeout(monitor);
    const proximo = () => { monitor = setTimeout(ciclo, Helpdesk.intervaloSeg() * 1000); };
    if (!logado()) return proximo();
    Helpdesk.ciclo().catch(() => null).finally(proximo);
  };
  if (logado()) { Helpdesk.verificar(false).catch(() => null); Paineis.atualizar(); }
  monitor = setTimeout(ciclo, 5000);
  timerPaineis = setInterval(() => { if (logado()) Paineis.atualizar(); }, 15 * 60 * 1000);
  conferirVersao(false);
  setInterval(() => conferirVersao(false), 30 * 60 * 1000);
}

// ---------------- ponte (window.App das telas) ----------------
const Q = s => JSON.stringify(String(s == null ? '' : s));

const ponte = {
  nome: () => 'Freedom',
  plataforma: () => 'mac',
  tema: () => temaClaro() ? 'claro' : 'escuro',
  definirTema: (wc, t) => {
    t = t === 'escuro' ? 'escuro' : 'claro';
    Prefs.de('aparencia').editar().put('tema', t).commit();
    nativeTheme.themeSource = t === 'claro' ? 'light' : 'dark';
    if (janela) { janela.setBackgroundColor(corFundo()); js(janela.webContents, 'window.temaMudou && temaMudou(' + Q(t) + ')'); }
    for (const v of [vApp, vPainel, vDash, vSino]) if (v) { try { v.setBackgroundColor(corFundo()); } catch (e) { } js(v.webContents, 'window.temaMudou && temaMudou(' + Q(t) + ')'); }
  },
  dadosPainel: (wc, id) => JSON.stringify(Paineis.dadosPainel(id, resumoApp())),
  dados: () => { const l = Paineis.paraAba(); return JSON.stringify(Paineis.dadosPainel(l.length ? l[0].id : '', resumoApp())); },
  atualizar: () => { Paineis.atualizar(); },
  buscarPainel: (wc, id, ini, fim) => {
    Paineis.buscarPeriodo(id, ini, fim).then(d => js(wc, 'window.painelPeriodo && painelPeriodo(' + (d ? JSON.stringify(d) : 'null') + ',' + Q(d ? '' : 'este painel não tem escolha de período') + ')'))
      .catch(e => js(wc, 'window.painelPeriodo && painelPeriodo(null,' + Q(Api.mensagem(e)) + ')'));
  },
  entrar: (wc, email, senha) => {
    const e = String(email || '').trim();
    (async () => {
      await Controle.conferir(true);
      const bl = Controle.estado(e);
      if (bl) { js(wc, 'erroLogin(' + Q(bl.mensagem) + ')'); return; }
      try {
        const api = new Api(e, senha); await api.entrar(); await Acesso.atualizar(api); await api.sair();
        Store.salvarLogin(e, senha);
        paginaApp = '';
        carregar(null);
        Helpdesk.verificar(true); Paineis.atualizar();
        atualizarBarra(); avisarHelpdesk();
      } catch (x) { js(wc, 'erroLogin(' + Q(Api.mensagem(x)) + ')'); }
    })();
  },
  controle: () => JSON.stringify(Controle.estado() || {}),
  sair: () => {
    Store.sair(); Helpdesk.sair(); Acesso.limpar();
    if (vSite) { session.fromPartition('persist:site').clearStorageData().catch(() => null); janela.contentView.removeChildView(vSite); vSite.webContents.close(); vSite = null; }
    if (vPainel) { janela.contentView.removeChildView(vPainel); vPainel.webContents.close(); vPainel = null; }
    if (vDash) { janela.contentView.removeChildView(vDash); vDash.webContents.close(); vDash = null; dashAtual = null; }
    aba = 'helpdesk'; paginaApp = '';
    carregar(null);
  },
  helpdesk: () => JSON.stringify(Helpdesk.resumoTela(resumoApp())),
  verificarHelpdesk: () => { Helpdesk.verificar(true).finally(avisarHelpdesk); },
  configurarHelpdesk: (wc, json) => { try { Helpdesk.configurar(JSON.parse(json)); } catch (e) { } avisarHelpdesk(); },
  abrirSite: (wc, c) => abrirCaminho(c),
  siteDireto: (wc, c) => abrirNoSite(c),
  aba: (wc, nome) => selecionar(nome),
  // barras novas
  shell: () => shellJson(),
  irAba: (wc, id) => {
    sino(false);
    if (aba === id && id === 'site' && vSite) vSite.webContents.loadURL(SITE + '/');
    else if (aba === id && id === 'helpdesk' && (paginaApp === 'sub' || helpSub === 'config')) { voltarHelpdesk(); js(vApp.webContents, 'window.F && F.entrar && F.entrar()'); }
    else selecionar(id);
  },
  irSub: (wc, id) => irSub(id),
  acaoShell: (wc, nome) => {
    if (nome === 'imagem' || nome === 'excel' || nome === 'atualizar') { const v = vistaAtual(); if (v) js(v.webContents, "window.acaoRail && acaoRail('" + nome + "')"); }
    else if (nome === 'chamado') { sino(false); abrirTela('novo.html'); }
    else if (nome === 'claro' || nome === 'escuro') { ponte.definirTema(wc, nome); atualizarBarra(); }
    else if (nome === 'sair') ponte.sair();
    else if (nome === 'config' && vApp && aba === 'helpdesk' && helpSub === 'config') { sino(false); voltarHelpdesk(); }
    else if (nome === 'config' && vApp && abasDisponiveis().includes('helpdesk')) { sino(false); vApp.webContents.loadURL(url('helpdesk.html') + '?config=1'); paginaApp = 'sub'; helpSub = 'config'; selecionar('helpdesk'); atualizarBarra(); }
  },
  sino: (wc, abrir, x) => { if (x > 0) sinoX = x; sino(!!abrir); },
  marcarLidos: () => { Helpdesk.marcarVisto(); avisarHelpdesk(); atualizarBarra(); },
  subAbas: (wc, json) => { try { const j = JSON.parse(json); if (j.acoes === 1 && j.url) { acoesTela[j.url] = j; atualizarBarra(); return; } if (j.pagina) { subs[j.pagina] = json; atualizarBarra(); } } catch (e) { } },
  painelShell: (wc, id) => { painelAtual = id; garantirPainel(true); atualizarBarra(); },
  abrirTela: (wc, arq) => abrirTela(String(arq || '')),
  voltar: () => voltarApp(),
  liberarBateria: () => { },
  configurarNotificacoes: () => { shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications'); },
  configurarSom: () => { shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications'); },
  testarNotificacao: () => notificar('Teste · Helpdesk Freedom', 'Assim chegam os avisos: novo chamado, resposta, mudança de status…', null),

  carregarChamado: (wc, id) => {
    id = Number(id);
    Chamado.historico(id).then(r => js(wc, 'window.chamadoCarregado && chamadoCarregado(' + id + ',' + r.ok + ',' + Q(r.mensagem) + ',' + (r.dados ? JSON.stringify(r.dados) : 'null') + ')'));
  },
  responderChamado: (wc, id, texto) => {
    id = Number(id);
    Chamado.responder(id, texto).then(r => js(wc, 'window.chamadoAcao && chamadoAcao(' + id + ",'responder'," + r.ok + ',' + Q(r.mensagem) + ')'));
  },
  assumirChamado: (wc, id) => ponte.operarChamado(wc, id, 'assumir', ''),
  operarChamado: (wc, id, tipo, valor) => {
    id = Number(id);
    Chamado.operar(id, tipo, valor).then(r => js(wc, 'window.chamadoAcao && chamadoAcao(' + id + ',' + Q(tipo) + ',' + r.ok + ',' + Q(r.mensagem) + ')'));
  },
  anexosChamado: (wc, id) => {
    id = Number(id);
    Chamado.anexos(id).then(r => js(wc, 'window.chamadoAnexos && chamadoAnexos(' + id + ',' + r.ok + ',' + Q(r.mensagem) + ',' + JSON.stringify(r.dados ? r.dados.items : []) + ')'));
  },
  enviarAnexoNovo: (wc, seq, id, nome, tipo, base64) => {
    seq = Number(seq); id = Number(id);
    let dados; try { dados = Buffer.from(String(base64 || ''), 'base64'); } catch (e) { dados = null; }
    const fim = r => js(wc, 'window.novoAnexo && novoAnexo(' + seq + ',' + r.ok + ',' + Q(r.mensagem) + ')');
    if (!dados) { fim({ ok: false, mensagem: 'Não consegui ler o arquivo' }); return; }
    Chamado.anexarDados(id, String(nome || 'arquivo'), dados).then(fim, () => fim({ ok: false, mensagem: 'Não consegui anexar' }));
  },
  anexarChamado: (wc, id) => {
    id = Number(id);
    dialog.showOpenDialog(janela, { title: 'Escolher arquivo para anexar', properties: ['openFile'],
      filters: [{ name: 'Arquivos aceitos', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'xls', 'xlsx', 'doc', 'docx'] }] }).then(res => {
      if (res.canceled || !res.filePaths.length) { js(wc, 'window.chamadoAcao && chamadoAcao(' + id + ",'anexo',false,'')"); return; }
      const arq = res.filePaths[0];
      js(wc, 'window.chamadoEnviandoAnexo && chamadoEnviandoAnexo(' + id + ',' + Q(path.basename(arq)) + ')');
      Chamado.anexar(id, arq).then(r => js(wc, 'window.chamadoAcao && chamadoAcao(' + id + ",'anexo'," + r.ok + ',' + Q(r.mensagem) + ')'));
    });
  },
  baixarAnexo: (wc, id, anexo, nome) => {
    Chamado.baixarAnexo(Number(id), Number(anexo), nome).then(arq => {
      if (arq) shell.showItemInFolder(arq); else js(wc, "window.F && F.toast && F.toast('Não consegui baixar o anexo')");
    });
  },
  api: (wc, req, metodo, caminho, corpo) => {
    Chamado.requisicao(metodo, caminho, corpo).then(r => js(wc, 'window.apiResposta && apiResposta(' + Number(req) + ',' + r.status + ',' + Q(r.body) + ')'));
  },
  exportar: (wc, req, corpo) => {
    (async () => {
      let cod = 0, msg = '';
      try {
        const r = await Chamado.exportar(String(corpo || ''));
        if (r.status === 200 && r.bytes.length) {
          const pasta = path.join(require('os').homedir(), 'Downloads'); fs.mkdirSync(pasta, { recursive: true });
          let arq = path.join(pasta, r.nome), i = 2; const ext = path.extname(r.nome), base = path.basename(r.nome, ext);
          while (fs.existsSync(arq) && i < 100) arq = path.join(pasta, base + ' (' + (i++) + ')' + ext);
          fs.writeFileSync(arq, r.bytes); shell.openPath(arq).catch(() => shell.showItemInFolder(arq));
          cod = 200; msg = 'Salvo em Downloads: ' + path.basename(arq);
        } else { cod = r.status; msg = r.bytes.toString('utf8'); }
      } catch (e) { cod = 0; msg = 'Sem conexão com o site: ' + Api.mensagem(e); }
      js(wc, 'window.exportado && exportado(' + Number(req) + ',' + cod + ',' + Q(msg) + ')');
    })();
  },
  atualizarApp: (wc) => {
    (async () => {
      {   // sempre confere o GitHub na hora: se saíram várias versões, baixa direto a última (não uma por vez)
        const r = await Atualizacao.conferir(true);
        if (r <= 0) { js(wc, 'window.F && F.toast && F.toast(' + Q(r === 0 ? 'O app já está na versão mais nova' : 'Não consegui verificar agora') + ')'); avisarTodas(); return; }
      }
      if (!Atualizacao.bundle()) { shell.openExternal(Atualizacao.pagina()); return; }
      if (await Atualizacao.baixarEInstalar(avisarTodas)) { saindo = true; app.quit(); }
      else if (Atualizacao.erro) shell.openExternal(Atualizacao.pagina());
    })();
  },
  atualizarPeloNavegador: () => { shell.openExternal(Atualizacao.pagina()); },
  copiarDiagnostico: (wc) => { clipboard.writeText(Helpdesk.textoDiagnostico()); js(wc, "window.F && F.toast && F.toast('Diagnóstico copiado. Cole na conversa com o suporte.')"); },
  copiarImagem: (wc, base64) => {
    try { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(String(base64), 'base64'))); js(wc, "window.F && F.toast && F.toast('Imagem copiada. É só colar (⌘V) no WhatsApp ou no e-mail.')"); }
    catch (e) { js(wc, 'window.F && F.toast && F.toast(' + Q('Não consegui copiar: ' + e.message) + ')'); }
  },
  lerDado: (wc, nome) => {
    const n = String(nome || '').replace(/[^a-z0-9_-]/g, ''); if (!n) return '';
    try { return fs.readFileSync(path.join(app.getPath('userData'), 'telas', n + '.json'), 'utf8'); } catch (e) { return ''; }
  },
  gravarDado: (wc, nome, texto) => {
    const n = String(nome || '').replace(/[^a-z0-9_-]/g, ''); if (!n) return false;
    try { const dir = path.join(app.getPath('userData'), 'telas'); fs.mkdirSync(dir, { recursive: true }); const a = path.join(dir, n + '.json'); fs.writeFileSync(a + '.tmp', String(texto || '')); fs.renameSync(a + '.tmp', a); return true; }
    catch (e) { return false; }
  },
  salvarCopia: (wc, nome, texto) => {
    try {
      const dir = path.join(require('os').homedir(), 'Downloads'); fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, String(nome || 'Freedom.json').replace(/[\/\\:*?"<>|]/g, '_'));
      fs.writeFileSync(arq, String(texto || '')); shell.showItemInFolder(arq);
      js(wc, 'window.F && F.toast && F.toast(' + Q('Cópia salva em Downloads') + ')');
    } catch (e) { js(wc, 'window.F && F.toast && F.toast(' + Q('Não consegui salvar a cópia: ' + e.message) + ')'); }
  },
  copiarImagens: (wc, lista, nome) => {
    // várias páginas: grava os PNG e copia como arquivos (⌘V no WhatsApp cola todas)
    try {
      const arr = JSON.parse(String(lista || '[]')), dir = path.join(app.getPath('temp'), 'Freedom-imagens'); fs.mkdirSync(dir, { recursive: true });
      const base = String(nome || 'Freedom').replace(/[\/\\:*?"<>|]/g, '_').replace(/\.png$/i, ''), arqs = [];
      arr.forEach((b, i) => { const arq = path.join(dir, base + '_pag' + (i + 1) + '.png'); fs.writeFileSync(arq, Buffer.from(String(b), 'base64')); arqs.push(arq); });
      if (!arqs.length) return;
      const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const plist = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><array>' +
        arqs.map((a) => '<string>' + esc(a) + '</string>').join('') + '</array></plist>';
      clipboard.clear(); clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist));
      js(wc, 'window.F && F.toast && F.toast(' + Q(arqs.length + ' páginas copiadas. É só colar (⌘V) no WhatsApp: vão todas de uma vez.') + ')');
    } catch (e) { js(wc, 'window.F && F.toast && F.toast(' + Q('Não consegui copiar: ' + e.message) + ')'); }
  },
  salvarImagem: (wc, base64, nome) => {
    try {
      const dir = path.join(app.getPath('pictures'), 'Freedom'); fs.mkdirSync(dir, { recursive: true });
      let seguro = String(nome || 'Freedom.png').replace(/[\/\\:*?"<>|]/g, '_'); if (!/\.png$/i.test(seguro)) seguro += '.png';
      const arq = path.join(dir, seguro);
      fs.writeFileSync(arq, Buffer.from(String(base64), 'base64'));
      shell.showItemInFolder(arq);
      js(wc, "window.F && F.toast && F.toast('Imagem salva em Imagens › Freedom')");
    } catch (e) { js(wc, 'window.F && F.toast && F.toast(' + Q('Não consegui salvar: ' + e.message) + ')'); }
  },
  configurarAvisoMeta: (wc, ligado) => { Paineis.Metas.ligar(!!ligado); js(wc, 'window.F && F.toast && F.toast(' + Q(ligado ? 'Avisos de meta ligados' : 'Avisos de meta desligados') + ')'); }
};

ipcMain.on('app', (e, metodo, args) => {
  let r = null;
  try {
    const f = ponte[metodo];
    if (typeof f === 'function') {
      // nome/plataforma não recebem a tela; os outros recebem quem chamou (para responder na mesma tela)
      r = (metodo === 'nome' || metodo === 'plataforma') ? f() : f(e.sender, ...(args || []));
    }
  } catch (x) { r = null; }
  e.returnValue = r === undefined ? null : r;
});

ipcMain.on('barra', (e, tipo, valor) => {
  if (tipo === 'aba') {
    // clicar de novo no Site volta ao início; no Helpdesk, volta da subtela
    if (aba === valor && valor === 'site' && vSite) vSite.webContents.loadURL(SITE + '/');
    else if (aba === valor && valor === 'helpdesk' && paginaApp === 'sub') voltarHelpdesk();
    else selecionar(valor);
  } else if (tipo === 'painel') { painelAtual = valor; garantirPainel(true); atualizarBarra(); }
});

// ---------------- só para os testes automáticos (FREEDOM_TESTE_FOTOS=pasta) ----------------
if (process.env.FREEDOM_TESTE_FOTOS) app.whenReady().then(() => {
  const dir = process.env.FREEDOM_TESTE_FOTOS;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const foto = async nome => {
    const v = vistaAtual() || vApp;
    const partes = [['barra', janela.webContents], ['tela', v.webContents]];
    for (const [k, wc] of partes) if (wc) fs.writeFileSync(path.join(dir, nome + '-' + k + '.png'), (await wc.capturePage()).toPNG());
  };
  (async () => {
    janela.show(); await espera(2500); await foto('1-login');
    ponte.entrar(vApp.webContents, 'a@b', 'certa'); await espera(5000); await foto('2-helpdesk');
    selecionar('painel'); await espera(3000); await foto('3-painel');
    painelAtual = 'faturamento'; garantirPainel(true); atualizarBarra(); await espera(2500); await foto('4-faturamento');
    abrirChamado(5); await espera(2500); await foto('5-chamado');
    console.log('FOTOS OK'); saindo = true; app.quit();
  })().catch(e => { console.error('ERRO', e); app.exit(1); });
});
