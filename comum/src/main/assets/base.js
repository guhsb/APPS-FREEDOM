// Funções usadas pelas telas cheias dos dois apps

// Aparência: claro (padrão, igual ao site) ou escuro — escolhida em Helpdesk > Configurações (guardada no app)
(function () {
  var t = 'claro';
  try { if (window.App && App.tema) t = App.tema() || t; else t = localStorage.getItem('tema') || t; } catch (e) { }
  document.documentElement.setAttribute('data-tema', t === 'escuro' ? 'escuro' : 'claro');
})();
/** O app trocou o tema (chamado pela parte nativa nas outras telas abertas). */
window.temaMudou = function (t) {
  document.documentElement.setAttribute('data-tema', t === 'escuro' ? 'escuro' : 'claro');
  if (window.aoMudarTema) try { aoMudarTema(); } catch (e) { }
};

var F = {
  n: function (v) { v = Number(v); return isFinite(v) ? v : 0; },
  tema: function () { return document.documentElement.getAttribute('data-tema') || 'claro'; },
  /** Troca o tema: na hora nesta tela e, pelo app, nas outras (e na barra de abas). */
  definirTema: function (t) {
    t = t === 'escuro' ? 'escuro' : 'claro';
    window.temaMudou(t);
    try { localStorage.setItem('tema', t); } catch (e) { }
    try { if (window.App && App.definirTema) App.definirTema(t); } catch (e) { }
  },
  /** Valor de uma cor do tema (para desenhos em SVG/canvas). */
  cor: function (nome) { try { return getComputedStyle(document.documentElement).getPropertyValue('--' + nome).trim(); } catch (e) { return ''; } },
  num: function (v) { return F.n(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); },
  brl: function (v) { return 'R$ ' + F.num(v); },
  um: function (x, c) { var s = x.toFixed(c || 1).replace('.', ','); return s.indexOf(',') >= 0 ? s.replace(/0+$/, '').replace(/,$/, '') : s; },
  brlK: function (v) { v = F.n(v); return v >= 1e7 ? 'R$ ' + F.um(v / 1e6) + ' mi' : v >= 1e6 ? 'R$ ' + F.um(v / 1e6, 2) + ' mi' : v >= 1e3 ? 'R$ ' + F.um(v / 1e3) + ' mil' : F.brl(v); },
  pct: function (v) { return F.n(v).toFixed(1).replace('.', ',') + '%'; },
  int: function (v) { return String(Math.round(F.n(v))); },
  hhmm: function (ms) { if (!ms) return '--:--'; var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); },
  dataBR: function (s) { s = String(s || '').slice(0, 10); return s.length === 10 ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; },
  esc: function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  barra: function (p, idealP, cor) {
    return '<div class="trilho"><div style="width:' + Math.min(100, Math.max(0, p * 100)) + '%;background:' + cor + '"></div>' +
      (idealP != null ? '<s style="left:calc(' + Math.min(100, Math.max(0, idealP * 100)) + '% - 1px)"></s>' : '') + '</div>';
  },
  tile: function (r, v, cls) { return '<div class="tile"><span>' + r + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; },
  // ícones de linha (SVG) usados nas telas
  IC: {
    atualizar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    mais: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    mais2: '<path d="M12 5v14M5 12h14"/>',
    lista: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    fone: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8"/>',
    seta: '<path d="M9 6l6 6-6 6"/>',
    sair: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 16l-4-4 4-4"/><path d="M5 12h11"/>',
    alerta: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    sino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.6 2H4.4z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    lua: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    baixo: '<path d="m6 9 6 6 6-6"/>',
    msg: '<path d="M4 5h16v11H9.5L5 19.5z"/>',
    troca: '<path d="M4 8h14l-3.5-3.5"/><path d="M20 16H6l3.5 3.5"/>',
    clipe: '<path d="M19.5 11.5l-7.8 7.8a4.6 4.6 0 0 1-6.5-6.5l8.4-8.4a3 3 0 0 1 4.3 4.3l-8.3 8.3a1.5 1.5 0 0 1-2.1-2.1l7.5-7.5"/>',
    pessoa: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bateria: '<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 11v2"/><path d="M6.5 10.5v3"/>',
    som: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    ajustes: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    cadeado: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    imagem: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="M4 17.5l5-5 4 4 2.5-2.5 4.5 4.5"/>',
    compartilhar: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
    copiar: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
    camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.4"/>',
    nuvem: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
    baixar: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>'
  },
  ic: function (n, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (F.IC[n] || '') + '</svg>'; },
  topoSombra: function () {
    var t = document.querySelector('.topo'); if (!t) return;
    var f = function () { t.classList.toggle('sombra', window.scrollY > 4); };
    window.addEventListener('scroll', f, { passive: true }); f();
  }
};

