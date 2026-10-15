'use strict';
/**
 * Painéis (Comercial e Faturamento): mesmas contas do Dados.kt (Android) e do Paineis.cs (Windows),
 * avisos de meta e o "Atualizador" que busca os números e guarda.
 */
const { EventEmitter } = require('events');
const { Prefs, Store, Api, Acesso, ErroLogin, SemAcesso, agora } = require('./base');

// ---------------- datas (dia = "AAAA-MM-DD", contas em UTC para não sofrer com fuso) ----------------
const D = {
  hoje() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return D.de(p);
  },
  de(iso) { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); },
  iso(d) { return d.toISOString().slice(0, 10); },
  mais(d, n) { return new Date(d.getTime() + n * 86400000); },
  util(d) { const w = d.getUTCDay(); return w !== 0 && w !== 6; },
  ini(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); },
  fim(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); },
  dm(d) { return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2); },
  dmy(d) { return D.dm(d) + '/' + d.getUTCFullYear(); }
};
const N = (o, k) => { if (!o || o[k] == null) return 0; const v = Number(o[k]); return isFinite(v) ? v : 0; };
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

function diasUteis(ini, fim, hoje) {
  let t = 0, dec = 0, rest = 0;
  for (let d = ini; d <= fim; d = D.mais(d, 1)) if (D.util(d)) { t++; if (d <= hoje) dec++; if (d >= hoje) rest++; }
  return [t, dec, rest];
}

const primeiro = (o, ks) => { const k = ks.find(k => o[k] != null); return k ? N(o, k) : 0; };

function gestor(nome, o, sv, ini, fim, hoje) {
  const fat = N(o, 'sales_revenue');
  let t = N(o, 'business_days_total'), dec = N(o, 'business_days_elapsed'), rest = N(o, 'business_days_remaining');
  if (t <= 0) [t, dec, rest] = diasUteis(ini, fim, hoje);
  const idealP = t > 0 ? Math.min(1, dec / t) : 0;
  let todos = Array.isArray(sv.sellers) && sv.sellers.length ? sv.sellers : (Array.isArray(sv.ranking) ? sv.ranking : []);
  const lista = todos.filter(x => x && typeof x === 'object').sort((a, b) => N(b, 'revenue') - N(a, 'revenue'));
  let meta = ['revenue_target', 'target_revenue', 'revenue_goal', 'meta_revenue'].map(k => N(o, k)).find(v => v > 0) || 0;
  let metaSoma = false;
  if (meta <= 0) { meta = lista.reduce((s, x) => s + N(x, 'meta_revenue'), 0); metaSoma = meta > 0; }
  const falta = Math.max(0, meta - fat);
  const vendedores = lista.map(x => {
    const vf = N(x, 'revenue'), vm = N(x, 'meta_revenue');
    return { nome: String(x.seller_name || '').replace('SUPERVISOR - ', 'SUP. '), chave: String(x.seller_name || ''), valor: vf, meta: vm, p: vm > 0 ? vf / vm : 0,
      ideal: vm * idealP, falta: Math.max(0, vm - vf), pedidos: N(x, 'order_count'), clientes: N(x, 'client_count'),
      pos: primeiro(x, ['positive_customer_count', 'positive_customers', 'positivation', 'positivacao', 'client_count']),
      metaPos: primeiro(x, ['positive_customer_target', 'positivation_target', 'meta_positivation', 'meta_positivacao', 'client_target']) };
  });
  return { tipo: 'gestor', nome, valor: fat, meta, p: meta > 0 ? fat / meta : 0, idealP, ideal: meta * idealP, falta, porDia: rest > 0 ? falta / rest : 0,
    pos: N(o, 'positive_customer_count'), metaPos: N(o, 'positive_customer_target'), pedidos: N(o, 'order_count'), ticket: N(o, 'average_order_value'),
    projecao: N(o, 'projected_revenue'), dec, T: t, rest, metaSoma, vendedores };
}

