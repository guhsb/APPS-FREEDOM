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
  brlK: function (v) {
    v = F.n(v); var neg = v < 0, a = Math.abs(v), g = function (x, c) { var t = F.um(x, c), p = t.split(','); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return p.join(','); };
    var t = a >= 1e9 ? 'R$ ' + g(a / 1e9, a >= 1e10 ? 1 : 2) + ' bi' : a >= 1e7 ? 'R$ ' + g(a / 1e6) + ' mi' : a >= 1e6 ? 'R$ ' + g(a / 1e6, 2) + ' mi' : a >= 1e3 ? 'R$ ' + g(a / 1e3) + ' mil' : F.brl(a);
    return (neg ? '−' : '') + t;
  },
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
    colunas: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="15.5" y="4" width="5" height="7" rx="1.5"/>',
    fone: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="6.5" rx="1.8"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8"/>',
    seta: '<path d="M9 6l6 6-6 6"/>',
    sair: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 16l-4-4 4-4"/><path d="M5 12h11"/>',
    alerta: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    sino: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.6 2H4.4z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    estrela: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19.5l1-5.8-4.2-4.1 5.8-.8z"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
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
F._req = Math.floor(Math.random() * 1e6) * 1000; F._pend = {};   // número único por tela
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
  if (d && typeof d === 'object' && !Array.isArray(d) && d.message) return d.message;
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
      mm.querySelector('span').innerHTML = 'Avisos de meta e da equipe: <b>' + (e.avisoMeta ? 'ligados' : 'desligados') + '</b>';
    }
    var ap = e.app || {};
    document.getElementById('aviso').innerHTML =
      (ap.baixando ? '<div class="aviso rosa">' + F.ic('atualizar') + '<span>Baixando a versão nova do app… <b>' + F.int(ap.progresso) + '%</b></span></div>'
        : ap.nova ? '<div class="aviso rosa">' + F.ic('atualizar') + '<span>Nova versão do app disponível (<b>' + F.esc(ap.novaNome || F.int(ap.nova)) + '</b>).</span><button onclick="App.atualizarApp()">Atualizar</button></div>' : '') +
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

// ---- acessibilidade (todas as telas): o que se toca também funciona pelo teclado e é anunciado como botão; Esc fecha janelas ----
(function () {
  var SEL = '[data-aba],[data-sub],[data-psub],[data-fsub],[data-setor],[data-v],[data-p],[data-t],[data-mais],[data-fmais],[data-act]:not(button):not(input):not(select),[data-a]:not(button),[data-c],[data-id],[data-anexo],[data-nota]:not(button)';
  var NAT = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL)$/;
  F.acessivel = function (raiz) {
    [].forEach.call((raiz || document).querySelectorAll(SEL), function (e) {
      if (NAT.test(e.tagName)) return;
      if (!e.hasAttribute('tabindex')) e.setAttribute('tabindex', '0');
      if (!e.hasAttribute('role')) e.setAttribute('role', e.hasAttribute('data-aba') ? 'tab' : 'button');
      if (e.hasAttribute('data-aba')) e.setAttribute('aria-selected', e.classList.contains('on') ? 'true' : 'false');
    });
  };
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { var m = document.getElementById('mfundo'); if (m) { m.parentNode.removeChild(m); ev.preventDefault(); } return; }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var t = ev.target; if (!t || NAT.test(t.tagName) || !t.matches || !t.matches(SEL)) return;
    ev.preventDefault(); t.click();
  });
  var agendado = false;
  try { new MutationObserver(function () { if (agendado) return; agendado = true; setTimeout(function () { agendado = false; F.acessivel(); }, 0); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { }
})();

// ---- layout novo: transição, ações da barra de atalhos (PC) e espaço para a barra flutuante (celular) ----
(function () {
  /** A tela (ou parte dela) entra embaçada e sobe um pouco até ficar em foco. */
  F.entrar = function (el) {
    el = el || document.body; if (!el || !el.animate) return;
    try { el.animate([{ opacity: 0, filter: 'blur(8px)', transform: 'translateY(14px)' }, { opacity: 1, filter: 'blur(0)', transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,.7,.2,1)' }); } catch (e) { }
  };
  function visivel(e) { return !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)); }
  function achar(sel, texto) {
    var l = [].slice.call(document.querySelectorAll(sel)).filter(visivel);
    if (l.length) return l[0];
    l = [].slice.call(document.querySelectorAll('button,[data-act],[data-a],[data-eq],[role=button]')).filter(function (e) { return visivel(e) && texto.test(e.textContent || ''); });
    return l[0] || null;
  }
  /** Botões de atalho do PC: "imagem" e "excel" usam o botão da própria tela. */
  window.acaoRail = function (nome) {
    if (nome === 'atualizar') { var at = document.getElementById('btAt'); if (at) at.click(); return !!at; }
    var b = nome === 'imagem' ? achar('#btImg,[data-act$="Png"],[data-eq="png"],#btFatPainel', /imagem/i)
          : nome === 'excel' ? achar('[data-a="excel"],[data-act="exportar"],#btExcel', /excel/i) : null;
    if (b) { b.click(); return true; }
    if (nome !== 'atualizar' && F.toast) F.toast(nome === 'excel' ? 'Esta tela não tem exportar Excel' : 'Esta tela não tem imagem');
    return false;
  };
  /** Conta para a barra do PC quais atalhos esta tela tem (sem botão de imagem = o atalho some). */
  var ultAcoes = '', tAcoes = 0;
  function relatarAcoes() {
    try {
      if (!window.App || !App.subAbas || /(shell|avisos)\.html/.test(location.pathname)) return;
      var o = { acoes: 1, url: location.href.split('#')[0],
        img: !!achar('#btImg,[data-act$="Png"],[data-eq="png"],#btFatPainel', /imagem/i),
        xls: !!achar('[data-a="excel"],[data-act="exportar"],#btExcel', /excel/i) };
      var k = JSON.stringify(o); if (k === ultAcoes) return; ultAcoes = k; App.subAbas(k);
    } catch (e) { }
  }
  function agendarAcoes() { clearTimeout(tAcoes); tAcoes = setTimeout(relatarAcoes, 400); }
  window.addEventListener('load', function () {
    agendarAcoes();
    try { new MutationObserver(agendarAcoes).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] }); } catch (e) { }
  });
  window.addEventListener('focus', function () { ultAcoes = ''; agendarAcoes(); });
  // celular: a barra de baixo flutua por cima; um espaço no fim para nada ficar escondido atrás dela
  try { if (window.App && App.plataforma && App.plataforma() === 'android') document.documentElement.classList.add('barraFlutuante'); } catch (e) { }
})();