// ---- acesso ao Helpdesk do site pelo app (mesmos endereços que o site usa) ----
F._req = 0; F._pend = {};
/** F.api('GET', '/helpdesk/...', corpo?) -> Promise({status, json, texto}) */
F.api = function (metodo, caminho, corpo) {
  return new Promise(function (ok) {
    var id = ++F._req; F._pend[id] = ok;
    try { App.api(id, metodo, caminho, corpo ? JSON.stringify(corpo) : ''); }
    catch (e) { delete F._pend[id]; ok({ status: 0, json: null, texto: 'O app não respondeu' }); }
  });
};
window.apiResposta = function (id, status, texto) {
  var f = F._pend[id]; if (!f) return; delete F._pend[id];
  var j = null; try { j = JSON.parse(texto); } catch (e) { }
  // 299 = sem internet: o app devolveu a última resposta guardada
  if (status === 299 && j && j._corpo != null) {
    var hora = j._offline, corpo = j._corpo; j = null; try { j = JSON.parse(corpo); } catch (e) { }
    F.semInternet(hora);
    return f({ status: 200, json: j, texto: corpo, offline: hora });
  }
  // 202 + _fila = sem internet: guardado para enviar quando a internet voltar
  if (status === 202 && j && j._fila) return f({ status: 202, json: j, texto: texto, fila: true });
  f({ status: status, json: j, texto: texto });
};
/** Faixa "sem internet" no topo das telas (dados guardados às hh:mm). */
F.semInternet = function (hora) {
  var id = 'faixaOffline', el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'aviso offline'; var av = document.getElementById('aviso'); (av ? av.parentNode : document.body).insertBefore(el, av || document.body.firstChild); }
  el.innerHTML = F.ic('nuvem') + '<span>Sem internet. Mostrando o que foi salvo' + (hora ? ' às <b>' + F.hhmm(hora) + '</b>' : '') + '.</span>';
  clearTimeout(F.semInternet.t);
  F.semInternet.t = setTimeout(function () { var x = document.getElementById(id); if (x) x.remove(); }, 120000);
};
F.ERROS = {
  helpdesk_ticket_already_assigned: 'Este chamado já foi assumido por outro atendente.',
  stale_ticket_version: 'O chamado foi alterado por outra pessoa. Atualize e tente de novo.',
  helpdesk_forbidden: 'Seu acesso a esta parte do Helpdesk não está disponível.',
  resolved_helpdesk_ticket: 'Este chamado já foi resolvido.',
  invalid_helpdesk_assignee: 'O responsável escolhido não pode atender este chamado.',
  inactive_helpdesk_queue: 'O setor escolhido não está disponível.',
  invalid_ticket_transition: 'Esta alteração de status não está mais disponível.'
};
F.erroApi = function (r, padrao) {
  if (!r) return padrao;
  if (r.status === 0) return r.texto || 'Sem conexão com o site.';
  var d = r.json && r.json.detail;
  var cod = typeof d === 'string' ? d : (d && d.code) || '';
  if (F.ERROS[cod]) return F.ERROS[cod];
  if (r.status === 401) return 'A sessão expirou. Tente de novo.';
  if (r.status === 403 || r.status === 404) return 'Você não tem acesso a isso.';
  if (Array.isArray(d) && d.length && d[0].msg) return padrao + ' (' + d[0].msg + ')';
  return padrao + ' (erro ' + r.status + ')';
};
F.STATUS = { OPEN: ['Aberto', 'var(--azul)', 'rgba(79,124,255,.15)'], IN_PROGRESS: ['Em andamento', 'var(--violeta)', 'rgba(139,108,240,.16)'],
  REOPENED: ['Reaberto', 'var(--azul)', 'rgba(79,124,255,.15)'], WAITING: ['Aguardando', 'var(--laranja)', 'rgba(240,165,58,.15)'],
  WAITING_SUPPLIER: ['Aguard. fornecedor', 'var(--laranja)', 'rgba(240,165,58,.15)'], PENDING_APPROVAL: ['Aguard. aprovação', 'var(--verde)', 'rgba(31,191,143,.15)'],
  RESOLVED: ['Resolvido', 'var(--verde)', 'rgba(31,191,143,.15)'], CLOSED: ['Fechado', 'var(--tx3)', 'var(--sf3)'], CANCELED: ['Cancelado', 'var(--tx3)', 'var(--sf3)'] };