/** Meta da semana ACUMULATIVA: o que faltou nas semanas anteriores entra na semana atual. */
function vendedor(nome, m, s, diario, ini, fim, hoje) {
  const util = {}; let ant = 0;
  for (const d of diario || []) { if (!d) continue; const k = String(d.sale_date || '').slice(0, 10); const v = N(d, 'ideal_cumulative_revenue'); util[k] = v > ant + 0.001; ant = v; }
  const ehUtil = d => (D.iso(d) in util ? util[D.iso(d)] : D.util(d));
  const dias = []; for (let d = ini; d <= fim; d = D.mais(d, 1)) dias.push(d);
  const uteis = dias.filter(ehUtil), passados = uteis.filter(d => d <= hoje);
  const t = N(m, 'business_days_total'), dec = N(m, 'business_days_elapsed'), rest = N(m, 'business_days_remaining');
  const fatS = N(s, 'sales_revenue'), fatM = N(m, 'sales_revenue'), metaM = N(m, 'revenue_target');
  const vendidoAntes = Math.max(0, fatM - fatS), duAntes = Math.max(0, dec - passados.length);
  const metaSem = t > 0 ? Math.max(0, metaM * Math.min(t, duAntes + uteis.length) / t - vendidoAntes) : 0;
  const metaDia = uteis.length ? metaSem / uteis.length : 0, idealS = metaDia * passados.length, faltaS = Math.max(0, metaSem - fatS);
  const restam = Math.max(uteis.filter(d => d > hoje).length, uteis.some(d => d.getTime() === hoje.getTime()) ? 1 : 0);
  const fixa = t > 0 ? metaM / t * uteis.length : 0, idM = t > 0 ? dec / t : 0, faltaM = Math.max(0, metaM - fatM);
  return { tipo: 'vendedor', nome,
    semana: { titulo: 'SEMANA ' + D.dm(ini) + '–' + D.dm(fim), valor: fatS, meta: metaSem, p: metaSem > 0 ? fatS / metaSem : 0,
      idealP: metaSem > 0 ? idealS / metaSem : 0, ideal: idealS, falta: faltaS, porDia: restam > 0 ? faltaS / restam : 0, restam,
      pos: N(s, 'positive_customer_count'), metaPos: N(s, 'positive_customer_target'), acumulado: metaSem - fixa },
    mes: { titulo: 'MÊS', valor: fatM, meta: metaM, p: metaM > 0 ? fatM / metaM : 0, idealP: idM, ideal: metaM * idM, falta: faltaM,
      porDia: rest > 0 ? faltaM / rest : 0, pos: N(m, 'positive_customer_count'), metaPos: N(m, 'positive_customer_target'), dec, T: t, rest } };
}

/** Evolução dia a dia (d, v = vendido no dia, a = acumulado até hoje, i = ideal acumulado). */
function diario(lista, ini, fim, hoje) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const itens = lista.filter(x => x && typeof x === 'object');
  const campo = nomes => nomes.find(k => itens.some(x => x[k] != null));
  const kDia = campo(['revenue', 'sales_revenue', 'daily_revenue', 'total_revenue', 'value']);
  const kAcum = campo(['cumulative_revenue', 'revenue_cumulative', 'accumulated_revenue', 'cumulative_sales_revenue', 'sales_revenue_cumulative']);
  if (!kDia && !kAcum) return null;
  const porDia = {}; for (const x of itens) porDia[String(x.sale_date || x.date || '').slice(0, 10)] = x;
  const r = []; let acum = 0, ideal = 0, antAcum = 0;
  for (let d = ini; d <= fim; d = D.mais(d, 1)) {
    const x = porDia[D.iso(d)];
    let v = kDia ? N(x, kDia) : 0;
    acum = kAcum && x && x[kAcum] != null ? N(x, kAcum) : acum + v;
    if (!kDia) v = Math.max(0, acum - antAcum);
    antAcum = acum;
    if (x && x.ideal_cumulative_revenue != null) ideal = N(x, 'ideal_cumulative_revenue');
    const o = { d: D.iso(d), v, i: ideal };
    if (d <= hoje) o.a = acum;
    r.push(o);
  }
  return r;
}

async function graficoDe(api, q, ini, fim, hoje) {
  try { return diario((await api.get('/dashboard/overview/charts?' + q)).daily, ini, fim, hoje); } catch (e) { return null; }
}

/** Mês passado até o mesmo dia útil. */
async function anterior(api, iniMes, dec, fx = '') {
  try {
    if (!(dec > 0)) return null;
    const pIni = D.ini(D.mais(iniMes, -1)), pUlt = D.fim(pIni);
    let fim = pUlt, cont = 0;
    for (let d = pIni; d <= pUlt; d = D.mais(d, 1)) if (D.util(d)) { cont++; if (cont >= dec) { fim = d; break; } }
    const o = await api.get('/dashboard/overview?start_date=' + D.iso(pIni) + '&end_date=' + D.iso(fim) + fx);
    return { valor: N(o, 'sales_revenue'), ate: D.dm(fim) };
  } catch (e) { return null; }
}

