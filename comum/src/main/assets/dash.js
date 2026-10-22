/* ============================================================
   Freedom · peças comuns dos dashboards (Comercial, Logística, Helpdesk).
   Os números vêm direto do site (F.api, só consulta) com o login do app,
   então cada pessoa vê exatamente o que o site libera para ela.
   ============================================================ */
var Dash = (function () {
  var X = {};
  X.k = function (v) { return F.brlK(v); };
  /** Valor principal (número grande do cartão): sempre com vírgula e centavos, ex.: R$ 2.670.173,45 */
  X.brl0 = function (v) { return F.brl(v); };
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
    var limite = new Promise(function (ok, falha) { setTimeout(function () { var e = new Error('O site demorou demais para responder. Toque em Tentar.'); e.status = 0; falha(e); }, 60000); });
    return Promise.race([F.api('GET', caminho), limite]).then(function (r) {
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
      if (svg._lig) return; svg._lig = 1; var box = svg.parentNode, tip = box.querySelector('.tip'), cur = svg.querySelector('.cursor');
      function mostrar(ev) {
        var r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        var vx = cx / r.width * cfg.W, i = cfg.col ? Math.floor((vx - cfg.L) / cfg.bw) : Math.round((vx - cfg.L) / ((cfg.W - 2 * cfg.L) / Math.max(1, cfg.n - 1)));
        i = Math.max(0, Math.min(cfg.n - 1, i)); var d = cfg.dicas[i]; if (!d) { tip.style.display = 'none'; cur.style.display = 'none'; return; }
        var px = cfg.col ? cfg.L + (i + .5) * cfg.bw : cfg.L + i * (cfg.W - 2 * cfg.L) / Math.max(1, cfg.n - 1);
        if (cfg.col) cur.setAttribute('x', cfg.L + i * cfg.bw); else { cur.setAttribute('x1', px); cur.setAttribute('x2', px); } cur.style.display = '';
        tip.innerHTML = d; tip.style.display = 'block';
        var left = px / cfg.W * r.width; tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px'; tip.style.top = '0px';
      }
      svg.addEventListener('touchstart', mostrar, { passive: true }); svg.addEventListener('touchmove', mostrar, { passive: true });
      svg.addEventListener('mousemove', mostrar); svg.addEventListener('click', mostrar);
      svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; cur.style.display = 'none'; });
    });
  };
  /** Barras verticais por posição: valores [v..], rótulos de x, destaque do maior, linha de média opcional. */
  X._ncol = 0;
  X.colunas = function (vals, rotulo, media, txtMedia, cores, dicas) {
    var W = 330, H = 130, n = vals.length || 1, bw = (W - 12) / n, mx = Math.max.apply(null, vals.concat([media || 0, 1])) * 1.15, id = 'col' + (++X._ncol);
    if (!dicas) dicas = vals.map(function (v, i) { var t = rotulo(i); return (t ? '<b>' + t + '</b><br>' : '') + F.brl(v); });
    var s = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" data-graf="' + id + '" style="cursor:pointer">';
    vals.forEach(function (v, i) { var hh = F.n(v) / mx * 92, xx = 6 + i * bw;
      s += v > 0 ? '<rect data-i="' + i + '" x="' + (xx + 2) + '" y="' + (104 - hh) + '" width="' + Math.max(2, bw - 4) + '" height="' + hh + '" rx="3" fill="' + (cores ? cores[i] : 'var(--azul)') + '"/>' : '<rect data-i="' + i + '" x="' + (xx + 2) + '" y="102" width="' + Math.max(2, bw - 4) + '" height="2" fill="var(--ln2)"/>';
      var t = rotulo(i); if (t) s += '<text x="' + (xx + bw / 2) + '" y="122" font-size="10" fill="var(--tx3)" text-anchor="middle">' + t + '</text>'; });
    if (media) { var ya = 104 - media / mx * 92; s += '<line x1="6" x2="' + (W - 6) + '" y1="' + ya + '" y2="' + ya + '" stroke="var(--tx2)" stroke-dasharray="4 4"/><text x="8" y="11" font-size="10.5" fill="var(--tx2)">- - ' + F.esc(txtMedia || '') + '</text>'; }
    s += '<rect class="cursor" x="0" y="4" width="' + bw + '" height="104" rx="4" fill="var(--tx3)" opacity=".14" style="display:none;pointer-events:none"/>';
    X._dicas[id] = { dicas: dicas, n: n, W: W, L: 6, col: true, bw: bw };
    return '<div class="graf">' + s + '</svg><div class="tip" style="display:none"></div></div>';
  };

  // ---- abas e estado ----
  X.abas = function (lista, atual, attr) { return '<div class="tabs' + (attr === 'sub' ? ' sub' : '') + '">' + lista.map(function (t) { var id = t[0], txt = t[1]; return '<b data-' + (attr || 'aba') + '="' + F.esc(id) + '"' + (id === atual ? ' class="on"' : '') + '>' + txt + '</b>'; }).join('') + '</div>'; };
  X.carregando = function (t) { return '<div class="carregando"><i></i>' + (t || 'Carregando…') + '</div>'; };
  X.erro = function (msg) { var st = document.getElementById('sub'); if (st && /Carregando/.test(st.textContent)) st.textContent = 'Não atualizou · toque em Tentar'; return '<div class="aviso" role="alert">' + F.ic('alerta') + '<span>' + F.esc(msg) + '</span><button onclick="carregar(true)">Tentar</button></div>'; };
  /** Última resposta guardada no aparelho: a tela abre na hora com ela e se atualiza sozinha. */
  X.cache = function (k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem('dc_' + k); return s ? JSON.parse(s) : null; }
      localStorage.setItem('dc_' + k, JSON.stringify({ t: Date.now(), d: v }));
    } catch (e) { try { localStorage.removeItem('dc_' + k); } catch (x) { } return null; }
  };
  X.lembrar = function (k, v) { try { if (v === undefined) return localStorage.getItem('dash_' + k); localStorage.setItem('dash_' + k, v); } catch (e) { return null; } };
  // ---- gravar no site (Logística, Administração): mesmos endereços e regras do site ----
  /** Envia uma alteração; 2xx devolve o JSON (ou null), erro vira Error com a mensagem certa. */
  X.enviar = function (metodo, caminho, corpo, msg409) {
    return F.api(metodo, caminho, corpo).then(function (r) {
      if (r.status >= 200 && r.status < 300) return r.json;
      var det = r.json && r.json.detail, m;
      if (r.status === 409) m = msg409 || 'O registro foi alterado por outra pessoa. Atualize a tela.';
      else if (det && typeof det === 'object' && !Array.isArray(det) && det.message) m = det.message;
      else if (r.status === 403) m = 'Seu login não tem permissão para esta alteração no site.';
      else if (r.status === 0) m = r.texto || 'Sem conexão com o site.';
      else m = F.erroApi ? F.erroApi(r, 'Não foi possível concluir a operação') : 'Não foi possível concluir a operação (erro ' + r.status + ')';
      var e = new Error(m); e.status = r.status; throw e;
    });
  };
  /** Janela por cima (embaixo no celular, no meio no computador). botoes: [[id, texto, classe]]. */
  X.modal = function (titulo, sub, corpo, botoes) {
    X.fechar();
    var el = document.createElement('div'); el.className = 'mfundo'; el.id = 'mfundo';
    el.innerHTML = '<div class="mcaixa" role="dialog" aria-modal="true"><p class="ct" style="font-size:16px">' + titulo + '</p>' + (sub ? '<p class="cs">' + sub + '</p>' : '') +
      '<div id="mcorpo">' + corpo + '</div><div class="merro" id="merro"></div><div class="acoes">' +
      (botoes || []).map(function (b) { return '<button class="btn ' + (b[2] || 'cl') + '" data-m="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div></div>';
    el.addEventListener('click', function (ev) { if (ev.target === el) X.fechar(); });
    document.body.appendChild(el);
    var f = el.querySelector('input,select,textarea'); if (f && window.innerWidth > 560) try { f.focus(); } catch (e) { }
    return el;
  };
  X.fechar = function () { var m = document.getElementById('mfundo'); if (m) m.parentNode.removeChild(m); };
  X.erroModal = function (t) { var e = document.getElementById('merro'); if (e) e.innerHTML = t ? F.esc(t) : ''; };
  /** Botão "Salvar" ocupado enquanto grava. */
  X.ocupado = function (id, sim, txt) { var b = document.querySelector('[data-m="' + id + '"]'); if (!b) return; if (sim) { b.setAttribute('data-txt', b.innerHTML); b.innerHTML = txt || 'Salvando…'; b.disabled = true; } else { b.innerHTML = b.getAttribute('data-txt') || b.innerHTML; b.disabled = false; } };
  X.campo = function (rot, html) { return '<label class="campo"><span>' + rot + '</span>' + html + '</label>'; };
  X.opcoes = function (lista, atual, vazio) {
    return (vazio != null ? '<option value="">' + F.esc(vazio) + '</option>' : '') + lista.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      return '<option value="' + F.esc(v) + '"' + (String(v) === String(atual == null ? '' : atual) ? ' selected' : '') + '>' + F.esc(t) + '</option>'; }).join('');
  };
  X.val = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
  /** Paginação do site: "Página X de Y" com Anterior/Próxima. */
  X.pag = function (chave, pag, tot, extra) {
    pag = F.n(pag) || 1; tot = F.n(tot) || 1; if (tot <= 1 && !extra) return '';
    return '<div class="pag"><button class="btn cl" data-pag="' + chave + '" data-ir="' + (pag - 1) + '"' + (pag <= 1 ? ' disabled' : '') + '>‹ Anterior</button><span>Página ' + pag + ' de ' + tot + (extra ? ' · ' + extra : '') + '</span>' +
      '<button class="btn cl" data-pag="' + chave + '" data-ir="' + (pag + 1) + '"' + (pag >= tot ? ' disabled' : '') + '>Próxima ›</button></div>';
  };
  /** Espera parar de digitar (300 ms, como o site). */
  X.espera = function (fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 300); }; };
  X.q = function (o) { var p = []; Object.keys(o).forEach(function (k) { var v = o[k]; if (v == null || v === '') return; (Array.isArray(v) ? v : [v]).forEach(function (x) { if (x !== '' && x != null) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(x)); }); }); return p.length ? '?' + p.join('&') : ''; };
  X.dh = function (s) { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(s); } };
  X.tempo = function (seg) { if (seg == null || seg === '') return '—'; seg = F.n(seg); if (seg < 60) return Math.round(seg) + 's'; var h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60); return h ? h + 'h ' + m + 'min' : m + 'min'; };
  /** Aberto direto pela barra do app (Comercial, Logística, Admin): sem botão voltar. */
  X.raiz = /[?&#]aba=1/.test(location.search + location.hash);
  if (X.raiz) document.documentElement.classList.add('raiz');
  /** Guarda o que estava digitando e a rolagem ao redesenhar. */
  X.manter = function (fn) {
    var y = window.scrollY, el = document.activeElement, id = el && el.id, pos = null; try { pos = el && el.selectionStart; } catch (e) { }
    fn(); try { X.buscaveis(document); } catch (e) { } window.scrollTo(0, y);
    if (id) { var n = document.getElementById(id); if (n && n !== document.activeElement) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch (e) { } } }
  };
  X.acessivel = function (r) { if (window.F && F.acessivel) F.acessivel(r); };

  // ---- listas grandes viram campo de busca: digita parte do nome ou o código e vai filtrando ----
  X._sa = function (t) { t = String(t || '').toLowerCase(); try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { } return t; };
  X.buscavel = function (sel) {
    if (sel._busca || sel.multiple || sel.options.length <= 20) return;
    sel._busca = 1;
    var caixa = document.createElement('div'); caixa.className = 'lbusca';
    var inp = document.createElement('input'); inp.className = 'inp'; inp.type = 'search'; inp.autocomplete = 'off';
    inp.placeholder = 'Digite o nome ou o código…'; if (sel.id) inp.id = sel.id + '_q'; inp.setAttribute('aria-label', 'Buscar na lista');
    var res = document.createElement('div'); res.className = 'bres'; res.setAttribute('role', 'listbox'); res.style.display = 'none';
    sel.parentNode.insertBefore(caixa, sel); caixa.appendChild(inp); caixa.appendChild(res); caixa.appendChild(sel);
    sel.style.display = 'none'; sel.tabIndex = -1;
    var ops = [], ativo = -1, achados = [];
    function ler() { ops = [].map.call(sel.options, function (o) { return { v: o.value, t: o.textContent, n: X._sa(o.textContent + ' ' + o.value) }; }).filter(function (o) { return o.v !== ''; }); }
    function mostrarAtual() { var o = sel.options[sel.selectedIndex]; inp.value = o && o.value !== '' ? o.textContent : ''; }
    function desenhar() {
      var q = X._sa(inp.value).trim(), partes = q.split(/\s+/).filter(Boolean);
      achados = ops.filter(function (o) { return partes.every(function (p) { return o.n.indexOf(p) >= 0; }); });
      // código exato primeiro
      if (/^\d+$/.test(q)) achados.sort(function (a, b) { return (String(b.v) === q) - (String(a.v) === q); });
      var mx = achados.slice(0, 60);
      res.innerHTML = mx.length ? mx.map(function (o, i) { return '<div class="bit' + (i === ativo ? ' on' : '') + '" role="option" data-i="' + i + '">' + F.esc(o.t) + '</div>'; }).join('') +
        (achados.length > 60 ? '<div class="bmais">+' + (achados.length - 60) + ' · continue digitando para achar</div>' : '') : '<div class="bmais">Nada encontrado</div>';
      res.style.display = 'block';
    }
    function escolher(o) {
      sel.value = o.v; mostrarAtual(); res.style.display = 'none'; ativo = -1;
      var ev; try { ev = new Event('change', { bubbles: true }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent('change', true, true); }
      sel.dispatchEvent(ev);
    }
    ler(); mostrarAtual();
    inp.addEventListener('focus', function () { ler(); inp.select(); ativo = -1; var v = inp.value; inp.value = ''; desenhar(); inp.value = v; inp.select(); });
    inp.addEventListener('input', function () { ativo = -1; desenhar(); if (!inp.value && sel.value) { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); } });
    inp.addEventListener('keydown', function (ev) {
      var n = Math.min(achados.length, 60);
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ativo = Math.min(n - 1, ativo + 1); desenhar(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ativo = Math.max(0, ativo - 1); desenhar(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault(); if (!res.style.display || res.style.display === 'none') desenhar();
        var q = inp.value.trim(), o = achados[ativo >= 0 ? ativo : 0];
        // só número: tem que ser o código exato (não pega um nome que por acaso tem esses dígitos)
        if (ativo < 0 && /^\d+$/.test(q)) { o = ops.filter(function (x) { return String(x.v) === q; })[0]; if (!o) { F.toast('Código ' + q + ' não está na lista'); inp.select(); return; } }
        if (o) escolher(o);
      }
      else if (ev.key === 'Escape') { res.style.display = 'none'; mostrarAtual(); ev.stopPropagation(); }
    });
    res.addEventListener('mousedown', function (ev) { ev.preventDefault(); var b = ev.target.closest('[data-i]'); if (b) escolher(achados[F.n(b.getAttribute('data-i'))]); });
    inp.addEventListener('blur', function () { setTimeout(function () { res.style.display = 'none'; mostrarAtual(); }, 120); });
  };
  X.buscaveis = function (r) { [].forEach.call((r || document).querySelectorAll('select.sel, .campo select'), X.buscavel); };
  (function () {
    var pend = 0;
    function rodar() { pend = 0; X.buscaveis(document); }
    function ligar() { rodar(); try { new MutationObserver(function () { if (!pend) { pend = 1; setTimeout(rodar, 0); } }).observe(document.body, { childList: true, subtree: true }); } catch (e) { } }
    if (document.body) ligar(); else document.addEventListener('DOMContentLoaded', ligar);
  })();
  return X;
})();
