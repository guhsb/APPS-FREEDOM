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
async function anterior(api, iniMes, dec) {
  try {
    if (!(dec > 0)) return null;
    const pIni = D.ini(D.mais(iniMes, -1)), pUlt = D.fim(pIni);
    let fim = pUlt, cont = 0;
    for (let d = pIni; d <= pUlt; d = D.mais(d, 1)) if (D.util(d)) { cont++; if (cont >= dec) { fim = d; break; } }
    const o = await api.get('/dashboard/overview?start_date=' + D.iso(pIni) + '&end_date=' + D.iso(fim));
    return { valor: N(o, 'sales_revenue'), ate: D.dm(fim) };
  } catch (e) { return null; }
}

async function comercial(api) {
  const hoje = D.hoje(), iniMes = D.ini(hoje), fimMes = D.fim(hoje);
  const qMes = 'start_date=' + D.iso(iniMes) + '&end_date=' + D.iso(fimMes);
  const me = await api.get('/auth/me');
  const nome = me.display_name || me.seller_name || '';
  if (me.role === 'seller') {
    const dow = (hoje.getUTCDay() + 6) % 7, seg = D.mais(hoje, -dow), dom = D.mais(seg, 6);
    const iniSem = seg < iniMes ? iniMes : seg, fimSem = dom > fimMes ? fimMes : dom;
    const qSem = 'start_date=' + D.iso(iniSem) + '&end_date=' + D.iso(fimSem);
    // o mês é o principal (igual a escolher as datas do mês); a semana é extra: se falhar, fica zerada e o mês aparece igual
    const oMes = await getOuVazio(api, '/dashboard/overview?' + qMes), oSem = await opcional(api, '/dashboard/overview?' + qSem);
    const cSem = await opcional(api, '/dashboard/overview/charts?' + qSem);
    const v = vendedor(nome, oMes, oSem, cSem.daily || [], iniSem, fimSem, hoje);
    const g = await graficoDe(api, qMes, iniMes, fimMes, hoje); if (g) v.mes.diario = g;
    const a = await anterior(api, iniMes, v.mes.dec); if (a) v.mes.anterior = a;
    return v;
  }
  const o = await getOuVazio(api, '/dashboard/overview?' + qMes), sv = await getOuVazio(api, '/dashboard/sellers?' + qMes);
  const g = gestor(nome, o, sv, iniMes, fimMes, hoje);
  await positivacaoVendedores(api, qMes, g);
  const gg = await graficoDe(api, qMes, iniMes, fimMes, hoje); if (gg) g.diario = gg;
  const ag = await anterior(api, iniMes, g.dec); if (ag) g.anterior = ag;
  return g;
}