async function comercial(api) {
  const hoje = D.hoje(), iniMes = D.ini(hoje), fimMes = D.fim(hoje);
  const me = await api.get('/auth/me');
  const qMes = 'start_date=' + D.iso(iniMes) + '&end_date=' + D.iso(fimMes) + filtro(me);
  const nome = me.display_name || me.seller_name || '';
  if (ehVendedor(me)) {
    const dow = (hoje.getUTCDay() + 6) % 7, seg = D.mais(hoje, -dow), dom = D.mais(seg, 6);
    const iniSem = seg < iniMes ? iniMes : seg, fimSem = dom > fimMes ? fimMes : dom;
    const qSem = 'start_date=' + D.iso(iniSem) + '&end_date=' + D.iso(fimSem) + filtro(me);
    // o mês é o principal (igual a escolher as datas do mês); a semana é extra: se falhar, fica zerada e o mês aparece igual
    const oMes = await getOuVazio(api, '/dashboard/overview?' + qMes), oSem = await opcional(api, '/dashboard/overview?' + qSem);
    const cSem = await opcional(api, '/dashboard/overview/charts?' + qSem);
    const v = vendedor(nome, oMes, oSem, cSem.daily || [], iniSem, fimSem, hoje);
    const g = await graficoDe(api, qMes, iniMes, fimMes, hoje); if (g) v.mes.diario = g;
    const a = await anterior(api, iniMes, v.mes.dec, filtro(me)); if (a) v.mes.anterior = a;
    return v;
  }
  const o = await getOuVazio(api, '/dashboard/overview?' + qMes), sv = await getOuVazio(api, '/dashboard/sellers?' + qMes);
  const g = gestor(nome, o, sv, iniMes, fimMes, hoje);
  await positivacaoVendedores(api, qMes, g);
  await vendaHoje(api, hoje, filtro(me), g);
  const gg = await graficoDe(api, qMes, iniMes, fimMes, hoje); if (gg) g.diario = gg;
  const ag = await anterior(api, iniMes, g.dec, filtro(me)); if (ag) g.anterior = ag;
  return g;
}

// positivação de cada vendedor guardada por 1 h (não pede de novo a cada atualização de 15 min)
const posCache = new Map();
/** A lista de vendedores não traz a positivação: vem do overview filtrado por vendedor (igual ao filtro do site).
 *  Pede um de cada vez, guarda por 1 h e, se o site der erro, para na hora (para não sobrecarregar o site). */
async function positivacaoVendedores(api, q, g) {
  const agora = Date.now(); let pedidos = 0;
  for (const v of (g.vendedores || [])) {
    if (!v.chave) continue;
    const id = q + '|' + v.chave, c = posCache.get(id);
    let o = c && agora - c[0] < 3600000 ? c[1] : null;
    if (!o) {
      if (pedidos >= 40) continue;
      pedidos++;
      try { o = await api.get('/dashboard/overview?' + q + '&seller=' + encodeURIComponent(v.chave)); } catch (e) { break; }
      posCache.set(id, [agora, o]);
    }
    if (o.positive_customer_count != null) v.pos = N(o, 'positive_customer_count');
    if (o.positive_customer_target != null) v.metaPos = N(o, 'positive_customer_target');
  }
}

/** Quanto cada vendedor vendeu hoje (avisos do gestor: sem venda hoje, acima da média). Se falhar, não marca nada. */
async function vendaHoje(api, hoje, fx, g) {
  const sv = await opcional(api, '/dashboard/sellers?start_date=' + D.iso(hoje) + '&end_date=' + D.iso(hoje) + fx);
  const lista = Array.isArray(sv.sellers) && sv.sellers.length ? sv.sellers : Array.isArray(sv.ranking) ? sv.ranking : (Object.keys(sv).length ? [] : null);
  if (!lista) return;
  const m = new Map(lista.filter(Boolean).map(x => [String(x.seller_name || ''), N(x, 'revenue')]));
  let tot = 0;
  for (const v of (g.vendedores || [])) { v.hoje = m.get(v.chave) || 0; tot += v.hoje; }
  g.temHoje = true; g.hojeEquipe = tot;
}

// ---- quem é quem: o mesmo que o site faz com as permissões do login ----
const perms = me => Array.isArray(me.permissions) ? me.permissions.map(String) : [];
/** Vê só os próprios números (vendedor)? Pelo papel ou, se vier, pelas permissões do site. */
function ehVendedor(me) {
  const p = perms(me);
  if (p.length) return p.indexOf('analytics:view_all') < 0 && p.indexOf('analytics:view_team') < 0;
  return me.role === 'seller';
}
/** Filtro igual ao do site: diretor (view_all) vê tudo; gestor (view_team) a equipe dele; vendedor só ele. */
function filtro(me) {
  const p = perms(me);
  if (p.indexOf('analytics:view_all') >= 0) return '';
  if (p.indexOf('analytics:view_team') >= 0) return me.manager_name ? '&manager=' + encodeURIComponent(me.manager_name) : '';
  if (p.length || me.role === 'seller') return me.seller_name ? '&seller=' + encodeURIComponent(me.seller_name) : '';
  return '';
}

