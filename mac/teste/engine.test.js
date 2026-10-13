'use strict';
// Mesmos cenários do EngineTest (Android) e EngineTeste (Windows), rodando a tradução em JavaScript.
// Rodar: node mac/teste/engine.test.js
const E = require('../core/engine');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

class Fake {
  constructor() { this.tickets = {}; this.timelines = {}; this.summary = sum(0, 0, 0); this.status = 200; this.down = false; this.timelineCalls = 0; }
  async get(path) {
    if (this.down) throw new Error('offline');
    if (this.status !== 200) return { status: this.status, body: '{"detail":"x"}' };
    if (path.includes('/notifications/summary')) return { status: 200, body: JSON.stringify(this.summary) };
    if (path.includes('/timeline')) {
      this.timelineCalls++;
      const id = Number(path.replace(/.*\/tickets\/(\d+)\/timeline.*/, '$1'));
      return { status: 200, body: JSON.stringify({ ticket: this.tickets[id], requester_name: 'Sillas Victor', queue_name: 'Contabilidade', items: this.timelines[id] }) };
    }
    if (path.includes('view=assigned')) return { status: 422, body: '{"detail":[]}' };
    const items = Object.keys(this.tickets).map(Number).sort((a, b) => a - b).map(k => this.tickets[k]);
    return { status: 200, body: JSON.stringify({ items, total: items.length }) };
  }
  ticket(id, protocol, status, created, updated) {
    const t = { id, protocol, title: 'ICMS pedido ' + id, status, priority: 'URGENT', assignee_user_id: 29, queue_id: 9, created_at: created, updated_at: updated, version: 1 };
    this.tickets[id] = t;
    this.timelines[id] = [item(id * 100, 'OPENING', created, 'Sillas Victor', false, 'PEDIDO 118374 URGENTE')];
    return t;
  }
  add(id, it) { this.timelines[id].push(it); }
}
function sum(risk, br, un) { return { workspace: { open: 0, unassigned_active: un, sla_at_risk: risk, sla_breached: br } }; }
function item(id, type, at, who, me, body) { return { id, type, created_at: at, actor: { id: 1, name: who, is_current_user: me, context: me ? 'AGENT' : 'REQUESTER' }, body }; }
function ev(id, at, who, me, et, oldV, newV) { return Object.assign(item(id, 'EVENT', at, who, me, ''), { event_type: et, old_value: oldV, new_value: newV, old_label: oldV, new_label: newV }); }

let state = null;
const avisos = o => o.notes.filter(x => !x.silent).length;
async function run(f, own, force) {
  const o = await E.run(p => f.get(p), state, own, Date.now() + 60000, force || new Set());
  if (o.ok) state = o.newState;
  for (const n of o.notes) console.log('       ' + (n.silent ? '(histórico) ' : '') + '[' + n.title + '] ' + n.lines.join(' | '));
  return o;
}

