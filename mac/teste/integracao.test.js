'use strict';
// Testa o app do Mac contra um "site" falso local: login (cookie), módulos, painéis, Helpdesk, fila sem internet.
// Rodar: node mac/teste/integracao.test.js
const http = require('http'), os = require('os'), fs = require('fs'), path = require('path');
let fails = 0; const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
let fora = false, chamadosCriados = [], respostas = [];
const srv = http.createServer((req, res) => {
  if (fora) { req.socket.destroy(); return; }
  let corpo = ''; req.on('data', d => corpo += d); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace('/api/v1', '');
    const ok = (j, st = 200, h = {}) => { res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, h)); res.end(JSON.stringify(j)); };
    const logado = (req.headers.cookie || '').includes('sess=abc');
    if (p === '/auth/login') { const b = JSON.parse(corpo); return b.password === 'certa' ? ok({ ok: 1 }, 200, { 'Set-Cookie': ['sess=abc; Path=/; HttpOnly; Secure; Max-Age=3600', 'csrf=z; Path=/'] }) : ok({ detail: 'x' }, 401); }
    if (!logado) return ok({ detail: 'auth' }, 401);
    if (p === '/auth/me') return ok({ role: 'manager', display_name: 'Gustavo', modules: ['helpdesk', 'commercial', 'logistics'] });
    if (p === '/auth/logout') return ok({});
    if (p === '/dashboard/overview') return ok({ sales_revenue: u.searchParams.get('start_date').slice(5, 7) === hoje.slice(5, 7) ? 1000 : 800, business_days_total: 22, business_days_elapsed: 10, business_days_remaining: 12 });
    if (p === '/dashboard/sellers') return ok({ sellers: [{ seller_name: 'SUPERVISOR - ANA', revenue: 600, meta_revenue: 500 }, { seller_name: 'BIA', revenue: 400, meta_revenue: 1000 }] });
    if (p === '/dashboard/overview/charts') return ok({ daily: [{ sale_date: hoje.slice(0, 8) + '01', revenue: 300, ideal_cumulative_revenue: 100 }] });
    if (p === '/logistics/billing/daily') return ok({ latest_day: { invoice_date: hoje + 'T00:00:00', total_value: '51126.78', order_count: 46, types: [{ order_type_code: 'V', order_type_label: 'Venda', value: 40000, order_count: 38 }] }, days: [{ invoice_date: hoje, total_value: 51126.78, order_count: 46 }] });
    if (p === '/logistics/report/snapshots') return ok({ items: [{ id: 1, standby_value: 10, team_pending: 20 }] });
    if (p === '/helpdesk/tickets' && req.method === 'POST') { chamadosCriados.push(JSON.parse(corpo)); return ok({ id: 99, protocol: 'TI-99' }, 201); }
    if (/\/helpdesk\/tickets\/\d+\/messages/.test(p)) { respostas.push(JSON.parse(corpo).body); return ok({ id: 1 }, 201); }
    if (/\/helpdesk\/tickets\/\d+\/timeline/.test(p)) return ok({ ticket: { id: 5, version: 1 }, items: [] });
    if (p.startsWith('/helpdesk/')) return ok({ items: [], total: 0 });
    ok({ detail: 'nf' }, 404);
  });
});
srv.listen(0, async () => {
  process.env.FREEDOM_TESTE_SITE = 'http://127.0.0.1:' + srv.address().port;
  const base = require('../core/base');
  base.Pastas.iniciar(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-')));
  const Helpdesk = require('../core/helpdesk'), { Chamado, Fila } = require('../core/chamado'), Paineis = require('../core/paineis');
  Helpdesk.usarFila(Fila);
  const { Api, Store, Acesso, ErroLogin } = base;

  console.log('1) login');
  try { await new Api('a@b', 'errada').entrar(); check(false, 'senha errada'); } catch (e) { check(e instanceof ErroLogin, 'senha errada recusada'); }
  const api = new Api('a@b', 'certa'); await api.entrar();
  check(api.cookie.includes('sess=abc') && api.cookies.find(c => c.name === 'sess').httpOnly, 'cookie da sessão (' + api.cookie + ')');
  await Acesso.atualizar(api);
  check(Acesso.helpdesk() && Acesso.tem('commercial'), 'módulos do login');
  Store.salvarLogin('a@b', 'certa');
  check(Store.login()[1] === 'certa', 'login guardado');

  console.log('2) painéis');
  const erro = await Paineis.atualizar();
  check(erro == null, 'atualizou sem erro');
  const c = Paineis.dadosPainel('comercial', {}).dados;
  check(c && c.tipo === 'gestor' && c.valor === 1000 && c.meta === 1500 && c.metaSoma, 'gestor com meta somada');
  check(c.vendedores[0].nome === 'SUP. ANA' && Math.abs(c.porDia - 500 / 12) < 1e-9, 'vendedores e por dia');
  check(c.anterior && c.anterior.valor === 800, 'mês passado');
  check(Array.isArray(c.diario) && c.diario[0].v === 300, 'gráfico do mês');
  const f = Paineis.dadosPainel('faturamento', {}).dados;
  check(f && f.dia.valor === 51126.78 && f.dia.tipos[0].nome === 'Venda' && f.dias.length === 1 && f.pend === 20, 'faturamento');
  const per = await Paineis.buscarPeriodo('comercial', hoje.slice(0, 8) + '01', hoje);
  check(per && per.periodo && per.tipo === 'gestor', 'período escolhido');

  console.log('3) helpdesk');
  const o = await Helpdesk.verificar(true);
  check(o && o.ok && o.firstRun, 'primeira verificação');
  const r = await Chamado.requisicao('POST', '/helpdesk/tickets', JSON.stringify({ title: 'Teste', queue_id: 1 }));
  check(r.status === 201 && chamadosCriados.length === 1, 'abre chamado');
  const resp = await Chamado.responder(5, 'Olá');
  check(resp.ok && respostas[0] === 'Olá', 'responde');
  const g = await Chamado.requisicao('GET', '/helpdesk/queues', '');
  check(g.status === 200, 'consulta e guarda');
  check((await Chamado.historico(5)).ok, 'abre a conversa');

  console.log('4) sem internet');
  fora = true;
  const g2 = await Chamado.requisicao('GET', '/helpdesk/queues', '');
  check(g2.status === 299 && JSON.parse(g2.body)._corpo, 'mostra o que foi salvo');
  const n2 = await Chamado.requisicao('POST', '/helpdesk/tickets', JSON.stringify({ title: 'Offline', queue_id: 1 }));
  check(n2.status === 202 && Fila.quantos() === 1, 'chamado guardado');
  const r2 = await Chamado.responder(5, 'Guardada');
  check(r2.ok && /guardada/.test(r2.mensagem) && Fila.quantos() === 2, 'resposta guardada');
  const h2 = await Chamado.historico(5);
  check(h2.ok && h2.dados.pendentes.length === 1 && h2.mensagem.startsWith('offline:'), 'conversa mostra pendente');
  fora = false;
  const avisos = []; Fila.avisos.on('aviso', t => avisos.push(t));
  Fila.conferirConexao = async () => true;   // no teste não há DNS do site
  await Fila.enviar();
  check(Fila.quantos() === 0 && chamadosCriados.length === 2 && respostas[1] === 'Guardada', 'enviou ao voltar');
  check(avisos.length === 2, 'avisou: ' + avisos.join(' / '));

  console.log('5) metas');
  const m = Paineis.Metas.calcular({ tipo: 'gestor', valor: 2000, meta: 1500, p: 1.33, vendedores: [] });
  check(Array.isArray(m), 'calcula avisos (' + m.length + ')');

  console.log(fails === 0 ? '\nTODOS OS TESTES PASSARAM' : '\n' + fails + ' FALHA(S)');
  srv.close(); process.exit(fails ? 1 : 0);
});