F.PRIO = { LOW: ['Baixa', '#6b7489'], MEDIUM: ['Média', '#4f7cff'], HIGH: ['Alta', 'var(--laranja)'], URGENT: ['Urgente', '#ef4444'] };
F.SLA = { NOT_CONFIGURED: 'Sem SLA', ON_TRACK: 'No prazo', AT_RISK: 'SLA em risco', BREACHED: 'SLA vencido', MET: 'SLA cumprido' };
/** Datas do site vêm em UTC sem "Z". */
F.data = function (s) {
  if (!s) return null;
  s = String(s).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  var d = new Date(s); return isNaN(d) ? null : d;
};
F.quando = function (s) {
  var d = F.data(s); if (!d) return '';
  var seg = Math.round((Date.now() - d.getTime()) / 1000), min = Math.round(seg / 60);
  if (seg < 60) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  if (min < 24 * 60 && d.toDateString() === new Date().toDateString()) return F.hhmm(d.getTime());
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
};
F.toast = function (t) {
  if (!t) return;
  var el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div'); el.id = '__toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--sf3);color:var(--tx);border:1px solid var(--ln2);border-radius:12px;padding:10px 14px;font-size:13px;z-index:60;max-width:90%;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.textContent = t; el.style.display = 'block';
  clearTimeout(F.toast.t); F.toast.t = setTimeout(function () { el.style.display = 'none'; }, 3500);
};

