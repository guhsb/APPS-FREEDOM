/* ============================================================
   Freedom · Logística › Equipe
   Quadro de setores, funcionários, função, horário, almoço e pausas, por dia da semana.
   Fica salvo no aparelho (arquivo do app: não some ao fechar, desligar, sair do login ou atualizar).
   Gera imagem (PNG) no formato da planilha: SETOR · RESUMO · HORÁRIO.
   ============================================================ */
var EQ = (function () {
  var X = Dash;
  var DIAS = [['seg', 'Seg', 'Segunda-feira'], ['ter', 'Ter', 'Terça-feira'], ['qua', 'Qua', 'Quarta-feira'], ['qui', 'Qui', 'Quinta-feira'],
    ['sex', 'Sex', 'Sexta-feira'], ['sab', 'Sáb', 'Sábado'], ['dom', 'Dom', 'Domingo']];
  var ARQ = 'equipe', q = null, dia = null, ed = null;   // q = quadro inteiro; ed = o que está aberto na janela de edição

  // ---------------- guardar / ler ----------------
  function ler() {
    var t = '';
    try { t = App.lerDado(ARQ) || ''; } catch (e) { }
    if (!t) try { t = localStorage.getItem('eq_quadro') || ''; } catch (e) { }
    try { q = t ? JSON.parse(t) : null; } catch (e) { q = null; }
    if (!q || !q.dias) q = { v: 1, dias: {} };
    DIAS.forEach(function (d) { q.dias[d[0]] = q.dias[d[0]] || { setores: [] }; });
    q.faltas = q.faltas || {};
    if (!q.pausaGeral) q.pausaGeral = [['08:30', '08:40']];   // a pausa de todos (todo mundo junto)
    var limite = isoDe(new Date(Date.now() - 21 * 864e5));
    Object.keys(q.faltas).forEach(function (k) { if (k < limite || !(q.faltas[k] || []).length) delete q.faltas[k]; });
  }
  function gravar() {
    q.atualizado = new Date().toISOString();
    var t = JSON.stringify(q), ok = false;
    try { ok = App.lerDado ? !!App.gravarDado(ARQ, t) : false; } catch (e) { ok = false; }
    try { localStorage.setItem('eq_quadro', t); ok = true; } catch (e) { }
    if (!ok) F.toast('Não consegui salvar o quadro neste aparelho');
  }
  function isoDe(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  /** Data (desta semana, de segunda a domingo) do dia escolhido. */
  function dataDoDia(dk) {
    var h = new Date(), seg = new Date(h.getFullYear(), h.getMonth(), h.getDate() - (h.getDay() + 6) % 7), i = DIAS.map(function (x) { return x[0]; }).indexOf(dk);
    return new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + i);
  }
  function dm(d) { return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function faltou(pid, dk) { return (q.faltas[isoDe(dataDoDia(dk || dia))] || []).indexOf(pid) >= 0; }
  function marcarFalta(pid, sim) {
    var k = isoDe(dataDoDia(dia)), l = q.faltas[k] = q.faltas[k] || [];
    var i = l.indexOf(pid); if (sim && i < 0) l.push(pid); if (!sim && i >= 0) l.splice(i, 1);
    if (!l.length) delete q.faltas[k];
    gravar(); redesenhar();
  }
  function hojeDia() { var w = new Date().getDay(); return DIAS[(w + 6) % 7][0]; }
  function id() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function setores() { return q.dias[dia].setores; }
  function acharSetor(sid) { return setores().filter(function (s) { return s.id === sid; })[0]; }
  function redesenhar() { if (window.desenharMantendo) desenharMantendo(); }

  // ---------------- horários ----------------
  function min(h) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(h || '').trim()); return m ? +m[1] * 60 + +m[2] : null; }
  function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  /** Intervalos parados (almoço + pausas), em minutos, ordenados. */
  function geral() { return (q.pausaGeral || []).filter(function (x) { return min(x[0]) != null && min(x[1]) != null && min(x[1]) > min(x[0]); }); }
  /** Pausas só desta pessoa (as iguais à pausa de todos não contam de novo). */
  function pausasDe(p) {
    var g = geral().map(function (x) { return x[0] + x[1]; });
    return (p.pausas || []).filter(function (x) { return min(x[0]) != null && min(x[1]) != null && g.indexOf(x[0] + x[1]) < 0; });
  }
  function paradas(p) {
    var l = [];
    if (p.alm && min(p.alm[0]) != null && min(p.alm[1]) != null) l.push([min(p.alm[0]), min(p.alm[1]), 'alm']);
    geral().forEach(function (x) { l.push([min(x[0]), min(x[1]), 'ge']); });
    pausasDe(p).forEach(function (x) { l.push([min(x[0]), min(x[1]), 'pa']); });
    return l.filter(function (x) { return x[1] > x[0]; }).sort(function (a, b) { return a[0] - b[0]; });
  }
  /** "07:45-08:30 / 08:40-12:30 / 13:30-17:33": entrada até saída, cortando almoço e pausas. */
  function blocos(p) {
    var e = min(p.ent), s = min(p.sai); if (e == null || s == null || s <= e) return [];
    var r = [], ini = e;
    paradas(p).forEach(function (x) { if (x[1] <= ini || x[0] >= s) return; if (x[0] > ini) r.push([ini, x[0]]); ini = Math.max(ini, x[1]); });
    if (ini < s) r.push([ini, s]);
    return r;
  }
  function textoHorario(p) { return blocos(p).map(function (b) { return hhmm(b[0]) + '-' + hhmm(b[1]); }).join(' / '); }
  function minutosTrab(p) { return blocos(p).reduce(function (a, b) { return a + b[1] - b[0]; }, 0); }
  function chips(p) {
    var h = '', e = min(p.ent), s = min(p.sai);
    if (e != null && s != null && s > e) h += '<i class="tr">' + hhmm(e) + '–' + hhmm(s) + '</i>';
    paradas(p).forEach(function (x) { if (x[2] === 'ge') return; h += '<i class="' + (x[2] === 'alm' ? 'al' : 'pa') + '">' + (x[2] === 'alm' ? 'almoço ' : 'pausa extra ') + hhmm(x[0]) + '–' + hhmm(x[1]) + '</i>'; });
    var t = minutosTrab(p); if (t) h += '<i class="pa">' + Math.floor(t / 60) + 'h' + ('0' + t % 60).slice(-2) + ' trabalhadas</i>';
    return '<div class="hr">' + (h || '<i class="pa">sem horário</i>') + '</div>';
  }

  // ---------------- tela ----------------
  function tela() {
    if (!q) ler();
    if (!dia) dia = hojeDia();
    var d = DIAS.filter(function (x) { return x[0] === dia; })[0], ss = setores(), h = '';
    h += '<div class="eqDias" role="tablist">' + DIAS.map(function (x) { var n = q.dias[x[0]].setores.reduce(function (a, s) { return a + s.pessoas.filter(function (p) { return !faltou(p.id, x[0]); }).length; }, 0);
      return '<b data-eq="dia" data-v="' + x[0] + '"' + (x[0] === dia ? ' class="on"' : '') + '>' + x[1] + ' <em>' + dm(dataDoDia(x[0])) + '</em>' + (n ? ' <small>' + n + '</small>' : '') + '</b>'; }).join('') + '</div>';
    var nf = ss.reduce(function (a, s) { return a + s.pessoas.filter(function (p) { return faltou(p.id); }).length; }, 0);
    if (nf) h += '<div class="aviso">' + F.ic('alerta') + '<span><b>' + nf + '</b> ' + (nf === 1 ? 'pessoa não veio' : 'pessoas não vieram') + ' em ' + d[2].toLowerCase() + ' ' + dm(dataDoDia(dia)) + ': não aparece' + (nf === 1 ? '' : 'm') + ' na imagem.</span></div>';
    h += '<div class="acoes" style="justify-content:flex-start;flex-wrap:wrap;margin:0 0 10px"><button class="btn ro mini" data-eq="novoSetor">+ Setor</button>' +
      '<button class="btn cl mini" data-eq="copiarDia">Copiar ' + d[1] + ' para…</button>' +
      '<button class="btn cl mini" data-eq="png">' + F.ic('imagem') + ' Gerar imagem (PNG)</button>' +
      '<button class="btn cl mini" data-eq="backup">Cópia (backup)</button></div>';
    var g = geral();
    h += '<div class="card eqGeral"><span>' + F.ic('relogio') + ' <b>Pausa de todos:</b> ' + (g.length ? g.map(function (x) { return x[0] + '–' + x[1]; }).join(' · ') : 'nenhuma') + '</span><button class="lnk" data-eq="geral">Alterar</button></div>';
    if (!ss.length) {
      h += '<div class="card" style="text-align:center"><p class="ct">' + d[2] + ' sem setores ainda</p><p class="cs">Crie os setores e coloque os funcionários com horário, almoço e pausas. Fica salvo neste aparelho.</p>' +
        '<div class="acoes" style="justify-content:center;flex-wrap:wrap"><button class="btn ro" data-eq="modelo">Começar com Separação, Conferência, Faturamento e Produção</button>' +
        '<button class="btn cl" data-eq="novoSetor">Criar setor do zero</button></div></div>';
      return h;
    }
    ss.forEach(function (s, i) {
      var pr = presencas(s);
      h += '<div class="card eqSet"><div class="cab"><b>' + F.esc(s.nome) + '</b><span><button class="lnk" data-eq="novaPessoa" data-v="' + s.id + '">+ Funcionário</button> · <button class="lnk" data-eq="editarSetor" data-v="' + s.id + '">Editar setor</button></span></div>' +
        (pr.length ? pr.map(function (z) {
          var p = z.p, f = faltou(p.id), outros = (p.funcoes || []).filter(function (x) { return x[3] && x[3] !== z.dono.id; });
          var cabeca = '<b>' + F.esc(p.nome) + (f ? ' <span class="bdg ro" style="display:inline-block;margin:0 0 0 6px">Não veio</span>' : '') +
            (!z.casa ? ' <span class="bdg" style="display:inline-block;margin:0 0 0 6px">também em ' + F.esc(z.dono.nome) + '</span>' : '') + '</b>';
          var corpo = z.casa ? (p.funcao ? '<span>' + F.esc(p.funcao) + '</span>' : '') : '';
          var tr = z.tr.length ? z.tr : (z.casa ? [] : []);
          var fn = (z.casa ? (p.funcoes || []).slice().sort(function (a, b) { return (min(a[0]) || 0) - (min(b[0]) || 0); }) : tr).map(function (x) {
            var fora = x[3] && x[3] !== s.id; return '<i class="fn">' + F.esc(x[0] + '–' + x[1] + ' · ' + x[2] + (fora ? ' (' + nomeSetor(x[3]) + ')' : '')) + '</i>'; }).join('');
          return '<div class="eqPes' + (f ? ' falta' : '') + (z.casa ? '' : ' visita') + '"><div class="nm">' + cabeca + corpo + (fn ? '<div class="hr">' + fn + '</div>' : '') + (z.casa ? chips(p) : '') + '</div>' +
            '<div class="eqAc"><button class="lnk ro" data-eq="editarPessoa" data-v="' + z.dono.id + '|' + p.id + '">Editar</button>' +
            (z.casa ? '<button class="lnk" data-eq="falta" data-v="' + p.id + '|' + (f ? 0 : 1) + '">' + (f ? 'Veio sim' : 'Não veio') + '</button>' : '') + '</div></div>';
        }).join('') : '<div class="vazio2">Nenhum funcionário neste setor.</div>') + '</div>';
    });
    if (q.atualizado) h += '<p class="cs" style="text-align:center">Salvo neste aparelho · ' + X.dh(q.atualizado) + '</p>';
    return h;
  }

  // ---------------- janelas de edição ----------------
  function campoHora(idc, v) { return '<input type="time" class="inp" id="' + idc + '" value="' + F.esc(v || '') + '">'; }
  function corpoHorario(o) {
    var h = '<div class="sub2">' + X.campo('Entrada', campoHora('eqEnt', o.ent)) + X.campo('Saída', campoHora('eqSai', o.sai)) + '</div>' +
      '<div class="sub2">' + X.campo('Almoço: início', campoHora('eqAlmI', o.alm && o.alm[0])) + X.campo('Almoço: fim', campoHora('eqAlmF', o.alm && o.alm[1])) + '</div>' +
      '<p class="ct" style="font-size:13px;margin:4px 0 2px">' + (ed && ed.tipo === 'g' ? 'Pausas' : 'Pausas extras <span class="cs" style="font-weight:500">(só desta pessoa)</span>') + '</p>' +
      (ed && ed.tipo === 'g' ? '' : '<p class="cs" style="margin:0 0 6px">A pausa de todos (' + (geral().map(function (x) { return x[0] + '–' + x[1]; }).join(', ') || 'nenhuma') + ') já entra sozinha.</p>');
    (o.pausas || []).forEach(function (x, i) {
      h += '<div class="eqLinha">' + campoHora('eqPI' + i, x[0]) + '<span>até</span>' + campoHora('eqPF' + i, x[1]) + '<button class="lnk" data-eq="tiraPausa" data-v="' + i + '" aria-label="Tirar pausa">×</button></div>';
    });
    return h + '<button class="lnk" data-eq="maisPausa">+ Pausa</button>';
  }
  /** Lê os campos de horário da janela aberta para dentro de "o". */
  function lerHorario(o) {
    o.ent = X.val('eqEnt'); o.sai = X.val('eqSai');
    var ai = X.val('eqAlmI'), af = X.val('eqAlmF'); o.alm = ai || af ? [ai, af] : null;
    var l = []; for (var i = 0; document.getElementById('eqPI' + i); i++) { var a = X.val('eqPI' + i), b = X.val('eqPF' + i); l.push([a, b]); }
    o.pausas = l;
  }
  function validarFuncoes(p) {
    var l = p.funcoes || [];
    for (var i = 0; i < l.length; i++) { var a = min(l[i][0]), b = min(l[i][1]);
      if (a == null || b == null || b <= a) return 'Confira o horário da função ' + (i + 1) + '.'; if (!l[i][2]) return 'Escreva a função ' + (i + 1) + '.'; }
    return '';
  }
  /** Trechos (função por horário) de "p" que são do setor "sid". Trecho sem setor = setor da própria pessoa. */
  function trechos(p, sid, dono) {
    return (p.funcoes || []).filter(function (x) { return min(x[0]) != null && min(x[1]) != null && (x[3] || dono) === sid; })
      .slice().sort(function (a, b) { return min(a[0]) - min(b[0]); });
  }
  /** Quem aparece em cada setor: a pessoa no setor dela e também nos outros setores onde tem trecho de função. */
  function presencas(s) {
    var l = [];
    setores().forEach(function (o) {
      o.pessoas.forEach(function (p) {
        var tem = (p.funcoes || []).length, tr = trechos(p, s.id, o.id);
        if (o.id === s.id && (!tem || tr.length || !(p.funcoes || []).some(function (x) { return (x[3] || o.id) !== o.id; }))) l.push({ p: p, dono: o, tr: tr, casa: true });
        else if (o.id !== s.id && tr.length) l.push({ p: p, dono: o, tr: tr, casa: false });
      });
    });
    return l;
  }
  function nomeSetor(sid) { var s = acharSetor(sid); return s ? s.nome : ''; }
  /** Texto da função: as trocas por horário (uma por linha) ou a função fixa. */
  function funcaoTexto(p, sep) {
    var l = (p.funcoes || []).filter(function (x) { return min(x[0]) != null && min(x[1]) != null && x[2]; }).slice().sort(function (a, b) { return min(a[0]) - min(b[0]); });
    if (!l.length) return p.funcao || '';
    return (p.funcao ? p.funcao + sep : '') + l.map(function (x) { return x[0] + '–' + x[1] + ' · ' + x[2]; }).join(sep);
  }
  function validar(o) {
    var e = min(o.ent), s = min(o.sai);
    if ((o.ent || o.sai) && (e == null || s == null)) return 'Preencha entrada e saída.';
    if (e != null && s != null && s <= e) return 'A saída tem que ser depois da entrada.';
    if (o.alm && (min(o.alm[0]) == null || min(o.alm[1]) == null || min(o.alm[1]) <= min(o.alm[0]))) return 'Confira o horário do almoço.';
    for (var i = 0; i < (o.pausas || []).length; i++) { var a = min(o.pausas[i][0]), b = min(o.pausas[i][1]); if (a == null || b == null || b <= a) return 'Confira a pausa ' + (i + 1) + '.'; }
    return '';
  }
  function abrirPessoa() {
    var s = acharSetor(ed.sid), p = ed.p, novo = ed.novo;
    X.modal((novo ? 'Novo funcionário' : 'Funcionário') + ' · ' + F.esc(s.nome), DIAS.filter(function (x) { return x[0] === dia; })[0][2],
      X.campo('Nome', '<input class="inp" id="eqNome" maxlength="60" value="' + F.esc(p.nome || '') + '">') +
      X.campo('Função / resumo', '<input class="inp" id="eqFunc" maxlength="120" value="' + F.esc(p.funcao || '') + '" placeholder="Ex.: separação de pedidos">') +
      '<p class="ct" style="font-size:13px;margin:4px 0 2px">Troca de função no dia <span class="cs" style="font-weight:500">(opcional)</span></p><p class="cs" style="margin:0 0 6px">Ex.: separação até 12:30 e conferência depois do almoço. Escolha o setor: a pessoa aparece nos dois.</p>' +
      (p.funcoes || []).map(function (x, i) {
        return '<div class="eqLinha eqFn">' + campoHora('eqFI' + i, x[0]) + '<span>até</span>' + campoHora('eqFF' + i, x[1]) + '<button class="lnk" data-eq="tiraFuncao" data-v="' + i + '" aria-label="Tirar">×</button></div>' +
          '<div class="eqLinha" style="margin:-2px 0 10px"><select class="inp" id="eqFS' + i + '" style="flex:0 0 38%">' + setores().map(function (o) { return '<option value="' + o.id + '"' + ((x[3] || ed.sid) === o.id ? ' selected' : '') + '>' + F.esc(o.nome) + '</option>'; }).join('') + '</select>' +
          '<input class="inp" id="eqFT' + i + '" maxlength="80" value="' + F.esc(x[2] || '') + '" placeholder="Função nesse horário"></div>';
      }).join('') + '<button class="lnk" data-eq="maisFuncao" style="margin-bottom:8px">+ Função por horário</button>' +
      corpoHorario(p) +
      '<div class="sugs" style="margin-top:10px">' + (s.padrao ? '<button data-eq="usarPadrao">Usar horário padrão do setor</button>' : '') + '<button data-eq="limparHorario">Sem horário</button></div>' +
      '<label class="eqCk"><input type="checkbox" id="eqSemana"' + (ed.semana ? ' checked' : '') + '> Aplicar também de segunda a sexta</label>' +
      (!novo ? '<div class="acoes" style="justify-content:flex-start;margin-top:6px"><button class="btn cl mini" data-eq="moverP" data-v="-1">↑ Subir</button><button class="btn cl mini" data-eq="moverP" data-v="1">↓ Descer</button></div>' : ''),
      (novo ? [] : [['eqExcluirP', 'Excluir', 'cl']]).concat([['cancelar', 'Cancelar', 'cl'], ['eqSalvarP', 'Salvar', 'ro']]));
  }
  function abrirSetor() {
    var s = ed.s, novo = ed.novo;
    X.modal(novo ? 'Novo setor' : 'Setor · ' + F.esc(s.nome), 'O horário padrão é opcional: serve de atalho ao cadastrar os funcionários do setor.',
      X.campo('Nome do setor', '<input class="inp" id="eqNome" maxlength="40" value="' + F.esc(s.nome || '') + '" placeholder="Ex.: SEPARAÇÃO">') +
      '<p class="ct" style="font-size:13.5px;margin:10px 0 6px">Horário padrão do setor</p>' + corpoHorario(s.padrao || {}) +
      '<label class="eqCk"><input type="checkbox" id="eqSemana"' + (ed.semana ? ' checked' : '') + '> Criar/atualizar também de segunda a sexta</label>' +
      (!novo ? '<div class="acoes" style="justify-content:flex-start;margin-top:6px"><button class="btn cl mini" data-eq="moverS" data-v="-1">↑ Subir</button><button class="btn cl mini" data-eq="moverS" data-v="1">↓ Descer</button></div>' : ''),
      (novo ? [] : [['eqExcluirS', 'Excluir setor', 'cl']]).concat([['cancelar', 'Cancelar', 'cl'], ['eqSalvarS', 'Salvar', 'ro']]));
  }
  function abrirGeral() {
    X.modal('Pausa de todos', 'Todo mundo para junto nesse horário. Entra sozinha no horário de cada um e aparece no topo da imagem.',
      corpoHorario({ pausas: ed.g }).replace(/<div class="sub2">[\s\S]*?<\/div><div class="sub2">[\s\S]*?<\/div>/, ''), [['cancelar', 'Cancelar', 'cl'], ['eqSalvarG', 'Salvar', 'ro']]);
  }
  /** Mantém o que já foi digitado ao redesenhar a janela (+ pausa, × pausa). */
  function guardarDigitado() {
    if (ed.tipo === 'g') { var lg = []; for (var j = 0; document.getElementById('eqPI' + j); j++) lg.push([X.val('eqPI' + j), X.val('eqPF' + j)]); ed.g = lg; return; }
    var o = ed.tipo === 'p' ? ed.p : (ed.s.padrao = ed.s.padrao || {});
    var n = document.getElementById('eqNome'); if (n) (ed.tipo === 'p' ? ed.p : ed.s).nome = n.value;
    var f = document.getElementById('eqFunc'); if (f) ed.p.funcao = f.value;
    if (ed.tipo === 'p') { var fl = []; for (var i = 0; document.getElementById('eqFI' + i); i++) fl.push([X.val('eqFI' + i), X.val('eqFF' + i), (X.val('eqFT' + i) || '').trim(), X.val('eqFS' + i) || ed.sid]); ed.p.funcoes = fl; }
    var sm = document.getElementById('eqSemana'); if (sm) ed.semana = sm.checked;
    lerHorario(o);
  }
  function reabrir() { if (ed.tipo === 'p') abrirPessoa(); else if (ed.tipo === 'g') abrirGeral(); else abrirSetor(); }
  function salvarGeral() {
    guardarDigitado();
    for (var i = 0; i < ed.g.length; i++) { var a = min(ed.g[i][0]), b = min(ed.g[i][1]); if (a == null || b == null || b <= a) { X.erroModal('Confira a pausa ' + (i + 1) + '.'); return; } }
    q.pausaGeral = ed.g; gravar(); X.fechar(); F.toast('Pausa de todos salva'); redesenhar();
  }
  var SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex'];

  function salvarPessoa() {
    guardarDigitado();
    var p = ed.p; p.nome = (p.nome || '').trim().toUpperCase(); p.funcao = (p.funcao || '').trim();
    if (!p.nome) { X.erroModal('Escreva o nome.'); return; }
    var e = validar(p) || validarFuncoes(p); if (e) { X.erroModal(e); return; }
    var dias = ed.semana ? SEMANA.concat(SEMANA.indexOf(dia) < 0 ? [dia] : []) : [dia], s0 = acharSetor(ed.sid);
    dias.forEach(function (dd) {
      var ss = q.dias[dd].setores, s = ss.filter(function (x) { return x.id === s0.id; })[0];
      if (!s) { s = { id: s0.id, nome: s0.nome, padrao: s0.padrao ? copia(s0.padrao) : null, pessoas: [] }; ss.push(s); }
      var i = s.pessoas.map(function (x) { return x.id; }).indexOf(p.id);
      if (i >= 0) s.pessoas[i] = copia(p); else s.pessoas.push(copia(p));
    });
    gravar(); X.fechar(); F.toast(dias.length > 1 ? 'Salvo de segunda a sexta' : 'Salvo'); redesenhar();
  }
  function excluirPessoa() {
    var s = acharSetor(ed.sid); s.pessoas = s.pessoas.filter(function (x) { return x.id !== ed.p.id; });
    gravar(); X.fechar(); F.toast('Funcionário tirado de ' + DIAS.filter(function (x) { return x[0] === dia; })[0][2]); redesenhar();
  }
  function salvarSetor() {
    guardarDigitado();
    var s = ed.s; s.nome = (s.nome || '').trim().toUpperCase();
    if (!s.nome) { X.erroModal('Escreva o nome do setor.'); return; }
    var pd = s.padrao || {}; if (!pd.ent && !pd.sai && !pd.alm && !(pd.pausas || []).length) s.padrao = null;
    var e = s.padrao ? validar(s.padrao) : ''; if (e) { X.erroModal(e); return; }
    var dias = ed.semana ? SEMANA.concat(SEMANA.indexOf(dia) < 0 ? [dia] : []) : [dia];
    dias.forEach(function (dd) {
      var ss = q.dias[dd].setores, x = ss.filter(function (y) { return y.id === s.id; })[0];
      if (x) { x.nome = s.nome; x.padrao = s.padrao ? copia(s.padrao) : null; }
      else ss.push({ id: s.id, nome: s.nome, padrao: s.padrao ? copia(s.padrao) : null, pessoas: dd === dia ? [] : [] });
    });
    gravar(); X.fechar(); redesenhar();
  }
  function excluirSetor() {
    var s = acharSetor(ed.s.id);
    if (s && s.pessoas.length && !ed.confirmar) { ed.confirmar = true; X.erroModal('O setor tem ' + s.pessoas.length + ' funcionário(s). Toque em "Excluir setor" de novo para confirmar.'); return; }
    q.dias[dia].setores = setores().filter(function (x) { return x.id !== ed.s.id; });
    gravar(); X.fechar(); redesenhar();
  }
  function mover(lista, idx, dir) { var j = idx + dir; if (j < 0 || j >= lista.length) return; var t = lista[idx]; lista[idx] = lista[j]; lista[j] = t; }

  function copiarDia() {
    var d = DIAS.filter(function (x) { return x[0] === dia; })[0];
    X.modal('Copiar ' + d[2] + ' para…', 'Os dias marcados ficam iguais a ' + d[2].toLowerCase() + ' (o que tinha neles é substituído).',
      DIAS.filter(function (x) { return x[0] !== dia; }).map(function (x) { return '<label class="eqCk"><input type="checkbox" class="eqDiaCk" value="' + x[0] + '"' + (SEMANA.indexOf(x[0]) >= 0 ? ' checked' : '') + '> ' + x[2] + '</label>'; }).join(''),
      [['cancelar', 'Cancelar', 'cl'], ['eqCopiarOk', 'Copiar', 'ro']]);
  }
  function copiarOk() {
    var alvo = [].map.call(document.querySelectorAll('.eqDiaCk:checked'), function (c) { return c.value; });
    if (!alvo.length) { X.erroModal('Marque pelo menos um dia.'); return; }
    alvo.forEach(function (dd) { q.dias[dd] = { setores: copia(q.dias[dia].setores) }; });
    gravar(); X.fechar(); F.toast('Copiado para ' + alvo.length + ' dia(s)'); redesenhar();
  }
  function modelo() {
    q.dias[dia].setores = ['SEPARAÇÃO', 'CONFERÊNCIA', 'FATURAMENTO', 'PRODUÇÃO'].map(function (n) { return { id: id(), nome: n, padrao: null, pessoas: [] }; });
    gravar(); redesenhar();
  }

  // ---------------- cópia (backup) ----------------
  function backup() {
    X.modal('Cópia do quadro (backup)', 'Guarde a cópia para restaurar depois ou abrir o mesmo quadro em outro aparelho.',
      '<div class="acoes" style="flex-direction:column;align-items:stretch"><button class="btn ro" data-eq="fazerCopia">Fazer cópia agora</button>' +
      '<button class="btn cl" data-eq="restaurar">Restaurar uma cópia…</button></div><input type="file" id="eqArq" accept=".json,application/json" style="display:none">',
      [['cancelar', 'Fechar', 'cl']]);
  }
  function fazerCopia() {
    var d = new Date(), nome = 'Freedom-equipe_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json', t = JSON.stringify(q, null, 1);
    try { if (App.salvarCopia) { App.salvarCopia(nome, t); X.fechar(); return; } } catch (e) { }
    try { var a = document.createElement('a'); a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(t); a.download = nome; document.body.appendChild(a); a.click(); a.remove(); X.fechar(); }
    catch (e) { X.erroModal('Não consegui fazer a cópia neste aparelho.'); }
  }
  function restaurar(arq) {
    var r = new FileReader();
    r.onload = function () {
      var n; try { n = JSON.parse(r.result); } catch (e) { n = null; }
      if (!n || !n.dias) { X.erroModal('Esse arquivo não é uma cópia do quadro de equipe.'); return; }
      q = n; DIAS.forEach(function (d) { q.dias[d[0]] = q.dias[d[0]] || { setores: [] }; });
      gravar(); X.fechar(); F.toast('Quadro restaurado'); redesenhar();
    };
    r.onerror = function () { X.erroModal('Não consegui ler o arquivo.'); };
    r.readAsText(arq);
  }

  // ---------------- imagem (PNG), no formato da planilha ----------------
  function png() {
    var ss = setores(), d = DIAS.filter(function (x) { return x[0] === dia; })[0], dt = dataDoDia(dia);
    var vivos = function (s) { return s.pessoas.filter(function (p) { return !faltou(p.id); }); };   // quem não veio nem aparece
    var total = ss.reduce(function (a, s) { return a + vivos(s).length; }, 0);
    if (!total) { F.toast('Ninguém no quadro deste dia'); return; }
    var hora = function (p) { var e = min(p.ent), sa = min(p.sai); return e != null && sa != null && sa > e ? hhmm(e) + '–' + hhmm(sa) : '—'; };
    var alm = function (p) { return p.alm && min(p.alm[0]) != null && min(p.alm[1]) != null ? p.alm[0] + '–' + p.alm[1] : '—'; };
    var pau = function (p) { var l = pausasDe(p); return l.length ? l.map(function (x) { return x[0] + '–' + x[1]; }).join('\n') : '—'; };
    var dentro = function (x, trs) { return !trs.length || trs.some(function (t) { return min(x[0]) >= min(t[0]) && min(x[1]) <= min(t[1]); }); };
    /** Horário numa linha só, igual à planilha: "07:45-08:30 / 08:40-12:30 / 13:30-17:33".
        A barra mostra o intervalo: laranja = almoço, cinza = café/pausa. ini/fim limitam a uma parte do dia (troca de setor). */
    var linhaHorario = function (p, ini, fim) {
      var bs = blocos(p).map(function (x) { return [Math.max(x[0], ini == null ? x[0] : ini), Math.min(x[1], fim == null ? x[1] : fim)]; }).filter(function (x) { return x[1] > x[0]; });
      if (!bs.length) return null;
      var a0 = p.alm ? min(p.alm[0]) : null, a1 = p.alm ? min(p.alm[1]) : null, partes = [];
      bs.forEach(function (x, i) {
        if (i) {   // o nome do intervalo entre um horário e outro: almoço, café (a pausa de todos) ou pausa
          var de = bs[i - 1][1], ate = x[0], almoco = a0 != null && de <= a1 && ate >= a0;
          var cafe = geral().some(function (g) { return min(g[0]) < ate && min(g[1]) > de; });
          partes.push([almoco ? '  almoço  ' : cafe ? '  café  ' : '  pausa  ', almoco ? 'laranja' : 'tx3']);
        }
        partes.push([hhmm(x[0]) + '-' + hhmm(x[1]), 'azul']);
      });
      return { partes: partes };
    };
    var linhas = [];
    ss.forEach(function (s) {
      var l = presencas(s).filter(function (z) { return !faltou(z.p.id); }); if (!l.length) return;   // setor sem ninguém não entra
      linhas.push({ sec: s.nome, d: l.length + (l.length === 1 ? ' pessoa' : ' pessoas') });
      l.forEach(function (z) {
        var p = z.p, tr = z.tr;
        if (!tr.length) { linhas.push({ c: [p.nome, funcaoTexto(p, '\n') || '—', linhaHorario(p) || '—'] }); return; }
        // só a parte do dia que a pessoa passa neste setor
        var hs = tr.map(function (t) { return linhaHorario(p, min(t[0]), min(t[1])); }).filter(Boolean), partes = [];
        hs.forEach(function (h, i) { if (i) partes.push(['  ·  ', 'tx3']); partes = partes.concat(h.partes); });
        linhas.push({ c: [p.nome + (z.casa ? '' : '\n(' + z.dono.nome.toLowerCase() + ')'), tr.map(function (x) { return x[2]; }).join('\n'), partes.length ? { partes: partes } : '—'] });
      });
    });
    total = 0; var vistos = {}; ss.forEach(function (s) { s.pessoas.forEach(function (p) { if (!faltou(p.id) && !vistos[p.id]) { vistos[p.id] = 1; total++; } }); });
    var bl = [{ tipo: 'planilha', cols: [['Nome', 0.18, 'l'], ['Resumo', 0.44, 'l'], ['Horário', 0.38, 'c']], linhas: linhas }];
    F.gerarImagem({ titulo: 'Equipe · ' + d[2], sub: dt.toLocaleDateString('pt-BR') + ' · ' + total + (total === 1 ? ' pessoa trabalhando' : ' pessoas trabalhando'),
      arquivo: 'Equipe-' + d[2] + '-' + dm(dt).replace('/', '-'), blocos: bl });
  }

  // ---------------- toques ----------------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-eq],[data-m^="eq"]') : null; if (!t) return;
    var a = t.getAttribute('data-eq'), v = t.getAttribute('data-v'), m = t.getAttribute('data-m');
    if (m) { ({ eqSalvarG: salvarGeral, eqSalvarP: salvarPessoa, eqExcluirP: excluirPessoa, eqSalvarS: salvarSetor, eqExcluirS: excluirSetor, eqCopiarOk: copiarOk })[m](); return; }
    ev.preventDefault();
    if (a === 'dia') { dia = v; redesenhar(); }
    else if (a === 'falta') { var fv = v.split('|'); marcarFalta(fv[0], fv[1] === '1'); F.toast(fv[1] === '1' ? 'Marcado: não veio (some da imagem)' : 'Voltou para o quadro'); }
    else if (a === 'novoSetor') { ed = { tipo: 's', novo: true, s: { id: id(), nome: '', padrao: null }, semana: false }; abrirSetor(); }
    else if (a === 'editarSetor') { var s = acharSetor(v); ed = { tipo: 's', novo: false, s: { id: s.id, nome: s.nome, padrao: s.padrao ? copia(s.padrao) : null }, semana: false }; abrirSetor(); }
    else if (a === 'novaPessoa') { var s2 = acharSetor(v); ed = { tipo: 'p', novo: true, sid: v, p: s2.padrao ? Object.assign({ id: id(), nome: '', funcao: '' }, copia(s2.padrao)) : { id: id(), nome: '', funcao: '', pausas: [] }, semana: false }; abrirPessoa(); }
    else if (a === 'editarPessoa') { var k = v.split('|'), s3 = acharSetor(k[0]), p = s3.pessoas.filter(function (x) { return x.id === k[1]; })[0]; ed = { tipo: 'p', novo: false, sid: k[0], p: copia(p), semana: false }; abrirPessoa(); }
    else if (a === 'maisFuncao') { guardarDigitado(); ed.p.funcoes = (ed.p.funcoes || []).concat([['', '', '', ed.sid]]); reabrir(); }
    else if (a === 'tiraFuncao') { guardarDigitado(); ed.p.funcoes.splice(+v, 1); reabrir(); }
    else if (a === 'geral') { ed = { tipo: 'g', g: copia(q.pausaGeral || []) }; abrirGeral(); }
    else if (a === 'maisPausa' && ed.tipo === 'g') { guardarDigitado(); ed.g.push(['', '']); reabrir(); }
    else if (a === 'tiraPausa' && ed.tipo === 'g') { guardarDigitado(); ed.g.splice(+v, 1); reabrir(); }
    else if (a === 'maisPausa') { guardarDigitado(); var o = ed.tipo === 'p' ? ed.p : ed.s.padrao; o.pausas = (o.pausas || []).concat([['', '']]); reabrir(); }
    else if (a === 'tiraPausa') { guardarDigitado(); var o2 = ed.tipo === 'p' ? ed.p : ed.s.padrao; o2.pausas.splice(+v, 1); reabrir(); }
    else if (a === 'usarPadrao') { guardarDigitado(); var pd = acharSetor(ed.sid).padrao; if (pd) { ed.p.ent = pd.ent; ed.p.sai = pd.sai; ed.p.alm = pd.alm ? pd.alm.slice() : null; ed.p.pausas = copia(pd.pausas || []); } reabrir(); }
    else if (a === 'limparHorario') { guardarDigitado(); ed.p.ent = ''; ed.p.sai = ''; ed.p.alm = null; ed.p.pausas = []; reabrir(); }
    else if (a === 'moverP') { var s4 = acharSetor(ed.sid), i = s4.pessoas.map(function (x) { return x.id; }).indexOf(ed.p.id); mover(s4.pessoas, i, +v); gravar(); redesenhar(); }
    else if (a === 'moverS') { var l = setores(), j = l.map(function (x) { return x.id; }).indexOf(ed.s.id); mover(l, j, +v); gravar(); redesenhar(); }
    else if (a === 'copiarDia') copiarDia();
    else if (a === 'modelo') modelo();
    else if (a === 'png') png();
    else if (a === 'backup') backup();
    else if (a === 'fazerCopia') fazerCopia();
    else if (a === 'restaurar') { var f = document.getElementById('eqArq'); f.onchange = function () { if (f.files && f.files[0]) restaurar(f.files[0]); }; f.click(); }
  });

  return { tela: tela, textoHorario: textoHorario, blocos: blocos, _q: function () { return q; } };
})();
