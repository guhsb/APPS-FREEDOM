/* ============================================================
   Freedom · Logística completa (igual ao site, dentro do app).
   Pedidos, PEND, Valor Pedido, Consulta, Standby, Relatório, Faturamento e Conferência.
   Lê e grava com os MESMOS endereços do site e com o login da pessoa: o que muda aqui
   muda no site (e o site recusa quem não tem acesso).
   ============================================================ */
var LG = (function () {
  var X = Dash, S = {}, seq = 0;
  var CLS = { PENDENCIA: 'Pendência', EQUIPE: 'Equipe', FINALIZADO: 'Finalizado' };
  var CONF = { FINALIZADA: 'Finalizada', EM_ANDAMENTO: 'Em conferência', SEM_REGISTRO: 'Sem registro', OUTRA: 'Outra situação' };
  var FATS = { FATURADO: 'Faturado', NAO_FATURADO: 'Não faturado' };
  var STATUS_NF = { FATURADO: 'Faturado', PENDENTE: 'Pendente', CANCELADO: 'Cancelado', OUTRO: 'Outro' };
  var CATS = [['NETWORK', 'Redes', 'rede'], ['PRODUCT', 'Produtos', 'produto'], ['FAMILY', 'Famílias', 'família'], ['CUSTOMER', 'Clientes', 'cliente']];
  var RELST = { IN_PRODUCTION: 'Em produção', OUT_OF_STOCK: 'Sem estoque' };

  function st(k) { return S[k] || (S[k] = {}); }
  function redesenhar() { if (window.desenharMantendo) desenharMantendo(); }
  /** Busca e guarda em alvo[campo]; só a última chamada vale. */
  function buscar(alvo, campo, url) {
    var meu = ++seq; alvo['_s' + campo] = meu; alvo['_c' + campo] = true; alvo['_e' + campo] = null;
    return X.get(url).then(function (j) { if (alvo['_s' + campo] !== meu) return; alvo[campo] = j; })
      .catch(function (e) { if (alvo['_s' + campo] !== meu) return; alvo['_e' + campo] = e.message || 'Não consegui carregar'; })
      .then(function () { if (alvo['_s' + campo] !== meu) return; alvo['_c' + campo] = false; redesenhar(); });
  }
  /** Mostra carregando / erro / conteúdo. */
  function bloco(alvo, campo, fn) {
    if (alvo['_e' + campo]) return '<div class="aviso">' + F.ic('alerta') + '<span>' + F.esc(alvo['_e' + campo]) + '</span></div>';
    if (alvo[campo] == null) return X.carregando();
    return fn(alvo[campo]);
  }
  function brl(v) { return F.brl(v); }
  function qtd(v) { var n = F.n(v); return (Math.round(n) === n ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })); }
  function lista(arr) { return Array.isArray(arr) ? arr : []; }
  function sel(id, ops, atual, vazio, extra) { return '<select class="sel" id="' + id + '"' + (extra || '') + '>' + X.opcoes(ops, atual, vazio) + '</select>'; }
  function inp(id, valor, ph, tipo) { return '<input class="inp" id="' + id + '" type="' + (tipo || 'text') + '" value="' + F.esc(valor || '') + '" placeholder="' + F.esc(ph || '') + '">'; }
  function falhou(e) { F.toast(e.message || 'Não foi possível concluir a operação.'); }

  // ---- escolher vários de uma vez (adicionar) e marcar vários para remover ----
  var MULTI = { nfExCli: 'nf', nfExTipo: 'nf', diaAddCli: 'dia', diaAddTipo: 'dia' };
  function marcados(sx, id) { sx.mc = sx.mc || {}; return (sx.mc[id] = sx.mc[id] || []); }
  /** Seleção da lista vai para os "escolhidos" (chips) e o campo limpa para escolher o próximo. */
  function escolheu(id, v) {
    if (!v) return; var sx = st(MULTI[id]), l = marcados(sx, id), el = document.getElementById(id);
    var txt = el && el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : v;
    if (!l.some(function (x) { return x[0] === v; })) l.push([v, txt]);
    redesenhar();
    var foco = function () { var i = document.getElementById(id + '_q'); if (i && i !== document.activeElement) i.focus(); };
    foco(); setTimeout(foco, 30);
  }
  function chipsMulti(sx, id) {
    var l = marcados(sx, id); if (!l.length) return '';
    return '<div class="escolhidos">' + l.map(function (x) { return '<span class="chip ro">' + F.esc(x[1]) + '<button class="lnk" data-act="desmarcar" data-v="' + F.esc(id + '|' + x[0]) + '" aria-label="Tirar">×</button></span>'; }).join('') +
      '<button class="lnk" data-act="desmarcarTodos" data-v="' + id + '">Limpar</button></div>';
  }
  function rotMulti(sx, id, um, varios) { var n = marcados(sx, id).length; return n > 1 ? varios + ' (' + n + ')' : um; }
  /** Valores a enviar: os escolhidos ou, se nenhum, o que está na lista. */
  function valoresMulti(id) { var l = marcados(st(MULTI[id]), id); if (l.length) return l.map(function (x) { return x[0]; }); var v = X.val(id); return v ? [v] : []; }
  /** Envia um por um (o site recebe um item por vez) e conta as falhas. */
  function emSerie(vals, fn) {
    var ok = 0, erros = [];
    return vals.reduce(function (p, v) { return p.then(function () { return fn(v).then(function () { ok++; }, function (e) { erros.push(v + ': ' + (e.message || 'falhou')); }); }); }, Promise.resolve())
      .then(function () { return { ok: ok, erros: erros }; });
  }
  function msgSerie(r, feito) { return r.erros.length ? r.ok + ' ' + feito + ', ' + r.erros.length + ' com erro (' + r.erros.slice(0, 2).join(' · ') + ')' : (r.ok === 1 ? '1 item ' : r.ok + ' itens ') + feito; }
  // remover vários: chave = 'nf:customers', 'dia:order-types'…
  function mr(sx, k) { sx.mr = sx.mr || {}; return (sx.mr[k] = sx.mr[k] || {}); }
  function ckRem(sx, k, v) { if (((sx.mrAll || {})[k] || []).length < 2) return ''; return '<input type="checkbox" class="ckRem" data-act="mrMarca" data-v="' + F.esc(k + '|' + v) + '"' + (mr(sx, k)[v] ? ' checked' : '') + ' aria-label="Marcar para remover">'; }
  function barraRem(sx, k, vals) {
    sx.mrAll = sx.mrAll || {}; sx.mrAll[k] = vals; if (vals.length < 2) return '';
    var m = mr(sx, k), n = vals.filter(function (v) { return m[v]; }).length;
    return '<div class="barraRem"><button class="lnk" data-act="mrTodos" data-v="' + k + '">' + (n === vals.length ? 'Desmarcar todos' : 'Marcar todos') + '</button>' +
      (n ? '<button class="btn ro" data-act="mrRem" data-v="' + k + '">Remover selecionados (' + n + ')</button>' : '<span class="cs">marque para remover vários</span>') + '</div>';
  }

  // =====================================================================
  // Pedidos (Controle de Pedidos)
  // =====================================================================
  function urlPed() { var s = st('ped'); return '/logistics/pending/orders' + X.q({ search: (s.busca || '').trim(), network: s.rede, classification: s.cls }); }
  function carregarPed() { var s = st('ped'); return buscar(s, 'd', urlPed()).then(function () { lista(s.d && s.d.items).forEach(function (i) { s.redes = s.redes || {}; if (i.network) s.redes[i.network] = 1; }); }); }
  /** Classificações que o pedido pode receber: as do site + qualquer nova que já apareça nos pedidos (entra sozinha). */
  function opcoesCls() {
    var l = ['PENDENCIA', 'EQUIPE'], d = st('ped').d;
    lista(d && d.items).forEach(function (i) { [i.operational_classification, i.classification].forEach(function (c) { if (c && c !== 'FINALIZADO' && l.indexOf(c) < 0) l.push(c); }); });
    return l;
  }
  function nomeCls(c) { return CLS[c] || X.cap(String(c || '').toLowerCase().replace(/_/g, ' ')); }
  /** Motivos já usados (nos pedidos de agora e nos que você salvou), do mais usado para o menos. */
  function motivosUsados() {
    var cont = {}, d = st('ped').d;
    lista(d && d.items).forEach(function (i) { var m = (i.reason || '').trim(); if (m) cont[m] = (cont[m] || 0) + 1; });
    try { JSON.parse(localStorage.getItem('log_motivos') || '[]').forEach(function (m) { cont[m] = (cont[m] || 0) + 0.5; }); } catch (e) { }
    return Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; }).slice(0, 12);
  }
  function lembrarMotivo(m) {
    if (!m) return;
    try { var l = JSON.parse(localStorage.getItem('log_motivos') || '[]').filter(function (x) { return x !== m; }); l.unshift(m); localStorage.setItem('log_motivos', JSON.stringify(l.slice(0, 20))); } catch (e) { }
  }
  /** Filtros a mais do app (data, motivo, conferência, valor): aplicados nos pedidos que o site devolveu. */
  function fxAtivo(fx) { return Object.keys(fx || {}).some(function (k) { return fx[k] !== '' && fx[k] != null; }); }
  function filtraPed(items) {
    var fx = st('ped').fx || {}, vmin = fx.vmin !== '' && fx.vmin != null ? F.n(fx.vmin) : null, vmax = fx.vmax !== '' && fx.vmax != null ? F.n(fx.vmax) : null;
    return lista(items).filter(function (p) {
      var dt = String(p.order_date || '').slice(0, 10), m = (p.reason || '').trim(), v = F.n(p.value);
      if (fx.ini && dt < fx.ini) return false; if (fx.fim && dt > fx.fim) return false;
      if (fx.mot === 'com' && !m) return false; if (fx.mot === 'sem' && m) return false;
      if (fx.mot && fx.mot !== 'com' && fx.mot !== 'sem' && m.toLowerCase() !== fx.mot.toLowerCase()) return false;
      if (fx.conf === 'nenhuma' && p.conference_status) return false; if (fx.conf && fx.conf !== 'nenhuma' && p.conference_status !== fx.conf) return false;
      if (vmin != null && v < vmin) return false; if (vmax != null && v > vmax) return false;
      return true;
    });
  }
  function filtrosPed(s) {
    var fx = s.fx || {}, ativo = fxAtivo(fx);
    return '<details class="card"' + (s.abreF || ativo ? ' open' : '') + ' id="pedFx"><summary class="ct" style="cursor:pointer">Mais filtros' + (ativo ? ' <span class="chip ro" style="display:inline-flex;margin-left:6px">ativos</span>' : '') + '</summary>' +
      '<div class="sub2" style="margin-top:10px">' + X.campo('Data inicial', '<input type="date" id="pedFxIni" value="' + F.esc(fx.ini || '') + '">') + X.campo('Data final', '<input type="date" id="pedFxFim" value="' + F.esc(fx.fim || '') + '">') + '</div>' +
      '<div class="sub2">' + X.campo('Motivo', '<select id="pedFxMot">' + X.opcoes([['com', 'Com motivo'], ['sem', 'Sem motivo']].concat(motivosUsados().map(function (m) { return [m, m]; })), fx.mot, 'Todos') + '</select>') +
      X.campo('Conferência', '<select id="pedFxConf">' + X.opcoes(Object.keys(CONF).map(function (k) { return [k, CONF[k]]; }).concat([['nenhuma', 'Sem conferência']]), fx.conf, 'Todas') + '</select>') + '</div>' +
      '<div class="sub2">' + X.campo('Valor mínimo (R$)', '<input type="number" inputmode="decimal" id="pedFxMin" value="' + F.esc(fx.vmin || '') + '" placeholder="0">') + X.campo('Valor máximo (R$)', '<input type="number" inputmode="decimal" id="pedFxMax" value="' + F.esc(fx.vmax || '') + '" placeholder="sem limite">') + '</div>' +
      '<div class="acoes" style="justify-content:flex-start;margin-top:4px"><button class="btn cl mini" data-act="pedFxLimpar">Limpar filtros</button></div></details>';
  }
  function telaPed() {
    var s = st('ped'); if (s.d == null && !s._cd) carregarPed();
    s.marc = s.marc || {};
    var h = '';
    var sm = s.d && s.d.summary || {};
    h += '<div class="k4" style="grid-template-columns:1fr 1fr 1fr">' + [['PENDENCIA', 'Pendência', sm.pending_value, sm.pending_orders, 'lar'], ['EQUIPE', 'Equipe', sm.team_value, sm.team_orders, ''], ['FINALIZADO', 'Finalizado', sm.finalized_value, sm.finalized_orders, 'pos']].map(function (c) {
      return '<div class="k" data-act="pedCls" data-v="' + c[0] + '" style="cursor:pointer' + (s.cls === c[0] ? ';outline:2px solid var(--rosa)' : '') + '"><span>' + c[1] + '</span><b class="' + c[4] + '" style="font-size:16px">' + (s.d ? X.k(c[2]) : '…') + '</b><em>' + (s.d ? X.int(c[3]) + ' pedido(s)' : '') + '</em></div>';
    }).join('') + '</div>';
    var redes = Object.keys(s.redes || {}).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    h += '<input class="busca" id="pedBusca" placeholder="Buscar cliente, rede ou pedido" value="' + F.esc(s.busca || '') + '">';
    h += '<div class="sub2">' + sel('pedRede', redes, s.rede, 'Todas as redes') + sel('pedCls', opcoesCls().concat(['FINALIZADO']).map(function (c) { return [c, nomeCls(c)]; }), s.cls, 'Todas as classificações') + '</div>';
    h += filtrosPed(s);
    var nMarc = Object.keys(s.marc).length;
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px"><button class="btn cl mini" data-act="pedPng">' + F.ic('imagem') + ' Gerar imagem (PNG)</button>' + (s.varios ? '<button class="btn cl mini" data-act="pedVarios">Cancelar seleção</button><button class="btn az mini" data-act="pedTodos">Marcar os mostrados</button>' :
      '<button class="btn az mini" data-act="pedVarios">☑ Selecionar vários</button>') + '<span class="cs" style="margin:0">Toque em Pendência/Equipe no pedido para trocar na hora</span></div>';
    h += bloco(s, 'd', function (d) {
      var it = filtraPed(d.items), n = s.n || 40;
      if (!it.length) return '<div class="vazio">Nenhum pedido encontrado' + (fxAtivo(s.fx) ? ' com esses filtros' : '') + '.</div>';
      return X.card(it.length + ' pedido(s)' + (fxAtivo(s.fx) ? ' · ' + X.k(it.reduce(function (a, p) { return a + F.n(p.value); }, 0)) : ''), s.varios ? 'Marque os pedidos e use a barra de baixo para classificar todos de uma vez' : 'Classificação e motivo gravam direto no site', it.slice(0, n).map(linhaPed).join('') +
        (it.length > n ? '<button class="mais" data-act="pedMais">Ver mais (' + (it.length - n) + ')</button>' : ''));
    });
    if (s.varios && nMarc) h += '<div style="height:70px"></div><div class="barraLote"><span><b>' + nMarc + '</b> pedido' + (nMarc > 1 ? 's' : '') + ' marcado' + (nMarc > 1 ? 's' : '') + '</span><button class="btn ro" data-act="pedLote">Classificar / motivo</button></div>';
    return h;
  }
  function linhaPed(p) {
    var s = st('ped'), ef = p.effective_classification, ab = s.ab && s.ab[p.order_number], pr = s.prods && s.prods[p.order_number];
    var cor = ef === 'FINALIZADO' ? 'vd' : ef === 'EQUIPE' ? 'az' : 'la', fin = ef === 'FINALIZADO', atual = p.operational_classification || p.classification;
    var trocando = s.trocando === p.order_number;
    var h = '<div class="lin">' + (s.varios && !fin ? '<input type="checkbox" class="chkPed" data-act="pedMarca" data-v="' + F.esc(p.order_number) + '"' + (s.marc[p.order_number] ? ' checked' : '') + ' style="width:20px;height:20px;margin-top:2px;accent-color:var(--rosa)">' : '') +
      '<div class="c"><b>' + F.esc(p.customer || '—') + '</b><span>Pedido ' + F.esc(p.order_number) + ' · ' + F.dataBR(p.order_date) + ' · ' + F.esc(p.network || 'SEM REDE') + '</span>';
    if (fin) h += '<span class="bdg vd">Finalizado</span>';
    else h += '<div class="segm">' + opcoesCls().map(function (c) {
      return '<button data-act="pedTroca" data-v="' + F.esc(p.order_number) + '" data-c="' + F.esc(c) + '" class="' + (c === atual ? 'on ' + (c === 'EQUIPE' ? 'az' : 'la') : '') + '"' + (trocando ? ' disabled' : '') + '>' + F.esc(nomeCls(c)) + '</button>'; }).join('') + '</div>';
    h += (p.conference_status ? '<span class="bdg">' + F.esc(CONF[p.conference_status] || p.conference_status) + '</span>' : '') +
      (p.reason ? '<span style="display:block;font-size:12.5px;color:var(--tx2);margin-top:4px">Motivo: <b>' + F.esc(p.reason) + '</b></span>' : '') +
      '<div class="ac2"><button class="lnk" data-act="pedItens" data-v="' + F.esc(p.order_number) + '">' + (ab ? 'Ocultar itens' : 'Ver ' + F.n(p.item_count) + ' itens') + '</button>' +
      (!fin ? '<button class="lnk ro" data-act="pedEditar" data-v="' + F.esc(p.order_number) + '">' + (p.reason ? 'Trocar motivo' : '+ Motivo') + '</button>' : '<span style="font-size:12px;color:var(--tx3)" title="Classificação definida pela conferência concluída.">Definido pela conferência</span>') + '</div>';
    if (ab) h += '<div class="itens2">' + (pr === undefined || pr === 'c' ? '<div class="vazio2">Carregando produtos…</div>' : pr === 'e' ? '<div class="vazio2">Não consegui abrir os produtos.</div>' :
      lista(pr.products).map(function (x) { return '<div class="row"><span>' + F.esc(x.product) + (x.product_code ? ' <small style="color:var(--tx3)">' + F.esc(x.product_code) + '</small>' : '') + '<br><small style="color:var(--tx3)">' + F.esc(x.family || '') + ' · ' + qtd(x.quantity) + ' un</small></span><b>' + brl(x.value) + '</b></div>'; }).join('')) + '</div>';
    return h + '</div><div class="v">' + brl(p.value) + '</div></div>';
  }
  function pedPorNumero(n) { var d = st('ped').d; return lista(d && d.items).filter(function (x) { return x.order_number === n; })[0]; }
  /** Grava no site; devolve a promessa. */
  function gravarPed(n, cls, motivo) {
    return X.enviar('PUT', '/logistics/pending/orders/' + encodeURIComponent(n) + '/control', { classification: cls, reason: motivo || null }, 'Este pedido não está mais disponível na lista de pendências.')
      .then(function (j) { var p = pedPorNumero(n); if (p) { p.operational_classification = cls; p.classification = cls; p.effective_classification = cls; p.reason = motivo || null; } return j; });
  }
  /** Um toque em Pendência/Equipe: troca na hora, mantendo o motivo. */
  function trocarPed(n, cls) {
    var s = st('ped'), p = pedPorNumero(n); if (!p || (p.operational_classification || p.classification) === cls || s.trocando) return;
    s.trocando = n; redesenhar();
    gravarPed(n, cls, (p.reason || '').trim()).then(function () { F.toast('Pedido ' + n + ' → ' + nomeCls(cls)); })
      .catch(function (e) { F.toast(e.message); if (e.status === 409) carregarPed(); })
      .then(function () { s.trocando = null; redesenhar(); if (window.carregar) carregar(true); });
  }
  /** Janela de classificação + motivo (um pedido ou vários marcados). */
  function formPed(titulo, sub, cls, motivo, alvo) {
    var sug = motivosUsados();
    X.modal(titulo, sub,
      '<div class="campo"><span>Classificação</span><div class="segm grande" id="mSeg">' + opcoesCls().map(function (c) { return '<button type="button" data-cls="' + F.esc(c) + '" class="' + (c === cls ? 'on ' + (c === 'EQUIPE' ? 'az' : 'la') : '') + '">' + F.esc(nomeCls(c)) + '</button>'; }).join('') + '</div></div>' +
      '<div class="campo"><span>Motivo</span>' + (sug.length ? '<div class="sugs">' + sug.map(function (m) { return '<button type="button" data-sug="' + F.esc(m) + '">' + F.esc(m) + '</button>'; }).join('') + '</div>' : '') +
      '<textarea id="mMot" maxlength="1000" rows="3" placeholder="Escreva ou toque num motivo acima">' + F.esc(motivo || '') + '</textarea></div>',
      [['cancelar', 'Cancelar', 'cl'], ['salvarPed', 'Salvar', 'ro']]).setAttribute('data-n', alvo);
    var m = document.getElementById('mfundo');
    m.setAttribute('data-cls', cls);
    m.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cls],[data-sug]'); if (!b) return;
      if (b.hasAttribute('data-cls')) { var c = b.getAttribute('data-cls'); m.setAttribute('data-cls', c); [].forEach.call(m.querySelectorAll('[data-cls]'), function (x) { x.className = x === b ? 'on ' + (c === 'EQUIPE' ? 'az' : 'la') : ''; }); }
      else { var t = document.getElementById('mMot'); t.value = b.getAttribute('data-sug'); t.focus(); }
    });
  }
  function editarPed(n) {
    var p = pedPorNumero(n); if (!p) return;
    formPed('Pedido ' + F.esc(n), F.esc(p.customer || '') + ' · ' + brl(p.value), p.operational_classification || 'PENDENCIA', p.reason || '', n);
  }
  function salvarPed() {
    var m = document.getElementById('mfundo'), alvo = m.getAttribute('data-n'), cls = m.getAttribute('data-cls'), mot = X.val('mMot').trim(), s = st('ped');
    X.ocupado('salvarPed', true); X.erroModal('');
    if (alvo !== '*') {
      gravarPed(alvo, cls, mot).then(function () { lembrarMotivo(mot); X.fechar(); F.toast('Pedido ' + alvo + ' atualizado no site'); redesenhar(); if (window.carregar) carregar(true); })
        .catch(function (e) { if (e.status === 409) { X.fechar(); F.toast(e.message); carregarPed(); return; } X.ocupado('salvarPed', false); X.erroModal(e.message); });
      return;
    }
    // vários pedidos: um de cada vez, mostrando o andamento
    var nums = Object.keys(s.marc), ok = 0, falhas = [], i = 0;
    function prox() {
      if (i >= nums.length) {
        lembrarMotivo(mot); X.fechar(); s.marc = {}; s.varios = false;
        F.toast(ok + ' pedido(s) atualizados' + (falhas.length ? ' · ' + falhas.length + ' não deu (' + falhas.slice(0, 3).join(', ') + ')' : ''));
        carregarPed(); if (window.carregar) carregar(true); return;
      }
      var n = nums[i++]; X.ocupado('salvarPed', false); X.ocupado('salvarPed', true, 'Salvando ' + i + ' de ' + nums.length + '…');
      gravarPed(n, cls, mot).then(function () { ok++; }).catch(function () { falhas.push(n); }).then(prox);
    }
    prox();
  }
  function lotePed() {
    var s = st('ped'), nums = Object.keys(s.marc); if (!nums.length) return;
    var tot = nums.reduce(function (a, n) { var p = pedPorNumero(n); return a + F.n(p && p.value); }, 0);
    formPed(nums.length + ' pedidos marcados', 'Total ' + brl(tot) + ' · a mesma classificação e o mesmo motivo para todos', 'EQUIPE', '', '*');
  }
  function itensPed(n) {
    var s = st('ped'); s.ab = s.ab || {}; s.prods = s.prods || {};
    s.ab[n] = !s.ab[n]; redesenhar();
    if (s.ab[n] && (s.prods[n] === undefined || s.prods[n] === 'e')) {
      s.prods[n] = 'c';
      X.get('/logistics/pending/orders/' + encodeURIComponent(n)).then(function (j) { s.prods[n] = j; }).catch(function () { s.prods[n] = 'e'; }).then(redesenhar);
    }
  }

  // =====================================================================
  // PEND (itens pendentes)
  // =====================================================================
  var ORD_PEND = [['order_date', 'Data'], ['family', 'Família'], ['order_number', 'Pedido'], ['customer', 'Cliente'], ['network', 'Rede'], ['product', 'Produto'], ['quantity', 'Qtde'], ['value', 'Valor']];
  function carregarPend() {
    var s = st('pend');
    return buscar(s, 'd', '/logistics/pending/items' + X.q({ page: s.pag || 1, page_size: 50, sort_by: s.ord || 'order_date', sort_direction: s.dir || 'asc', search: (s.busca || '').trim(), network: s.rede, family: s.fam }));
  }
  function telaPend() {
    var s = st('pend'); if (s.d == null && !s._cd) carregarPend();
    var d = s.d || {}, sm = d.summary || {}, h = '';
    h += X.k4([['Valor total pendente', s.d ? X.k(sm.pending_value) : '…', s.d ? X.int(sm.item_rows) + ' linhas' : ''], ['Pedidos distintos', s.d ? X.int(sm.distinct_orders) : '…'], ['Redes envolvidas', s.d ? X.int(sm.distinct_networks) : '…'], ['Produtos distintos', s.d ? X.int(sm.distinct_products) : '…']]);
    h += '<input class="busca" id="pendBusca" placeholder="Buscar cliente, produto, pedido, rede ou família" value="' + F.esc(s.busca || '') + '">';
    h += '<div class="sub2">' + sel('pendRede', lista(d.networks), s.rede, 'Todas as redes') + sel('pendFam', lista(d.families), s.fam, 'Todas as famílias') + '</div>';
    h += '<div class="sub2">' + sel('pendOrd', ORD_PEND, s.ord || 'order_date') + sel('pendDir', [['asc', 'Crescente'], ['desc', 'Decrescente']], s.dir || 'asc') + '</div>';
    h += bloco(s, 'd', function (d) {
      var it = lista(d.items);
      if (!it.length) return '<div class="vazio">Nenhum item pendente encontrado.</div>';
      return X.card('', '', it.map(function (i) {
        return '<div class="lin"><div class="c"><b>' + F.esc(i.product) + '</b><span>Pedido ' + F.esc(i.order_number) + ' · ' + F.dataBR(i.order_date) + ' · ' + F.esc(i.customer || '—') + '</span><span>' + F.esc(i.network || 'SEM REDE') + (i.family ? ' · ' + F.esc(i.family) : '') + '</span><span class="bdg la">Pendente</span></div>' +
          '<div class="v">' + brl(i.value) + '<small>' + qtd(i.quantity) + ' un</small></div></div>';
      }).join('') + X.pag('pend', d.page, d.total_pages, X.int(d.total_items) + ' linhas'));
    });
    return h;
  }

  // =====================================================================
  // Valor Pedido
  // =====================================================================
  /** Todos os pedidos (todas as páginas) da busca/ordem atual: para filtrar por data/valor e para a imagem. */
  function vpTodos() {
    var s = st('vp'), ch = JSON.stringify([s.busca || '', s.ord || 'order_date', s.dir || 'desc']);
    if (s.todos && s.todosCh === ch) return Promise.resolve(s.todos);
    if (s.todosP && s.todosCh === ch) return s.todosP;
    s.todosCh = ch;
    var url = function (p) { return '/logistics/pending/order-values' + X.q({ page: p, page_size: 50, sort_by: s.ord || 'order_date', sort_direction: s.dir || 'desc', search: (s.busca || '').trim() }); };
    s.todosP = X.get(url(1)).then(function (j) {
      var tot = Math.min(60, F.n(j.total_pages) || 1), pags = [], itens = lista(j.items);
      for (var p = 2; p <= tot; p++) pags.push(p);
      var lote = function () { if (!pags.length) return Promise.resolve(); return Promise.all(pags.splice(0, 4).map(function (p) { return X.get(url(p)).then(function (r) { return lista(r.items); }); })).then(function (rs) { rs.forEach(function (l) { itens = itens.concat(l); }); return lote(); }); };
      return lote().then(function () { if (s.todosCh === ch) { s.todos = itens; s.todosP = null; } return itens; });
    }).catch(function (e) { s.todosP = null; s.todosCh = ''; throw e; });
    return s.todosP;
  }
  function filtraVp(items) {
    var fx = st('vp').fx || {}, vmin = fx.vmin !== '' && fx.vmin != null ? F.n(fx.vmin) : null, vmax = fx.vmax !== '' && fx.vmax != null ? F.n(fx.vmax) : null;
    return lista(items).filter(function (i) { var dt = String(i.order_date || '').slice(0, 10), v = F.n(i.value);
      return !(fx.ini && dt < fx.ini) && !(fx.fim && dt > fx.fim) && !(vmin != null && v < vmin) && !(vmax != null && v > vmax); });
  }
  function carregarVp() { var s = st('vp'); s.todos = null; if (fxAtivo(s.fx)) vpTodos().then(redesenhar, falhou); return buscar(s, 'd', '/logistics/pending/order-values' + X.q({ page: s.pag || 1, page_size: 50, sort_by: s.ord || 'order_date', sort_direction: s.dir || 'desc', search: (s.busca || '').trim() })); }
  function linhaVp(i) { return '<div class="lin"><div class="c"><b>' + F.esc(i.customer || '—') + '</b><span>Pedido ' + F.esc(i.order_number) + ' · ' + F.dataBR(i.order_date) + '</span><span class="bdg la">Pendente</span></div><div class="v">' + brl(i.value) + '</div></div>'; }
  function telaVp() {
    var s = st('vp'); if (s.d == null && !s._cd) carregarVp();
    var sm = s.d && s.d.summary || {}, h = '';
    h += '<div class="k4" style="grid-template-columns:1fr 1fr 1fr">' + [['Valor total', X.k(sm.total_value)], ['Nº de pedidos', X.int(sm.order_count)], ['Ticket médio', X.k(sm.average_ticket)]].map(function (k) { return '<div class="k"><span>' + k[0] + '</span><b style="font-size:16px">' + (s.d ? k[1] : '…') + '</b></div>'; }).join('') + '</div>';
    h += '<input class="busca" id="vpBusca" placeholder="Buscar pedido ou cliente" value="' + F.esc(s.busca || '') + '">';
    h += '<div class="sub2">' + sel('vpOrd', [['order_date', 'Data'], ['order_number', 'Pedido'], ['customer', 'Cliente'], ['value', 'Valor']], s.ord || 'order_date') + sel('vpDir', [['desc', 'Decrescente'], ['asc', 'Crescente']], s.dir || 'desc') + '</div>';
    var fx = s.fx || {}, ativo = fxAtivo(fx);
    h += '<details class="card"' + (s.abreF || ativo ? ' open' : '') + ' id="vpFx"><summary class="ct" style="cursor:pointer">Filtros' + (ativo ? ' <span class="chip ro" style="display:inline-flex;margin-left:6px">ativos</span>' : '') + '</summary>' +
      '<div class="sub2" style="margin-top:10px">' + X.campo('Data inicial', '<input type="date" id="vpFxIni" value="' + F.esc(fx.ini || '') + '">') + X.campo('Data final', '<input type="date" id="vpFxFim" value="' + F.esc(fx.fim || '') + '">') + '</div>' +
      '<div class="sub2">' + X.campo('Valor mínimo (R$)', '<input type="number" inputmode="decimal" id="vpFxMin" value="' + F.esc(fx.vmin || '') + '" placeholder="0">') + X.campo('Valor máximo (R$)', '<input type="number" inputmode="decimal" id="vpFxMax" value="' + F.esc(fx.vmax || '') + '" placeholder="sem limite">') + '</div>' +
      '<div class="acoes" style="justify-content:flex-start;margin-top:4px"><button class="btn cl mini" data-act="vpFxLimpar">Limpar filtros</button></div></details>';
    h += '<div style="margin:-2px 0 10px"><button class="btn cl mini" data-act="vpPng">' + F.ic('imagem') + ' Gerar imagem (PNG)</button></div>';
    if (ativo) {
      if (!s.todos) return h + X.carregando('Juntando todos os pedidos para filtrar…');
      var fl = filtraVp(s.todos), pg = s.pagF || 1, tp = Math.max(1, Math.ceil(fl.length / 50)), soma = fl.reduce(function (a, i) { return a + F.n(i.value); }, 0);
      if (pg > tp) pg = tp;
      h = h.replace(/<div class="k4"[\s\S]*?<\/div><\/div>/, '<div class="k4" style="grid-template-columns:1fr 1fr 1fr">' + [['Valor filtrado', X.k(soma)], ['Nº de pedidos', X.int(fl.length)], ['Ticket médio', fl.length ? X.k(soma / fl.length) : '—']].map(function (k) { return '<div class="k"><span>' + k[0] + '</span><b style="font-size:16px">' + k[1] + '</b></div>'; }).join('') + '</div>');
      if (!fl.length) return h + '<div class="vazio">Nenhum pedido com esses filtros.</div>';
      return h + X.card('', '', fl.slice((pg - 1) * 50, pg * 50).map(linhaVp).join('') + X.pag('vpF', pg, tp, X.int(fl.length) + ' pedidos'));
    }
    h += bloco(s, 'd', function (d) {
      var it = lista(d.items); if (!it.length) return '<div class="vazio">Nenhum pedido encontrado.</div>';
      return X.card('', '', it.map(linhaVp).join('') +
        X.pag('vp', d.page, d.total_pages, X.int(d.total_items) + ' pedidos'));
    });
    return h;
  }

  // =====================================================================
  // Consulta Produto / Rede
  // =====================================================================
  function rankTab(items) {
    items = lista(items); if (!items.length) return '<div class="vazio2">Nenhum resultado encontrado.</div>';
    return items.map(function (r, i) { return '<div class="lin"><div class="c"><b><span style="color:var(--tx3)">' + (i + 1) + '.</span> ' + F.esc(r.product) + '</b><span>' + qtd(r.quantity) + ' un · ' + X.int(r.distinct_orders) + ' pedidos</span></div><div class="v">' + brl(r.value) + '</div></div>'; }).join('');
  }
  function telaCons() {
    var s = st('cons'), h = '';
    s.modo = s.modo || 'prod';
    h += '<div class="seg"><b data-act="consModo" data-v="prod"' + (s.modo === 'prod' ? ' class="on"' : '') + '>Produto</b><b data-act="consModo" data-v="rede"' + (s.modo === 'rede' ? ' class="on"' : '') + '>Rede</b></div>';
    if (s.modo === 'prod') {
      if (s.sug == null && !s._csug) buscar(s, 'sug', '/logistics/analysis/products' + X.q({ search: (s.busca || '').trim() }));
      h += '<input class="busca" id="consBusca" placeholder="Buscar produto" value="' + F.esc(s.busca || '') + '">';
      h += bloco(s, 'sug', function (sg) { var it = lista(sg.items); return it.length ? sel('consProd', it.slice(0, 200), s.prod, 'Selecione um produto') : '<div class="vazio2">Nenhuma sugestão encontrada.</div>'; });
      if (s.prod) {
        h += bloco(s, 'res', function (r) { return '<div class="k4" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px">' + [['Quantidade total', qtd(r.quantity) + ' un'], ['Valor total', X.k(r.value)], ['Nº de pedidos', X.int(r.distinct_orders)]].map(function (k) { return '<div class="k"><span>' + k[0] + '</span><b style="font-size:16px">' + k[1] + '</b></div>'; }).join('') + '</div>'; });
        h += bloco(s, 'peds', function (p) {
          return X.card('Pedidos com este produto', '', (lista(p.items).map(function (o) { return '<div class="lin"><div class="c"><b>' + F.esc(o.customer || '—') + '</b><span>Pedido ' + F.esc(o.order_number) + ' · ' + F.dataBR(o.order_date) + ' · ' + F.esc(o.network || '') + '</span></div><div class="v">' + brl(o.value) + '<small>' + qtd(o.quantity) + ' un</small></div></div>'; }).join('') || '<div class="vazio2">Nenhum pedido.</div>') +
            X.pag('consPed', p.page, p.total_pages));
        });
      }
      s.rk = s.rk || { ord: 'value', lim: 15 };
      if (s.rank == null && !s._crank) buscar(s, 'rank', '/logistics/analysis/products/ranking' + X.q({ sort_by: s.rk.ord, limit: s.rk.lim }));
      h += X.card('Top produtos', '', '<div class="sub2">' + sel('rkOrd', [['value', 'Valor'], ['quantity', 'Quantidade'], ['orders', 'Pedidos']], s.rk.ord) + sel('rkLim', [5, 15, 20, 50], s.rk.lim) + '</div>' + bloco(s, 'rank', function (r) { return rankTab(r.items); }));
    } else {
      if (s.redes == null && !s._credes) buscar(s, 'redes', '/logistics/analysis/networks');
      h += bloco(s, 'redes', function (r) { return sel('consRede', lista(r.items), s.rede, 'Selecione uma rede'); });
      if (s.rede) {
        h += bloco(s, 'rres', function (r) { return '<div class="k4" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px">' + [['Nº de pedidos', X.int(r.distinct_orders)], ['Valor total', X.k(r.value)], ['Clientes distintos', X.int(r.distinct_customers)]].map(function (k) { return '<div class="k"><span>' + k[0] + '</span><b style="font-size:16px">' + k[1] + '</b></div>'; }).join('') + '</div>'; });
        h += X.card('Produtos mais vendidos na rede', '', bloco(s, 'rprods', function (r) { return rankTab(r.items); }));
      }
    }
    return h;
  }
  function consPedidos() { var s = st('cons'); buscar(s, 'peds', '/logistics/analysis/product/orders' + X.q({ product: s.prod, page: s.pagPed || 1, page_size: 50 })); }

  // =====================================================================
  // Standby (seleções que compõem o valor em standby)
  // =====================================================================
  function carregarSb() {
    var s = st('sb');
    buscar(s, 'sel', '/logistics/standby/selections'); buscar(s, 'sum', '/logistics/standby/summary');
  }
  function opcoesSb() { var s = st('sb'), c = s.cat || 'NETWORK'; buscar(s, 'op', '/logistics/standby/options' + X.q({ category: c, limit: 50, search: ((s.busca || {})[c] || '').trim() })); }
  function telaSb() {
    var s = st('sb'); if (s.sel == null && !s._csel) carregarSb();
    s.cat = s.cat || 'NETWORK'; s.busca = s.busca || {};
    if (s.op == null && !s._cop) opcoesSb();
    var sm = s.sum || {}, h = '';
    h += '<div class="card hero"><div class="lb">Total combinado (sem duplicar)</div><div class="v">' + (s.sum ? X.brl0(sm.combined_value) : '…') + '</div><div class="s"><b>' + X.int(sm.distinct_orders) + '</b> pedidos · <b>' + X.int(sm.active_selections) + '</b> seleções ativas' + (F.n(sm.inactive_selections) ? ' · ' + X.int(sm.inactive_selections) + ' inativas' : '') + '</div>' +
      '<div class="acoes" style="justify-content:flex-start"><button class="btn ro" data-act="sbEnviar">Enviar soma para Relatório</button><button class="btn cl" data-act="sbPng">' + F.ic('imagem') + ' Imagem (PNG)</button></div></div>';
    var sels = lista(s.sel && s.sel.items);
    h += X.abas(CATS.map(function (c) { var n = sels.filter(function (x) { return x.category === c[0]; }).length; return [c[0], c[1] + (n ? ' <small>' + n + '</small>' : '')]; }), s.cat, 'sbcat').replace(/data-sbcat=/g, 'data-act="sbCat" data-v=');
    var cat = CATS.filter(function (c) { return c[0] === s.cat; })[0];
    var ja = {}; sels.forEach(function (x) { if (x.category === s.cat) ja[x.item_value] = 1; });
    h += '<div class="card"><p class="ct">Adicionar ' + cat[2] + '</p><input class="inp" id="sbBusca" placeholder="Buscar ' + cat[2] + '" value="' + F.esc(s.busca[s.cat] || '') + '" style="margin:6px 0 8px">' +
      bloco(s, 'op', function (o) { var it = lista(o.items).filter(function (v) { return !ja[v]; }); return it.length ? sel('sbAdd', it, '', 'Selecione para adicionar') : '<div class="vazio2">Nenhuma sugestão encontrada.</div>'; }) + '</div>';
    h += bloco(s, 'sel', function () {
      var l = sels.filter(function (x) { return x.category === s.cat; });
      return X.card(cat[1] + ' selecionad' + (cat[0] === 'FAMILY' ? 'as' : 'os'), 'O motivo é salvo quando você sai do campo', l.length ? l.map(function (x) {
        return '<div class="lin"><div class="c"><b>' + F.esc(x.item_value) + '</b><span>' + X.int(x.matching_orders) + ' pedidos' + (x.is_active ? '' : ' · <b style="color:var(--tx-laranja)">Sem correspondência na PEND atual</b>') + '</span>' +
          '<input class="inp" data-sbmot="' + x.id + '" id="sbMot' + x.id + '" maxlength="500" placeholder="Motivo" value="' + F.esc(x.reason || '') + '" style="margin-top:6px;padding:7px 10px;font-size:13px"></div>' +
          '<div class="v">' + X.k(x.value) + '<br><button class="lnk ro" data-act="sbRem" data-v="' + x.id + '" style="margin-top:6px">Remover</button></div></div>';
      }).join('') : '<div class="vazio2">Nenhuma seleção.</div>');
    });
    if (window.standbyEvolucao) h += standbyEvolucao();
    return h;
  }
  function sbPorId(id) { return lista(st('sb').sel && st('sb').sel.items).filter(function (x) { return String(x.id) === String(id); })[0]; }
  function sbDepois(msg) { var s = st('sb'); if (msg) F.toast(msg); carregarSb(); s.op = null; opcoesSb(); if (window.carregar) carregar(true); }
  function sbAdd(v) {
    var s = st('sb'); if (!v) return;
    X.enviar('POST', '/logistics/standby/selections', { category: s.cat, item_value: v, reason: null }, 'A seleção foi alterada por outro usuário. Atualize a página.')
      .then(function () { sbDepois('Adicionado ao standby'); }).catch(function (e) { falhou(e); redesenhar(); });
  }
  function sbMotivo(id, txt) {
    var x = sbPorId(id); if (!x || (x.reason || '') === txt) return;
    X.enviar('PUT', '/logistics/standby/selections/' + id, { reason: txt, updated_at: x.updated_at }, 'A seleção foi alterada por outro usuário. Atualize a página.')
      .then(function (j) { if (j) { x.reason = j.reason; x.updated_at = j.updated_at; } F.toast('Motivo salvo'); }).catch(function (e) { falhou(e); carregarSb(); });
  }
  function sbRem(id) {
    var x = sbPorId(id); if (!x) return;
    X.modal('Remover do standby?', F.esc(x.item_value) + ' · ' + X.k(x.value), '', [['cancelar', 'Cancelar', 'cl'], ['sbRemOk', 'Remover', 'ro']]).setAttribute('data-n', id);
  }
  function sbRemOk() {
    var id = document.getElementById('mfundo').getAttribute('data-n'); X.ocupado('sbRemOk', true, 'Removendo…');
    X.enviar('DELETE', '/logistics/standby/selections/' + id).then(function () { X.fechar(); sbDepois('Removido do standby'); }).catch(function (e) { X.ocupado('sbRemOk', false); X.erroModal(e.message); });
  }
  function sbEnviar() {
    var sm = st('sb').sum || {};
    X.modal('Enviar soma para o Relatório?', 'Cria uma foto (snapshot) do standby de agora no Relatório do site.', '<div class="det">Standby: <b>' + F.brl(sm.combined_value) + '</b> · ' + X.int(sm.distinct_orders) + ' pedidos</div>',
      [['cancelar', 'Cancelar', 'cl'], ['sbEnviarOk', 'Enviar', 'ro']]);
  }
  function sbEnviarOk() {
    X.ocupado('sbEnviarOk', true, 'Enviando…');
    X.enviar('POST', '/logistics/report/snapshots').then(function (j) { X.fechar(); F.toast('Snapshot #' + (j && j.id != null ? j.id : '') + ' enviado ao Relatório.'); st('rel').snaps = null; if (window.carregar) carregar(true); })
      .catch(function (e) { X.ocupado('sbEnviarOk', false); X.erroModal(e.message); });
  }

  // =====================================================================
  // Relatório (snapshots e listas de produtos em produção / sem estoque)
  // =====================================================================
  function carregarRel() { var s = st('rel'); buscar(s, 'snaps', '/logistics/report/snapshots'); buscar(s, 'prods', '/logistics/report/products'); }
  function opcoesRel() { var s = st('rel'); buscar(s, 'op', '/logistics/report/products/options' + X.q({ limit: 50, search: (s.busca || '').trim() })); }
  function telaRel() {
    var s = st('rel'); if (s.snaps == null && !s._csnaps) carregarRel();
    if (s.op == null && !s._cop) opcoesRel();
    var h = '';
    h += bloco(s, 'snaps', function (sn) {
      var it = lista(sn.items); if (!it.length) return '<div class="vazio">Nenhum snapshot disponível. <button class="lnk" data-act="irAba" data-v="sb">Ir para Standby</button></div>';
      var atual = it.filter(function (x) { return String(x.id) === String(s.snap); })[0] || it[0];
      return '<label class="campo"><span>Histórico de snapshots</span>' + sel('relSnap', it.map(function (x) { return [x.id, '#' + x.id + ' · ' + X.dh(x.created_at)]; }), atual.id) + '</label>' +
        X.k4([['PEND no snapshot', X.k(atual.pending_total_at_snapshot)], ['Standby', X.k(atual.standby_value), '', 'lar'], ['PEND da equipe', X.k(atual.team_pending)], ['Pedidos no Standby', X.int(atual.standby_distinct_orders)]]) +
        '<p class="cs" style="margin:-4px 0 8px">Enviado em ' + X.dh(atual.created_at) + ' por ' + F.esc(atual.created_by || '—') + '. Snapshot imutável.</p>' +
        '<button class="btn cl" data-act="relPng" style="width:100%;margin-bottom:12px">' + F.ic('imagem') + ' Gerar imagem do Relatório (PNG)</button>';
    });
    h += '<div class="card"><p class="ct">Listas operacionais de produtos</p><p class="cs">Adicione um produto da PEND em "Em produção" ou "Sem estoque"</p><input class="inp" id="relBusca" placeholder="Buscar produto" value="' + F.esc(s.busca || '') + '" style="margin-bottom:8px">' +
      bloco(s, 'op', function (o) { var it = lista(o.items); return it.length ? sel('relProd', it, s.prodSel, 'Selecione para adicionar') : '<div class="vazio2">Nenhuma sugestão encontrada.</div>'; }) +
      '<div class="acoes" style="justify-content:flex-start"><button class="btn az" data-act="relAdd" data-v="IN_PRODUCTION">＋ Em produção</button><button class="btn pe" data-act="relAdd" data-v="OUT_OF_STOCK">＋ Sem estoque</button></div></div>';
    h += bloco(s, 'prods', function (p) {
      var it = lista(p.items), sub = {}; lista(p.subtotals).forEach(function (x) { sub[x.status] = x; });
      return ['IN_PRODUCTION', 'OUT_OF_STOCK'].map(function (stt) {
        var l = it.filter(function (x) { return x.status === stt; }), sb = sub[stt] || {};
        return X.card(RELST[stt], 'Subtotal atual: ' + F.brl(sb.value) + ' · ' + X.int(sb.distinct_products) + ' produtos', l.length ? l.map(function (x) {
          return '<div class="lin"><div class="c"><b>' + F.esc(x.product) + '</b><span>' + qtd(x.quantity) + ' un · ' + X.k(x.value) + ' · ' + X.int(x.distinct_orders) + ' pedidos</span>' + (x.unit_value != null ? '<span>Valor unitário: ' + F.brl(x.unit_value) + '</span>' : '') +
            (x.is_active ? '' : '<span style="color:var(--tx-laranja);font-weight:600">Fora da PEND atual</span>') +
            '<div class="ac2"><button class="lnk" data-act="relMover" data-v="' + x.id + '">Mover para ' + RELST[stt === 'IN_PRODUCTION' ? 'OUT_OF_STOCK' : 'IN_PRODUCTION'] + '</button><button class="lnk ro" data-act="relRem" data-v="' + x.id + '">Remover</button></div></div></div>';
        }).join('') : '<div class="vazio2">Nenhum produto classificado.</div>');
      }).join('');
    });
    return h;
  }
  function relPorId(id) { return lista(st('rel').prods && st('rel').prods.items).filter(function (x) { return String(x.id) === String(id); })[0]; }
  function relDepois(m) { F.toast(m); var s = st('rel'); buscar(s, 'prods', '/logistics/report/products'); s.op = null; opcoesRel(); }
  function relAdd(status) {
    var p = X.val('relProd'); if (!p) { F.toast('Escolha um produto na lista'); return; }
    X.enviar('POST', '/logistics/report/products', { product: p, status: status }).then(function () { st('rel').prodSel = ''; relDepois('Adicionado em ' + RELST[status]); }).catch(falhou);
  }
  function relMover(id) {
    var x = relPorId(id); if (!x) return; var novo = x.status === 'IN_PRODUCTION' ? 'OUT_OF_STOCK' : 'IN_PRODUCTION';
    X.enviar('PUT', '/logistics/report/products/' + id, { status: novo, updated_at: x.updated_at }).then(function () { relDepois('Movido para ' + RELST[novo]); }).catch(function (e) { falhou(e); relDepois(''); });
  }
  function relRem(id) {
    var x = relPorId(id); if (!x) return;
    X.modal('Remover da lista?', F.esc(x.product) + ' · ' + RELST[x.status], '', [['cancelar', 'Cancelar', 'cl'], ['relRemOk', 'Remover', 'ro']]).setAttribute('data-n', id);
  }
  function relRemOk() {
    var id = document.getElementById('mfundo').getAttribute('data-n'); X.ocupado('relRemOk', true, 'Removendo…');
    X.enviar('DELETE', '/logistics/report/products/' + id).then(function () { X.fechar(); relDepois('Removido da lista'); }).catch(function (e) { X.ocupado('relRemOk', false); X.erroModal(e.message); });
  }

  // =====================================================================
  // Faturamento: Diário (com regras próprias) e Relatório pedido → NF (com exclusões)
  // =====================================================================
  function telaFat() {
    var s = st('fat'); s.sub = s.sub || 'dia';
    var h = X.abas([['dia', 'Faturamento Diário'], ['nf', 'Relatório (pedido → NF)']], s.sub, 'fsub').replace(/data-fsub=/g, 'data-act="fatSub" data-v=');
    return h + (s.sub === 'dia' ? telaDia() : telaNf());
  }
  // ---- Diário ----
  function urlDia() {
    var s = st('dia'), f = s.f || {};
    return '/logistics/billing/daily' + X.q({ start_date: f.ini, end_date: f.fim, customer_code: f.cli, city: f.cid, seller: f.ven, order_type: f.tipo, selected_date: s.dia });
  }
  function carregarDia() { var s = st('dia'); return buscar(s, 'd', urlDia()); }
  function telaDia() {
    var s = st('dia'); s.f = s.f || {};
    if (s.op == null && !s._cop) buscar(s, 'op', '/logistics/billing/daily/options');
    if (s.d == null && !s._cd) carregarDia();
    if (s.ex == null && !s._cex) buscar(s, 'ex', '/logistics/billing/daily/exclusions');
    var h = '', op = s.op || {}, f = s.f;
    if (window.faturamentoHoje) h += faturamentoHoje();
    if (!h) h += '<div class="acoes" style="justify-content:flex-start;margin:0 0 10px"><button class="btn ro" data-act="diaPng">' + F.ic('imagem') + ' Gerar imagem do faturamento (PNG)</button></div>';
    h += '<details class="card"' + (s.abreF ? ' open' : '') + ' id="diaFiltros"><summary class="ct" style="cursor:pointer">Filtros</summary>' +
      '<div class="sugs" style="margin-top:10px">' + [['hoje', 'Hoje'], ['7', 'Últimos 7 dias'], ['mes', 'Este mês'], ['ant', 'Mês passado']].map(function (p) { return '<button data-act="diaPer" data-v="' + p[0] + '"' + (s.per === p[0] ? ' class="on"' : '') + '>' + p[1] + '</button>'; }).join('') + '</div><div class="sub2">' +
      X.campo('Data inicial', '<input type="date" id="diaIni" value="' + F.esc(f.ini || '') + '"' + (op.minimum_date ? ' min="' + op.minimum_date + '"' : '') + (op.maximum_date ? ' max="' + op.maximum_date + '"' : '') + '>') +
      X.campo('Data final', '<input type="date" id="diaFim" value="' + F.esc(f.fim || '') + '"' + (op.minimum_date ? ' min="' + op.minimum_date + '"' : '') + (op.maximum_date ? ' max="' + op.maximum_date + '"' : '') + '>') + '</div>' +
      X.campo('Cliente', '<select id="diaCli">' + X.opcoes(lista(op.customers).map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), f.cli, 'Todos') + '</select>') +
      '<div class="sub2 t3">' + X.campo('Cidade', '<select id="diaCid">' + X.opcoes(lista(op.cities), f.cid, 'Todas') + '</select>') + X.campo('Vendedor', '<select id="diaVen">' + X.opcoes(lista(op.sellers), f.ven, 'Todos') + '</select>') +
      X.campo('Tipo de operação', '<select id="diaTipo">' + X.opcoes(lista(op.order_types), f.tipo, 'Todos') + '</select>') + '</div>' +
      '<button class="btn cl mini" data-act="diaLimpar">Limpar filtros</button></details>';
    h += bloco(s, 'd', function (d) {
      var dias = lista(d.days).slice().sort(function (a, b) { return a.invoice_date < b.invoice_date ? -1 : 1; }), dia = d.selected_day || d.latest_day, r = '';
      // quanto faturou nas datas escolhidas (soma dos dias do período filtrado)
      var somaP = dias.reduce(function (a, x) { return a + F.n(x.total_value); }, 0), pedP = dias.reduce(function (a, x) { return a + F.n(x.order_count); }, 0), fp = s.f || {};
      var ini = fp.ini || (dias[0] && dias[0].invoice_date), fim = fp.fim || (dias.length && dias[dias.length - 1].invoice_date);
      r += '<div class="card hero"><div class="lb">Faturado no período' + (ini ? ' · ' + F.dataBR(ini) + ' a ' + F.dataBR(fim) : '') + '</div><div class="v">' + X.brl0(somaP) + '</div><div class="s"><b>' + X.int(pedP) + '</b> pedidos em <b>' + dias.length + '</b> dia' + (dias.length === 1 ? '' : 's') + ' com faturamento</div></div>';
      r += X.k4([['Média diária faturada', X.k(d.daily_average)], ['Dia mais recente', d.latest_day ? X.k(d.latest_day.total_value) : '—', d.latest_day ? F.dataBR(d.latest_day.invoice_date) + ' · ' + X.int(d.latest_day.order_count) + ' pedidos' : ''],
        ['Regras ativas', X.int(d.active_exclusion_rules), 'só deste indicador'], ['Pedidos excluídos', X.int(d.excluded_orders_count)]]);
      var ult = dias.slice(-30);
      if (ult.length) r += X.card('Faturamento diário (R$)', 'Últimos ' + ult.length + ' dias com faturamento · toque num dia abaixo para ver o detalhe', X.colunas(ult.map(function (x) { return F.n(x.total_value); }), function (i) { return i % 5 === 0 || i === ult.length - 1 ? X.dm(ult[i].invoice_date) : ''; },
        F.n(d.daily_average), 'média ' + X.k(d.daily_average) + '/dia', ult.map(function (x) { return dia && x.invoice_date === dia.invoice_date ? 'var(--rosa)' : 'var(--azul)'; }),
        ult.map(function (x) { return '<b>' + F.dataBR(x.invoice_date) + '</b><br>' + F.brl(x.total_value) + (x.order_count != null ? '<br>' + X.int(x.order_count) + ' pedidos' : ''); })));
      if (dia) {
        var idx = dias.map(function (x) { return x.invoice_date; }).indexOf(dia.invoice_date);
        r += '<div class="card"><div style="display:flex;gap:8px;align-items:center"><button class="btn cl mini" data-act="diaIr" data-v="' + (idx > 0 ? dias[idx - 1].invoice_date : '') + '"' + (idx > 0 ? '' : ' disabled') + '>‹</button>' +
          sel('diaSel', dias.slice().reverse().map(function (x) { return [x.invoice_date, F.dataBR(x.invoice_date) + ' · ' + X.k(x.total_value)]; }), dia.invoice_date) +
          '<button class="btn cl mini" data-act="diaIr" data-v="' + (idx >= 0 && idx < dias.length - 1 ? dias[idx + 1].invoice_date : '') + '"' + (idx >= 0 && idx < dias.length - 1 ? '' : ' disabled') + '>›</button></div>' +
          '<div class="hero" style="margin-top:12px"><div class="lb">Dia selecionado · ' + F.dataBR(dia.invoice_date) + '</div><div class="v">' + X.brl0(dia.total_value) + '</div><div class="s"><b>' + X.int(dia.order_count) + '</b> pedidos faturados · ' + lista(dia.types).length + ' tipos</div></div>' +
          '<p class="ct" style="margin-top:14px">Resumo por tipo de operação</p>' + lista(dia.types).map(function (t, i) {
            var k = dia.invoice_date + '|' + i, ab = s.abT && s.abT[k];
            return '<div class="lin" data-act="diaTipoAb" data-v="' + F.esc(k) + '" style="cursor:pointer"><div class="c"><b>' + F.esc(t.order_type_label) + '</b><span>' + X.int(t.order_count) + ' pedidos · ' + Math.round(F.n(t.day_percentage)) + '% do dia · ' + (ab ? 'ocultar' : 'ver pedidos') + '</span>' +
              (ab ? '<div class="itens2">' + lista(t.orders).map(function (o) { return '<div class="row"><span>' + F.esc(o.customer_name || '—') + '<br><small style="color:var(--tx3)">Pedido ' + F.esc(o.order_number) + ' · NF ' + F.esc(o.invoice_number) + (o.city_name ? ' · ' + F.esc(o.city_name) : '') + (o.carrier_name ? ' · ' + F.esc(o.carrier_name) : '') + '</small></span><b>' + brl(o.order_value) + '</b></div>'; }).join('') + '</div>' : '') +
              '</div><div class="v">' + X.k(t.value) + '</div></div>';
          }).join('') + '</div>';
      } else r += '<div class="vazio">Nenhum faturamento encontrado.</div>';
      return r;
    });
    // regras deste indicador
    h += bloco(s, 'ex', function (ex) {
      var exc = {}; lista(ex.excluded_order_types).forEach(function (t) { exc[t.order_type_code] = 1; });
      var buscaC = (s.buscaCli || '').trim().toLowerCase(), clis = lista(op.customers).filter(function (c) { return !buscaC || ((c.customer_name || '') + ' ' + c.customer_code).toLowerCase().indexOf(buscaC) >= 0; }).slice(0, 80);
      return X.card('Regras de inclusão/exclusão', 'Só deste indicador (não mexe no Relatório Faturamento)',
        '<p class="ct" style="font-size:13.5px;margin-top:6px">Clientes excluídos aqui</p><input class="inp" id="diaBuscaCli" placeholder="Busque por nome ou código" value="' + F.esc(s.buscaCli || '') + '" style="margin:6px 0">' +
        '<div style="display:flex;gap:8px">' + sel('diaAddCli', clis.map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), '', 'Selecione...') + '<button class="btn ro" data-act="diaAddCli">' + rotMulti(s, 'diaAddCli', 'Adicionar', 'Adicionar') + '</button></div>' + chipsMulti(s, 'diaAddCli') +
        barraRem(s, 'dia:customers', lista(ex.excluded_customers).map(function (c) { return String(c.customer_code); })) +
        lista(ex.excluded_customers).map(function (c) { return '<div class="x" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--ln);font-size:13px">' + ckRem(s, 'dia:customers', c.customer_code) + '<span style="flex:1">' + F.esc(c.customer_name || 'Sem nome') + ' · cód. ' + F.esc(c.customer_code) + '</span><button class="lnk ro" data-act="diaRem" data-t="customers" data-v="' + F.esc(c.customer_code) + '">Remover</button></div>'; }).join('') +
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Tipos incluídos/excluídos aqui</p>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' + sel('diaAddTipo', lista(op.exclusion_order_types).filter(function (t) { return !exc[t.order_type_code]; }).map(function (t) { return [t.order_type_code, t.order_type_label]; }), '', 'Selecione...') + '<button class="btn ro" data-act="diaAddTipo">' + rotMulti(s, 'diaAddTipo', 'Adicionar', 'Adicionar') + '</button></div>' + chipsMulti(s, 'diaAddTipo') +
        barraRem(s, 'dia:order-types', lista(ex.excluded_order_types).map(function (t) { return String(t.order_type_code); })) +
        lista(ex.excluded_order_types).map(function (t) { return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--ln);font-size:13px">' + ckRem(s, 'dia:order-types', t.order_type_code) + '<span style="flex:1">' + F.esc(t.order_type_label) + '</span><button class="lnk ro" data-act="diaRem" data-t="order-types" data-v="' + F.esc(t.order_type_code) + '">Remover</button></div>'; }).join(''));
    });
    return h;
  }
  function diaDepois(m) { var s = st('dia'); F.toast(m); buscar(s, 'ex', '/logistics/billing/daily/exclusions'); carregarDia(); }
  function diaAdd(tipo) {
    var id = tipo === 'customers' ? 'diaAddCli' : 'diaAddTipo', vals = valoresMulti(id); if (!vals.length) { F.toast('Escolha na lista primeiro'); return; }
    emSerie(vals, function (v) { return X.enviar('POST', '/logistics/billing/daily/exclusions/' + tipo, tipo === 'customers' ? { customer_code: v } : { order_type_code: v }); })
      .then(function (r) { st('dia').mc[id] = []; diaDepois(vals.length === 1 && r.ok ? 'Regra adicionada' : msgSerie(r, 'adicionados')); });
  }
  function diaRem(tipo, v) { X.enviar('DELETE', '/logistics/billing/daily/exclusions/' + tipo + '/' + encodeURIComponent(v)).then(function () { diaDepois('Regra removida'); }).catch(falhou); }
  function diaFiltro() {
    var s = st('dia'); s.f = { ini: X.val('diaIni'), fim: X.val('diaFim'), cli: X.val('diaCli'), cid: X.val('diaCid'), ven: X.val('diaVen'), tipo: X.val('diaTipo') };
    if (s.f.ini && s.f.fim && s.f.ini > s.f.fim) { F.toast('A data inicial é depois da final'); return; }
    s.dia = ''; s.per = ''; s.abreF = true; carregarDia();
  }
  // ---- Relatório pedido → NF ----
  var ORD_NF = [['order_date', 'Data'], ['order_number', 'Pedido'], ['customer', 'Cliente'], ['city', 'Cidade'], ['order_type', 'Tipo'], ['order_value', 'Valor'], ['pending_days', 'Dias em pendência']];
  function urlNf() {
    var s = st('nf'), f = s.f || {};
    return '/logistics/billing/report' + X.q({ page: s.pag || 1, page_size: 50, sort_by: s.ord || 'order_date', sort_direction: s.dir || 'asc', start_date: f.ini, end_date: f.fim, customer: f.cli, city: f.cid, seller: f.ven, order_type: f.tipo, analytical_status: f.st, search: (s.busca || '').trim() });
  }
  function carregarNf() { buscar(st('nf'), 'd', urlNf()); }
  function telaNf() {
    var s = st('nf'); s.f = s.f || {};
    if (s.op == null && !s._cop) buscar(s, 'op', '/logistics/billing/report/options');
    if (s.d == null && !s._cd) carregarNf();
    if (s.ex == null && !s._cex) buscar(s, 'ex', '/logistics/billing/report/exclusions');
    var op = s.op || {}, f = s.f, h = '';
    h += '<details class="card"' + (s.abreF ? ' open' : '') + '><summary class="ct" style="cursor:pointer">Filtros</summary><div class="sub2" style="margin-top:10px">' +
      X.campo('Data inicial', '<input type="date" id="nfIni" value="' + F.esc(f.ini || '') + '">') + X.campo('Data final', '<input type="date" id="nfFim" value="' + F.esc(f.fim || '') + '">') + '</div>' +
      '<div class="sub2">' + X.campo('Cliente', '<select id="nfCli">' + X.opcoes(lista(op.customers), f.cli, 'Todos') + '</select>') + X.campo('Cidade', '<select id="nfCid">' + X.opcoes(lista(op.cities), f.cid, 'Todas') + '</select>') + '</div>' +
      '<div class="sub2 t3">' + X.campo('Vendedor', '<select id="nfVen">' + X.opcoes(lista(op.sellers), f.ven, 'Todos') + '</select>') + X.campo('Tipo', '<select id="nfTipo">' + X.opcoes(lista(op.order_types), f.tipo, 'Todos') + '</select>') +
      X.campo('Status', '<select id="nfSt">' + X.opcoes(lista(op.analytical_statuses).map(function (x) { return [x, STATUS_NF[x] || x]; }), f.st, 'Todos') + '</select>') + '</div>' +
      '<button class="btn cl mini" data-act="nfLimpar">Limpar filtros</button></details>';
    // regras de exclusão
    h += bloco(s, 'ex', function (ex) {
      var sug = lista(s.sug && s.sug.items);
      return '<details class="card"' + (s.abreEx ? ' open' : '') + ' id="nfEx"><summary class="ct" style="cursor:pointer">Regras de exclusão <span class="cs" style="font-weight:500">· ' + X.int(s.d && s.d.summary && s.d.summary.active_exclusion_rules) + ' regras ativas · ' + X.int(s.d && s.d.summary && s.d.summary.excluded_orders_count) + ' pedidos excluídos</span></summary>' +
        '<p class="ct" style="font-size:13.5px;margin-top:10px">Pedido específico</p><input class="inp" id="nfPedBusca" placeholder="Digite o pedido" value="' + F.esc(s.pedBusca || '') + '" style="margin:6px 0">' +
        (sug.length ? sel('nfPedSel', sug.map(function (o) { return [o.order_number, o.order_number + (o.customer_name ? ' · ' + o.customer_name : '')]; }), s.pedSel, 'Escolha o pedido') : (s.pedBusca ? '<div class="vazio2">Nenhum pedido encontrado.</div>' : '')) +
        '<input class="inp" id="nfPedMot" placeholder="Motivo" value="' + F.esc(s.pedMot || '') + '" style="margin:6px 0"><button class="btn ro" data-act="nfExPed">Excluir pedido</button>' +
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Cliente</p><div style="display:flex;gap:8px;margin-top:6px">' + sel('nfExCli', lista(op.exclusion_customers).map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), '', 'Selecione') + '<button class="btn ro" data-act="nfExCli">' + rotMulti(s, 'nfExCli', 'Excluir cliente', 'Excluir clientes') + '</button></div>' + chipsMulti(s, 'nfExCli') +
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Tipo de operação</p><div style="display:flex;gap:8px;margin-top:6px">' + sel('nfExTipo', lista(op.exclusion_order_types).map(function (t) { return [t.order_type_code, t.order_type_label]; }), '', 'Selecione') + '<button class="btn ro" data-act="nfExTipo">' + rotMulti(s, 'nfExTipo', 'Excluir tipo', 'Excluir tipos') + '</button></div>' + chipsMulti(s, 'nfExTipo') +
        '<p class="ct" style="font-size:13.5px;margin-top:16px">Pedidos excluídos</p>' + barraRem(s, 'nf:orders', lista(ex.excluded_orders).map(function (o) { return String(o.order_number); })) + (lista(ex.excluded_orders).map(function (o) { return '<div class="lin">' + ckRem(s, 'nf:orders', o.order_number) + '<div class="c"><b>' + F.esc(o.order_number) + ' · ' + F.esc(o.customer_name || '—') + '</b><span>' + F.esc(o.reason) + ' · Atualizado em ' + X.dh(o.updated_at) + '</span></div><button class="lnk ro" data-act="nfRem" data-t="orders" data-v="' + F.esc(o.order_number) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
        '<p class="ct" style="font-size:13.5px;margin-top:12px">Clientes excluídos</p>' + barraRem(s, 'nf:customers', lista(ex.excluded_customers).map(function (c) { return String(c.customer_code); })) + (lista(ex.excluded_customers).map(function (c) { return '<div class="lin">' + ckRem(s, 'nf:customers', c.customer_code) + '<div class="c"><b>' + F.esc(c.customer_name || 'Sem nome') + '</b><span>cód. ' + F.esc(c.customer_code) + '</span></div><button class="lnk ro" data-act="nfRem" data-t="customers" data-v="' + F.esc(c.customer_code) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
        '<p class="ct" style="font-size:13.5px;margin-top:12px">Tipos excluídos</p>' + barraRem(s, 'nf:order-types', lista(ex.excluded_order_types).map(function (t) { return String(t.order_type_code); })) + (lista(ex.excluded_order_types).map(function (t) { return '<div class="lin">' + ckRem(s, 'nf:order-types', t.order_type_code) + '<div class="c"><b>' + F.esc(t.order_type_label) + '</b></div><button class="lnk ro" data-act="nfRem" data-t="order-types" data-v="' + F.esc(t.order_type_code) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
        '</details>';
    });
    h += bloco(s, 'd', function (d) {
      var sm = d.summary || {}, r = '', velho = sm.oldest_pending_order;
      r += X.k4([['Total pedidos', X.int(sm.total_orders)], ['Faturados', X.int(sm.billed_orders), '', 'pos'], ['Pendentes', X.int(sm.pending_orders), '', 'lar'], ['Taxa de faturamento', F.um(F.n(sm.billing_rate) * 100, 1) + '%', X.int(sm.cancelled_orders) + ' cancelados']]);
      r += X.k4([['Tempo médio até faturar', sm.average_billing_days_calendar != null ? F.um(F.n(sm.average_billing_days_calendar), 1) + ' dias' : '—', 'dias corridos'], ['Tempo máximo até faturar', sm.maximum_billing_days_calendar != null ? sm.maximum_billing_days_calendar + ' dias' : '—', 'dias corridos'],
        ['Tempo médio em pendência', sm.average_pending_days != null ? F.um(F.n(sm.average_pending_days), 1) + ' dias' : '—', 'dias corridos'], ['Pendente mais antigo', velho ? velho.pending_days + ' dias' : '—', velho ? 'Pedido ' + F.esc(velho.order_number) + ' · ' + F.esc(velho.customer_name || '') : '', velho ? 'neg' : '']]);
      var sd = lista(d.status_distribution), td = lista(d.order_type_distribution);
      if (sd.length) r += X.card('Status dos pedidos', '', X.barras(sd.map(function (x) { return [x.label, x.count]; }), 'var(--azul)', X.int));
      if (td.length) r += X.card('Por tipo de operação', '', X.barras(td.map(function (x) { return [x.label, x.count]; }), 'var(--violeta)', X.int));
      r += '<div class="card"><p class="ct">Pedidos pendentes há mais tempo</p><p class="cs">Pedidos mais antigos primeiro</p><input class="inp" id="nfBusca" placeholder="Buscar pedido ou cliente" value="' + F.esc(s.busca || '') + '" style="margin-bottom:8px">' +
        '<div class="sub2">' + sel('nfOrd', ORD_NF, s.ord || 'order_date') + sel('nfDir', [['asc', 'Crescente'], ['desc', 'Decrescente']], s.dir || 'asc') + '</div>' +
        (lista(d.pending_items).map(function (o) { return '<div class="lin"><div class="c"><b>' + F.esc(o.customer_name || '—') + '</b><span>Pedido ' + F.esc(o.order_number) + ' · ' + F.dataBR(o.order_date) + (o.city_name ? ' · ' + F.esc(o.city_name) : '') + '</span><span>' + F.esc(o.order_type_label) + '</span></div><div class="v">' + (o.order_value != null ? brl(o.order_value) : '—') + '<small>' + (o.pending_days != null ? o.pending_days + ' dias' : '') + '</small></div></div>'; }).join('') || '<div class="vazio2">Nenhum pedido pendente.</div>') +
        X.pag('nf', d.page, d.total_pending_pages, X.int(d.total_pending_items) + ' pedidos') + '</div>';
      return r;
    });
    return h;
  }
  function nfDepois(m) { var s = st('nf'); F.toast(m); s.abreEx = true; buscar(s, 'ex', '/logistics/billing/report/exclusions'); carregarNf(); }
  function nfEx(tipo) {
    var s = st('nf'), corpo;
    if (tipo === 'orders') {
      var n = X.val('nfPedSel'), mot = X.val('nfPedMot').trim();
      if (!n) { F.toast('Escolha o pedido na lista'); return; } if (!mot) { F.toast('Informe o motivo da exclusão do pedido.'); return; }
      corpo = { order_number: n, reason: mot };
    } else {
      var id = tipo === 'customers' ? 'nfExCli' : 'nfExTipo', vals = valoresMulti(id);
      if (!vals.length) { F.toast(tipo === 'customers' ? 'Escolha o cliente' : 'Escolha o tipo'); return; }
      emSerie(vals, function (v) { return X.enviar('POST', '/logistics/billing/report/exclusions/' + tipo, tipo === 'customers' ? { customer_code: v } : { order_type_code: v }); })
        .then(function (r) { s.mc[id] = []; nfDepois(vals.length === 1 && r.ok ? 'Exclusão salva no site' : msgSerie(r, 'excluídos')); });
      return;
    }
    X.enviar('POST', '/logistics/billing/report/exclusions/' + tipo, corpo).then(function () { if (tipo === 'orders') { s.pedBusca = ''; s.pedMot = ''; s.pedSel = ''; s.sug = null; } nfDepois('Exclusão salva no site'); }).catch(falhou);
  }
  function nfRem(tipo, v) { X.enviar('DELETE', '/logistics/billing/report/exclusions/' + tipo + '/' + encodeURIComponent(v)).then(function () { nfDepois('Exclusão removida'); }).catch(falhou); }
  function nfFiltro() {
    var s = st('nf'); s.f = { ini: X.val('nfIni'), fim: X.val('nfFim'), cli: X.val('nfCli'), cid: X.val('nfCid'), ven: X.val('nfVen'), tipo: X.val('nfTipo'), st: X.val('nfSt') };
    s.pag = 1; s.abreF = true; carregarNf();
  }

  // =====================================================================
  // Conferência
  // =====================================================================
  function urlConf() { var s = st('conf'), f = s.f || {}; return '/logistics/conference' + X.q({ start_date: f.ini, end_date: f.fim, conference_user: f.us, conference_status: f.cs, billing_status: f.bs, search: (s.busca || '').trim(), page: s.pag || 1, page_size: 50 }); }
  function carregarConf() { buscar(st('conf'), 'd', urlConf()); }
  function telaConf() {
    var s = st('conf'); s.f = s.f || {};
    if (s.op == null && !s._cop) buscar(s, 'op', '/logistics/conference/options');
    if (s.d == null && !s._cd) carregarConf();
    var op = s.op || {}, f = s.f, h = '', mn = op.minimum_date ? String(op.minimum_date).slice(0, 10) : '', mx = op.maximum_date ? String(op.maximum_date).slice(0, 10) : '';
    h += '<details class="card"' + (s.abreF ? ' open' : '') + '><summary class="ct" style="cursor:pointer">Filtros</summary><div class="sub2" style="margin-top:10px">' +
      X.campo('Data inicial', '<input type="date" id="cfIni" value="' + F.esc(f.ini || '') + '"' + (mn ? ' min="' + mn + '"' : '') + (mx ? ' max="' + mx + '"' : '') + '>') +
      X.campo('Data final', '<input type="date" id="cfFim" value="' + F.esc(f.fim || '') + '"' + (mn ? ' min="' + mn + '"' : '') + (mx ? ' max="' + mx + '"' : '') + '>') + '</div>' +
      '<div class="sub2 t3">' + X.campo('Conferente', '<select id="cfUs">' + X.opcoes(lista(op.conference_users).map(String), f.us, 'Todos') + '</select>') +
      X.campo('Conferência', '<select id="cfCs">' + X.opcoes(lista(op.conference_statuses).map(function (x) { return [x, CONF[x] || x]; }), f.cs, 'Todos') + '</select>') +
      X.campo('Faturamento', '<select id="cfBs">' + X.opcoes(lista(op.billing_statuses).map(function (x) { return [x, FATS[x] || x]; }), f.bs, 'Todos') + '</select>') + '</div>' +
      '<p class="cs">O período considera a data do pedido.</p><button class="btn cl mini" data-act="cfLimpar">Limpar filtros</button></details>';
    h += '<input class="busca" id="cfBusca" placeholder="Pedido, cliente ou código" value="' + F.esc(s.busca || '') + '">';
    h += bloco(s, 'd', function (d) {
      var o = d.overview || {}, r = '';
      r += X.k4([['Conferências finalizadas', X.int(o.finalized), '', 'pos'], ['Em conferência', X.int(o.in_progress), '', 'lar'], ['Conferidos não faturados', X.int(o.finalized_not_billed), '', F.n(o.finalized_not_billed) ? 'neg' : ''], ['Sem registro de conferência', X.int(o.without_conference_record)],
        ['Tempo médio', X.tempo(o.average_duration_seconds)], ['Tempo mediano', X.tempo(o.median_duration_seconds)]]);
      var pr = lista(d.productivity);
      if (pr.length) r += X.card('Produtividade por conferente', 'Pedidos finalizados · tempo médio · mediana', X.barras(pr.map(function (p) { return [p.conference_user_name || p.conference_user_code || '—', F.n(p.finalized_orders), null, X.tempo(p.average_duration_seconds) + ' · med. ' + X.tempo(p.median_duration_seconds)]; }), 'var(--verde)', X.int));
      r += X.card('Pedidos', X.int(d.total_orders) + ' pedidos', (lista(d.orders).map(function (p) {
        var cs = p.conference_status, bs = p.billing_status;
        return '<div class="lin"><div class="c"><b>' + F.esc(p.customer_name || '—') + '</b><span>Pedido ' + F.esc(p.order_number) + ' · ' + F.dataBR(p.order_date) + (p.conference_lot ? ' · lote ' + F.esc(p.conference_lot) : '') + '</span>' +
          '<span>' + F.esc(p.conference_user_name || '') + (p.conference_start_at ? ' · ' + X.dh(p.conference_start_at) + (p.conference_end_at ? ' → ' + X.dh(p.conference_end_at) : '') : '') + '</span>' +
          (cs ? '<span class="bdg ' + (cs === 'FINALIZADA' ? 'vd' : cs === 'EM_ANDAMENTO' ? 'la' : '') + '">' + F.esc(CONF[cs] || cs) + '</span>' : '') + (bs ? '<span class="bdg ' + (bs === 'FATURADO' ? 'az' : 'ro') + '">' + F.esc(FATS[bs] || bs) + (p.invoice_number ? ' · NF ' + F.esc(p.invoice_number) : '') + '</span>' : '') +
          '</div><div class="v">' + X.tempo(p.conference_duration_seconds) + '</div></div>';
      }).join('') || '<div class="vazio2">Nenhum pedido encontrado.</div>') + X.pag('conf', d.page, d.total_pages));
      return r;
    });
    return h;
  }


  // =====================================================================
  // Imagens (PNG) iguais às do site: Standby e Relatório de Pendências
  // =====================================================================
  function quandoImg() { var d = new Date(); return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function pngStandby() {
    var s = st('sb'); if (!s.sel || !s.sum) { F.toast('Espere o Standby carregar'); return; }
    var sels = lista(s.sel.items), bl = [{ tipo: 'card', blocos: [{ tipo: 'hero', rot: 'Total combinado (sem duplicar)', valor: F.n(s.sum.combined_value), pill: X.int(s.sum.distinct_orders) + ' pedidos', sub: X.int(s.sum.active_selections) + ' seleções ativas' }] }];
    CATS.forEach(function (c) {
      var l = sels.filter(function (x) { return x.category === c[0]; });
      bl.push({ tipo: 'tabela', titulo: c[1], d: l.length ? l.length + ' item(ns)' : '', cols: [[X.cap(c[2]), 'l', 0.46], ['Motivo', 'l', 0.3], ['Valor', 'r', 0.24, 1]],
        linhas: l.map(function (x) { return [x.item_value, (x.reason || '').trim() || '—', F.brl(x.value)]; }) });
    });
    F.gerarImagem({ titulo: 'Standby', sub: 'Painel de Pendências · ' + quandoImg(), arquivo: 'freedom-logistica-standby', blocos: bl });
  }
  function pngRelatorio() {
    var s = st('rel'), it = lista(s.snaps && s.snaps.items); if (!it.length || !s.prods) { F.toast('Espere o Relatório carregar'); return; }
    var sn = it.filter(function (x) { return String(x.id) === String(s.snap); })[0] || it[0], pr = lista(s.prods.items);
    var bl = [{ tipo: 'card', blocos: [{ tipo: 'linha', r: 'TOTAL PENDENTE', v: F.brl(sn.pending_total_at_snapshot), c: 'vermelho' }, { tipo: 'linha', r: 'STANDBY', v: F.brl(sn.standby_value), c: 'azul' }, { tipo: 'linha', r: 'EQUIPE TEM PENDENTE', v: F.brl(sn.team_pending), c: 'verde' }] }];
    [['IN_PRODUCTION', 'Itens em Produção', 'azul'], ['OUT_OF_STOCK', 'Itens sem estoque', 'rosa']].forEach(function (g) {
      var l = pr.filter(function (x) { return x.status === g[0]; });
      bl.push({ tipo: 'tabela', titulo: g[1], cor: g[2], d: l.length + ' produto(s)', cols: [['Produto', 'l', 0.36], ['Valor un.', 'r', 0.15], ['Valor Total', 'r', 0.19, 1], ['Qtd Vend.', 'r', 0.15], ['Nº Ped.', 'r', 0.15]],
        linhas: l.map(function (x) { return [x.product, x.unit_value != null ? F.brl(x.unit_value) : '—', F.brl(x.value), qtd(x.quantity), X.int(x.distinct_orders)]; }) });
    });
    F.gerarImagem({ titulo: 'Relatório de Pendências', sub: 'Painel de Pendências · snapshot #' + sn.id + ' de ' + X.dh(sn.created_at), arquivo: 'freedom-logistica-pendencias', blocos: bl });
  }

  function descFiltros(partes) { partes = partes.filter(Boolean); return partes.length ? [{ tipo: 'nota', t: 'Filtros: ' + partes.join(' · ') }] : []; }
  function faixa(fx) { return [fx.ini || fx.fim ? 'de ' + (fx.ini ? F.dataBR(fx.ini) : 'início') + ' até ' + (fx.fim ? F.dataBR(fx.fim) : 'hoje') : '', fx.vmin ? 'valor ≥ ' + F.brl(fx.vmin) : '', fx.vmax ? 'valor ≤ ' + F.brl(fx.vmax) : '']; }
  function pngPed() {
    var s = st('ped'); if (!s.d) { F.toast('Espere os pedidos carregarem'); return; }
    var it = filtraPed(s.d.items), fx = s.fx || {}, tot = it.reduce(function (a, p) { return a + F.n(p.value); }, 0), por = {};
    it.forEach(function (p) { var c = p.effective_classification || 'PENDENCIA'; por[c] = por[c] || [0, 0]; por[c][0] += F.n(p.value); por[c][1]++; });
    var linhas = [['PENDENCIA', 'Pendência', 'laranja'], ['EQUIPE', 'Equipe', 'azul'], ['FINALIZADO', 'Finalizado', 'verde']].map(function (c) { var v = por[c[0]] || [0, 0]; return { tipo: 'linha', r: c[1] + ' · ' + v[1] + (v[1] === 1 ? ' pedido' : ' pedidos'), v: F.brl(v[0]), c: c[2] }; });
    var bl = [{ tipo: 'card', blocos: [{ tipo: 'hero', rot: 'Pedidos pendentes', valor: tot, pill: it.length + (it.length === 1 ? ' pedido' : ' pedidos') }].concat(linhas) }];
    bl = bl.concat(descFiltros([s.busca ? 'busca "' + s.busca.trim() + '"' : '', s.rede ? 'rede ' + s.rede : '', s.cls ? nomeCls(s.cls) : '', fx.mot === 'com' ? 'com motivo' : fx.mot === 'sem' ? 'sem motivo' : fx.mot ? 'motivo "' + fx.mot + '"' : '', fx.conf ? (fx.conf === 'nenhuma' ? 'sem conferência' : 'conferência ' + (CONF[fx.conf] || fx.conf)) : ''].concat(faixa(fx))));
    bl.push({ tipo: 'tabela', titulo: 'Pedidos', d: it.length + ' pedido(s)', lim: 250, cols: [['Cliente', 'l', 0.39], ['Pedido', 'l', 0.14], ['Data', 'l', 0.12], ['Class.', 'l', 0.15], ['Valor', 'r', 0.2, 1]],
      linhas: it.map(function (p) { var r = [p.customer || '—', p.order_number, X.dm(p.order_date), nomeCls(p.effective_classification), F.brl(p.value)], m = (p.reason || '').trim(); if (m) r.sub = 'Motivo: ' + m; return r; }) });
    F.gerarImagem({ titulo: 'Controle de Pedidos', sub: 'Logística · ' + quandoImg(), arquivo: 'freedom-logistica-pedidos', blocos: bl });
  }
  function pngVp(b) {
    var s = st('vp'); if (b) { b.disabled = true; b.lastChild.textContent = ' Juntando os pedidos…'; }
    vpTodos().then(function (todos) {
      if (b) { b.disabled = false; b.lastChild.textContent = ' Gerar imagem (PNG)'; }
      var it = filtraVp(todos), fx = s.fx || {}, tot = it.reduce(function (a, i) { return a + F.n(i.value); }, 0);
      var bl = [{ tipo: 'card', blocos: [{ tipo: 'hero', rot: 'Valor dos pedidos pendentes', valor: tot, pill: it.length + (it.length === 1 ? ' pedido' : ' pedidos'), sub: it.length ? 'Ticket médio ' + F.brl(tot / it.length) : '' }] }];
      bl = bl.concat(descFiltros([s.busca ? 'busca "' + s.busca.trim() + '"' : ''].concat(faixa(fx))));
      bl.push({ tipo: 'tabela', titulo: 'Pedidos', d: it.length + ' pedido(s)', lim: 250, cols: [['Cliente', 'l', 0.42], ['Pedido', 'l', 0.14], ['Data', 'l', 0.19], ['Valor', 'r', 0.25, 1]],
        linhas: it.map(function (i) { return [i.customer || '—', i.order_number, F.dataBR(i.order_date), F.brl(i.value)]; }) });
      F.gerarImagem({ titulo: 'Valor Pedido', sub: 'Logística · ' + quandoImg(), arquivo: 'freedom-logistica-valor-pedido', blocos: bl });
    }).catch(function (e) { if (b) { b.disabled = false; b.lastChild.textContent = ' Gerar imagem (PNG)'; } falhou(e); });
  }
  var CORES_TIPO = { V: '#1fbf8f', C: '#8b6cf0', '1': '#4f7cff', B: '#f0a53a', P: '#2bb673', O: '#e5484d', D: '#3b82f6', Q: '#f59e0b', M: '#10b981', T: '#f97316', '5': '#a855f7', '7': '#ef4444', '6': '#7c3aed', A: '#60a5fa' };
  /** Imagem do Faturamento Diário (dia escolhido + período), sem sair da tela. */
  function pngDia() {
    var s = st('dia'), d = s.d;
    if (!d) { F.toast('Carregando o faturamento…'); carregarDia().then(function () { if (st('dia').d) pngDia(); }); return; }
    var dias = lista(d.days).slice().sort(function (a, b) { return a.invoice_date < b.invoice_date ? -1 : 1; }), dia = d.selected_day || d.latest_day;
    if (!dia) { F.toast('Sem faturamento no período'); return; }
    var tot = F.n(dia.total_value), tipos = lista(dia.types).slice().sort(function (a, b) { return F.n(b.value) - F.n(a.value); }), f = s.f || {};
    var idx = dias.map(function (x) { return x.invoice_date; }).indexOf(dia.invoice_date), ant = idx > 0 ? dias[idx - 1] : null, cmp = [];
    var pv = function (a, b) { if (!b) return ''; var v = a / b - 1; return (v >= 0 ? '+' : '') + F.um(v * 100, 1) + '%'; };
    if (ant && F.n(ant.total_value)) cmp.push(pv(tot, F.n(ant.total_value)) + ' vs ' + X.dm(ant.invoice_date));
    if (F.n(d.daily_average)) cmp.push(pv(tot, F.n(d.daily_average)) + ' vs média');
    var PAL = ['#4f7cff', '#f0a53a', '#1fbf8f', '#8b6cf0', '#e84b8a', '#3b82f6', '#f97316', '#10b981'];
    var cor = function (t) { return CORES_TIPO[t.order_type_code] || PAL[Math.max(0, tipos.indexOf(t)) % PAL.length]; };
    var hero = [{ tipo: 'hero', rot: 'Faturamento do dia ' + F.dataBR(dia.invoice_date), valor: tot, pill: X.int(dia.order_count) + (F.n(dia.order_count) === 1 ? ' pedido' : ' pedidos'), sub: cmp.join('  ·  ') }];
    if (tot > 0 && tipos.length) hero.push({ tipo: 'dist', partes: tipos.map(function (t) { return { frac: Math.max(0.005, F.n(t.value) / tot), cor: cor(t) }; }) });
    var bl = [{ tipo: 'card', blocos: hero }];
    if (tipos.length) { bl.push({ tipo: 'secao', t: 'Por tipo de operação', d: String(tipos.length) });
      bl.push({ tipo: 'tipos', itens: tipos.map(function (t) { var np = F.n(t.order_count); return { nome: t.order_type_label, valor: F.brl(t.value), sub: np + (np === 1 ? ' pedido' : ' pedidos'), pct: F.um(F.n(t.day_percentage), 1) + '%', cor: cor(t) }; }) }); }
    var ult = dias.slice(-22), somaP = dias.reduce(function (a, x) { return a + F.n(x.total_value); }, 0);
    bl.push({ tipo: 'card', blocos: [{ tipo: 'colunas', titulo: 'Faturamento por dia', d: ult.length + ' dias', media: F.n(d.daily_average), txtMedia: 'média ' + X.k(d.daily_average),
      dados: ult.map(function (x, i) { return { v: F.n(x.total_value), on: x.invoice_date === dia.invoice_date, r: i % 4 === 0 || i === ult.length - 1 ? X.dm(x.invoice_date) : '' }; }) },
      { tipo: 'linha', r: 'Total no período (' + dias.length + ' dias)', v: F.brl(somaP) }, { tipo: 'linha', r: 'Média diária', v: F.brl(d.daily_average) }] });
    var op = s.op || {}, nomeCli = '';
    if (f.cli) lista(op.customers).forEach(function (c) { if (String(c.customer_code) === String(f.cli)) nomeCli = c.customer_name || f.cli; });
    bl = bl.concat(descFiltros([f.ini || f.fim ? (f.ini ? F.dataBR(f.ini) : '…') + ' a ' + (f.fim ? F.dataBR(f.fim) : '…') : '', f.cli ? 'cliente ' + (nomeCli || f.cli) : '', f.cid ? 'cidade ' + f.cid : '', f.ven ? 'vendedor ' + f.ven : '', f.tipo ? 'tipo ' + f.tipo : '']));
    tipos.forEach(function (t) {
      var os = lista(t.orders); if (!os.length) return;
      bl.push({ tipo: 'tabela', titulo: t.order_type_label + ' · ' + F.brl(t.value), cor: cor(t), d: os.length + ' pedido(s)', lim: 120, cols: [['Cliente', 'l', 0.44], ['Pedido', 'l', 0.15], ['NF', 'l', 0.15], ['Valor', 'r', 0.26, 1]],
        linhas: os.map(function (o) { return [o.customer_name || '—', o.order_number, o.invoice_number, F.brl(o.order_value)]; }) });
    });
    F.gerarImagem({ titulo: 'Faturamento Diário', sub: 'Dia ' + F.dataBR(dia.invoice_date) + ' · ' + quandoImg(), arquivo: 'Faturamento-' + X.dm(dia.invoice_date).replace('/', '-'), blocos: bl });
  }
  function periodoDia(v) {
    var h = X.hoje(), s = st('dia'); s.f = s.f || {};
    if (v === 'hoje') { s.f.ini = h; s.f.fim = h; }
    else if (v === '7') { s.f.ini = X.iso(new Date(X.de(h).getTime() - 6 * 864e5)); s.f.fim = h; }
    else if (v === 'mes') { s.f.ini = X.mes(h, 0)[0]; s.f.fim = h; }
    else if (v === 'ant') { var m = X.mes(h, -1); s.f.ini = m[0]; s.f.fim = m[1]; }
    s.per = v; s.dia = ''; s.abreF = true; carregarDia();
  }

  // =====================================================================
  // Toques e campos
  // =====================================================================
  var ACT = {
    pedCls: function (v) { var s = st('ped'); s.cls = s.cls === v ? '' : v; s.n = 40; carregarPed(); },
    pedMais: function () { st('ped').n = (st('ped').n || 40) + 60; redesenhar(); },
    pedItens: itensPed, pedEditar: editarPed,
    pedTroca: function (v, t) { trocarPed(v, t.getAttribute('data-c')); },
    pedVarios: function () { var s = st('ped'); s.varios = !s.varios; s.marc = {}; redesenhar(); },
    pedMarca: function (v, t) { var s = st('ped'); if (t.checked) s.marc[v] = 1; else delete s.marc[v]; redesenhar(); },
    pedTodos: function () { var s = st('ped'); filtraPed(s.d && s.d.items).slice(0, s.n || 40).forEach(function (p) { if (p.effective_classification !== 'FINALIZADO') s.marc[p.order_number] = 1; }); redesenhar(); },
    pedLote: lotePed,
    consModo: function (v) { st('cons').modo = v; redesenhar(); },
    sbCat: function (v) { var s = st('sb'); s.cat = v; s.op = null; opcoesSb(); redesenhar(); },
    sbRem: sbRem, sbEnviar: sbEnviar, sbPng: pngStandby, relPng: pngRelatorio,
    relAdd: relAdd, relMover: relMover, relRem: relRem,
    irAba: function (v) { if (window.irAba) irAba(v); },
    fatSub: function (v) { st('fat').sub = v; redesenhar(); },
    diaLimpar: function () { var s = st('dia'); s.f = {}; s.dia = ''; s.per = ''; carregarDia(); },
    diaIr: function (v) { if (!v) return; st('dia').dia = v; carregarDia(); },
    diaTipoAb: function (v) { var s = st('dia'); s.abT = s.abT || {}; s.abT[v] = !s.abT[v]; redesenhar(); },
    diaAddCli: function () { diaAdd('customers'); }, diaAddTipo: function () { diaAdd('order-types'); },
    nfLimpar: function () { var s = st('nf'); s.f = {}; s.pag = 1; carregarNf(); },
    desmarcar: function (v) { var i = v.indexOf('|'), id = v.slice(0, i), val = v.slice(i + 1), sx = st(MULTI[id]); sx.mc[id] = marcados(sx, id).filter(function (x) { return x[0] !== val; }); redesenhar(); },
    desmarcarTodos: function (id) { st(MULTI[id]).mc[id] = []; redesenhar(); },
    mrMarca: function (v, t) { var i = v.indexOf('|'), k = v.slice(0, i); mr(st(k.split(':')[0]), k)[v.slice(i + 1)] = !!t.checked; redesenhar(); },
    mrTodos: function (k) { var sx = st(k.split(':')[0]), vals = (sx.mrAll || {})[k] || [], m = mr(sx, k), todos = vals.every(function (v) { return m[v]; }); vals.forEach(function (v) { m[v] = !todos; }); redesenhar(); },
    mrRem: function (k, b) {
      var tela = k.split(':')[0], tipo = k.split(':')[1], sx = st(tela), m = mr(sx, k), vals = ((sx.mrAll || {})[k] || []).filter(function (v) { return m[v]; });
      if (!vals.length) return;
      if (b) { b.disabled = true; b.textContent = 'Removendo…'; }
      var base = tela === 'nf' ? '/logistics/billing/report/exclusions/' : '/logistics/billing/daily/exclusions/';
      emSerie(vals, function (v) { return X.enviar('DELETE', base + tipo + '/' + encodeURIComponent(v)); }).then(function (r) {
        sx.mr[k] = {}; (tela === 'nf' ? nfDepois : diaDepois)(msgSerie(r, 'removidos'));
      });
    },
    pedPng: pngPed, vpPng: function (v, b) { pngVp(b); }, diaPng: pngDia, diaPer: periodoDia,
    pedFxLimpar: function () { st('ped').fx = {}; redesenhar(); },
    vpFxLimpar: function () { var s = st('vp'); s.fx = {}; s.pagF = 1; redesenhar(); },
    nfExPed: function () { nfEx('orders'); }, nfExCli: function () { nfEx('customers'); }, nfExTipo: function () { nfEx('order-types'); },
    cfLimpar: function () { var s = st('conf'); s.f = {}; s.pag = 1; carregarConf(); }
  };
  var MBOT = { cancelar: X.fechar, salvarPed: salvarPed, sbRemOk: sbRemOk, sbEnviarOk: sbEnviarOk, relRemOk: relRemOk };
  var PAG = { vpF: [function () { var s = st('vp'); return { set pag(v) { s.pagF = v; } }; }, redesenhar], pend: [st.bind(null, 'pend'), carregarPend], vp: [st.bind(null, 'vp'), carregarVp], nf: [st.bind(null, 'nf'), carregarNf], conf: [st.bind(null, 'conf'), carregarConf],
    consPed: [function () { var s = st('cons'); return { set pag(v) { s.pagPed = v; } }; }, consPedidos] };

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-m],[data-pag]') : null; if (!t || t.disabled) return;
    if (t.hasAttribute('data-m')) { var f = MBOT[t.getAttribute('data-m')]; if (f) f(); return; }
    if (t.hasAttribute('data-pag')) { var p = PAG[t.getAttribute('data-pag')]; if (p) { p[0]().pag = F.n(t.getAttribute('data-ir')); p[1](); window.scrollTo(0, 0); } return; }
    var a = t.getAttribute('data-act');
    if (a === 'diaRem') { diaRem(t.getAttribute('data-t'), t.getAttribute('data-v')); return; }
    if (a === 'nfRem') { nfRem(t.getAttribute('data-t'), t.getAttribute('data-v')); return; }
    if (ACT[a]) { if (t.type !== 'checkbox') ev.preventDefault(); ACT[a](t.getAttribute('data-v'), t); }
  });
  var digitou = {
    pedBusca: X.espera(function (v) { st('ped').busca = v; carregarPed(); }),
    pendBusca: X.espera(function (v) { var s = st('pend'); s.busca = v; s.pag = 1; carregarPend(); }),
    vpBusca: X.espera(function (v) { var s = st('vp'); s.busca = v; s.pag = 1; carregarVp(); }),
    consBusca: X.espera(function (v) { var s = st('cons'); s.busca = v; buscar(s, 'sug', '/logistics/analysis/products' + X.q({ search: v.trim() })); }),
    sbBusca: X.espera(function (v) { var s = st('sb'); s.busca[s.cat] = v; opcoesSb(); }),
    relBusca: X.espera(function (v) { st('rel').busca = v; opcoesRel(); }),
    diaBuscaCli: function (v) { st('dia').buscaCli = v; redesenhar(); },
    nfBusca: X.espera(function (v) { var s = st('nf'); s.busca = v; s.pag = 1; carregarNf(); }),
    nfPedBusca: X.espera(function (v) { var s = st('nf'); s.pedBusca = v; s.abreEx = true; if (v.trim()) buscar(s, 'sug', '/logistics/billing/report/order-options' + X.q({ q: v.trim(), limit: 20 })); else { s.sug = null; redesenhar(); } }),
    nfPedMot: function (v) { st('nf').pedMot = v; },
    cfBusca: X.espera(function (v) { var s = st('conf'); s.busca = v; s.pag = 1; carregarConf(); })
  };
  var mudou = {
    pedRede: function (v) { st('ped').rede = v; carregarPed(); }, pedCls: function (v) { st('ped').cls = v; carregarPed(); },
    pendRede: function (v) { var s = st('pend'); s.rede = v; s.pag = 1; carregarPend(); }, pendFam: function (v) { var s = st('pend'); s.fam = v; s.pag = 1; carregarPend(); },
    pendOrd: function (v) { var s = st('pend'); s.ord = v; s.pag = 1; carregarPend(); }, pendDir: function (v) { var s = st('pend'); s.dir = v; s.pag = 1; carregarPend(); },
    vpOrd: function (v) { var s = st('vp'); s.ord = v; s.pag = 1; carregarVp(); }, vpDir: function (v) { var s = st('vp'); s.dir = v; s.pag = 1; carregarVp(); },
    consProd: function (v) { var s = st('cons'); s.prod = v; s.pagPed = 1; s.res = null; s.peds = null; if (v) { buscar(s, 'res', '/logistics/analysis/product' + X.q({ product: v })); consPedidos(); } redesenhar(); },
    rkOrd: function (v) { var s = st('cons'); s.rk.ord = v; buscar(s, 'rank', '/logistics/analysis/products/ranking' + X.q({ sort_by: s.rk.ord, limit: s.rk.lim })); },
    rkLim: function (v) { var s = st('cons'); s.rk.lim = v; buscar(s, 'rank', '/logistics/analysis/products/ranking' + X.q({ sort_by: s.rk.ord, limit: s.rk.lim })); },
    consRede: function (v) { var s = st('cons'); s.rede = v; s.rres = null; s.rprods = null; if (v) { buscar(s, 'rres', '/logistics/analysis/network' + X.q({ network: v })); buscar(s, 'rprods', '/logistics/analysis/network/products' + X.q({ network: v })); } redesenhar(); },
    sbAdd: sbAdd,
    relSnap: function (v) { st('rel').snap = v; redesenhar(); }, relProd: function (v) { st('rel').prodSel = v; },
    diaSel: function (v) { st('dia').dia = v; carregarDia(); },
    diaIni: diaFiltro, diaFim: diaFiltro, diaCli: diaFiltro, diaCid: diaFiltro, diaVen: diaFiltro, diaTipo: diaFiltro,
    nfIni: nfFiltro, nfFim: nfFiltro, nfCli: nfFiltro, nfCid: nfFiltro, nfVen: nfFiltro, nfTipo: nfFiltro, nfSt: nfFiltro,
    nfOrd: function (v) { var s = st('nf'); s.ord = v; s.pag = 1; carregarNf(); }, nfDir: function (v) { var s = st('nf'); s.dir = v; s.pag = 1; carregarNf(); },
    nfPedSel: function (v) { st('nf').pedSel = v; },
    pedFxIni: pedFx, pedFxFim: pedFx, pedFxMot: pedFx, pedFxConf: pedFx, pedFxMin: pedFx, pedFxMax: pedFx,
    vpFxIni: vpFx, vpFxFim: vpFx, vpFxMin: vpFx, vpFxMax: vpFx,
    nfExCli: function (v) { escolheu('nfExCli', v); }, nfExTipo: function (v) { escolheu('nfExTipo', v); },
    diaAddCli: function (v) { escolheu('diaAddCli', v); }, diaAddTipo: function (v) { escolheu('diaAddTipo', v); },
    cfIni: confFiltro, cfFim: confFiltro, cfUs: confFiltro, cfCs: confFiltro, cfBs: confFiltro
  };
  function pedFx() { var s = st('ped'); s.fx = { ini: X.val('pedFxIni'), fim: X.val('pedFxFim'), mot: X.val('pedFxMot'), conf: X.val('pedFxConf'), vmin: X.val('pedFxMin'), vmax: X.val('pedFxMax') }; s.abreF = true; s.n = 40; redesenhar(); }
  function vpFx() { var s = st('vp'); s.fx = { ini: X.val('vpFxIni'), fim: X.val('vpFxFim'), vmin: X.val('vpFxMin'), vmax: X.val('vpFxMax') }; s.abreF = true; s.pagF = 1; if (fxAtivo(s.fx) && !s.todos) vpTodos().then(redesenhar, falhou); redesenhar(); }
  function confFiltro() { var s = st('conf'); s.f = { ini: X.val('cfIni'), fim: X.val('cfFim'), us: X.val('cfUs'), cs: X.val('cfCs'), bs: X.val('cfBs') }; s.pag = 1; s.abreF = true; carregarConf(); }
  document.addEventListener('input', function (ev) { var id = ev.target.id; if (digitou[id]) digitou[id](ev.target.value); });
  document.addEventListener('change', function (ev) { var id = ev.target.id; if (mudou[id]) mudou[id](ev.target.value); });
  document.addEventListener('focusout', function (ev) { var m = ev.target.getAttribute && ev.target.getAttribute('data-sbmot'); if (m) sbMotivo(m, ev.target.value); });
  document.addEventListener('toggle', function (ev) { if (ev.target.id === 'nfEx') st('nf').abreEx = ev.target.open; }, true);

  /** Atualizar (botão do topo): recarrega a aba aberta. */
  function recarregar(aba) {
    if (aba === 'ped') carregarPed(); if (aba === 'pend') carregarPend(); if (aba === 'vp') carregarVp();
    if (aba === 'cons') { var c = st('cons'); c.sug = null; c.rank = null; c.redes = null; if (c.prod) mudou.consProd(c.prod); if (c.rede) mudou.consRede(c.rede); }
    if (aba === 'sb') { carregarSb(); st('sb').op = null; opcoesSb(); }
    if (aba === 'rel') { carregarRel(); st('rel').op = null; opcoesRel(); }
    if (aba === 'fat') { var f = st('fat').sub || 'dia'; if (f === 'dia') { carregarDia(); buscar(st('dia'), 'ex', '/logistics/billing/daily/exclusions'); } else { carregarNf(); buscar(st('nf'), 'ex', '/logistics/billing/report/exclusions'); } }
    if (aba === 'conf') carregarConf();
  }
  return { ped: telaPed, pend: telaPend, vp: telaVp, cons: telaCons, sb: telaSb, rel: telaRel, fat: telaFat, conf: telaConf, recarregar: recarregar, S: S, pngDia: pngDia };
})();