/** Busca que não pode derrubar a tela: qualquer falha (menos login/acesso) vira objeto vazio. */
async function opcional(api, caminho) {
  try { return await api.get(caminho); }
  catch (e) { if (e instanceof SemAcesso || e instanceof ErroLogin) throw e; return {}; }
}

async function getOuVazio(api, caminho) {
  try { return await api.get(caminho); }
  catch (e) { if (!(e instanceof SemAcesso) && !(e instanceof ErroLogin) && /HTTP (204|400|404|422)/.test(e.message || '')) return {}; throw e; }
}

async function periodo(api, iniTxt, fimTxt) {
  const ini = D.de(iniTxt), fim = D.de(fimTxt);
  if (fim < ini) throw new Error('a data final é antes da inicial');
  const me = await api.get('/auth/me');
  const hoje = D.hoje(), q = 'start_date=' + D.iso(ini) + '&end_date=' + D.iso(fim) + filtro(me);
  const nome = me.display_name || me.seller_name || '';
  const titulo = D.dmy(ini) + ' a ' + D.dmy(fim);
  // período sem vendas: o site pode responder "sem dados" (4xx) em vez de zeros — vira painel vazio, não erro
  const o = await getOuVazio(api, '/dashboard/overview?' + q);
  const graf = await graficoDe(api, q, ini, fim, hoje);
  if (ehVendedor(me)) {
    const g = gestor(nome, o, {}, ini, fim, hoje); g.titulo = 'PERÍODO ' + titulo; if (graf) g.diario = graf;
    return { tipo: 'vendedor', nome, periodo: titulo, mes: g, semVendas: N(o, 'sales_revenue') <= 0 };
  }
  const g = gestor(nome, o, await getOuVazio(api, '/dashboard/sellers?' + q), ini, fim, hoje); g.periodo = titulo; if (graf) g.diario = graf;
  await positivacaoVendedores(api, q, g);
  g.semVendas = N(o, 'sales_revenue') <= 0 && !g.vendedores.some(v => v.valor > 0);
  return g;
}

async function faturamento(api) {
  let fat, snaps;
  try { fat = await api.get('/logistics/billing/daily'); snaps = await api.get('/logistics/report/snapshots'); }
  catch (e) { if (e instanceof SemAcesso) throw new SemAcesso('este login não tem acesso ao faturamento'); throw e; }
  const dia = fat.latest_day || {}, hoje = D.hoje(), mesIso = D.iso(hoje).slice(0, 7);
  const dias = Array.isArray(fat.days) ? fat.days : [];
  let totalMes = 0; for (const d of dias) if (d && String(d.invoice_date || '').startsWith(mesIso)) totalMes += N(d, 'total_value');
  const mapT = t => ({ codigo: String(t.order_type_code || ''), nome: String(t.order_type_label || ''), valor: N(t, 'value'), pedidos: N(t, 'order_count') });
  const tipos = (Array.isArray(dia.types) ? dia.types : []).filter(Boolean).map(mapT).sort((a, b) => b.valor - a.valor);
  let snap = null; for (const it of (Array.isArray(snaps.items) ? snaps.items : [])) if (it && (!snap || N(it, 'id') > N(snap, 'id'))) snap = it;
  const porData = {};
  for (const d of dias) {
    if (!d) continue; const dt = String(d.invoice_date || '').slice(0, 10); if (dt.length !== 10) continue;
    const o = { d: dt, v: N(d, 'total_value'), p: N(d, 'order_count') };
    if (Array.isArray(d.types) && d.types.length) o.tipos = d.types.filter(Boolean).map(mapT);
    porData[dt] = o;
  }
  const data = String(dia.invoice_date || '').slice(0, 10);
  if (data.length === 10) porData[data] = Object.assign(porData[data] || { d: data }, { v: N(dia, 'total_value'), p: N(dia, 'order_count'), tipos });
  const listaDias = Object.keys(porData).sort().slice(-70).map(k => porData[k]);
  return { dias: listaDias, dia: { data, valor: N(dia, 'total_value'), pedidos: N(dia, 'order_count'), tipos },
    mes: { nome: MESES[hoje.getUTCMonth()], valor: totalMes }, standby: N(snap, 'standby_value'), pend: N(snap, 'team_pending') };
}