// ---- Ctrl+V de print: a imagem copiada vira um arquivo PNG (Print_AAAAMMDD_HHMMSS.png) ----
F.aoColarImagem = function (fn) {
  document.addEventListener('paste', function (ev) {
    var itens = (ev.clipboardData && ev.clipboardData.items) || [], arqs = [];
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].kind !== 'file' || !/^image\//.test(itens[i].type)) continue;
      var f = itens[i].getAsFile(); if (!f) continue;
      var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
      var nome = 'Print_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + (arqs.length ? '_' + (arqs.length + 1) : '') + '.png';
      try { f = new File([f], nome, { type: f.type || 'image/png' }); } catch (e) { f.name2 = nome; }
      arqs.push(f);
    }
    if (!arqs.length) return;   // texto: cola normal
    ev.preventDefault();
    fn(arqs);
  });
};

// ---- PC: usa a largura da tela (cartões em 2 colunas) e mostra o formato da tela enquanto os dados chegam ----
(function () {
  var raiz = document.documentElement, pc = false;
  try { var pl = window.App && App.plataforma && App.plataforma(); pc = pl === 'windows' || pl === 'mac'; } catch (e) { }
  function medir() { raiz.classList.toggle('largo', pc && window.innerWidth >= 980); }
  medir(); window.addEventListener('resize', function () { var a = raiz.classList.contains('largo'); medir(); if (a !== raiz.classList.contains('largo')) tudo(); });

  // esqueleto: cartões cinzas brilhando no lugar dos dados (no celular também)
  function i(w, h, m) { return '<i style="width:' + w + ';height:' + h + 'px' + (m ? ';margin-top:' + m + 'px' : '') + '"></i>'; }
  function esqueleto(onde) {
    if (onde.id === 'lista') return '<div class="esqL">' + new Array(7).join('<div class="esq">' + i('30%', 13) + i('70%', 11) + i('22%', 10) + '</div>') + '</div>';
    if (/chamado\.html/.test(location.pathname)) return '<div class="esqG"><div class="esqE">' + i('20%', 12) + '<div class="esq" style="width:70%">' + i('40%', 11) + i('90%', 12) + i('60%', 12) + '</div><div class="esq" style="width:55%;align-self:flex-end">' + i('30%', 11) + i('80%', 12) + '</div><div class="esq" style="width:65%">' + i('40%', 11) + i('85%', 12) + '</div></div>' +
      '<div class="esqD"><div class="esq">' + i('45%', 14) + i('80%', 18) + i('100%', 40, 14) + '</div><div class="esq">' + i('35%', 12) + i('100%', 44, 10) + '</div></div></div>';
    var t = '<div class="esq">' + i('50%', 11) + i('70%', 24) + i('40%', 10) + '</div>';
    return '<div class="esqG"><div class="esq cheio">' + i('22%', 12) + i('45%', 36) + i('30%', 12) + i('100%', 12, 20) + i('60%', 24, 14) + '</div>' +
      '<div class="esqT cheio">' + t + t + t + t + '</div>' +
      '<div class="esq">' + i('40%', 14) + i('60%', 10) + i('100%', 180, 18) + '</div>' +
      '<div class="esq">' + i('45%', 14) + i('100%', 38, 16) + i('100%', 38) + i('100%', 38) + i('100%', 38) + '</div></div>';
  }
  function trocarCarregando(c) {
    if (!c) return;
    [].forEach.call(c.querySelectorAll(':scope>.carregando:not(.esqOn)'), function (k) { k.classList.add('esqOn'); k.insertAdjacentHTML('beforeend', esqueleto(c)); });
  }

  // agrupa "título de seção + o que vem embaixo" e põe os cartões lado a lado
  var CHEIO = /\b(tabs|filtro|filtros|hero|status|aviso|kpis|acoes|k4|sla|rod|nota|carregando|dashbt|vis|kanban|topo)\b/;
  function itens(c) {
    var l = [];
    [].forEach.call(c.children, function (k) {
      if (k.classList.contains('gL')) [].forEach.call(k.children, function (x) { if (x.classList.contains('bl')) [].push.apply(l, [].slice.call(x.children)); else l.push(x); });
      else if (k.classList.contains('gC')) [].forEach.call(k.children, function (x) { [].push.apply(l, [].slice.call(x.children)); });
      else l.push(k);
    });
    return l.filter(function (x) { return x.tagName !== 'SCRIPT' && x.tagName !== 'STYLE'; });
  }
  function grupoChamado(c, l) {
    var E = document.createElement('div'), D = document.createElement('div'), g = document.createElement('div');
    E.className = 'ladoE'; D.className = 'ladoD'; g.className = 'gC';
    l.forEach(function (k, ix) {
      var conv = k.classList.contains('tl') || (k.classList.contains('sec') && l[ix + 1] && l[ix + 1].classList.contains('tl'));
      (conv ? E : D).appendChild(k);
    });
    g.appendChild(D); g.appendChild(E); c.appendChild(g);   // dados à esquerda, conversa à direita
    // a página não rola: só a conversa (esquerda) e, se precisar, a coluna da direita
    raiz.classList.add('chamadoFixo'); alturaChamado();
    if (rolConv.fim || rolConv.top == null) E.scrollTop = rolConv.top == null ? 0 : E.scrollHeight; else E.scrollTop = rolConv.top;
    E.addEventListener('scroll', function () { rolConv.top = E.scrollTop; rolConv.fim = E.scrollHeight - E.scrollTop - E.clientHeight < 30; });
  }
  var rolConv = { top: null, fim: false };
  function alturaChamado() {
    var g = document.querySelector('.gC'); if (!g) return;
    var cx = document.getElementById('caixa'), baixo = cx && cx.offsetHeight ? cx.offsetHeight + 26 : 20;
    g.style.height = Math.max(260, window.innerHeight - g.getBoundingClientRect().top - baixo) + 'px';
  }
  window.addEventListener('resize', function () { alturaChamado(); });
  function grupoCartoes(c, l) {
    var g = document.createElement('div'); g.className = 'gL';
    var blocos = [];
    for (var n = 0; n < l.length; n++) {
      var k = l[n]; k.classList.remove('cheio'); k.classList.remove('par');
      if (k.classList.contains('sec') && l[n + 1]) {
        var b = document.createElement('div'); b.className = 'bl'; b.appendChild(k);
        while (l[n + 1] && !l[n + 1].classList.contains('sec') && !/\b(tabs|filtro|hero|k4|sla|rod|kpis|acoes|dashbt)\b/.test(l[n + 1].className)) b.appendChild(l[++n]);
        blocos.push(b); continue;
      }
      blocos.push(k);
    }
    blocos.forEach(function (k) { k.classList.remove('cheio'); g.appendChild(k); });
    c.appendChild(g);
    // linhas curtas (filtros, botões, avisos) e o que ficaria sozinho na linha ocupam a largura toda: sem buraco
    var col = 0, ant = null, pares = [];
    blocos.forEach(function (k) {
      var cheio = k.querySelector('.atencao') || k.classList.contains('inteiro') || k.querySelector(':scope>.inteiro') ||
        (!k.classList.contains('bl') && (CHEIO.test(k.className) || !k.className || k.getBoundingClientRect().height < 110));
      if (cheio) { k.classList.add('cheio'); if (col === 1 && ant) ant.classList.add('cheio'); col = 0; ant = null; return; }
      if (col === 0) { ant = k; col = 1; } else { pares.push([ant, k]); col = 0; ant = null; }
    });
    if (col === 1 && ant) ant.classList.add('cheio');
    // em cada par: o maior fica na esquerda; se for bem maior, fica do tamanho do outro com "Ver mais"
    pares.forEach(function (pr) {
      var a = pr[0], b = pr[1], ha = a.offsetHeight, hb = b.offsetHeight;
      a.classList.add('par'); b.classList.add('par');   // o menor estica até a altura do outro: sem vazio embaixo
      if (hb > ha) { g.insertBefore(b, a); var t = a; a = b; b = t; t = ha; ha = hb; hb = t; }
      var lim = Math.max(hb, 340);
      if (ha > lim * 1.35 && ha - lim > 160) cortar(a, lim);
    });
  }
  function cortar(el, lim) {
    el.classList.add('cortado'); el.style.maxHeight = lim + 'px'; el.dataset.lim = lim;
    var bt = document.createElement('button'); bt.className = 'verMais'; bt.type = 'button';
    bt.innerHTML = 'Ver mais' + (F.ic ? F.ic('baixo') : '');
    bt.onclick = function (ev) { ev.stopPropagation(); abrirInteiro(el); };
    el.appendChild(bt);
  }
  function abrirInteiro(el) {
    var lugar = document.createElement('div'); lugar.style.height = el.offsetHeight + 'px'; lugar.className = el.className.replace('cortado', '');
    el.parentNode.replaceChild(lugar, el);
    var bt = el.querySelector(':scope>.verMais'); if (bt) bt.remove();
    el.classList.remove('cortado'); el.style.maxHeight = '';
    var f = document.createElement('div'); f.className = 'vmFundo';
    f.innerHTML = '<div class="vmCaixa"><button class="vmFechar" type="button" aria-label="Fechar">' + '<span style="font-size:22px;line-height:1">×</span>' + '</button></div>';
    var cx = f.firstChild; cx.appendChild(el);
    document.body.appendChild(f); document.body.style.overflow = 'hidden';
    function fechar() {
      document.removeEventListener('keydown', tecla); f.remove(); document.body.style.overflow = '';
      if (lugar.parentNode) { lugar.parentNode.replaceChild(el, lugar); cortar(el, +el.dataset.lim || 340); }
    }
    function tecla(ev) { if (ev.key === 'Escape') fechar(); }
    document.addEventListener('keydown', tecla);
    f.addEventListener('click', function (ev) { if (ev.target === f || ev.target.closest('.vmFechar')) fechar(); });
    try { if (F.entrar) F.entrar(cx); } catch (e) { }
  }
  var ocupado = false;
  function agrupar(c) {
    if (!c || ocupado) return;
    ocupado = true;
    try {
      trocarCarregando(c);
      var l = itens(c);
      if (!raiz.classList.contains('largo') || c.id === 'lista' || (l.length === 1 && l[0].classList.contains('carregando'))) {
        if (c.querySelector(':scope>.gL,:scope>.gC')) l.forEach(function (k) { k.classList.remove('cheio'); c.appendChild(k); });
        [].slice.call(c.querySelectorAll(':scope>.gL,:scope>.gC')).forEach(function (x) { x.remove(); });
        return;
      }
      var ja = c.children.length === 1 && (c.firstElementChild.classList.contains('gL') || c.firstElementChild.classList.contains('gC'));
      if (ja) return;
      var velhos = [].slice.call(c.querySelectorAll(':scope>.gL,:scope>.gC'));
      if (/chamado\.html/.test(location.pathname) && l.some(function (x) { return x.classList.contains('tl'); })) grupoChamado(c, l); else grupoCartoes(c, l);
      velhos.forEach(function (x) { x.remove(); });
    } catch (e) { } finally { ocupado = false; }
  }
  function alvos() { return ['conteudo', 'c', 'lista'].map(function (id) { return document.getElementById(id); }).filter(Boolean); }
  function tudo() { alvos().forEach(function (c) { if (c.id === 'lista') trocarCarregando(c); else agrupar(c); }); }
  function ligar() {
    alvos().forEach(function (c) {
      new MutationObserver(function () { if (c.id === 'lista') trocarCarregando(c); else agrupar(c); }).observe(c, { childList: true });
    });
    tudo();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();
})();
