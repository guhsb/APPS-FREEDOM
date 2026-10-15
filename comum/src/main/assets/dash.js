/* ============================================================
   Freedom · peças comuns dos dashboards (Comercial, Logística, Helpdesk).
   Os números vêm direto do site (F.api, só consulta) com o login do app,
   então cada pessoa vê exatamente o que o site libera para ela.
   ============================================================ */
var Dash = (function () {
  var X = {};
  X.k = function (v) { return F.brlK(v); };
  X.brl0 = function (v) { return 'R$ ' + Math.round(F.n(v)).toLocaleString('pt-BR'); };
  X.p0 = function (v) { return Math.round(F.n(v) * 100) + '%'; };
  X.int = function (v) { return Math.round(F.n(v)).toLocaleString('pt-BR'); };
  X.nome = function (s) { return String(s || '').replace(/^(SUPERVISOR|DIRETORIA|GERENTE|GESTOR)\s*-\s*/i, ''); };
  /** Nomes ficam como vêm do site; só texto todo em minúsculas (ex.: motivos) ganha a 1ª letra maiúscula. */
  X.cap = function (s) { s = String(s || '').trim(); return s && s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

  // ---- datas (horário de São Paulo) ----
  X.hoje = function () { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); };
  X.de = function (iso) { var a = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); };
  X.iso = function (d) { return d.toISOString().slice(0, 10); };
  X.dm = function (iso) { iso = String(iso || ''); return iso.slice(8, 10) + '/' + iso.slice(5, 7); };
  X.mes = function (iso, mais) { var d = X.de(iso), a = d.getUTCFullYear(), m = d.getUTCMonth() + (mais || 0); return [X.iso(new Date(Date.UTC(a, m, 1))), X.iso(new Date(Date.UTC(a, m + 1, 0)))]; };
  X.util = function (iso) { var w = X.de(iso).getUTCDay(); return w !== 0 && w !== 6; };
  X.dias = function (ini, fim) { var r = [], d = X.de(ini), f = X.de(fim); while (d <= f) { r.push(X.iso(d)); d = new Date(d.getTime() + 864e5); } return r; };
  X.idade = function (iso) { return Math.max(0, Math.round((X.de(X.hoje()) - X.de(iso)) / 864e5)); };

  // ---- site (só GET) ----
  /** Busca no site; 204 = vazio. Falha vira erro com a mensagem do site. */
  X.get = function (caminho) {
    return F.api('GET', caminho).then(function (r) {
      if (r.status === 200) return r.json || {};
      if (r.status === 204) return {};
      var e = new Error(F.erroApi ? F.erroApi(r, 'Não consegui carregar') : 'Não consegui carregar (HTTP ' + r.status + ')'); e.status = r.status; throw e;
    });
  };
  /** Igual, mas falha vira objeto vazio (partes extras não derrubam a tela). */
  X.opc = function (caminho) { return X.get(caminho).catch(function () { return {}; }); };

  // ---- quem é quem: mesmo critério do site ----
  X.perfil = function (me) {
    var p = Array.isArray(me.permissions) ? me.permissions.map(String) : [];
    var tipo = p.indexOf('analytics:view_all') >= 0 ? 'dir' : p.indexOf('analytics:view_team') >= 0 ? 'ger' :
      (p.length || me.role === 'seller') ? 'ven' : (me.role === 'director' || me.role === 'admin' ? 'dir' : me.role === 'manager' ? 'ger' : 'dir');
    var fx = tipo === 'ger' ? (me.manager_name ? '&manager=' + encodeURIComponent(me.manager_name) : '') : tipo === 'ven' ? (me.seller_name ? '&seller=' + encodeURIComponent(me.seller_name) : '') : '';
    return { tipo: tipo, fx: fx, nome: me.display_name || me.seller_name || '', papel: tipo === 'dir' ? 'Diretor' : tipo === 'ger' ? 'Gestor' : 'Vendedor' };
  };

  // ---- pedaços de tela ----
  X.card = function (t, s, corpo, cls) { return '<div class="card' + (cls ? ' ' + cls : '') + '">' + (t ? '<p class="ct">' + t + '</p>' : '') + (s ? '<p class="cs">' + s + '</p>' : '') + corpo + '</div>'; };
  X.k4 = function (itens) { return '<div class="k4">' + itens.map(function (i) { return '<div class="k"><span>' + i[0] + '</span><b' + (i[3] ? ' class="' + i[3] + '"' : '') + '>' + i[1] + '</b><em>' + (i[2] || '') + '</em>' + (i[4] || '') + '</div>'; }).join('') + '</div>'; };
  X.ins = function (c, ic, t, x) { return '<div class="ins"><div class="ic2" style="background:var(--' + c + '-s);color:var(--' + c + ')">' + ic + '</div><p><b>' + t + '</b>' + (x ? '<br>' + x : '') + '</p></div>'; };
  X.atencao = function (lista) {
    if (!lista.length) return '';
    return '<div class="sec"><h2>O que merece atenção</h2><span>gerado dos dados</span></div><div class="card">' + lista.join('') + '</div>';
  };
  /** Barras horizontais: itens [nome, valor, %, extra, dataAttr]. */
  X.barras = function (itens, cor, fmt) {
    var mx = Math.max.apply(null, itens.map(function (i) { return F.n(i[1]); }).concat([1]));
    return itens.map(function (i) {
      return '<div class="hb"' + (i[4] ? ' data-v="' + F.esc(i[4]) + '"' : '') + '><span class="n">' + F.esc(i[0]) + '</span><span class="p"><b>' + (fmt ? fmt(i[1]) : X.k(i[1])) + '</b>' +
        (i[2] != null ? ' · ' + Math.round(F.n(i[2])) + '%' : '') + (i[3] ? ' · ' + i[3] : '') + '</span><div class="t"><i style="width:' + (F.n(i[1]) / mx * 100) + '%' + (cor ? ';background:' + cor : '') + '"></i></div></div>';
    }).join('');
  };
  /** Linha com barra de meta: [nome, sub, p (0..1), idealP, data]. */
  X.meta = function (nome, sub, p, idealP, data, semMeta) {
    var ok = p >= idealP, bateu = p >= 1;
    var selo = semMeta ? '<span class="st2 sm">sem meta</span>' : '<span class="st2 ' + (ok ? 'ok' : 'ba') + '">' + (bateu ? '★ bateu' : ok ? '▲ no ritmo' : '▼ abaixo') + '</span>';
    return '<div class="ger"' + (data ? ' data-v="' + F.esc(data) + '"' : '') + '><div class="nm"><b>' + F.esc(nome) + '</b>' + (sub ? '<span>' + sub + '</span>' : '') +
      (semMeta ? '' : '<div class="mini"><i style="width:' + Math.min(100, p * 100) + '%;background:' + (ok ? 'var(--verde)' : 'var(--laranja)') + '"></i><u style="left:' + Math.min(100, idealP * 100) + '%"></u></div>') + '</div>' +
      (semMeta ? '' : '<b style="font-size:15px;min-width:46px;text-align:right">' + Math.round(p * 100) + '%</b>') + selo + '</div>';
  };
  /** Barra única dividida (ABC, idade, prioridade): partes [rótulo, valor, cor, textoDentro]. */
  X.faixa = function (partes, alt) {
    var tot = partes.reduce(function (s, p) { return s + F.n(p[1]); }, 0) || 1;
    return '<div class="abc" style="height:' + (alt || 30) + 'px">' + partes.filter(function (p) { return F.n(p[1]) > 0; }).map(function (p) {
      return '<div style="flex:' + F.n(p[1]) + ';background:' + p[2] + '">' + (p[3] != null ? p[3] : (F.n(p[1]) / tot > 0.08 ? Math.round(F.n(p[1]) / tot * 100) + '%' : '')) + '</div>';
    }).join('') + '</div>';
  };
  X.legenda = function (partes, fmt) { return '<div class="leg2">' + partes.map(function (p) { return '<span><b style="color:' + p[2] + '">■</b> ' + p[0] + (fmt ? ' · <b style="color:var(--tx)">' + fmt(p[1]) + '</b>' : '') + '</span>'; }).join('') + '</div>'; };

  /** Gráfico de linhas (várias séries, mesmo eixo). series: [{pts:[[i,v]..], cor, tracejado, pontos}], n = nº de posições, rotulos = [[i, texto]]. */
  X.linhas = function (id, series, n, rotulos, max, linhasRef, dicas) {
    var W = 330, H = 160, L = 6, T = 14, B = 22;
    max = max || Math.max.apply(null, [1].concat(series.map(function (s) { return Math.max.apply(null, s.pts.map(function (p) { return F.n(p[1]); }).concat([0])); })));
    max *= 1.06;
    var x = function (i) { return L + i * (W - 2 * L) / Math.max(1, n - 1); }, y = function (v) { return T + (H - T - B) * (1 - F.n(v) / max); };
    var s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" data-graf="' + id + '"><line x1="' + L + '" x2="' + (W - L) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" stroke="var(--ln)"/>';
    (linhasRef || []).forEach(function (r) { s += '<line x1="' + L + '" x2="' + (W - L) + '" y1="' + y(r[0]) + '" y2="' + y(r[0]) + '" stroke="var(--ln2)" stroke-dasharray="2 4"/><text x="' + L + '" y="' + (y(r[0]) - 5) + '" font-size="10.5" fill="var(--tx3)">' + F.esc(r[1]) + '</text>'; });
    series.forEach(function (se) {
      if (!se.pts.length) return;
      s += '<polyline points="' + se.pts.map(function (p) { return x(p[0]) + ',' + y(p[1]); }).join(' ') + '" fill="none" stroke="' + se.cor + '" stroke-width="' + (se.fino ? 1.5 : 2.4) + '" stroke-linejoin="round"' +
        (se.tracejado ? ' stroke-dasharray="' + se.tracejado + '"' : '') + (se.opac ? ' opacity="' + se.opac + '"' : '') + '/>';
      if (se.pontos) se.pts.forEach(function (p) { s += '<circle cx="' + x(p[0]) + '" cy="' + y(p[1]) + '" r="3.5" fill="' + se.cor + '" stroke="var(--sf)" stroke-width="1.5"/>'; });
      if (se.fimPonto) { var u = se.pts[se.pts.length - 1]; s += '<circle cx="' + x(u[0]) + '" cy="' + y(u[1]) + '" r="5" fill="' + se.cor + '" stroke="var(--sf)" stroke-width="2"/>'; }
    });
    (rotulos || []).forEach(function (r, k) { s += '<text x="' + x(r[0]) + '" y="' + (H - 6) + '" font-size="10.5" fill="var(--tx3)" text-anchor="' + (k === 0 ? 'start' : k === rotulos.length - 1 ? 'end' : 'middle') + '">' + r[1] + '</text>'; });
    s += '<line class="cursor" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--tx3)" stroke-width="1" style="display:none"/></svg>';
    X._dicas[id] = { dicas: dicas || [], n: n, W: W, L: L };
    return '<div class="graf">' + s + '<div class="tip" style="display:none"></div></div>';
  };
  X._dicas = {};
  /** Toque/passar o mouse no gráfico mostra o valor do dia. */
  X.ligarGraficos = function (raiz) {
    [].forEach.call((raiz || document).querySelectorAll('svg[data-graf]'), function (svg) {
      var cfg = X._dicas[svg.getAttribute('data-graf')]; if (!cfg || !cfg.dicas.length) return;
      var box = svg.parentNode, tip = box.querySelector('.tip'), cur = svg.querySelector('.cursor');
      function mostrar(ev) {
        var r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        var vx = cx / r.width * cfg.W, i = Math.round((vx - cfg.L) / ((cfg.W - 2 * cfg.L) / Math.max(1, cfg.n - 1)));
        i = Math.max(0, Math.min(cfg.n - 1, i)); var d = cfg.dicas[i]; if (!d) { tip.style.display = 'none'; cur.style.display = 'none'; return; }
        var px = cfg.L + i * (cfg.W - 2 * cfg.L) / Math.max(1, cfg.n - 1);
        cur.setAttribute('x1', px); cur.setAttribute('x2', px); cur.style.display = '';
        tip.innerHTML = d; tip.style.display = 'block';
        var left = px / cfg.W * r.width; tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px'; tip.style.top = '0px';
      }
      svg.addEventListener('touchstart', mostrar, { passive: true }); svg.addEventListener('touchmove', mostrar, { passive: true });
      svg.addEventListener('mousemove', mostrar);
      svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; cur.style.display = 'none'; });
    });
  };
  /** Barras verticais por posição: valores [v..], rótulos de x, destaque do maior, linha de média opcional. */
  X.colunas = function (vals, rotulo, media, txtMedia, cores) {
    var W = 330, H = 130, n = vals.length || 1, bw = (W - 12) / n, mx = Math.max.apply(null, vals.concat([media || 0, 1])) * 1.15;
    var s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '">';
    vals.forEach(function (v, i) { var hh = F.n(v) / mx * 92, xx = 6 + i * bw;
      s += v > 0 ? '<rect x="' + (xx + 2) + '" y="' + (104 - hh) + '" width="' + Math.max(2, bw - 4) + '" height="' + hh + '" rx="3" fill="' + (cores ? cores[i] : 'var(--azul)') + '"/>' : '<rect x="' + (xx + 2) + '" y="102" width="' + Math.max(2, bw - 4) + '" height="2" fill="var(--ln2)"/>';
      var t = rotulo(i); if (t) s += '<text x="' + (xx + bw / 2) + '" y="122" font-size="10" fill="var(--tx3)" text-anchor="middle">' + t + '</text>'; });
    if (media) { var ya = 104 - media / mx * 92; s += '<line x1="6" x2="' + (W - 6) + '" y1="' + ya + '" y2="' + ya + '" stroke="var(--tx2)" stroke-dasharray="4 4"/><text x="8" y="11" font-size="10.5" fill="var(--tx2)">- - ' + F.esc(txtMedia || '') + '</text>'; }
    return s + '</svg>';
  };

  // ---- abas e estado ----
  X.abas = function (lista, atual, attr) { return '<div class="tabs' + (attr === 'sub' ? ' sub' : '') + '">' + lista.map(function (t) { var id = t[0], txt = t[1]; return '<b data-' + (attr || 'aba') + '="' + F.esc(id) + '"' + (id === atual ? ' class="on"' : '') + '>' + txt + '</b>'; }).join('') + '</div>'; };
  X.carregando = function (t) { return '<div class="carregando"><i></i>' + (t || 'Carregando…') + '</div>'; };
  X.erro = function (msg) { return '<div class="aviso">' + F.ic('alerta') + '<span>' + F.esc(msg) + '</span><button onclick="carregar(true)">Tentar</button></div>'; };
  X.lembrar = function (k, v) { try { if (v === undefined) return localStorage.getItem('dash_' + k); localStorage.setItem('dash_' + k, v); } catch (e) { return null; } };
  return X;
})();