var Base = {
  render: null,
  // cada página de painel define PAINEL_ID ('comercial', 'faturamento'...) antes de carregar este arquivo
  estado: function () { try { return JSON.parse(window.PAINEL_ID ? App.dadosPainel(PAINEL_ID) : App.dados()); } catch (e) { return {}; } },
  iniciar: function (render) {
    Base.render = render;
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="topo"><img src="logo.png" alt="Freedom"><div class="tt"><h1 id="tit">Painel</h1><div class="st" id="st"></div></div>' +
      '<button class="bt" id="btAt" aria-label="Atualizar">' + F.ic('atualizar') + '</button>' +
      (F.gerarImagem ? '<button class="bt" id="btImg" aria-label="Gerar imagem">' + F.ic('imagem') + '</button>' : '') +
      '<button class="bt" id="btMenu" aria-label="Menu">' + F.ic('mais') + '</button></div><div id="aviso"></div>');
    document.body.insertAdjacentHTML('beforeend',
      '<div class="fundo-modal" id="modal"><div class="modal"><h3 id="mNome">Freedom</h3><p id="mEmail"></p>' +
      '<button class="b2" id="mAt">' + F.ic('atualizar') + ' Atualizar agora</button>' +
      (F.gerarImagem ? '<button class="b2" id="mImg">' + F.ic('imagem') + ' Gerar imagem (PNG)</button>' : '') +
      '<button class="b2" id="mMeta" style="display:none">' + F.ic('sino') + ' <span>Avisos de meta</span></button>' +
      '<button class="b1" id="mSair">' + F.ic('sair') + ' <span>Sair / trocar login</span></button>' +
      '<button class="b3" id="mFechar">Fechar</button></div></div>');
    F.topoSombra();
    document.getElementById('btAt').onclick = function () { try { App.atualizar(); } catch (e) {} };
    document.getElementById('mAt').onclick = function () { Base.fechar(); try { App.atualizar(); } catch (e) {} };
    if (F.gerarImagem) {
      document.getElementById('btImg').onclick = function () { F.gerarImagem(); };
      document.getElementById('mImg').onclick = function () { Base.fechar(); F.gerarImagem(); };
    }
    document.getElementById('mMeta').onclick = function () {
      var e = Base.estado(); try { App.configurarAvisoMeta(!e.avisoMeta); } catch (x) {}
      setTimeout(Base.atualizarTela, 150);
    };
    document.getElementById('btMenu').onclick = function () { document.getElementById('modal').classList.add('on'); };
    document.getElementById('mFechar').onclick = Base.fechar;
    document.getElementById('modal').onclick = function (ev) { if (ev.target.id === 'modal') Base.fechar(); };
    document.getElementById('mSair').onclick = function () {
      var b = this; if (b.dataset.ok) { try { App.sair(); } catch (e) {} return; }
      b.dataset.ok = '1'; b.querySelector('span').textContent = 'Toque de novo para confirmar';
    };
    window.recebido = Base.atualizarTela;
    window.aoMudarTema = function () { Base.ultimo = ''; Base.atualizarTela(); };   // redesenha os gráficos com as cores novas
    Base.atualizarTela();
    setInterval(function () { var e = Base.estado(); if (e.atualizando) Base.atualizarTela(); }, 1500);
  },
  fechar: function () { document.getElementById('modal').classList.remove('on'); var b = document.getElementById('mSair'); delete b.dataset.ok; b.querySelector('span').textContent = 'Sair / trocar login'; },
  ultimo: '',
  atualizarTela: function () {
    var e = Base.estado();
    document.getElementById('tit').textContent = e.titulo || 'Painel';
    document.getElementById('st').innerHTML = e.atualizando ? 'Atualizando…' : (e.hora ? 'Atualizado às <b>' + F.hhmm(e.hora) + '</b>' : 'Ainda não atualizado');
    document.getElementById('btAt').classList.toggle('gira', !!e.atualizando);
    document.getElementById('mNome').textContent = e.nome || 'Freedom';
    document.getElementById('mEmail').textContent = e.email ? 'Login: ' + e.email : '';
    var mm = document.getElementById('mMeta');
    if (mm) {
      mm.style.display = e.avisoMeta === undefined ? 'none' : '';
      mm.querySelector('span').innerHTML = 'Avisos de meta: <b>' + (e.avisoMeta ? 'ligados' : 'desligados') + '</b>';
    }
    var ap = e.app || {};
    document.getElementById('aviso').innerHTML =
      (ap.baixando ? '<div class="aviso rosa">' + F.ic('atualizar') + '<span>Baixando a versão nova do app… <b>' + F.int(ap.progresso) + '%</b></span></div>'
        : ap.nova ? '<div class="aviso rosa">' + F.ic('atualizar') + '<span>Nova versão do app disponível (<b>' + F.int(ap.nova) + '</b>).</span><button onclick="App.atualizarApp()">Atualizar</button></div>' : '') +
      ((e.erro && !e.atualizando)
      ? '<div class="aviso">' + F.ic('alerta') + '<span>Não atualizou agora: ' + F.esc(e.erro) + (e.dados ? '. Mostrando os números das ' + F.hhmm(e.hora) + '.' : '') + '</span></div>' : '');
    var conteudo = document.getElementById('conteudo');
    if (!e.dados) { conteudo.innerHTML = e.atualizando || !e.erro ? '<div class="carregando"><i></i>Buscando os números…</div>' : ''; Base.ultimo = ''; return; }
    var chave = JSON.stringify(e.dados);
    if (chave === Base.ultimo) return;   // nada mudou: não redesenha (mantém a busca digitada)
    Base.ultimo = chave;
    Base.render(e.dados, e);
  }
};
