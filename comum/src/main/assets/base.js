// Funções usadas pelas telas cheias dos dois apps
var F = {
  n: function (v) { v = Number(v); return isFinite(v) ? v : 0; },
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
    grafico: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'
  },
  ic: function (n, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (F.IC[n] || '') + '</svg>'; },
  topoSombra: function () {
    var t = document.querySelector('.topo'); if (!t) return;
    var f = function () { t.classList.toggle('sombra', window.scrollY > 4); };
    window.addEventListener('scroll', f, { passive: true }); f();
  }
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
      '<button class="bt" id="btMenu" aria-label="Menu">' + F.ic('mais') + '</button></div><div id="aviso"></div>');
    document.body.insertAdjacentHTML('beforeend',
      '<div class="fundo-modal" id="modal"><div class="modal"><h3 id="mNome">Freedom</h3><p id="mEmail"></p>' +
      '<button class="b2" id="mAt">' + F.ic('atualizar') + ' Atualizar agora</button>' +
      '<button class="b1" id="mSair">' + F.ic('sair') + ' <span>Sair / trocar login</span></button>' +
      '<button class="b3" id="mFechar">Fechar</button></div></div>');
    F.topoSombra();
    document.getElementById('btAt').onclick = function () { try { App.atualizar(); } catch (e) {} };
    document.getElementById('mAt').onclick = function () { Base.fechar(); try { App.atualizar(); } catch (e) {} };
    document.getElementById('btMenu').onclick = function () { document.getElementById('modal').classList.add('on'); };
    document.getElementById('mFechar').onclick = Base.fechar;
    document.getElementById('modal').onclick = function (ev) { if (ev.target.id === 'modal') Base.fechar(); };
    document.getElementById('mSair').onclick = function () {
      var b = this; if (b.dataset.ok) { try { App.sair(); } catch (e) {} return; }
      b.dataset.ok = '1'; b.querySelector('span').textContent = 'Toque de novo para confirmar';
    };
    window.recebido = Base.atualizarTela;
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