/** A lista de vendedores não traz a positivação: vem do overview filtrado por vendedor (igual ao filtro do site). 4 de cada vez. */
async function positivacaoVendedores(api, q, g) {
  const itens = (g.vendedores || []).slice(0, 60).filter(v => v.chave);
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) {
      const v = itens[i++];
      try {
        const o = await api.get('/dashboard/overview?' + q + '&seller=' + encodeURIComponent(v.chave));
        if (o.positive_customer_count != null) v.pos = N(o, 'positive_customer_count');
        if (o.positive_customer_target != null) v.metaPos = N(o, 'positive_customer_target');
      } catch (e) { }
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
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
  const hoje = D.hoje(), q = 'start_date=' + D.iso(ini) + '&end_date=' + D.iso(fim);
  const me = await api.get('/auth/me');
  const nome = me.display_name || me.seller_name || '';
  const titulo = D.dmy(ini) + ' a ' + D.dmy(fim);
  // período sem vendas: o site pode responder "sem dados" (4xx) em vez de zeros — vira painel vazio, não erro
  const o = await getOuVazio(api, '/dashboard/overview?' + q);
  const graf = await graficoDe(api, q, ini, fim, hoje);
  if (me.role === 'seller') {
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
  calcular(d) {
    const out = [];
    if (d.periodo) return out;
    const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hoje = D.hoje(), mes = D.iso(hoje).slice(0, 7), hojeIso = D.iso(hoje);
    const tarde = agoraSP.getHours() >= 14 && D.util(hoje);
    const p = this.P, primeira = !p.getBool('base_' + mes, false), ed = p.editar(), marcadas = new Set();
    const marcar = k => { if (p.getBool(k, false) || marcadas.has(k)) return false; marcadas.add(k); ed.put(k, true); return !primeira; };
    const pct = v => v.toFixed(1).replace('.', ',') + '%';
    const brlK = v => v >= 1e7 ? 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : v >= 1e6 ? 'R$ ' + (v / 1e6).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',') + ' mi'
      : v >= 1e3 ? 'R$ ' + (v / 1e3).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' mil' : 'R$ ' + v.toFixed(2).replace('.', ',');
    const abaixo = (o, quem) => {
      const pp = N(o, 'p'), ideal = N(o, 'idealP');
      if (!tarde || N(o, 'meta') <= 0 || pp >= ideal - 0.10 || N(o, 'rest') <= 0) return;
      if (!marcar('abaixo_' + hojeIso)) return;
      out.push([quem + ' abaixo do ideal do mês', 'Vendido ' + pct(pp * 100) + ' da meta; o ideal hoje é ' + pct(ideal * 100) + '. Para bater a meta de ' + brlK(N(o, 'meta')) +
        ', faltam ' + brlK(N(o, 'falta')) + ': ' + brlK(N(o, 'porDia')) + ' por dia útil (' + Math.round(N(o, 'rest')) + ' dias).']);
    };
    if (d.tipo === 'vendedor') {
      const s = d.semana, m = d.mes;
      if (s && N(s, 'meta') > 0 && N(s, 'p') >= 1 && marcar('sem_' + mes + '_' + s.titulo))
        out.push(['Meta da semana batida!', 'Você vendeu ' + brlK(N(s, 'valor')) + ' na semana (' + pct(N(s, 'p') * 100) + ' da meta de ' + brlK(N(s, 'meta')) + ').']);
      if (m) {
        if (N(m, 'meta') > 0 && N(m, 'p') >= 1) { if (marcar('mes_' + mes)) out.push(['Meta do mês batida!', 'Você vendeu ' + brlK(N(m, 'valor')) + ' no mês (' + pct(N(m, 'p') * 100) + ' da meta de ' + brlK(N(m, 'meta')) + ').']); }
        else abaixo(m, 'Você está');
      }
    } else {
      if (N(d, 'meta') > 0 && N(d, 'p') >= 1) { if (marcar('mes_' + mes)) out.push(['Meta do mês batida!', 'A equipe faturou ' + brlK(N(d, 'valor')) + ' (' + pct(N(d, 'p') * 100) + ' da meta de ' + brlK(N(d, 'meta')) + ').']); }
      else abaixo(d, 'Equipe');
      const bateram = (d.vendedores || []).filter(v => N(v, 'meta') > 0 && N(v, 'valor') >= N(v, 'meta') && marcar('vend_' + mes + '_' + v.nome)).map(v => v.nome);
      if (bateram.length === 1) out.push([bateram[0] + ' bateu a meta do mês', 'Parabéns! Veja o ranking no painel Comercial.']);
      else if (bateram.length > 1) out.push([bateram.length + ' vendedores bateram a meta', bateram.join(', ')]);
    }
    ed.put('base_' + mes, true).commit();
    return out;
  }
};

const TODOS = [
  { id: 'comercial', nomeModulo: 'Comercial', modulo: 'commercial', tela: 'painel-comercial.html', buscar: comercial, buscarPeriodo: periodo, avisos: d => Metas.calcular(d) },
  { id: 'faturamento', nomeModulo: 'Faturamento', modulo: 'logistics', tela: 'painel-faturamento.html', buscar: faturamento }
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
            if (p.avisos && Metas.ligado()) try { for (const a of p.avisos(d)) ev.emit('meta', a[0], a[1], p.id); } catch (e) { }
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