(async () => {
  const f = new Fake();
  f.ticket(55, 'CONT-08', 'RESOLVED', '2026-10-06 18:27:05', '2026-10-06 18:37:04');
  f.ticket(60, 'CONT-09', 'OPEN', '2026-10-07 10:00:00', '2026-10-07 10:00:00');
  console.log('1) primeira execução');
  let o = await run(f, false);
  check(o.ok && o.firstRun && o.notes.length === 0 && o.monitored === 2, 'sem avisos na primeira vez');
  console.log('2) nada mudou');
  o = await run(f, false);
  check(o.ok && !o.firstRun && o.notes.length === 0, 'nenhum aviso');
  console.log('3) novo chamado');
  f.ticket(61, 'CONT-10', 'OPEN', '2026-10-07 11:00:00', '2026-10-07 11:00:00');
  f.add(61, item(6101, 'MESSAGE', '2026-10-07 11:00:00', 'Sillas Victor', false, 'PEDIDO 118374 URGENTE'));
  f.add(61, ev(6102, '2026-10-07 11:00:00', 'Sillas Victor', false, 'QUEUE_ASSIGNED', null, '9'));
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].isNew && o.notes[0].title.startsWith('Novo chamado CONT-10'), 'avisa novo chamado');
  check(o.notes.length === 1 && o.notes[0].lines.join('|').includes('Aberto por Sillas Victor'), 'quem abriu e a fila');
  check(o.notes.length === 1 && o.notes[0].lines.length === 3, 'sem duplicar descrição/eventos');
  check(o.notes.length === 1 && o.notes[0].path === '/helpdesk/tickets/61', 'abre o chamado');
  console.log('4) resposta de outra pessoa');
  f.add(60, item(6002, 'MESSAGE', '2026-10-07 11:05:00', 'Sillas Victor', false, 'Conseguiu ver?'));
  f.tickets[60].updated_at = '2026-10-07 11:05:00';
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].text === 'Sillas Victor: Conseguiu ver?', 'avisa a mensagem');
  console.log('5) status por outra pessoa');
  f.add(60, ev(6003, '2026-10-07 11:06:00', 'Ana Souza', false, 'STATUS_CHANGED', 'OPEN', 'IN_PROGRESS'));
  Object.assign(f.tickets[60], { status: 'IN_PROGRESS', updated_at: '2026-10-07 11:06:00', version: 2 });
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].text === 'Ana Souza alterou o status: Aberto → Em andamento', 'texto do status');
  console.log('6) ação minha');
  f.add(60, item(6004, 'MESSAGE', '2026-10-07 11:07:00', 'Gustavo Batista', true, 'Vou verificar'));
  f.add(60, ev(6005, '2026-10-07 11:07:01', 'Gustavo Batista', true, 'PRIORITY_CHANGED', 'URGENT', 'HIGH'));
  Object.assign(f.tickets[60], { priority: 'HIGH', updated_at: '2026-10-07 11:07:01', version: 3 });
  o = await run(f, false);
  check(avisos(o) === 0, 'sem aviso por padrão');
  check(o.notes.length === 1 && o.notes[0].silent && o.notes[0].lines.join('|').includes('Gustavo Batista: Vou verificar'), 'vai pro histórico');
  console.log('6b) minhas ações ligado');
  f.add(60, ev(6006, '2026-10-07 11:08:00', 'Gustavo Batista', true, 'ASSIGNEE_CHANGED', null, 'Gustavo Batista'));
  f.tickets[60].updated_at = '2026-10-07 11:08:00';
  o = await run(f, true);
  check(o.notes.length === 1 && !o.notes[0].silent && o.notes[0].text.includes('definiu o responsável: Gustavo Batista'), 'avisa quando ligado');
  console.log('7) resposta sem mudar updated_at');
  f.add(60, item(6007, 'MESSAGE', '2026-10-07 11:09:00', 'Sillas Victor', false, 'Obrigado!'));
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].text.includes('Obrigado!'), 'detecta pelo rodízio');
  console.log('8) anexo + reaberto');
  f.add(55, ev(5501, '2026-10-07 11:10:00', 'Sillas Victor', false, 'STATUS_CHANGED', 'RESOLVED', 'OPEN'));
  const att = ev(5502, '2026-10-07 11:10:05', 'Sillas Victor', false, 'ATTACHMENT_ADDED', null, '36'); att.metadata = { attachment_id: 36, filename: 'nota.pdf' };
  f.add(55, att);
  Object.assign(f.tickets[55], { status: 'OPEN', updated_at: '2026-10-07 11:10:05', version: 4 });
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].lines.length === 2 && o.notes[0].lines[1].includes('anexou um arquivo: nota.pdf'), 'status + anexo');
  console.log('9) chamado antigo não é novo');
  f.ticket(10, 'LOG-01', 'RESOLVED', '2026-10-01 09:00:00', '2026-10-01 10:00:00');
  o = await run(f, false);
  check(o.notes.length === 0, 'sem falso novo');
  console.log('10) SLA em risco');
  f.summary = sum(2, 0, 0);
  o = await run(f, false);
  check(o.notes.length === 1 && o.notes[0].text === 'SLA em risco: 2 chamado(s)', 'alerta de SLA');
  console.log('11) sessão expirada');
  f.status = 401; o = await run(f, false);
  check(o.sessionExpired && !o.ok, 'detecta 401'); f.status = 200;
  console.log('12) sem internet');
  f.down = true; o = await run(f, false);
  check(!o.ok && o.error != null && !o.sessionExpired, 'erro sem perder estado');
  f.down = false; o = await run(f, false);
  check(o.ok && o.notes.length === 0, 'volta sem repetir');
  console.log('13) muitos chamados');
  for (let i = 0; i < 60; i++) f.ticket(200 + i, 'X-' + i, 'OPEN', '2026-10-05 08:00:00', '2026-10-05 08:00:00');
  f.timelineCalls = 0; o = await run(f, false);
  check(f.timelineCalls <= E.MAX_TIMELINES, 'consultou ' + f.timelineCalls + ' históricos');
  f.timelineCalls = 0; o = await run(f, false);
  check(o.notes.length === 0 && f.timelineCalls <= E.ROTATE_ACTIVE, 'em repouso só o rodízio (' + f.timelineCalls + ')');
  console.log('14) sondagem');
  const ordem = E.probeOrder(state);
  check(ordem.length > 0 && ordem.indexOf(10) < 0, 'só ativos (' + ordem.length + ')');
  const alvo = ordem.find(id => E.baselined(state, id) && id >= 200) || 0;
  check(alvo > 0, 'chamado com histórico: ' + alvo);
  check(!E.timelineHasNew(state, alvo, JSON.stringify({ items: f.timelines[alvo] })), 'nada novo antes');
  f.add(alvo, item(alvo * 100 + 50, 'MESSAGE', '2026-10-07 12:00:00', 'Paolo Yoshitani', false, 'Pode conferir a nota?'));
  check(E.timelineHasNew(state, alvo, JSON.stringify({ items: f.timelines[alvo] })), 'percebe item novo');
  let force = new Set([alvo]);
  o = await run(f, false, force);
  check(o.notes.some(n => n.ticketId === alvo && !n.silent && n.text === 'Paolo Yoshitani: Pode conferir a nota?'), 'avisa na hora');
  o = await run(f, false, force);
  check(avisos(o) === 0, 'não repete');
  console.log('15) resposta minha');
  f.add(61, item(6110, 'MESSAGE', '2026-10-07 12:05:00', 'Gustavo Batista', true, 'Segue o pedido'));
  force = new Set([61]);
  o = await run(f, false, force);
  check(avisos(o) === 0 && o.notes.length === 1 && o.notes[0].silent, 'só histórico');
  f.add(61, item(6111, 'MESSAGE', '2026-10-07 12:06:00', 'Paolo Yoshitani', false, 'Recebido'));
  o = await run(f, false, force);
  check(avisos(o) === 1 && o.notes[0].text === 'Paolo Yoshitani: Recebido', 'outra pessoa avisa');
  console.log('16) linha de base');
  const st = JSON.parse(state); delete st.tickets['230'].wm; state = JSON.stringify(st);
  f.add(230, item(23050, 'MESSAGE', '2026-10-07 12:30:00', 'Paolo Yoshitani', false, 'Mensagem antiga'));
  force = new Set([230]);
  o = await run(f, false, force);
  check(avisos(o) === 0 && E.baselined(state, 230), 'base sem aviso falso');
  f.add(230, item(23051, 'MESSAGE', '2026-10-07 12:31:00', 'Paolo Yoshitani', false, 'Mensagem nova'));
  o = await run(f, false, force);
  check(avisos(o) === 1 && o.notes[0].text.includes('Mensagem nova'), 'depois avisa');
  console.log('17) pedido de conclusão');
  f.add(61, ev(6120, '2026-10-07 12:40:00', 'Paolo Yoshitani', false, 'SOLUTION_PROPOSED', null, null));
  Object.assign(f.tickets[61], { status: 'PENDING_APPROVAL', updated_at: '2026-10-07 12:40:00', version: 5 });
  o = await run(f, false);
  check(avisos(o) === 1 && o.notes[0].lines.join('|').includes('pediu a conclusão'), 'avisa o pedido');
  console.log('18) numeração própria de mensagens e eventos');
  const t70 = f.ticket(70, 'LOG-20', 'OPEN', '2026-10-07 13:00:00', '2026-10-07 13:00:00');
  f.timelines[70] = [];
  f.add(70, item(70, 'OPENING', '2026-10-07 13:00:00', 'Gustavo Batista', true, 'Pedido sem coleta'));
  f.add(70, ev(9001, '2026-10-07 13:05:00', 'Paolo Yoshitani', false, 'ASSIGNEE_CHANGED', null, 'Paolo Yoshitani'));
  f.add(70, ev(9002, '2026-10-07 13:05:01', 'Paolo Yoshitani', false, 'STATUS_CHANGED', 'OPEN', 'IN_PROGRESS'));
  Object.assign(t70, { status: 'IN_PROGRESS', updated_at: '2026-10-07 13:05:01', version: 2 });
  o = await run(f, false);
  force = new Set([70]);
  o = await run(f, false, force);
  f.add(70, item(151, 'MESSAGE', '2026-10-07 13:10:00', 'Paolo Yoshitani', false, 'Pode mandar o comprovante?'));
  check(E.timelineHasNew(state, 70, JSON.stringify({ items: f.timelines[70] })), 'sondagem vê id menor');
  o = await run(f, false, force);
  check(o.notes.some(n => n.ticketId === 70 && !n.silent && n.text.includes('Pode mandar o comprovante?')), 'avisa a resposta');
  f.add(70, item(152, 'MESSAGE', '2026-10-07 13:12:00', 'Paolo Yoshitani', false, 'Chegou?'));
  o = await run(f, false, force);
  check(avisos(o) === 1 && o.notes[0].text.includes('Chegou?'), 'e a seguinte');
  console.log(fails === 0 ? '\nTODOS OS TESTES PASSARAM' : '\n' + fails + ' FALHA(S)');
  process.exit(fails === 0 ? 0 : 1);
})();