// ---------------- avisos de meta (igual ao AvisosMeta.kt / Metas.cs) ----------------
const Metas = {
  get P() { return Prefs.de('metas'); },
  ligado() { return this.P.getBool('ligado', true); },
  ligar(sim) { this.P.editar().put('ligado', !!sim).commit(); },
  /** Os mesmos avisos do gestor, mas só com os números do próprio vendedor. */
  pessoal(m, s, c) {
    const { hoje, hojeIso: dia, mes, agoraSP, marcar, p, ed, primeira, pct, brlK, out } = c;
    const p0 = v => Math.round(v * 100) + '%', hh = fx => this.hh(fx);
    const util = D.util(hoje), hora = agoraSP.getHours();
    const meta = N(m, 'meta'), pp = N(m, 'p'), idealP = N(m, 'idealP'), rest = N(m, 'rest'), dec = N(m, 'dec');
    const hojeX = (m.diario || []).find(x => x && x.d === dia), hojeV = hojeX ? N(hojeX, 'v') : null;
    if (util && hora >= 8 && hora <= 11 && marcar('eu_manha_' + dia)) {
      const ontem = (m.diario || []).filter(x => x && String(x.d).length === 10 && x.d < dia && D.util(D.de(x.d))).pop();
      const b = [];
      if (ontem) b.push('Ontem ' + brlK(N(ontem, 'v')));
      if (meta > 0 && N(m, 'falta') > 0 && rest > 0) b.push(brlK(N(m, 'porDia')) + '/dia p/ bater');
      else if (meta <= 0) b.push('Mês ' + brlK(N(m, 'valor')));
      out.push([meta > 0 ? 'Bom dia! Você está em ' + p0(pp) + ' da meta' : 'Bom dia!', b.join(' · ')]);
    }
    if (meta <= 0) return;
    const fx = util ? this.faixa(['10:00', '12:00', '14:00', '16:00'], '17:59', hora, agoraSP.getMinutes()) : null;
    if (fx && marcar('eu_ritmo_' + dia + '_' + fx)) {
      out.push(['Seu ritmo ' + hh(fx) + ': ' + p0(pp) + ' da meta', N(m, 'valor') >= N(m, 'ideal') ? 'Acima do ideal' : 'Abaixo do ideal']);
    }
    if (util && pp < 1 && rest >= 1 && rest <= 3 && marcar('eu_reta_' + dia))
      out.push(['Reta final: ' + Math.round(rest) + (rest === 1 ? ' dia útil' : ' dias úteis'), 'Faltam ' + brlK(N(m, 'falta')) + ' · ' + brlK(N(m, 'porDia')) + '/dia']);
    let novo = 0; for (const k of [50, 75, 90]) if (pp >= k / 100 && marcar('eu_marco_' + mes + '_' + k)) novo = k;
    if (novo > 0 && pp < 1) out.push(['Você passou de ' + novo + '% da meta!', brlK(N(m, 'valor')) + ' de ' + brlK(meta)]);
    const kb = 'eu_baixo_' + mes;
    if (pp < idealP - 0.10) ed.put(kb, true);
    else if (pp >= idealP && p.getBool(kb, false)) { ed.remove(kb); if (!primeira) out.push(['Você voltou ao ritmo!', p0(pp) + ' da meta']); }
    if (util && hojeV != null && dec > 0 && N(m, 'valor') > 0 && hojeV >= 1.5 * N(m, 'valor') / dec && marcar('eu_acima_' + dia))
      out.push(['Hoje acima da sua média!', brlK(hojeV) + ' hoje']);
    if (N(m, 'metaPos') > 0 && N(m, 'pos') >= N(m, 'metaPos') && marcar('eu_pos_' + mes))
      out.push(['Positivação batida!', Math.round(N(m, 'pos')) + ' de ' + Math.round(N(m, 'metaPos')) + ' clientes']);
  },
  hh(fx) { return fx.endsWith(':00') ? String(Number(fx.slice(0, 2))) + 'h' : fx.replace(':', 'h'); },
  agoraSP() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })); },
  /** Para não virar spam: tudo de uma atualização vira UM aviso; nada entre 19 h e 8 h; no máximo 8 por dia. */
  /** Regula e garante que todo aviso tenha uma linha de texto embaixo do título. */
  regular(avisos, painel = '') {
    const a = this.agoraSP(), hora = ('0' + a.getHours()).slice(-2) + ':' + ('0' + a.getMinutes()).slice(-2);
    const padrao = painel === 'faturamento' ? 'Atualizado às ' + hora : 'Toque para abrir o painel';
    return this.regularBruto(avisos, painel).map(x => [x[0], String(x[1] || '').trim() ? x[1] : padrao]);
  },
  regularBruto(avisos, painel) {
    if (!avisos || !avisos.length) return [];
    if (painel === 'faturamento') return avisos;     // Faturamento de hoje: horário próprio (17:30–20:00), fora do limite do dia
    const a = this.agoraSP(); if (a.getHours() < 8 || a.getHours() >= 19) return [];
    const k = 'qtd_' + D.iso(D.hoje()), q = this.P.getNum(k, 0);
    if (q >= 8) return [];
    this.P.editar().put(k, q + 1).commit();
    // "solo" (acima / abaixo do ritmo) sai como aviso próprio; o resto vira um aviso só, com os títulos
    const solo = avisos.filter(x => x[2] === 'solo').map(x => [x[0], x[1]]), resto = avisos.filter(x => x[2] !== 'solo');
    if (resto.length > 1) return solo.concat([[resto.length + ' novidades do painel', resto.map(x => '• ' + x[0]).join('\n')]]);
    return solo.concat(resto.map(x => [x[0], x[1]]));
  },
  /** Horário agendado (ex.: "10:00") em que estamos: o último já passado, até "fim"; null fora disso. */
  faixa(horarios, fim, h, m) {
    const min = x => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5)), agora = h * 60 + m;
    if (agora > min(fim)) return null;
    return horarios.filter(x => min(x) <= agora).pop() || null;
  },
  faixaFaturamento(h, m) { return this.faixa(['11:30', '15:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00'], '20:14', h, m); },
  /** "Faturamento de hoje" às 11:30 e 15:00 e de 30 em 30 minutos das 17:30 às 20:00 (dias úteis), com quanto entrou desde o aviso anterior. */
  faturamento(d) {
    const out = [], hoje = D.hoje(); if (!D.util(hoje)) return out;
    const a = this.agoraSP(), faixa = this.faixaFaturamento(a.getHours(), a.getMinutes()); if (!faixa) return out;
    const dia = D.iso(hoje), dd = d.dia;
    if (!dd || dd.data !== dia || N(dd, 'valor') <= 0) return out;
    const mes = dia.slice(0, 7), p = this.P, ed = p.editar(), primeira = !p.getBool('base_' + mes, false);
    const brlK = v => v >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace('.', ',') + ' mi' : v >= 1e3 ? 'R$ ' + (v / 1e3).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' mil' : 'R$ ' + v.toFixed(2).replace('.', ',');
    const k = 'fat_' + dia + '_' + faixa;
    if (!p.getBool(k, false)) {
      ed.put(k, true);
      const v = N(dd, 'valor'), antes = p.get('fatv_' + dia);
      if (!primeira) out.push(['Faturamento hoje: ' + brlK(v), 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' · até ' + ('0' + a.getHours()).slice(-2) + ':' + ('0' + a.getMinutes()).slice(-2)]);
      ed.put('fatv_' + dia, v);
    }
    ed.put('base_' + mes, true).commit();
    return out;
  },
  calcular(d) {
    const out = [];
    if (d.periodo) return out;
    const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hoje = D.hoje(), mes = D.iso(hoje).slice(0, 7), hojeIso = D.iso(hoje);
    const p = this.P, primeira = !p.getBool('base_' + mes, false), ed = p.editar(), marcadas = new Set();
    const marcar = k => { if (p.getBool(k, false) || marcadas.has(k)) return false; marcadas.add(k); ed.put(k, true); return !primeira; };
    const pct = v => v.toFixed(1).replace('.', ',') + '%', p0 = v => Math.round(v * 100) + '%';
    const brlK = v => v >= 1e7 ? 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : v >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') + ' mi'
      : v >= 1e3 ? 'R$ ' + (v / 1e3).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' mil' : 'R$ ' + v.toFixed(2).replace('.', ',');
    if (d.tipo === 'vendedor') {
      const s = d.semana, m = d.mes;
      if (s && N(s, 'meta') > 0 && N(s, 'p') >= 1 && marcar('sem_' + mes + '_' + s.titulo))
        out.push(['Meta da semana batida!', brlK(N(s, 'valor')) + ' (' + p0(N(s, 'p')) + ')']);
      if (m) {
        if (N(m, 'meta') > 0 && N(m, 'p') >= 1) { if (marcar('mes_' + mes)) out.push(['Meta do mês batida!', brlK(N(m, 'valor')) + ' (' + p0(N(m, 'p')) + ')']); }
        this.pessoal(m, s, { hoje, hojeIso, mes, agoraSP, marcar, p, ed, primeira, pct, brlK, out });
      }
    } else {
      if (N(d, 'meta') > 0 && N(d, 'p') >= 1) { if (marcar('mes_' + mes)) out.push(['Meta do mês batida!', 'Equipe: ' + brlK(N(d, 'valor')) + ' (' + p0(N(d, 'p')) + ')']); }

      const bateram = (d.vendedores || []).filter(v => N(v, 'meta') > 0 && N(v, 'valor') >= N(v, 'meta') && marcar('vend_' + mes + '_' + v.nome)).map(v => v.nome);
      if (bateram.length === 1) out.push([bateram[0] + ' bateu a meta do mês!', 'Parabéns!']);
      else if (bateram.length > 1) out.push([bateram.length + ' vendedores bateram a meta', bateram.join(', ')]);
      // avisos sobre cada vendedor (juntando num aviso só quando são vários)
      const lista = d.vendedores || [], dec = N(d, 'dec'), idealP = N(d, 'idealP'), hora = agoraSP.getHours(), util = D.util(hoje);
      const junta = (um, varios, itens) => {
        if (itens.length === 1) out.push([itens[0][0] + ' ' + um, '']);
        else if (itens.length > 1) out.push([itens.length + ' vendedores ' + varios, itens.map(x => x[0]).join(', ')]);
      };
      if (d.temHoje && util) {
        junta('vendeu acima da média hoje', 'acima da média hoje', lista.filter(v => { const h = N(v, 'hoje'), media = dec > 0 ? N(v, 'valor') / dec : 0;
          return h > 0 && media > 0 && h >= media * 1.5 && marcar('acima_' + hojeIso + '_' + v.nome); })
          .map(v => [v.nome]));
        if (hora >= 15 && N(d, 'hojeEquipe') > 0)
          junta('está sem venda hoje', 'sem venda hoje', lista.filter(v => N(v, 'meta') > 0 && N(v, 'hoje') <= 0 && marcar('semvenda_' + hojeIso + '_' + v.nome)).map(v => [v.nome, '']));
      }
      // marcos da meta (50/75/90%): só o maior que acabou de passar
      const marcos = lista.filter(v => N(v, 'meta') > 0).map(v => {
        let novo = 0; for (const m of [50, 75, 90]) if (N(v, 'p') >= m / 100 && marcar('marco_' + mes + '_' + m + '_' + v.nome)) novo = m;
        return novo > 0 && N(v, 'p') < 1 ? [v.nome, novo, v] : null; }).filter(Boolean);
      if (marcos.length === 1) out.push([marcos[0][0] + ' passou de ' + marcos[0][1] + '% da meta', '']);
      else if (marcos.length > 1) out.push([marcos.length + ' vendedores passaram de marcos da meta', marcos.map(x => x[0] + ' ' + x[1] + '%').join(', ')]);
      // voltou ao ritmo: estava 10 pontos abaixo do ideal e agora está no ideal ou acima
      junta('voltou ao ritmo', 'voltaram ao ritmo', lista.filter(v => N(v, 'meta') > 0).map(v => {
        const k = 'baixo_' + mes + '_' + v.nome;
        if (N(v, 'p') < idealP - 0.10) { ed.put(k, true); return null; }
        if (N(v, 'p') >= idealP && p.getBool(k, false)) { ed.remove(k); return primeira ? null : [v.nome]; }
        return null; }).filter(Boolean));
      // resumo da manhã (8–11 h) e reta final (últimos 3 dias úteis)
      if (util && hora >= 8 && hora <= 11 && marcar('manha_' + hojeIso)) {
        const ontem = (d.diario || []).filter(x => x && String(x.d).length === 10 && x.d < hojeIso && D.util(D.de(x.d))).pop();
        const b = [];
        if (ontem) b.push('Ontem ' + brlK(N(ontem, 'v')));
        if (N(d, 'meta') > 0 && N(d, 'falta') > 0 && N(d, 'rest') > 0) b.push(brlK(N(d, 'porDia')) + '/dia p/ bater');
        else if (N(d, 'meta') <= 0) b.push('Mês ' + brlK(N(d, 'valor')));
        out.push([N(d, 'meta') > 0 ? 'Bom dia! Equipe em ' + p0(N(d, 'p')) + ' da meta' : 'Bom dia!', b.join(' · ')]);
      }
      // ritmo da equipe 4x por dia (10 h, 12 h, 14 h, 16 h)
      const fx = util ? this.faixa(['10:00', '12:00', '14:00', '16:00'], '17:59', hora, agoraSP.getMinutes()) : null;
      if (fx && marcar('ritmoeq_' + hojeIso + '_' + fx)) {
        // dois avisos, só com os nomes: quem está acima e quem está abaixo do ritmo
        const com = idealP > 0 ? lista.filter(v => N(v, 'meta') > 0) : [];
        const acima = com.filter(v => N(v, 'p') >= idealP).sort((a, b) => N(b, 'p') - N(a, 'p')).map(v => v.nome);
        const baixo = com.filter(v => N(v, 'p') < idealP).sort((a, b) => N(a, 'p') - N(b, 'p')).map(v => v.nome);
        if (acima.length) out.push(['Acima do ritmo (' + this.hh(fx) + ')', acima.join(', '), 'solo']);
        if (baixo.length) out.push(['Abaixo do ritmo (' + this.hh(fx) + ')', baixo.join(', '), 'solo']);
      }
      if (util && N(d, 'meta') > 0 && N(d, 'p') < 1 && N(d, 'rest') >= 1 && N(d, 'rest') <= 3 && marcar('reta_' + hojeIso)) {
        const perto = lista.filter(v => N(v, 'meta') > 0 && N(v, 'p') >= 0.8 && N(v, 'p') < 1).sort((a, b) => N(b, 'p') - N(a, 'p')).slice(0, 3).map(v => v.nome).join(', ');
        out.push(['Reta final: ' + Math.round(N(d, 'rest')) + (N(d, 'rest') === 1 ? ' dia útil' : ' dias úteis'),
          'Faltam ' + brlK(N(d, 'falta')) + ' · ' + brlK(N(d, 'porDia')) + '/dia' + (perto ? ' · perto: ' + perto : '')]);
      }
      junta('bateu a positivação', 'bateram a positivação', lista.filter(v => N(v, 'metaPos') > 0 && N(v, 'pos') >= N(v, 'metaPos') && marcar('pos_' + mes + '_' + v.nome))
        .map(v => [v.nome]));
    }
    ed.put('base_' + mes, true).commit();
    return out;
  }
};

