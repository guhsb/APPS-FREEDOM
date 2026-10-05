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
  tile: function (r, v, cls) { return '<div class="tile"><span>' + r + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; }
};

var Base = {
  render: null,
  estado: function () { try { return JSON.parse(App.dados()); } catch (e) { return {}; } },
  iniciar: function (render) {
    Base.render = render;
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="topo"><img src="logo.png" alt="Freedom"><div class="st" id="st"></div>' +
      '<button class="bt" id="btAt" aria-label="Atualizar"><span>↻</span></button>' +
      '<button class="bt" id="btMenu" aria-label="Menu">⋯</button></div><div id="aviso"></div>');
    document.body.insertAdjacentHTML('beforeend',
      '<div class="fundo-modal" id="modal"><div class="modal"><h3 id="mNome">Freedom</h3><p id="mEmail"></p>' +
      '<button class="b2" id="mAt">↻ Atualizar agora</button><button class="b1" id="mSair">Sair / trocar login</button>' +
      '<button class="b2" id="mFechar">Fechar</button></div></div>');
    document.getElementById('btAt').onclick = function () { try { App.atualizar(); } catch (e) {} };
    document.getElementById('mAt').onclick = function () { Base.fechar(); try { App.atualizar(); } catch (e) {} };
    document.getElementById('btMenu').onclick = function () { document.getElementById('modal').classList.add('on'); };
    document.getElementById('mFechar').onclick = Base.fechar;
    document.getElementById('modal').onclick = function (ev) { if (ev.target.id === 'modal') Base.fechar(); };
    document.getElementById('mSair').onclick = function () {
      var b = this; if (b.dataset.ok) { try { App.sair(); } catch (e) {} return; }
      b.dataset.ok = '1'; b.textContent = 'Toque de novo para confirmar';
    };
    window.recebido = Base.atualizarTela;
    Base.atualizarTela();
    setInterval(function () { var e = Base.estado(); if (e.atualizando) Base.atualizarTela(); }, 1500);
  },
  fechar: function () { document.getElementById('modal').classList.remove('on'); var b = document.getElementById('mSair'); delete b.dataset.ok; b.textContent = 'Sair / trocar login'; },
  ultimo: '',
  atualizarTela: function () {
    var e = Base.estado();
    document.getElementById('st').innerHTML = e.atualizando ? 'atualizando…' : 'atualizado <b>' + F.hhmm(e.hora) + '</b><br>' + F.esc(e.email || '');
    document.getElementById('btAt').classList.toggle('gira', !!e.atualizando);
    document.getElementById('mNome').textContent = e.nome || 'Freedom';
    document.getElementById('mEmail').textContent = e.email ? 'Login: ' + e.email : '';
    document.getElementById('aviso').innerHTML = (e.erro && !e.atualizando)
      ? '<div class="aviso">Não atualizou agora: ' + F.esc(e.erro) + (e.dados ? '. Mostrando os números das ' + F.hhmm(e.hora) + '.' : '') + '</div>' : '';
    var conteudo = document.getElementById('conteudo');
    if (!e.dados) { conteudo.innerHTML = e.atualizando || !e.erro ? '<div class="carregando"><i></i>Buscando os números…</div>' : ''; Base.ultimo = ''; return; }
    var chave = JSON.stringify(e.dados);
    if (chave === Base.ultimo) return;   // nada mudou: não redesenha (mantém a busca digitada)
    Base.ultimo = chave;
    Base.render(e.dados, e);
  }
};
