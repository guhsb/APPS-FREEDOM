'use strict';
/**
 * Detecção de alterações no Helpdesk — tradução fiel do Engine.java (Android) / Engine.cs (Windows):
 * mesmas regras, para os três apps avisarem as mesmas coisas.
 */

const API = '/helpdesk';
const MAX_TIMELINES = 30, MAX_TIMELINES_FIRST = 60, ROTATE_ACTIVE = 10, MAX_LINES = 6;
const LISTS = [
  API + '/tickets?page=1&page_size=100',
  API + '/tickets?view=requester&page=1&page_size=100',
  API + '/workspace/tickets?view=queues&page=1&page_size=100',
  API + '/workspace/tickets?view=assigned&page=1&page_size=100'
];

// ---- leitura tolerante (como o org.json) ----
const tem = (o, k) => o != null && typeof o === 'object' && o[k] !== undefined && o[k] !== null;
function os(o, k, d = '') { if (!tem(o, k)) return d; const v = o[k]; return typeof v === 'object' ? JSON.stringify(v) : String(v); }
function oi(o, k, d = 0) { if (!tem(o, k)) return d; const v = Number(o[k]); return isFinite(v) ? Math.trunc(v) : d; }
function ob(o, k, d = false) { if (!tem(o, k)) return d; const v = o[k]; return typeof v === 'boolean' ? v : (v === 'true' ? true : v === 'false' ? false : d); }
function oo(o, k) { return tem(o, k) && typeof o[k] === 'object' && !Array.isArray(o[k]) ? o[k] : null; }
function oa(o, k) { return tem(o, k) && Array.isArray(o[k]) ? o[k] : null; }
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);      // comparação "ordinal" de textos

function ts(s) { if (s == null) return ''; s = String(s).replace(/T/g, ' '); return s.length > 19 ? s.slice(0, 19) : s; }
function str(o, k) { return tem(o, k) ? os(o, k, '') : ''; }
function clean(s) { return s == null ? '' : String(s).replace(/\s+/g, ' ').trim(); }
function clip(s, max) { s = clean(s); return s.length > max ? s.slice(0, max - 1) + '…' : s; }

function isActive(st) { return !(st === 'RESOLVED' || st === 'CLOSED' || st === 'CANCELED' || st === 'CANCELLED'); }