const TODOS = [
  { id: 'comercial', nomeModulo: 'Comercial', modulo: 'commercial', tela: 'painel-comercial.html', buscar: comercial, buscarPeriodo: periodo, avisos: d => Metas.calcular(d) },
  { id: 'faturamento', nomeModulo: 'Faturamento', modulo: 'logistics', tela: 'painel-faturamento.html', buscar: faturamento, avisos: d => Metas.faturamento(d) }
];

// ---------------- atualizador ----------------
const ev = new EventEmitter();     // 'meta' (titulo, texto, painelId)
let atualizando = false, rodando = null;
const Paineis = {
  ev, TODOS, Metas, D, diario, gestor, vendedor,
  porId(id) { return TODOS.find(p => p.id === id) || null; },
  paraAba() { return TODOS.filter(p => Acesso.tem(p.modulo)); },
  get cache() { return Prefs.de('cache'); },
  get atualizando() { return atualizando; },
  velho(min) { return agora() - this.cache.getNum('tentativa', 0) > min * 60000; },
  atualizar() { return rodando || (rodando = this._atualizar().finally(() => { rodando = null; })); },
  async _atualizar() {
    atualizando = true; ev.emit('mudou');
    const ed = this.cache.editar().put('tentativa', agora());
    let erro = null;
    try {
      const l = Store.login(); if (!l) throw new ErroLogin('abra o app e faça o login');
      const api = new Api(l[0], l[1]); await api.entrar();
      try {
        await Acesso.atualizar(api);
        for (const p of TODOS) {
          if (!Acesso.tem(p.modulo)) { ed.remove('dados_' + p.id).put('erro_' + p.id, 'este login não tem acesso ao ' + p.nomeModulo); continue; }
          try {
            const d = await p.buscar(api);
            ed.put('dados_' + p.id, JSON.stringify(d)).put('hora_' + p.id, agora()).remove('erro_' + p.id);
            if (p.avisos && Metas.ligado()) try { for (const a of Metas.regular(p.avisos(d), p.id)) ev.emit('meta', a[0], a[1], p.id); } catch (e) { }
          } catch (e) {
            const m = Api.mensagem(e); ed.put('erro_' + p.id, m);
            if (e instanceof SemAcesso) ed.remove('dados_' + p.id);
            if (!erro) erro = m;
          }
        }
      } finally { await api.sair(); }
    } catch (e) { const m = Api.mensagem(e); for (const p of TODOS) ed.put('erro_' + p.id, m); erro = m; }
    if (Store.logado()) ed.commit();
    atualizando = false; ev.emit('mudou');
    return erro;
  },
  async buscarPeriodo(id, ini, fim) {
    const p = this.porId(id);
    const l = Store.login(); if (!l) throw new ErroLogin('faça o login');
    const api = new Api(l[0], l[1]); await api.entrar();
    try { return p && p.buscarPeriodo ? await p.buscarPeriodo(api, ini, fim) : null; } finally { await api.sair(); }
  },
  /** O que a tela do painel recebe (mesmo formato do App.dadosPainel do Android). */
  dadosPainel(id, app) {
    const o = {}, p = this.porId(id), c = this.cache;
    if (p) {
      const txt = c.getStr('dados_' + p.id); if (txt) try { o.dados = JSON.parse(txt); } catch (e) { }
      const e = c.getStr('erro_' + p.id); if (e) o.erro = e;
      o.hora = c.getNum('hora_' + p.id, 0); o.titulo = p.nomeModulo;
      if (p.avisos) o.avisoMeta = Metas.ligado();
    }
    Object.assign(o, { atualizando, email: Store.email() || '', nome: 'Freedom', app });
    return o;
  }
};

module.exports = Paineis;
