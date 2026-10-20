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

  // =====================================================================
  // Pedidos (Controle de Pedidos)
  // =====================================================================
  function urlPed() { var s = st('ped'); return '/logistics/pending/orders' + X.q({ search: (s.busca || '').trim(), network: s.rede, classification: s.cls }); }
  function carregarPed() { var s = st('ped'); return buscar(s, 'd', urlPed()).then(function () { lista(s.d && s.d.items).forEach(function (i) { s.redes = s.redes || {}; if (i.network) s.redes[i.network] = 1; }); }); }
  function telaPed() {
    var s = st('ped'); if (s.d == null && !s._cd) carregarPed();
    var h = '';
    var sm = s.d && s.d.summary || {};
    h += '<div class="k4" style="grid-template-columns:1fr 1fr 1fr">' + [['PENDENCIA', 'Pendência', sm.pending_value, sm.pending_orders, 'lar'], ['EQUIPE', 'Equipe', sm.team_value, sm.team_orders, ''], ['FINALIZADO', 'Finalizado', sm.finalized_value, sm.finalized_orders, 'pos']].map(function (c) {
      return '<div class="k" data-act="pedCls" data-v="' + c[0] + '" style="cursor:pointer' + (s.cls === c[0] ? ';outline:2px solid var(--rosa)' : '') + '"><span>' + c[1] + '</span><b class="' + c[4] + '" style="font-size:16px">' + (s.d ? X.k(c[2]) : '…') + '</b><em>' + (s.d ? X.int(c[3]) + ' pedido(s)' : '') + '</em></div>';
    }).join('') + '</div>';
    var redes = Object.keys(s.redes || {}).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    h += '<input class="busca" id="pedBusca" placeholder="Buscar cliente, rede ou pedido" value="' + F.esc(s.busca || '') + '">';
    h += '<div class="sub2">' + sel('pedRede', redes, s.rede, 'Todas as redes') + sel('pedCls', [['PENDENCIA', 'Pendência'], ['EQUIPE', 'Equipe'], ['FINALIZADO', 'Finalizado']], s.cls, 'Todas as classificações') + '</div>';
    h += bloco(s, 'd', function (d) {
      var it = lista(d.items), n = s.n || 40;
      if (!it.length) return '<div class="vazio">Nenhum pedido encontrado.</div>';
      return X.card(it.length + ' pedido(s)', 'Toque em "Ver itens" para abrir os produtos', it.slice(0, n).map(linhaPed).join('') +
        (it.length > n ? '<button class="mais" data-act="pedMais">Ver mais (' + (it.length - n) + ')</button>' : ''));
    });
    return h;
  }
  function linhaPed(p) {
    var s = st('ped'), ef = p.effective_classification, ab = s.ab && s.ab[p.order_number], pr = s.prods && s.prods[p.order_number];
    var cor = ef === 'FINALIZADO' ? 'vd' : ef === 'EQUIPE' ? 'az' : 'la';
    var h = '<div class="lin"><div class="c"><b>' + F.esc(p.customer || '—') + '</b><span>Pedido ' + F.esc(p.order_number) + ' · ' + F.dataBR(p.order_date) + ' · ' + F.esc(p.network || 'SEM REDE') + '</span>' +
      '<span class="bdg ' + cor + '">' + (CLS[ef] || ef) + '</span>' + (p.conference_status ? '<span class="bdg">' + F.esc(CONF[p.conference_status] || p.conference_status) + '</span>' : '') +
      (p.reason ? '<span style="display:block;font-size:12.5px;color:var(--tx2);margin-top:4px">Motivo: <b>' + F.esc(p.reason) + '</b></span>' : '') +
      '<div class="ac2"><button class="lnk" data-act="pedItens" data-v="' + F.esc(p.order_number) + '">' + (ab ? 'Ocultar itens' : 'Ver ' + F.n(p.item_count) + ' itens') + '</button>' +
      (ef !== 'FINALIZADO' ? '<button class="lnk ro" data-act="pedEditar" data-v="' + F.esc(p.order_number) + '">Editar</button>' : '<span style="font-size:12px;color:var(--tx3)" title="Classificação definida pela conferência concluída.">Definido pela conferência</span>') + '</div>';
    if (ab) h += '<div class="itens2">' + (pr === undefined || pr === 'c' ? '<div class="vazio2">Carregando produtos…</div>' : pr === 'e' ? '<div class="vazio2">Não consegui abrir os produtos.</div>' :
      lista(pr.products).map(function (x) { return '<div class="row"><span>' + F.esc(x.product) + (x.product_code ? ' <small style="color:var(--tx3)">' + F.esc(x.product_code) + '</small>' : '') + '<br><small style="color:var(--tx3)">' + F.esc(x.family || '') + ' · ' + qtd(x.quantity) + ' un</small></span><b>' + brl(x.value) + '</b></div>'; }).join('')) + '</div>';
    return h + '</div><div class="v">' + brl(p.value) + '</div></div>';
  }
  function pedPorNumero(n) { var d = st('ped').d; return lista(d && d.items).filter(function (x) { return x.order_number === n; })[0]; }
  function editarPed(n) {
    var p = pedPorNumero(n); if (!p) return;
    X.modal('Editar pedido ' + F.esc(n), F.esc(p.customer || '') + ' · ' + brl(p.value),
      X.campo('Classificação', '<select id="mCls">' + X.opcoes([['PENDENCIA', 'Pendência'], ['EQUIPE', 'Equipe']], p.operational_classification || 'PENDENCIA') + '</select>') +
      X.campo('Motivo', '<textarea id="mMot" maxlength="1000" rows="4">' + F.esc(p.reason || '') + '</textarea>'),
      [['cancelar', 'Cancelar', 'cl'], ['salvarPed', 'Salvar', 'ro']]).setAttribute('data-n', n);
  }
  function salvarPed() {
    var n = document.getElementById('mfundo').getAttribute('data-n'), mot = X.val('mMot').trim();
    X.ocupado('salvarPed', true); X.erroModal('');
    X.enviar('PUT', '/logistics/pending/orders/' + encodeURIComponent(n) + '/control', { classification: X.val('mCls'), reason: mot || null },
      'Este pedido não está mais disponível na lista de pendências.').then(function () {
      X.fechar(); F.toast('Pedido ' + n + ' atualizado no site'); carregarPed(); if (window.carregar) carregar(true);
    }).catch(function (e) {
      if (e.status === 409) { X.fechar(); F.toast(e.message); carregarPed(); return; }
      X.ocupado('salvarPed', false); X.erroModal(e.message);
    });
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
  function carregarVp() { var s = st('vp'); return buscar(s, 'd', '/logistics/pending/order-values' + X.q({ page: s.pag || 1, page_size: 50, sort_by: s.ord || 'order_date', sort_direction: s.dir || 'desc', search: (s.busca || '').trim() })); }
  function telaVp() {
    var s = st('vp'); if (s.d == null && !s._cd) carregarVp();
    var sm = s.d && s.d.summary || {}, h = '';
    h += '<div class="k4" style="grid-template-columns:1fr 1fr 1fr">' + [['Valor total', X.k(sm.total_value)], ['Nº de pedidos', X.int(sm.order_count)], ['Ticket médio', X.k(sm.average_ticket)]].map(function (k) { return '<div class="k"><span>' + k[0] + '</span><b style="font-size:16px">' + (s.d ? k[1] : '…') + '</b></div>'; }).join('') + '</div>';
    h += '<input class="busca" id="vpBusca" placeholder="Buscar pedido ou cliente" value="' + F.esc(s.busca || '') + '">';
    h += '<div class="sub2">' + sel('vpOrd', [['order_date', 'Data'], ['order_number', 'Pedido'], ['customer', 'Cliente'], ['value', 'Valor']], s.ord || 'order_date') + sel('vpDir', [['desc', 'Decrescente'], ['asc', 'Crescente']], s.dir || 'desc') + '</div>';
    h += bloco(s, 'd', function (d) {
      var it = lista(d.items); if (!it.length) return '<div class="vazio">Nenhum pedido encontrado.</div>';
      return X.card('', '', it.map(function (i) { return '<div class="lin"><div class="c"><b>' + F.esc(i.customer || '—') + '</b><span>Pedido ' + F.esc(i.order_number) + ' · ' + F.dataBR(i.order_date) + '</span><span class="bdg la">Pendente</span></div><div class="v">' + brl(i.value) + '</div></div>'; }).join('') +
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
      '<div class="acoes" style="justify-content:flex-start"><button class="btn ro" data-act="sbEnviar">Enviar soma para Relatório</button></div></div>';
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
        '<p class="cs" style="margin:-4px 0 12px">Enviado em ' + X.dh(atual.created_at) + ' por ' + F.esc(atual.created_by || '—') + '. Snapshot imutável.</p>';
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
  function carregarDia() { var s = st('dia'); buscar(s, 'd', urlDia()); }
  function telaDia() {
    var s = st('dia'); s.f = s.f || {};
    if (s.op == null && !s._cop) buscar(s, 'op', '/logistics/billing/daily/options');
    if (s.d == null && !s._cd) carregarDia();
    if (s.ex == null && !s._cex) buscar(s, 'ex', '/logistics/billing/daily/exclusions');
    var h = '', op = s.op || {}, f = s.f;
    if (window.faturamentoHoje) h += faturamentoHoje();
    h += '<details class="card"' + (s.abreF ? ' open' : '') + ' id="diaFiltros"><summary class="ct" style="cursor:pointer">Filtros</summary><div class="sub2" style="margin-top:10px">' +
      X.campo('Data inicial', '<input type="date" id="diaIni" value="' + F.esc(f.ini || '') + '"' + (op.minimum_date ? ' min="' + op.minimum_date + '"' : '') + (op.maximum_date ? ' max="' + op.maximum_date + '"' : '') + '>') +
      X.campo('Data final', '<input type="date" id="diaFim" value="' + F.esc(f.fim || '') + '"' + (op.minimum_date ? ' min="' + op.minimum_date + '"' : '') + (op.maximum_date ? ' max="' + op.maximum_date + '"' : '') + '>') + '</div>' +
      X.campo('Cliente', '<select id="diaCli">' + X.opcoes(lista(op.customers).map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), f.cli, 'Todos') + '</select>') +
      '<div class="sub2 t3">' + X.campo('Cidade', '<select id="diaCid">' + X.opcoes(lista(op.cities), f.cid, 'Todas') + '</select>') + X.campo('Vendedor', '<select id="diaVen">' + X.opcoes(lista(op.sellers), f.ven, 'Todos') + '</select>') +
      X.campo('Tipo de operação', '<select id="diaTipo">' + X.opcoes(lista(op.order_types), f.tipo, 'Todos') + '</select>') + '</div>' +
      '<button class="btn cl mini" data-act="diaLimpar">Limpar filtros</button></details>';
    h += bloco(s, 'd', function (d) {
      var dias = lista(d.days).slice().sort(function (a, b) { return a.invoice_date < b.invoice_date ? -1 : 1; }), dia = d.selected_day || d.latest_day, r = '';
      r += X.k4([['Média diária faturada', X.k(d.daily_average)], ['Dia mais recente', d.latest_day ? X.k(d.latest_day.total_value) : '—', d.latest_day ? F.dataBR(d.latest_day.invoice_date) + ' · ' + X.int(d.latest_day.order_count) + ' pedidos' : ''],
        ['Regras ativas', X.int(d.active_exclusion_rules), 'só deste indicador'], ['Pedidos excluídos', X.int(d.excluded_orders_count)]]);
      var ult = dias.slice(-30);
      if (ult.length) r += X.card('Faturamento diário (R$)', 'Últimos ' + ult.length + ' dias com faturamento · toque num dia abaixo para ver o detalhe', X.colunas(ult.map(function (x) { return F.n(x.total_value); }), function (i) { return i % 5 === 0 || i === ult.length - 1 ? X.dm(ult[i].invoice_date) : ''; },
        F.n(d.daily_average), 'média ' + X.k(d.daily_average) + '/dia', ult.map(function (x) { return dia && x.invoice_date === dia.invoice_date ? 'var(--rosa)' : 'var(--azul)'; })));
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
        '<div style="display:flex;gap:8px">' + sel('diaAddCli', clis.map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), '', 'Selecione...') + '<button class="btn ro" data-act="diaAddCli">Adicionar</button></div>' +
        lista(ex.excluded_customers).map(function (c) { return '<div class="x" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--ln);font-size:13px"><span>' + F.esc(c.customer_name || 'Sem nome') + ' · cód. ' + F.esc(c.customer_code) + '</span><button class="lnk ro" data-act="diaRem" data-t="customers" data-v="' + F.esc(c.customer_code) + '">Remover</button></div>'; }).join('') +
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Tipos incluídos/excluídos aqui</p>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' + sel('diaAddTipo', lista(op.exclusion_order_types).filter(function (t) { return !exc[t.order_type_code]; }).map(function (t) { return [t.order_type_code, t.order_type_label]; }), '', 'Selecione...') + '<button class="btn ro" data-act="diaAddTipo">Adicionar</button></div>' +
        lista(ex.excluded_order_types).map(function (t) { return '<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--ln);font-size:13px"><span>' + F.esc(t.order_type_label) + '</span><button class="lnk ro" data-act="diaRem" data-t="order-types" data-v="' + F.esc(t.order_type_code) + '">Remover</button></div>'; }).join(''));
    });
    return h;
  }
  function diaDepois(m) { var s = st('dia'); F.toast(m); buscar(s, 'ex', '/logistics/billing/daily/exclusions'); carregarDia(); }
  function diaAdd(tipo) {
    var v = X.val(tipo === 'customers' ? 'diaAddCli' : 'diaAddTipo'); if (!v) { F.toast('Escolha na lista primeiro'); return; }
    X.enviar('POST', '/logistics/billing/daily/exclusions/' + tipo, tipo === 'customers' ? { customer_code: v } : { order_type_code: v }).then(function () { diaDepois('Regra adicionada'); }).catch(falhou);
  }
  function diaRem(tipo, v) { X.enviar('DELETE', '/logistics/billing/daily/exclusions/' + tipo + '/' + encodeURIComponent(v)).then(function () { diaDepois('Regra removida'); }).catch(falhou); }
  function diaFiltro() {
    var s = st('dia'); s.f = { ini: X.val('diaIni'), fim: X.val('diaFim'), cli: X.val('diaCli'), cid: X.val('diaCid'), ven: X.val('diaVen'), tipo: X.val('diaTipo') };
    if (s.f.ini && s.f.fim && s.f.ini > s.f.fim) { F.toast('A data inicial é depois da final'); return; }
    s.dia = ''; s.abreF = true; carregarDia();
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
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Cliente</p><div style="display:flex;gap:8px;margin-top:6px">' + sel('nfExCli', lista(op.exclusion_customers).map(function (c) { return [c.customer_code, (c.customer_name || 'Sem nome') + ' · cód. ' + c.customer_code]; }), '', 'Selecione') + '<button class="btn ro" data-act="nfExCli">Excluir cliente</button></div>' +
        '<p class="ct" style="font-size:13.5px;margin-top:14px">Tipo de operação</p><div style="display:flex;gap:8px;margin-top:6px">' + sel('nfExTipo', lista(op.exclusion_order_types).map(function (t) { return [t.order_type_code, t.order_type_label]; }), '', 'Selecione') + '<button class="btn ro" data-act="nfExTipo">Excluir tipo</button></div>' +
        '<p class="ct" style="font-size:13.5px;margin-top:16px">Pedidos excluídos</p>' + (lista(ex.excluded_orders).map(function (o) { return '<div class="lin"><div class="c"><b>' + F.esc(o.order_number) + ' · ' + F.esc(o.customer_name || '—') + '</b><span>' + F.esc(o.reason) + ' · Atualizado em ' + X.dh(o.updated_at) + '</span></div><button class="lnk ro" data-act="nfRem" data-t="orders" data-v="' + F.esc(o.order_number) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
        '<p class="ct" style="font-size:13.5px;margin-top:12px">Clientes excluídos</p>' + (lista(ex.excluded_customers).map(function (c) { return '<div class="lin"><div class="c"><b>' + F.esc(c.customer_name || 'Sem nome') + '</b><span>cód. ' + F.esc(c.customer_code) + '</span></div><button class="lnk ro" data-act="nfRem" data-t="customers" data-v="' + F.esc(c.customer_code) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
        '<p class="ct" style="font-size:13.5px;margin-top:12px">Tipos excluídos</p>' + (lista(ex.excluded_order_types).map(function (t) { return '<div class="lin"><div class="c"><b>' + F.esc(t.order_type_label) + '</b></div><button class="lnk ro" data-act="nfRem" data-t="order-types" data-v="' + F.esc(t.order_type_code) + '">Remover</button></div>'; }).join('') || '<div class="vazio2">Nenhum.</div>') +
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
    } else if (tipo === 'customers') { var c = X.val('nfExCli'); if (!c) { F.toast('Escolha o cliente'); return; } corpo = { customer_code: c }; }
    else { var t = X.val('nfExTipo'); if (!t) { F.toast('Escolha o tipo'); return; } corpo = { order_type_code: t }; }
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
  // Toques e campos
  // =====================================================================
  var ACT = {
    pedCls: function (v) { var s = st('ped'); s.cls = s.cls === v ? '' : v; s.n = 40; carregarPed(); },
    pedMais: function () { st('ped').n = (st('ped').n || 40) + 60; redesenhar(); },
    pedItens: itensPed, pedEditar: editarPed,
    consModo: function (v) { st('cons').modo = v; redesenhar(); },
    sbCat: function (v) { var s = st('sb'); s.cat = v; s.op = null; opcoesSb(); redesenhar(); },
    sbRem: sbRem, sbEnviar: sbEnviar,
    relAdd: relAdd, relMover: relMover, relRem: relRem,
    irAba: function (v) { if (window.irAba) irAba(v); },
    fatSub: function (v) { st('fat').sub = v; redesenhar(); },
    diaLimpar: function () { var s = st('dia'); s.f = {}; s.dia = ''; carregarDia(); },
    diaIr: function (v) { if (!v) return; st('dia').dia = v; carregarDia(); },
    diaTipoAb: function (v) { var s = st('dia'); s.abT = s.abT || {}; s.abT[v] = !s.abT[v]; redesenhar(); },
    diaAddCli: function () { diaAdd('customers'); }, diaAddTipo: function () { diaAdd('order-types'); },
    nfLimpar: function () { var s = st('nf'); s.f = {}; s.pag = 1; carregarNf(); },
    nfExPed: function () { nfEx('orders'); }, nfExCli: function () { nfEx('customers'); }, nfExTipo: function () { nfEx('order-types'); },
    cfLimpar: function () { var s = st('conf'); s.f = {}; s.pag = 1; carregarConf(); }
  };
  var MBOT = { cancelar: X.fechar, salvarPed: salvarPed, sbRemOk: sbRemOk, sbEnviarOk: sbEnviarOk, relRemOk: relRemOk };
  var PAG = { pend: [st.bind(null, 'pend'), carregarPend], vp: [st.bind(null, 'vp'), carregarVp], nf: [st.bind(null, 'nf'), carregarNf], conf: [st.bind(null, 'conf'), carregarConf],
    consPed: [function () { var s = st('cons'); return { set pag(v) { s.pagPed = v; } }; }, consPedidos] };

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-m],[data-pag]') : null; if (!t || t.disabled) return;
    if (t.hasAttribute('data-m')) { var f = MBOT[t.getAttribute('data-m')]; if (f) f(); return; }
    if (t.hasAttribute('data-pag')) { var p = PAG[t.getAttribute('data-pag')]; if (p) { p[0]().pag = F.n(t.getAttribute('data-ir')); p[1](); window.scrollTo(0, 0); } return; }
    var a = t.getAttribute('data-act');
    if (a === 'diaRem') { diaRem(t.getAttribute('data-t'), t.getAttribute('data-v')); return; }
    if (a === 'nfRem') { nfRem(t.getAttribute('data-t'), t.getAttribute('data-v')); return; }
    if (ACT[a]) { ev.preventDefault(); ACT[a](t.getAttribute('data-v')); }
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
    cfIni: confFiltro, cfFim: confFiltro, cfUs: confFiltro, cfCs: confFiltro, cfBs: confFiltro
  };
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
  return { ped: telaPed, pend: telaPend, vp: telaVp, cons: telaCons, sb: telaSb, rel: telaRel, fat: telaFat, conf: telaConf, recarregar: recarregar, S: S };
})();