function statusLabel(s) {
  return ({ OPEN: 'Aberto', IN_PROGRESS: 'Em andamento', WAITING: 'Aguardando', REOPENED: 'Reaberto', WAITING_SUPPLIER: 'Aguardando fornecedor',
    PENDING_APPROVAL: 'Aguardando aprovação', RESOLVED: 'Resolvido', CLOSED: 'Fechado', CANCELED: 'Cancelado', CANCELLED: 'Cancelado', '': '—' })[s || ''] || s;
}
function priorityLabel(s) {
  return ({ LOW: 'Baixa', MEDIUM: 'Média', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente', CRITICAL: 'Crítica', '': '—' })[s || ''] || s;
}
function humanize(code) { return !code ? 'atualização' : String(code).replace(/_/g, ' ').toLowerCase(); }
function labelOf(it, p) { let l = str(it, p + '_label'); if (!l) l = str(it, p + '_value'); return l; }

function eventText(it) {
  const et = os(it, 'event_type', ''), oldV = labelOf(it, 'old'), newV = labelOf(it, 'new'), meta = oo(it, 'metadata');
  if (et === 'STATUS_CHANGED') return 'alterou o status: ' + statusLabel(oldV) + ' → ' + statusLabel(newV);
  if (et === 'PRIORITY_CHANGED') return 'alterou a prioridade: ' + priorityLabel(oldV) + ' → ' + priorityLabel(newV);
  if (et === 'ASSIGNEE_CHANGED') return newV.length === 0 ? 'removeu o responsável' : 'definiu o responsável: ' + newV;
  if (et.startsWith('QUEUE') || et.indexOf('TRANSFER') >= 0) return 'transferiu o chamado' + (newV ? ' para a fila ' + newV : '');
  if (et === 'ATTACHMENT_ADDED') { const fn = meta ? os(meta, 'filename', '') : ''; return 'anexou um arquivo' + (fn ? ': ' + fn : ''); }
  if (et === 'SOLUTION_PROPOSED') return 'enviou a solução e pediu a conclusão do chamado';
  if (et === 'SOLUTION_ACCEPTED') return 'aceitou a solução (chamado concluído)';
  if (et === 'SOLUTION_REJECTED') { const m = meta ? os(meta, 'reason', '') : ''; return 'rejeitou a solução' + (m ? ': ' + clip(m, 200) : ''); }
  if (newV) return 'encaminhou o chamado ' + (oldV ? 'de ' + oldV + ' ' : '') + 'para ' + newV;
  return humanize(et);
}

function describe(it, isNew) {
  const type = os(it, 'type', ''), actor = oo(it, 'actor');
  let who = actor ? os(actor, 'name', '') : ''; if (!who) who = 'Sistema';
  const body = os(it, 'body', '');
  if (type === 'OPENING') return isNew ? clip(body, 300) : null;
  if (type === 'MESSAGE') return clean(body) ? who + ': ' + clip(body, 300) : who + ' enviou uma mensagem';
  if (type === 'EVENT') return who + ' ' + eventText(it);
  return clean(body) ? who + ': ' + clip(body, 300) : who + ': ' + humanize(type);
}

function numId(it) {
  const v = it.id;
  if (typeof v === 'string') { const n = Number(v); return /^-?\d+$/.test(v) ? n : -1; }
  return typeof v === 'number' && isFinite(v) ? Math.trunc(v) : -1;
}

function watermarks(items) {
  const wm = {};
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const k = os(it, 'type', ''), iid = numId(it);
    if (iid >= 0 && iid > oi(wm, k, -1)) wm[k] = iid;
    const t = ts(os(it, 'created_at', ''));
    if (cmp(t, os(wm, k + '@', '')) > 0) wm[k + '@'] = t;
  }
  return wm;
}

function isFresh(wm, it) {
  const k = os(it, 'type', ''), iid = numId(it);
  if (iid >= 0) return iid > oi(wm, k, -1);
  return cmp(ts(os(it, 'created_at', '')), os(wm, k + '@', '')) > 0;
}

function lerEstado(s) { try { return s ? JSON.parse(s) : {}; } catch (e) { return {}; } }

function baselined(stateJson, id) {
  const r = oo(oo(lerEstado(stateJson), 'tickets'), String(id));
  return !!(r && oo(r, 'wm'));
}

function timelineHasNew(stateJson, id, body) {
  try {
    const r = oo(oo(lerEstado(stateJson), 'tickets'), String(id));
    const wm = r ? oo(r, 'wm') : null;
    if (!wm) return true;
    const items = oa(JSON.parse(body), 'items');
    if (!items) return false;
    return items.some(it => it && isFresh(wm, it));
  } catch (e) { return false; }
}

function probeOrder(stateJson) {
  try {
    const known = oo(lerEstado(stateJson), 'tickets');
    if (!known) return [];
    const recs = {};
    for (const k of Object.keys(known)) {
      const r = oo(known, k);
      if (!r || !isActive(os(r, 'status')) || !/^-?\d+$/.test(k)) continue;
      recs[k] = r;
    }
    const ids = Object.keys(recs).map(Number);
    ids.sort((a, b) => {
      const ma = ob(recs[a], 'mine'), mb = ob(recs[b], 'mine');
      if (ma !== mb) return ma ? -1 : 1;
      const c = cmp(os(recs[b], 'updated'), os(recs[a], 'updated'));
      return c !== 0 ? c : (b - a);
    });
    return ids;
  } catch (e) { return []; }
}

/**
 * Uma verificação completa. f(caminho) -> Promise<{status, body}>.
 * Devolve { ok, sessionExpired, firstRun, error, newState, monitored, notes:[{ticketId,title,text,lines,path,isNew,silent}] }
 */
async function run(f, stateJson, notifyOwn, deadline, force = new Set()) {
  const outc = { ok: false, sessionExpired: false, firstRun: false, error: null, newState: null, monitored: 0, notes: [] };
  const state = lerEstado(stateJson);
  let known = oo(state, 'tickets');
  const firstRun = known == null;
  if (!known) known = {};
  outc.firstRun = firstRun;
  const wmCreated = os(state, 'wm_created', ''), wmUpdated = os(state, 'wm_updated', '');

  // 1) listas
  const current = [], porId = new Map(), mine = new Set();
  let okLists = 0, lastErr = null;
  for (let li = 0; li < LISTS.length; li++) {
    if (Date.now() > deadline) { if (okLists === 0) lastErr = 'o site demorou para responder'; break; }
    let r;
    try { r = await f(LISTS[li]); } catch (e) { lastErr = 'sem conexão com o servidor'; continue; }
    if (r.status === 401) { outc.sessionExpired = true; outc.error = 'sessão expirada'; return outc; }
    if (r.status !== 200) { if (r.status >= 500) lastErr = 'servidor respondeu ' + r.status; continue; }
    try {
      const items = oa(JSON.parse(r.body), 'items');
      if (items) for (const t of items) {
        if (!t || typeof t !== 'object' || !tem(t, 'id')) continue;
        const id = oi(t, 'id');
        if (!porId.has(id)) current.push(t); else current[current.indexOf(porId.get(id))] = t;
        porId.set(id, t);
        if (li === 1 || li === 3) mine.add(id);
      }
      okLists++;
    } catch (e) { lastErr = 'resposta inesperada do servidor'; }
  }
  if (okLists === 0) { outc.error = lastErr || 'não foi possível consultar o helpdesk'; return outc; }

  // 2) resumo
  let summary = null;
  if (Date.now() < deadline) try { const r = await f(API + '/notifications/summary'); if (r.status === 200) summary = JSON.parse(r.body); } catch (e) { }

  // 3) rodízio dos ativos
  const activeIds = current.filter(t => isActive(os(t, 'status'))).map(t => oi(t, 'id')).sort((a, b) => a - b);
  const rotate = new Set();
  let rr = oi(state, 'rr', 0);
  if (activeIds.length > 0) {
    const n = Math.min(ROTATE_ACTIVE, activeIds.length);
    for (let k = 0; k < n; k++) rotate.add(activeIds[(rr + k) % activeIds.length]);
    rr = (rr + n) % activeIds.length;
  }

  // 4) chamado a chamado
  const newKnown = {};
  let maxCreated = wmCreated, maxUpdated = wmUpdated;
  let timelinesLeft = firstRun ? MAX_TIMELINES_FIRST : MAX_TIMELINES;
  let newTicketsNotified = 0;
  const order = current.filter(t => mine.has(oi(t, 'id'))).concat(current.filter(t => !mine.has(oi(t, 'id'))));

  for (const t of order) {
    const id = oi(t, 'id');
    const protocol = os(t, 'protocol', '#' + id), title = os(t, 'title', ''), status = os(t, 'status', ''), priority = os(t, 'priority', '');
    const assignee = str(t, 'assignee_user_id'), queue = str(t, 'queue_id');
    const created = ts(os(t, 'created_at', '')), updated = ts(os(t, 'updated_at', ''));
    const version = oi(t, 'version', 0);
    const old = oo(known, String(id));
    const oldWm = old ? oo(old, 'wm') : null;
    let newWm = oldWm;

    let isNew = false, unknownTouched = false, touched = false, versionChanged = false;
    const fieldChanges = [];
    if (!old) {
      if (!firstRun) {
        if (cmp(created, wmCreated) > 0) isNew = true;
        else if (cmp(updated, wmUpdated) > 0) unknownTouched = true;
      }
    } else {
      if (status !== os(old, 'status')) fieldChanges.push('Status: ' + statusLabel(os(old, 'status')) + ' → ' + statusLabel(status));
      if (priority !== os(old, 'priority')) fieldChanges.push('Prioridade: ' + priorityLabel(os(old, 'priority')) + ' → ' + priorityLabel(priority));
      if (assignee !== os(old, 'assignee')) fieldChanges.push(assignee.length === 0 ? 'Chamado ficou sem responsável' : 'Responsável alterado');
      if (queue !== os(old, 'queue')) fieldChanges.push('Chamado transferido de fila');
      versionChanged = version !== oi(old, 'version', version);
      touched = updated !== os(old, 'updated') || versionChanged || fieldChanges.length > 0;
    }
    touched = touched || isNew || unknownTouched;

    const forced = force.has(id);
    const wantTimeline = touched || forced || rotate.has(id) || (firstRun && isActive(status));

    let lines = [];
    const ownSeen = [];
    let timelineOk = false, anyOwn = false, anyOther = false;
    let requesterName = '', queueName = '';
    const sinceTs = old ? os(old, 'updated', '') : updated;

    if (wantTimeline && (timelinesLeft > 0 || forced) && Date.now() < deadline) {
      if (!forced) timelinesLeft--;
      try {
        const r = await f(API + '/tickets/' + id + '/timeline');
        if (r.status === 401) { outc.sessionExpired = true; outc.error = 'sessão expirada'; return outc; }
        if (r.status === 200) {
          const tl = JSON.parse(r.body);
          requesterName = os(tl, 'requester_name', ''); queueName = os(tl, 'queue_name', '');
          const items = oa(tl, 'items');
          if (items) newWm = watermarks(items);
          const seen = [];
          let openingBody = null;
          if (items) for (const it of items) {
            if (!it || typeof it !== 'object') continue;
            let fresh;
            if (firstRun || (!old && !isNew && !unknownTouched)) fresh = false;
            else if (isNew) fresh = true;
            else if (oldWm) fresh = isFresh(oldWm, it);
            else fresh = touched && cmp(ts(os(it, 'created_at', '')), sinceTs) > 0;
            if (!fresh) continue;
            const actor = oo(it, 'actor');
            const own = !!actor && ob(actor, 'is_current_user', false);
            if (own) anyOwn = true; else anyOther = true;
            const type = os(it, 'type', '');
            if (own && !notifyOwn) {
              if (!(isNew && type === 'EVENT')) { const ol = describe(it, isNew); if (ol && ownSeen.indexOf(ol) < 0) ownSeen.push(ol); }
              continue;
            }
            if (type === 'OPENING') openingBody = clean(os(it, 'body', ''));
            if (isNew && type === 'EVENT') continue;
            if (isNew && type === 'MESSAGE' && openingBody != null && openingBody === clean(os(it, 'body', ''))) continue;
            const line = describe(it, isNew);
            if (line && seen.indexOf(line) < 0) seen.push(line);
          }
          lines.push(...seen);
          timelineOk = true;
        }
      } catch (e) { }
    }

    // decide se avisa
    let note = null;
    if (isNew) {
      const ownTicket = timelineOk && anyOwn && !anyOther;
      if (!ownTicket || notifyOwn) {
        note = { isNew: true, silent: false, title: 'Novo chamado ' + protocol + (priority ? ' (' + priorityLabel(priority) + ')' : ''), text: title };
        const head = [title];
        let meta = '';
        if (requesterName) meta += 'Aberto por ' + requesterName;
        if (queueName) meta += (meta ? ' · ' : '') + 'Fila ' + queueName;
        if (meta) head.push(meta);
        lines = head.concat(lines);
        newTicketsNotified++;
      }
    } else if (touched || lines.length > 0) {
      if (timelineOk) {
        if (lines.length === 0) {
          if (anyOwn && !anyOther) { /* só ações minhas */ }
          else if (fieldChanges.length > 0) lines.push(...fieldChanges);
          else if (versionChanged || unknownTouched) lines.push('Chamado atualizado');
        }
      } else if (touched) {
        if (fieldChanges.length > 0) lines.push(...fieldChanges);
        else if (versionChanged || unknownTouched) lines.push('Chamado atualizado');
      }
      if (lines.length > 0) note = { isNew: false, silent: false, title: protocol + (title ? ' · ' + title : ''), text: lines[lines.length - 1] };
    }
    if (!note && !notifyOwn && timelineOk && anyOwn && !anyOther) {
      if (isNew) { note = { isNew: true, title: 'Você abriu o chamado ' + protocol, text: title }; lines = [title]; }
      else if (ownSeen.length > 0) { note = { isNew: false, title: protocol + (title ? ' · ' + title : '') }; lines = ownSeen.slice(); note.text = lines[lines.length - 1]; }
      if (note) note.silent = true;
    }
    if (note) {
      note.ticketId = id;
      note.path = '/helpdesk/tickets/' + id;
      if (lines.length > MAX_LINES) {
        const extra = lines.length - MAX_LINES;
        const keep = note.isNew ? lines.slice(0, MAX_LINES) : lines.slice(lines.length - MAX_LINES);
        keep.push('+' + extra + ' outra(s) atualização(ões)');
        lines = keep;
      }
      note.lines = lines;
      outc.notes.push(note);
    }

    const rec = { protocol, title, status, priority, assignee, queue, updated, version };
    if (newWm) rec.wm = newWm;
    if (mine.has(id) || (old && ob(old, 'mine', false))) rec.mine = true;
    newKnown[String(id)] = rec;
    if (cmp(created, maxCreated) > 0) maxCreated = created;
    if (cmp(updated, maxUpdated) > 0) maxUpdated = updated;
  }

  // mantém chamados antigos que saíram das listas (limitado)
  if (Object.keys(newKnown).length < 800) for (const k of Object.keys(known)) if (!(k in newKnown)) newKnown[k] = known[k];

  // 5) alertas do resumo
  if (summary) {
    const ws = oo(summary, 'workspace'), oldSummary = oo(state, 'summary'), ows = oldSummary ? oo(oldSummary, 'workspace') : null;
    if (!firstRun && ws && ows) {
      const sl = [];
      const risk = oi(ws, 'sla_at_risk'), oRisk = oi(ows, 'sla_at_risk');
      const br = oi(ws, 'sla_breached'), oBr = oi(ows, 'sla_breached');
      const un = oi(ws, 'unassigned_active'), oUn = oi(ows, 'unassigned_active');
      if (br > oBr) sl.push('SLA estourado: ' + br + ' chamado(s)');
      if (risk > oRisk) sl.push('SLA em risco: ' + risk + ' chamado(s)');
      if (un > oUn && newTicketsNotified === 0) sl.push(un + ' chamado(s) aguardando responsável na fila');
      if (sl.length > 0) outc.notes.push({ ticketId: 0, title: 'Helpdesk · Central de Atendimento', text: sl[0], path: '/helpdesk/workspace', lines: sl, isNew: false, silent: false });
    }
  }

  state.tickets = newKnown; state.wm_created = maxCreated; state.wm_updated = maxUpdated; state.rr = rr;
  if (summary) state.summary = summary;
  outc.newState = JSON.stringify(state);
  outc.monitored = current.length;
  outc.ok = true;
  return outc;
}

module.exports = { run, probeOrder, watermarks, isFresh, baselined, timelineHasNew, isActive, ts, clean, describe, eventText,
  statusLabel, priorityLabel, MAX_TIMELINES, MAX_TIMELINES_FIRST, ROTATE_ACTIVE };
