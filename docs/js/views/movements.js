import { db } from '../storage.js?v=390';
import { commodityClass } from '../commoditycolor.js?v=390';
import { cleanDeductions, deductionNotes, amountOnTicket, perTonFromTicket } from '../deductions.js?v=390';
import { movementsForEndpoint, bigFirst } from '../derived.js?v=390';
import { num, tons, esc, shortDate, tightDate, todayLocal, dmy } from '../fmt.js?v=390';
import { withholdingClash } from '../fumigation.js?v=390';
import { openSheet, closeSheet, openOver, field, getVal, getNum, confirmDelete, toast, notify, askConfirm } from '../ui.js?v=390';
import { compressAndStampImage } from '../img.js?v=390';
import { displayUrlFor, photoLookupError } from '../photos.js?v=390';
import { specText, extraSpecKey } from '../outload.js?v=390';
import { isTransit, stageOf, STAGES, toFinish } from '../transit.js?v=390';
import { pickableSilos } from '../silopick.js?v=390';
import { heldOf, holdsCommodity } from '../offfarm.js?v=390';
import { gradeFieldHtml, wireGradeField } from '../gradepick.js?v=390';
import { activeSales } from '../paidsales.js?v=390';
import { ordersForLoad, orderState, windowText, orderTitle } from '../orders.js?v=390';
import { freightOrdersForLoad, freightState, freightTitle, freightDestination } from '../freight.js?v=390';
import { openLoadReportSheet, sendLoadTicket, readOrigin, saveOrigin, readDestination, saveDestination, readComments, saveComments, readQuality, saveQuality, readSplit, saveSplit } from './loadreport.js?v=390';
import { nowTime } from '../loadreport.js?v=390';
import { normaliseOutloadNo, duplicateOutloads } from '../outloadno.js?v=390';
import { pageOfRows, PAGE_SIZE } from '../paging.js?v=390';
import { openGinRunSheet } from './ginrun.js?v=390';
import { openModuleMoveSheet } from './modulemove.js?v=390';
import { isHay, hasHayLoad, isUsedOnFarm, avgBaleKg, cleanHayLoad, secondaryTypes, describeBales } from '../hay.js?v=390';
import { hasGin, describeGin, stdBales, hasModules, describeModules, padOffBy, cleanGin } from '../ginning.js?v=390';

const DEST_HINT = 'e.g. Newcastle terminal';
let unsub = null;

/** A ginning run's gin pad deadline: seven days after ginning. Red when it has passed and some of its lint is still not allocated. */
function ginPadLine(m) {
  const off = padOffBy(m.date);
  if (!off) return '';
  const unallocated = (cleanGin(m.gin)?.allocations || []).length === 0 || cleanGin(m.gin).allocations.some((a) => !a.to);
  const late = unallocated && off < todayLocal();
  return `<div class="meta"${late ? ' style="color:var(--danger)"' : ''}>${late ? 'Lint not allocated, was due off the gin pad by ' : 'Off the gin pad by '}${shortDate(off)}</div>`;
}

export function renderMovements(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

// What the list is narrowed to. Kept across repaints so a ticket saved or a
// sync arriving does not wipe the search someone is part-way through.
let listFilter = { q: '', commodityId: '', toFinish: false, limit: PAGE_SIZE };

function ticketSearchText(m, ctx) {
  const ends = [...(m.froms || []).map((f) => endpointLabel(f.type, f.id, ctx)), ...(m.tos || []).map((t) => endpointLabel(t.type, t.id, ctx))];
  const c = ctx.commodities.find((cc) => cc.id === m.commodityId);
  const linked = [...(m.tos || []), ...(m.froms || [])].filter((l) => l.type === 'sale').map((l) => ctx.sales.find((s) => s.id === l.id)).filter(Boolean);
  const fo = m.freightOrderId ? (ctx.freightOrders || []).find((f) => f.id === m.freightOrderId) : null;
  // a date is searchable as it is written on paperwork (05-11-2026) as well as stored (2026-11-05)
  const written = /^(\d{4})-(\d{2})-(\d{2})/.exec(m.date || '');
  return [m.ticketNo, m.sourceRef, m.externalTicketNo, m.manualDocketNo, m.outloadNo, m.date, written ? `${written[3]}-${written[2]}-${written[1]} ${written[3]}/${written[2]}/${written[1]}` : '', m.truckRego, m.driver, m.notes, m.grade, m.tons, c?.name,
    ...linked.flatMap((s) => [s.buyer, s.contractNo, s.ourRef]), fo?.carrier, fo?.freightNo, ...ends].filter((x) => x !== undefined && x !== null && x !== '').join(' ').toLowerCase();
}

function dayHeading(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return 'No date';
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${day.toLocaleDateString('en-AU', { weekday: 'short' })} ${m[3]}-${m[2]}-${m[1]}`;
}

function paint(root) {
  const { storages, commodities, movements } = db.get();
  // the commodities with loads, the one with the most tonnes moved first
  const movedOf = (c) => movements.reduce((sum, m) => sum + (m.commodityId === c.id ? Number(m.tons) || 0 : 0), 0);
  const inUse = commodities.filter((c) => movements.some((m) => moveCommodity(m, commodities) === c.id)).sort(bigFirst(movedOf, (c) => c.name));
  if (listFilter.commodityId && !inUse.some((c) => c.id === listFilter.commodityId)) listFilter.commodityId = '';
  const finishCount = toFinish(movements, storages).length;
  if (listFilter.toFinish && finishCount === 0) listFilter.toFinish = false;

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Movement</h1>
        <div class="sub">Truck tickets: field/silo &rarr; silo/contract</div>
      </div>
    </div>
    <div class="view">
      <div class="mv-summary" id="move-stats"></div>

      <div class="filterbar">
        <div class="mv-searchrow">
          ${movements.length > 0 ? `<input type="search" id="mv-q" placeholder="Search tickets" value="${esc(listFilter.q)}" aria-label="Search tickets by date, truck, driver, buyer, contract or grade" />` : '<span class="mv-spacer"></span>'}
          <button type="button" class="btn secondary small mv-more-btn" id="mv-tools-btn" aria-haspopup="true" aria-expanded="false">More &#9662;</button>
        </div>
        <div class="mv-menu" id="mv-tools" hidden>
          ${(storages.some((s) => s.kind === 'tally') || commodities.some((c) => c.unit === 'bale')) ? `<button type="button" id="move-modules">Move modules</button><button type="button" id="log-ginning">Log ginning</button>` : ''}
          ${movements.length > 0 ? `<button type="button" id="load-report">Load report</button>` : ''}
          <button type="button" id="get-outload">Get an outload number</button>
        </div>
        ${movements.length > 0 && (inUse.length > 1 || finishCount > 0) ? `<div class="chips">
          <button type="button" class="chip ${listFilter.commodityId || listFilter.toFinish ? '' : 'active'}" data-chip="">All</button>
          ${finishCount > 0 ? `<button type="button" class="chip chip-warn ${listFilter.toFinish ? 'active' : ''}" data-finish="1">To finish ${finishCount}</button>` : ''}
          ${inUse.length > 1 ? inUse.map((c) => `<button type="button" class="chip ${listFilter.commodityId === c.id ? 'active' : ''}" data-chip="${esc(c.id)}">${esc(c.name)}</button>`).join('') : ''}
        </div>` : ''}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Tickets</h2>
        <div id="ticket-list"></div>
      </div>
    </div>
    ${movements.length > 0 ? `<button class="fab-secondary beside-label" id="repeat-movement">Repeat</button>` : ''}
    <button class="fab labelled" id="add-movement" aria-label="Add a load">+ Add load</button>
  `;

  paintList(root);

  root.querySelector('#add-movement').addEventListener('click', () => openMovementSheet(null));
  const toolsMenu = root.querySelector('#mv-tools');
  const toolsBtn = root.querySelector('#mv-tools-btn');
  const setMenu = (open) => { toolsMenu.hidden = !open; toolsBtn.setAttribute('aria-expanded', String(open)); };
  toolsBtn.addEventListener('click', () => setMenu(toolsMenu.hidden));
  toolsMenu.addEventListener('click', () => setMenu(false));
  root.onclick = (ev) => { if (!toolsMenu.hidden && !ev.target.closest('#mv-tools, #mv-tools-btn')) setMenu(false); };
  root.querySelector('#log-ginning')?.addEventListener('click', () => openGinRunSheet(null));
  root.querySelector('#move-modules')?.addEventListener('click', () => openModuleMoveSheet(null));
  root.querySelector('#load-report')?.addEventListener('click', () => openLoadReportSheet());
  // a number to quote at a third-party site: the load form opens with the number already in it
  root.querySelector('#get-outload')?.addEventListener('click', () => openMovementSheet(null, { wantOutload: true }));
  // The most recent ticket by date — not the last one typed in, which is
  // whatever order an import or an edit happened to leave.
  root.querySelector('#repeat-movement')?.addEventListener('click', () => {
    const latest = [...movements].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.ticketNo) || 0) - (Number(a.ticketNo) || 0))[0];
    openMovementSheet(null, latest);
  });
  root.querySelector('#mv-q')?.addEventListener('input', (e) => { listFilter.q = e.target.value; listFilter.limit = PAGE_SIZE; paintList(root); });
  root.querySelectorAll('[data-chip]').forEach((el) => {
    el.addEventListener('click', () => { listFilter.commodityId = el.dataset.chip; listFilter.toFinish = false; listFilter.limit = PAGE_SIZE; paint(root); });
  });
  root.querySelector('[data-finish]')?.addEventListener('click', () => { listFilter.toFinish = !listFilter.toFinish; if (listFilter.toFinish) listFilter.commodityId = ''; listFilter.limit = PAGE_SIZE; paint(root); });
}

/** The commodity a ticket is under: its own, or cotton for a module move saved without one. */
const moveCommodity = (m, commodities) => m.commodityId || (hasModules(m) ? commodities.find((c) => c.unit === 'bale')?.id || '' : '');

/** The ticket list and its totals, repainted alone so the search box keeps focus. */
function paintList(root) {
  const { fields, storages, sales, commodities, movements } = db.get();
  const ctx = { fields, storages, sales, commodities, grouped: true, freightOrders: db.getFreightOrders(), dupOutloads: duplicateOutloads(movements) };
  const q = listFilter.q.trim().toLowerCase();
  const shown = movements
    .filter((m) => !listFilter.commodityId || moveCommodity(m, commodities) === listFilter.commodityId)
    .filter((m) => !listFilter.toFinish || stageOf(m, storages))
    .filter((m) => !q || ticketSearchText(m, ctx).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.ticketNo) || 0) - (Number(a.ticketNo) || 0));
  const narrowed = !!(q || listFilter.commodityId || listFilter.toFinish);
  const totalTons = shown.filter((m) => !hasGin(m) && !hasModules(m)).reduce((s, m) => s + (Number(m.tons) || 0), 0);   // a ginning run or a module move counts bales and modules, not tonnes

  const unfinished = toFinish(movements, storages).length;
  root.querySelector('#move-stats').textContent = movements.length === 0 ? ''
    : [`${shown.length} load${shown.length === 1 ? '' : 's'}${narrowed ? ' shown' : ''}`, totalTons > 0 ? `${num(totalTons, 1)} t` : '', !narrowed && unfinished ? `${unfinished} to finish` : ''].filter(Boolean).join(' \u00b7 ');

  const list = root.querySelector('#ticket-list');
  if (movements.length === 0) {
    list.innerHTML = `<div class="empty">No loads logged yet.<br/><button class="btn" id="empty-add-move">Log your first load</button></div>`;
    list.querySelector('#empty-add-move').addEventListener('click', () => openMovementSheet(null));
    return;
  }
  if (shown.length === 0) {
    list.innerHTML = `<div class="empty">No tickets match${q ? ` &ldquo;${esc(listFilter.q.trim())}&rdquo;` : ''}.</div>`;
    return;
  }
  // the latest loads first; the rest are one tap away, and a search looks through all of them
  const page = pageOfRows(shown, listFilter.limit);
  let lastDate = null;
  list.innerHTML = page.rows.map((m, i) => {
    let head = '';
    if ((m.date || '') !== lastDate) {
      lastDate = m.date || '';
      const day = shown.filter((x) => (x.date || '') === lastDate);
      const dayTons = day.reduce((s, x) => s + (Number(x.tons) || 0), 0);
      head = `<div class="day-label"><span>${esc(dayHeading(m.date))}</span><span>${day.length} load${day.length === 1 ? '' : 's'} · ${num(dayTons, 1)} t</span></div>`;
    }
    return head + movementRow(m, { ...ctx, bandIndex: i });
  }).join('') + (page.hidden > 0
    ? `<button type="button" class="btn secondary more-row" id="mv-more">Show ${Math.min(PAGE_SIZE, page.hidden)} more <span class="meta">· ${page.hidden} older ${page.hidden === 1 ? 'load' : 'loads'} not shown</span></button>`
    : '');
  list.querySelector('#mv-more')?.addEventListener('click', () => { listFilter.limit = page.rows.length + PAGE_SIZE; paintList(root); });
  list.querySelectorAll('[data-edit-movement]').forEach((el) => {
    el.addEventListener('click', () => openMovementSheet(movements.find((m) => m.id === el.dataset.editMovement)));
  });
}

/**
 * Every picker on the movement sheet narrows to the commodity being moved.
 * Fields and silos with no commodity assigned always stay in the list — an
 * empty silo can take any grain, and a paddock that has not been set up yet
 * should not disappear. Contracts match strictly: a wheat contract cannot
 * take barley, and offering it invites exactly the delivery you cannot undo.
 */
function distinctOf(list, key) {
  return [...new Set(list.map((x) => String(x[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function matchesCommodity(entity, commodityId) {
  if (!commodityId) return true;
  if (!entity.commodityId) return true;
  return entity.commodityId === commodityId;
}

function fieldOptions(fields, commodityId) {
  // a paddock that has had this straw baled off it is offered for it too, although its crop is something else
  const list = fields.filter((f) => matchesCommodity(f, commodityId) || secondaryTypes(f).includes(commodityId));
  return [{ value: '', label: 'Select…' }, ...list.map((f) => ({ value: `field:${f.id}`, label: f.name }))];
}

function siloOptions(storages, commodityId, opts = {}) {
  // the in-transit store is not a silo anyone picks by name: it has its own choice, on the destination only
  const list = pickableSilos(storages.filter((s) => !isTransit(s)), commodityId, opts);
  return [{ value: '', label: 'Select…' }, ...list.map((s) => ({ value: `silo:${s.id}`, label: s.offFarm ? `${s.name} (off-farm)` : s.name }))];
}

/** Where a load can go: In transit first (grain on a truck, not yet in a silo), then the silos. */
function toSiloOptions(storages, commodityId, opts = {}) {
  const base = siloOptions(storages, commodityId, { ...opts, to: true });
  return [base[0], { value: 'silo:__transit__', label: 'In transit (not yet allocated)' }, ...base.slice(1)];
}

function saleOptions(sales, commodities, commodityId, keep = []) {
  const open = activeSales(sales, keep);
  const list = commodityId ? open.filter((s) => s.commodityId === commodityId) : open;
  const opts = list.map((s) => {
    const c = commodities.find((cc) => cc.id === s.commodityId);
    const label = [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Sale';
    return { value: `sale:${s.id}`, label };
  });
  return [{ value: '', label: 'Select…' }, ...opts];
}

export function endpointLabel(type, id, { fields, storages, sales, commodities }) {
  if (type === 'field') return fields.find((f) => f.id === id)?.name || 'Unknown field';
  if (type === 'silo') return storages.find((s) => s.id === id)?.name || 'Unknown silo';
  if (type === 'sale') {
    const s = sales.find((ss) => ss.id === id);
    if (!s) return 'Unknown contract';
    const c = commodities.find((cc) => cc.id === s.commodityId);
    return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
  }
  return 'Unknown';
}

/**
 * Renders a "Related movements" card into `container` for a field, silo, or
 * sale — the same movement rows shown in the Movement tab, filtered to the
 * ones touching this endpoint. Tapping one opens it for editing.
 */
export function renderRelatedMovements(container, type, id, { collapsed = false } = {}) {
  if (!container) return;
  const { fields, storages, sales, commodities, movements } = db.get();
  const related = movementsForEndpoint(type, id, movements);
  const ctx = { fields, storages, sales, commodities };
  container.className = collapsed ? '' : 'card';
  // A new load starting from this paddock, or going to this contract (a silo can be either end, so it has no shortcut here)
  const startTemplate = type === 'field' ? { froms: [{ type: 'field', id, tons: '' }], tos: [] } : type === 'sale' ? { froms: [], tos: [{ type: 'sale', id, tons: '' }] } : null;
  const body = `
    ${related.length === 0 ? `<div class="empty">No movements linked to this yet.</div>` : related.map((m) => movementRow(m, ctx)).join('')}
    ${startTemplate ? `<button type="button" class="btn secondary small" data-new-movement style="margin-top:8px">+ Add a movement${type === 'field' ? ' from this paddock' : ' to this contract'}</button>` : ''}`;
  const sum = related.reduce((a, m) => a + (Number(m.tons) || 0), 0);
  container.innerHTML = collapsed
    ? `<details class="fold" id="related-fold">
        <summary><div><h2>Related movements</h2>
          <div class="sub">${related.length ? `${related.length} load${related.length === 1 ? '' : 's'} · ${num(sum, 1)} t` : 'None yet'}</div></div></summary>${body}
      </details>`
    : `<h2>Related movements</h2>${body}`;
  // a load opened from here opens over the sheet this list is in (the contract, silo or paddock), which comes back, with this list up to date, when the load is saved or closed
  const back = () => {
    const open = !!container.querySelector('#related-fold')?.open;
    renderRelatedMovements(container, type, id, { collapsed });
    if (open) { const f = container.querySelector('#related-fold'); if (f) f.open = true; }
  };
  container.querySelector('[data-new-movement]')?.addEventListener('click', () => openOver(() => openMovementSheet(null, startTemplate), back));
  container.querySelectorAll('[data-edit-movement]').forEach((el) => {
    el.addEventListener('click', () => openOver(() => openMovementSheet(related.find((m) => m.id === el.dataset.editMovement)), back));
  });
}

/** The short name for one end of a trip: a contract is its buyer, not "Canola · Buyer · #1234". */
function endLabel(type, id, ctx) {
  if (type === 'sale') {
    const s = ctx.sales.find((x) => x.id === id);
    if (!s) return 'Unknown contract';
    return s.buyer || (s.contractNo ? `#${s.contractNo}` : 'Contract');
  }
  return endpointLabel(type, id, ctx);
}

export function movementRow(m, ctx) {
  const froms = m.froms || [];
  const tos = m.tos || [];
  const fromLabel = froms.map((f) => endLabel(f.type, f.id, ctx)).join(' + ') || 'Unknown';
  const toLabel = tos.map((t) => endLabel(t.type, t.id, ctx)).join(' + ') || (isUsedOnFarm(m) ? 'Used on farm' : 'Unknown');
  const stage = stageOf(m, ctx.storages);
  const commodity = ctx.commodities.find((c) => c.id === moveCommodity(m, ctx.commodities))?.name;
  const fromBreakdown = froms.length > 1
    ? froms.map((f) => `From ${endpointLabel(f.type, f.id, ctx)}: ${num(f.tons, 2)} t`).join(', ')
    : null;
  const toBreakdown = tos.length > 1
    ? tos.map((t) => `To ${endpointLabel(t.type, t.id, ctx)}: ${num(t.tons, 2)} t`).join(', ')
    : null;
  // the order it was delivered against, if any
  const order = m.orderId ? (ctx.orders || db.getOrders()).find((o) => o.id === m.orderId) : null;
  const details = [ctx.grouped ? '' : commodity, m.ticketNo ? `#${m.ticketNo}` : '', m.externalTicketNo ? `their #${m.externalTicketNo}` : '', m.manualDocketNo ? `docket ${m.manualDocketNo}` : '', m.outloadNo ? `outload ${m.outloadNo}${ctx.dupOutloads?.has(normaliseOutloadNo(m.outloadNo)) ? ' (used on more than one load)' : ''}` : '', order ? (order.orderNo ? `grain order #${order.orderNo}` : 'against a grain order') : '', m.sourceRef, ctx.grouped ? '' : (shortDate(m.date, { tight: true }) || 'No date'), m.truckRego, m.driver].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="list-item stack${ctx.bandIndex === undefined ? '' : ` band ${ctx.bandIndex % 2 ? 'alt' : ''}`}" data-edit-movement="${m.id}">
      <div class="li-top">
        <div class="main">${ctx.grouped && commodity ? `<span class="mv-com ${commodityClass(commodity)}">${esc(commodity)}</span>` : ''}${esc(fromLabel)} &rarr; ${esc(toLabel)}</div>
        <div class="main mv-qty">${hasGin(m) ? `${num(stdBales(m.gin.lintKg, m.gin.stdBaleKg), 2)} bales` : hasModules(m) ? `${num(m.modules.count, 0)} module${Number(m.modules.count) === 1 ? '' : 's'}` : tons(m.tons || 0)}</div>
      </div>
      <div class="li-foot" style="margin-top:2px">
        <span class="meta">${details}</span>
        <span class="badges"><span class="badge ${stage ? 'warn' : 'pos'}">${stage ? STAGES[stage] : 'Final'}</span>${m.photoDataUrl ? '<span aria-label="Photo waiting to upload" title="Photo waiting to upload">📷⏳</span>' : (m.photoPath ? '<span aria-label="Has photo">📷</span>' : '')}</span>
      </div>
      ${specText(m) ? `<div class="meta">${esc(specText(m))}</div>` : ''}
      ${hasGin(m) ? `<div class="meta">Ginning${m.gin.ginName ? `, ${esc(m.gin.ginName)}` : ''}: ${esc(describeGin(m.gin))}</div>${ginPadLine(m)}` : ''}
      ${hasModules(m) ? `<div class="meta">Modules: ${esc(describeModules(m.modules))}${m.weightStatus === 'final' ? '' : ' (weight estimated)'}</div>` : ''}
      ${hasHayLoad(m) ? `<div class="meta">${isUsedOnFarm(m) ? `Used on farm: ${esc(m.hayLoad.use)}${m.hayLoad.bales > 0 ? ' · ' : ''}` : ''}${esc(describeBales(m.hayLoad.bales, m.hayLoad.kg))}${m.weightStatus === 'final' ? '' : ' (weight estimated)'}</div>` : ''}
      ${!hasGin(m) && !hasModules(m) && fromBreakdown ? `<div class="meta">${esc(fromBreakdown)}</div>` : ''}
      ${!hasGin(m) && !hasModules(m) && toBreakdown ? `<div class="meta">${esc(toBreakdown)}</div>` : ''}
    </div>
  `;
}

/** One premium or discount on the ticket: what it is and the $/t, plus for a premium and minus for a discount. */
function dedRowHtml(d) {
  return `<div class="ded-row">
    <input class="ded-reason" type="text" placeholder="Reason, e.g. Screenings 6% vs contract 5%" value="${esc(d.reason || '')}" aria-label="Reason for the premium or discount" />
    <input class="ded-per" type="number" step="0.01" inputmode="decimal" placeholder="+/- $/t" value="${esc(amountOnTicket(d))}" aria-label="Dollars per tonne: plus for a premium, minus for a discount" />
    <button type="button" class="btn ghost-danger small ded-del" style="width:auto;margin:0;padding:8px 12px" aria-label="Remove this premium or discount">&times;</button>
  </div>`;
}

/** The deductions on the screen as they will be saved. */
function readDeductions(container) {
  return cleanDeductions(Array.from(container?.querySelectorAll('.ded-row') || []).map((row) => ({
    reason: row.querySelector('.ded-reason').value,
    perTon: perTonFromTicket(row.querySelector('.ded-per').value),
  })));
}

/** The line under the heading of the deductions section. */
function dedSummary(list) {
  const notes = deductionNotes(list);
  return notes.length ? notes.join('; ') : 'None. Tap to add a premium or discount the contract does not cover';
}

function addFromRow(container, ctx, onChange, existingFrom) {
  const row = document.createElement('div');
  row.className = 'from-row';
  row.style.cssText = 'margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:10px';
  let kind = existingFrom?.type === 'silo' ? 'silo' : 'field';
  row.innerHTML = `
    <div class="segmented from-kind" style="margin-bottom:8px">
      <button type="button" data-kind="field" class="${kind === 'field' ? 'active' : ''}">Field</button>
      <button type="button" data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
    </div>
    <div style="display:flex;gap:8px;align-items:flex-end">
      <div class="field" style="flex:2;margin-bottom:0">
        <label>From</label>
        <select class="from-select"></select>
      </div>
      <div class="field" style="flex:1;margin-bottom:0">
        <label>Tons</label>
        <input type="number" step="0.01" inputmode="decimal" class="from-tons" value="${existingFrom?.tons ?? ''}" />
      </div>
      <button type="button" class="btn ghost-danger small from-remove" style="width:auto;margin:0;padding:8px 12px" aria-label="Remove this source">&times;</button>
    </div>
  `;
  container.appendChild(row);

  const selectEl = row.querySelector('.from-select');
  let firstRender = true;
  function renderSelect() {
    const options = kind === 'silo' ? ctx.siloOpts() : ctx.fieldOpts();
    // On a commodity change, keep what is already chosen if it survives the
    // new filter; if it does not, fall back to Select… so the wrong source
    // cannot be saved silently.
    const selectedVal = firstRender
      ? (existingFrom?.type === kind ? `${existingFrom.type}:${existingFrom.id}` : '')
      : selectEl.value;
    firstRender = false;
    selectEl.innerHTML = options.map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
  }
  renderSelect();
  ctx.refreshers.push(renderSelect);

  row.querySelector('.from-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn || btn.dataset.kind === kind) return;
    kind = btn.dataset.kind;
    row.querySelectorAll('.from-kind button').forEach((b) => b.classList.toggle('active', b === btn));
    renderSelect();
    onChange();
  });

  row.querySelector('.from-tons').addEventListener('input', onChange);
  selectEl.addEventListener('change', onChange);
  row.querySelector('.from-remove').addEventListener('click', () => {
    if (container.querySelectorAll('.from-row').length <= 1) return;
    row.remove();
    onChange();
  });
}

function readFromRows(container) {
  return Array.from(container.querySelectorAll('.from-row')).map((row) => {
    const val = row.querySelector('.from-select').value;
    const [type, ...rest] = val.split(':');
    return { type: type || '', id: rest.join(':'), tons: parseFloat(row.querySelector('.from-tons').value) || 0 };
  });
}

// A load can split across several silos (e.g. topping up two bins), but
// never several contracts — a delivery to more than one buyer is always a
// separate movement — so only the silo destination is repeatable.
function addToRow(container, ctx, onChange, existingTo) {
  const row = document.createElement('div');
  row.className = 'to-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:10px';
  row.innerHTML = `
    <div class="field" style="flex:2;margin-bottom:0">
      <label>Silo</label>
      <select class="to-select"></select>
    </div>
    <div class="field" style="flex:1;margin-bottom:0">
      <label>Tons</label>
      <input type="number" step="0.01" inputmode="decimal" class="to-tons" value="${existingTo?.tons ?? ''}" />
    </div>
    <button type="button" class="btn ghost-danger small to-remove" style="width:auto;margin:0;padding:8px 12px" aria-label="Remove this destination">&times;</button>
  `;
  container.appendChild(row);

  const toSelectEl = row.querySelector('.to-select');
  let toFirstRender = true;
  function renderToSelect() {
    const selectedVal = toFirstRender
      ? (existingTo?.id ? (ctx.isTransitId(existingTo.id) ? 'silo:__transit__' : `silo:${existingTo.id}`) : '')
      : toSelectEl.value;
    toFirstRender = false;
    toSelectEl.innerHTML = ctx.toSiloOpts()
      .map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
  }
  renderToSelect();
  renderToSelect.ownedByToBody = true;
  ctx.refreshers.push(renderToSelect);

  row.querySelector('.to-tons').addEventListener('input', onChange);
  row.querySelector('.to-select').addEventListener('change', onChange);
  row.querySelector('.to-remove').addEventListener('click', () => {
    if (container.querySelectorAll('.to-row').length <= 1) return;
    row.remove();
    onChange();
  });
}

function readToRows(container) {
  return Array.from(container.querySelectorAll('.to-row')).map((row) => {
    const val = row.querySelector('.to-select').value;
    const [type, ...rest] = val.split(':');
    return { type: type || '', id: rest.join(':'), tons: parseFloat(row.querySelector('.to-tons').value) || 0 };
  });
}

/**
 * `template` pre-fills a brand-new movement from an existing one's details
 * (the "Repeat last movement" shortcut) without editing that record —
 * `existing` stays null so it still saves as a fresh ticket (new id/ticket
 * number, no delete button, no related-movements section), while every
 * field's starting value is sourced from the template. The photo is
 * deliberately excluded — a photo documents one specific load, not a
 * repeat of it.
 */
export function openMovementSheet(existing, template) {
  // a ginning run has a form of its own
  if (existing && hasGin(existing)) return openGinRunSheet(existing);
  if (existing && hasModules(existing)) return openModuleMoveSheet(existing);
  const { fields, storages, sales, commodities, movements } = db.get();
  const orders = db.getOrders();
  const src = existing || template;
  const existingFroms = src?.froms?.length ? src.froms : [{ type: '', id: '', tons: '' }];
  const existingSiloTos = (src?.tos || []).filter((t) => t.type === 'silo');
  const existingSaleTo = (src?.tos || []).find((t) => t.type === 'sale');
  const existingUse = isUsedOnFarm(src);

  // Opening an existing ticket should show it already narrowed, so work the
  // commodity back out of whatever the load was against — the contract first,
  // then the source it came out of.
  function inferCommodityId() {
    if (existingSaleTo) {
      const s = sales.find((ss) => ss.id === existingSaleTo.id);
      if (s?.commodityId) return s.commodityId;
    }
    const firstFrom = existingFroms.find((f) => f.id);
    if (firstFrom) {
      const pool = firstFrom.type === 'silo' ? storages : fields;
      const entity = pool.find((e) => e.id === firstFrom.id);
      if (entity?.commodityId) return entity.commodityId;
    }
    return '';
  }

  // an off-farm location is offered to take grain out of only when it holds some of the commodity
  const offCtx = { fields, storages, sales };
  const holdsHere = (loc, commodityId) => holdsCommodity(loc, movements, offCtx, commodityId);
  const keepSales = [...(src?.tos || [])].filter((l) => l.type === 'sale' && l.id).map((l) => l.id);
  const keepSilos = [...(src?.froms || []), ...(src?.tos || [])].filter((l) => l.type === 'silo' && l.id).map((l) => l.id);
  const ctx = {
    commodityId: inferCommodityId(),
    refreshers: [],
    fieldOpts() { return fieldOptions(fields, this.commodityId); },
    // silos already on this ticket always stay on the list, so editing an old ticket never loses one
    siloOpts() { return siloOptions(storages, this.commodityId, { movements, keep: keepSilos, holds: holdsHere }); },
    toSiloOpts() { return toSiloOptions(storages, this.commodityId, { movements, keep: keepSilos, holds: holdsHere }); },
    isTransitId(id) { return isTransit(storages.find((x) => x.id === id)); },
    saleOpts() { return saleOptions(sales, commodities, this.commodityId, keepSales); },
    refreshAll() { this.refreshers.forEach((fn) => fn()); },
  };

  // Orders a load can be put against, from the top of the form: those still taking loads (and the one this load is
  // already against), soonest deadline first. Choosing one fills in its contract, the commodity and the grade.
  const saleOfOrder = (o) => sales.find((s) => s.id === o.saleId);
  const orderOptionLabel = (o) => {
    const s = saleOfOrder(o);
    const c = commodities.find((cc) => cc.id === s?.commodityId);
    return [c?.name, s?.buyer, orderTitle(o), windowText(o, tightDate), `${num(orderState(o, movements, todayLocal()).left, 0)} t left`].filter(Boolean).join(' · ');
  };
  const pickableOrders = orders
    .filter((o) => saleOfOrder(o) && (o.id === existing?.orderId || orderState(o, movements, todayLocal()).active))
    .sort((a, b) => String(a.deliverBy || '9999').localeCompare(String(b.deliverBy || '9999')));

  openSheet(existing ? `Edit movement #${existing.ticketNo ?? ''}` : 'Add movement', (root) => {
    root.innerHTML = `
      <datalist id="dl-regos">${distinctOf(movements, 'truckRego').map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-drivers">${distinctOf(movements, 'driver').map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <section class="form-section">
        <div class="subhead">Load</div>
        <div class="grid-2">
          ${field({ label: 'Date', id: 'date', type: 'date', value: existing ? existing.date : todayLocal() })}
          ${field({ label: 'Time', id: 'loadTime', type: 'time', value: existing ? (existing.loadTime || '') : nowTime() })}
        </div>
        ${pickableOrders.length ? `
        <div class="field">
          <label for="m-order">Delivering against a grain order</label>
          <select id="m-order">
            <option value="">No grain order</option>
            ${pickableOrders.map((o) => `<option value="${esc(o.id)}" ${o.id === existing?.orderId ? 'selected' : ''}>${esc(orderOptionLabel(o))}</option>`).join('')}
          </select>
          <div class="hint" id="m-order-note">Fills in the contract, commodity and grade.</div>
        </div>` : ''}
        <div class="field">
          <label>Commodity</label>
          <select id="m-commodity">
            <option value="">All commodities</option>
            ${commodities.map((c) => `<option value="${c.id}" ${c.id === ctx.commodityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <div class="hint">Narrows the lists below to this grain.</div>
        </div>
      </section>

      <section class="form-section alt">
        <div class="subhead">From and to</div>
        <div class="field"><label>From (add a source if the load blends silos or fields)</label></div>
        <div id="from-rows"></div>
        <button type="button" class="btn secondary small" id="add-from">+ Add source</button>
        <div class="row" style="margin:10px 0 14px"><span class="label">Sources total</span><span class="value" id="from-sources-total">0.0 t</span></div>
        <div id="offfarm-note" class="hint" style="margin:-6px 0 12px"></div>
        <div class="field">
          <label>To</label>
          <div class="segmented" id="to-kind">
            <button type="button" data-kind="silo" class="${!existingSaleTo && !existingUse ? 'active' : ''}">Silo</button>
            <button type="button" data-kind="sale" class="${existingSaleTo ? 'active' : ''}">Contract</button>
            <button type="button" data-tokind="use" id="to-use-btn" class="${existingUse ? 'active' : ''}" ${isHay(commodities.find((c) => c.id === ctx.commodityId)) || existingUse ? '' : 'hidden'}>Used on farm</button>
          </div>
        </div>
        <div id="to-body" style="margin-top:8px"></div>
        <datalist id="dl-destinations">${[...new Set([...distinctOf(movements, 'destination'), ...distinctOf(db.get().sales, 'location')])].sort((a, b) => a.localeCompare(b)).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        ${field({ label: 'Destination', id: 'destination', value: src?.destination, list: 'dl-destinations', placeholder: DEST_HINT, hint: "Shown on the load ticket. Fills in from the freight order. Blank uses the contract's delivery site." })}
      </section>

      <section class="form-section">
        <div class="subhead">Truck and tickets</div>
        <div class="grid-2">
          ${field({ label: 'Truck rego', id: 'truckRego', value: src?.truckRego, list: 'dl-regos' })}
          ${field({ label: 'Driver', id: 'driver', value: src?.driver, list: 'dl-drivers' })}
        </div>
        <div class="grid-2">
          ${field({ label: 'Their ticket no.', id: 'extTicket', value: existing?.externalTicketNo, placeholder: 'On their ticket' })}
          ${field({ label: 'Manual docket no.', id: 'manualDocket', value: existing?.manualDocketNo, placeholder: 'Our paper docket' })}
        </div>
        <div class="field">
          <label for="outloadNo">Outload number</label>
          <input id="outloadNo" type="text" inputmode="numeric" autocomplete="off" value="${esc(existing?.outloadNo || '')}" placeholder="Quoted at the site" />
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin:-2px 0 10px">
          <button type="button" class="btn secondary small" id="ol-get" style="width:auto;flex:none">Get a number</button>
          <div class="hint" id="ol-hint" style="margin:0;font-size:11.5px;color:var(--text-dim)">The driver gives this to the site. It matches the site's delivery file to this load.</div>
        </div>
      </section>

      <section class="form-section alt">
        <div class="subhead">Weight</div>
        <div class="grid-2">
          ${field({ label: 'Gross (t, optional)', id: 'gross', type: 'number', step: '0.01', value: src?.grossWeight })}
          ${field({ label: 'Tare (t, optional)', id: 'tare', type: 'number', step: '0.01', value: src?.tareWeight })}
        </div>
        ${field({ label: 'Net weight (t)', id: 'tons', type: 'number', step: '0.01', value: src?.tons, hint: 'Fills from gross minus tare, or enter it directly.' })}
        <div id="hay-wrap" ${isHay(commodities.find((c) => c.id === ctx.commodityId)) || hasHayLoad(src) ? '' : 'hidden'}>
          ${field({ label: 'Bales', id: 'm-bales', type: 'number', step: '1', value: src?.hayLoad?.bales || '' })}
          <div class="field" style="margin-top:-6px"><div class="hint" id="m-bales-note"></div></div>
        </div>
        <div class="field">
          <label>Weight status</label>
          <div class="segmented" id="m-status">
            <button data-status="estimate" class="${(src?.weightStatus || 'estimate') === 'estimate' ? 'active' : ''}">Estimate</button>
            <button data-status="final" class="${src?.weightStatus === 'final' ? 'active' : ''}">Final</button>
          </div>
        </div>
        ${existing?.sourceRef ? `<div class="hint" style="margin-bottom:8px">Movement number from the freight platform: <strong>${esc(existing.sourceRef)}</strong></div>` : ''}
      </section>

      <details class="fold feature" id="lq-fold" ${existing && (existing.grade || existing.proteinPct != null || existing.moisturePct != null || existing.oilPct != null || existing.ffaPct != null || existing.retentionPct != null) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Load quality</h2>
          <div class="sub" id="lq-sub">${esc(specText(existing) || 'Not recorded yet · tap to add grade, protein, moisture and more')}</div></div></summary>
        <div class="hint" style="margin-bottom:8px">What was on the truck. Storage uses it to say what each load out will carry.</div>
        ${gradeFieldHtml({ id: 'lq-grade', commodity: commodities.find((c) => c.id === ctx.commodityId), value: existing?.grade })}
        <div class="grid-2">
          ${field({ label: 'Moisture (%)', id: 'lq-moisture', type: 'number', step: '0.1', value: existing?.moisturePct ?? '' })}
          ${field({ label: 'Protein (%)', id: 'lq-protein', type: 'number', step: '0.1', value: existing?.proteinPct ?? '' })}
        </div>
        <div class="grid-2">
          ${field({ label: 'Screenings (%)', id: 'lq-screenings', type: 'number', step: '0.1', value: existing?.screeningsPct ?? '' })}
          ${field({ label: 'Test weight (kg/hL)', id: 'lq-tw', type: 'number', step: '0.1', value: existing?.testWeightKgHl ?? '' })}
        </div>
        <div class="grid-2">
          ${field({ label: 'Falling number (seconds)', id: 'lq-fn', type: 'number', step: '1', value: existing?.fallingNumber ?? '' })}
          <div id="lq-extra">
            <div id="lq-oil-wrap">${field({ label: 'Oil (%)', id: 'lq-oil', type: 'number', step: '0.1', value: existing?.oilPct ?? '', hint: 'Canola' })}</div>
            <div id="lq-ret-wrap" hidden>${field({ label: 'Retention (%)', id: 'lq-ret', type: 'number', step: '0.1', value: existing?.retentionPct ?? '', hint: 'Barley: kept above 2.5 mm' })}</div>
          </div>
        </div>
        <div id="lq-ffa-wrap" class="grid-2">${field({ label: 'Free fatty acid (%)', id: 'lq-ffa', type: 'number', step: '0.01', value: existing?.ffaPct ?? '', hint: 'Canola' })}</div>
      </details>
      <details class="fold" id="ded-fold" ${cleanDeductions(existing?.deductions).length ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Premium / discount</h2><div class="sub" id="ded-sub">${esc(dedSummary(existing?.deductions))}</div></div></summary>
        <div id="ded-rows">${cleanDeductions(existing?.deductions).map(dedRowHtml).join('')}</div>
        <button type="button" class="btn secondary small" id="ded-add">Add a premium / discount</button>
        <div class="hint" style="margin-top:6px">For something the contract does not cover. Type a discount as a minus (-10) and a premium as a plus (4). It moves this load's price on the invoice, with the reason under the load.</div>
      </details>
      <details class="fold" id="np-fold" ${src?.notes || existing?.photoPath || existing?.photoDataUrl ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Notes and photo</h2><div class="sub">${esc(src?.notes || 'A note, or a photo of the truck rego')}</div></div></summary>
        ${field({ label: 'Notes', id: 'notes', value: src?.notes })}
        <div class="field">
          <label>Photo (e.g. truck rego)</label>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn secondary small" id="m-photo-take" style="flex:1">Take photo</button>
            <button type="button" class="btn secondary small" id="m-photo-pick" style="flex:1">Choose from library</button>
          </div>
          <input id="m-photo-file" type="file" accept="image/*" capture="environment" hidden />
          <input id="m-photo-lib" type="file" accept="image/*" hidden />
          <div class="hint">Kept with the load and uploaded when you have signal, stamped with the date and time.</div>
          <div id="m-photo-preview" style="margin-top:8px"></div>
        </div>
      </details>
      ${existing ? `<details class="fold" id="tk-fold">
        <summary><div class="feature-head"><h2>Send as a PDF</h2><div class="sub">Choose what shows on the load ticket, then send it</div></div></summary>
        <div style="padding-top:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0 10px"><input type="checkbox" id="tk-origin" ${readOrigin() ? 'checked' : ''} style="width:18px;height:18px" /> Show where it came from (storage or paddock)</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="tk-split" ${readSplit() ? 'checked' : ''} style="width:18px;height:18px" /> Tonnes from each, when it came from more than one</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="tk-dest" ${readDestination() ? 'checked' : ''} style="width:18px;height:18px" /> Show the destination</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="tk-comments" ${readComments() ? 'checked' : ''} style="width:18px;height:18px" /> Comments box (this load's notes, and room to write)</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="tk-quality" ${readQuality() ? 'checked' : ''} style="width:18px;height:18px" /> Quality results (if the load was tested)</label>
        <button class="btn secondary" id="tk-send" type="button">Send this load as a PDF</button>
        <div class="meta" style="margin-top:6px;font-size:12px">Sends the load as it is on the screen now. Save the ticket to keep any changes.</div></div></details>` : ''}
${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete movement</button>` : ''}
      <div class="save-bar"><div class="total"><div class="l">Net load</div><div class="v" id="load-preview">—</div></div><button class="btn" id="save">Save</button></div>
    `;

    const fromRowsEl = root.querySelector('#from-rows');
    const sourcesTotalEl = root.querySelector('#from-sources-total');
    let offFarmNoteHook = null;   // set once the grade box exists, below
    function recomputeSourcesTotal() {
      const total = readFromRows(fromRowsEl).reduce((s, f) => s + (Number(f.tons) || 0), 0);
      sourcesTotalEl.textContent = tons(total);
      offFarmNoteHook?.();
    }
    existingFroms.forEach((f) => addFromRow(fromRowsEl, ctx, recomputeSourcesTotal, f));
    root.querySelector('#add-from').addEventListener('click', () => addFromRow(fromRowsEl, ctx, recomputeSourcesTotal));
    recomputeSourcesTotal();

    // the grade dropdown follows the commodity: its published grades and the farm's own
    const gradeCtl = wireGradeField(root, 'lq-grade', () => commodities.find((c) => c.id === ctx.commodityId));
    // barley takes retention where other grains have oil; a figure already typed stays visible either way
    const syncExtra = () => {
      const key = extraSpecKey(commodities.find((c) => c.id === ctx.commodityId)?.name);
      root.querySelector('#lq-oil-wrap').hidden = !(key === 'oilPct' || getVal(root, 'lq-oil'));
      root.querySelector('#lq-ret-wrap').hidden = !(key === 'retentionPct' || getVal(root, 'lq-ret'));
      root.querySelector('#lq-ffa-wrap').hidden = !(key === 'oilPct' || getVal(root, 'lq-ffa'));
    };
    syncExtra();
    // the closed header says what has been recorded, kept current as it is typed
    const lqSub = root.querySelector('#lq-sub');
    const paintLqSub = () => {
      const v = (id) => getVal(root, id);
      lqSub.textContent = specText({
        grade: gradeCtl.read(), moisturePct: v('lq-moisture'), proteinPct: v('lq-protein'), screeningsPct: v('lq-screenings'),
        testWeightKgHl: v('lq-tw'), fallingNumber: v('lq-fn'), oilPct: v('lq-oil'), ffaPct: v('lq-ffa'), retentionPct: v('lq-ret'),
      }) || 'Not recorded yet · tap to add grade, protein, moisture and more';
    };
    const lqFold = root.querySelector('#lq-fold');
    lqFold.addEventListener('input', () => setTimeout(paintLqSub, 0));
    lqFold.addEventListener('change', () => setTimeout(paintLqSub, 0));
    // premiums and discounts: a reason and a $/t each, added and removed here, read back when the ticket is saved
    const dedRowsEl = root.querySelector('#ded-rows');
    const paintDedSub = () => { root.querySelector('#ded-sub').textContent = dedSummary(readDeductions(dedRowsEl)); };
    root.querySelector('#ded-add').addEventListener('click', () => {
      dedRowsEl.insertAdjacentHTML('beforeend', dedRowHtml({ reason: '', perTon: '' }));
      dedRowsEl.lastElementChild.querySelector('.ded-reason').focus();
    });
    dedRowsEl.addEventListener('click', (e) => {
      if (!e.target.closest('.ded-del')) return;
      e.target.closest('.ded-row').remove();
      paintDedSub();
    });
    dedRowsEl.addEventListener('input', paintDedSub);
    // What an off-farm location holds of this commodity and grade, against what this load takes out of it, and
    // the grade a load going into one will be held under.
    const offFarmNoteEl = root.querySelector('#offfarm-note');
    offFarmNoteHook = () => {
      const grade = gradeCtl.read();
      const lines = [];
      for (const from of readFromRows(fromRowsEl)) {
        const loc = from.type === 'silo' ? storages.find((s) => s.id === from.id) : null;
        if (!loc?.offFarm) continue;
        if (!ctx.commodityId) { lines.push(`Choose the commodity above to check what ${esc(loc.name)} holds.`); continue; }
        const held = heldOf(loc, movements, offCtx, ctx.commodityId, grade, { except: existing?.id });
        const what = grade ? esc(grade) : 'ungraded grain';
        lines.push(from.tons > held + 0.0005
          ? `<strong style="color:var(--danger)">${esc(loc.name)} holds ${num(held, 1)} t of ${what}; this load takes ${num(from.tons, 1)} t.</strong>`
          : `${esc(loc.name)} holds ${num(held, 1)} t of ${what}.`);
      }
      const toRowsBox = root.querySelector('#to-rows');
      for (const to of toRowsBox ? readToRows(toRowsBox) : []) {
        const loc = to.type === 'silo' ? storages.find((s) => s.id === to.id) : null;
        if (!loc?.offFarm) continue;
        lines.push(grade ? `${esc(loc.name)} will hold this load as ${esc(grade)}.` : `This load has no grade, so ${esc(loc.name)} will hold it as ungraded. Set the grade under Load quality to keep it by grade.`);
      }
      offFarmNoteEl.innerHTML = lines.join(' ');
    };
    root.addEventListener('change', () => offFarmNoteHook());
    root.addEventListener('input', () => offFarmNoteHook());
    offFarmNoteHook();

    root.querySelector('#m-commodity').addEventListener('change', (e) => {
      ctx.commodityId = e.target.value;
      syncExtra();
      syncHay();
      ctx.refreshAll();
      recomputeSourcesTotal();
      gradeCtl.refresh();
    });

    // the order this load is against (see orders.js), if any; `orderTouched` once the person has chosen
    let orderChoice = existing?.orderId ?? null;
    let orderTouched = false;
    // the freight order this load is carted on (see freight.js); `freightTouched` once the person has chosen
    let freightChoice = existing?.freightOrderId ?? null;
    let freightTouched = false;
    // The destination on the ticket comes from the freight order chosen: the company, then the address. It only fills a blank
    // box, or one it filled itself; what was typed stays. `destAuto` is what it last put there.
    let destAuto = '';
    const applyFreightDestination = (saleId) => {
      const el = root.querySelector('#destination');
      if (!el) return;
      const fo = freightChoice ? db.getFreightOrders().find((x) => x.id === freightChoice) : null;
      const want = fo ? freightDestination(fo, db.get().sales.find((s) => s.id === saleId)) : '';
      if (el.value === '' || el.value === destAuto) { el.value = want; destAuto = want; }
    };
    let toKind = existingUse ? 'use' : existingSaleTo ? 'sale' : 'silo';

    // What the chosen order says, under the box at the top: who is carting it, where it goes, by when.
    function showOrderNote() {
      const top = root.querySelector('#m-order');
      if (top) top.value = orderChoice || '';
      const note = root.querySelector('#m-order-note');
      if (!note) return;
      const o = orders.find((x) => x.id === orderChoice);
      if (!o) { note.textContent = 'Choosing a grain order fills in its contract, the commodity and the grade.'; return; }
      const s = saleOfOrder(o);
      note.textContent = [o.freightCompany ? `Freight: ${o.freightCompany}` : '', s?.location ? `Delivery: ${s.location}` : '', o.deliverBy ? `Deliver by ${shortDate(o.deliverBy)}` : '', o.notes || ''].filter(Boolean).join(' · ');
    }
    // Choosing an order at the top: the commodity, the contract it is against and the grade follow it.
    function applyOrder(id) {
      orderChoice = id || null;
      orderTouched = true;
      const o = orders.find((x) => x.id === id);
      const s = o && saleOfOrder(o);
      if (s) {
        const commodityEl = root.querySelector('#m-commodity');
        if (s.commodityId && commodityEl.value !== s.commodityId) { commodityEl.value = s.commodityId; commodityEl.dispatchEvent(new Event('change', { bubbles: true })); }
        if (toKind !== 'sale') root.querySelector('#to-kind [data-kind="sale"]').click();
        const saleEl = root.querySelector('#to-sale-select');
        if (saleEl) { saleEl.value = `sale:${s.id}`; saleEl.dispatchEvent(new Event('change', { bubbles: true })); }
        const gradeEl = root.querySelector('#lq-grade');
        if (s.grade && gradeEl && !gradeCtl.read()) {
          gradeEl.value = s.grade;
          if (gradeEl.value !== s.grade) gradeEl.value = '';
        }
      } else {
        root.querySelector('#to-sale-select')?.dispatchEvent(new Event('change', { bubbles: true }));
      }
      showOrderNote();
    }
    root.querySelector('#m-order')?.addEventListener('change', (e) => applyOrder(e.target.value));
    const toBody = root.querySelector('#to-body');
    function renderToBody() {
      // The To side is rebuilt wholesale when the kind flips, so discard any
      // refreshers pointing at DOM that is about to be replaced.
      ctx.refreshers = ctx.refreshers.filter((fn) => !fn.ownedByToBody);
      root.querySelector('#destination')?.setAttribute('placeholder', DEST_HINT);
      if (toKind === 'sale') {
        const selectedVal = existingSaleTo ? `sale:${existingSaleTo.id}` : '';
        const opts = ctx.saleOpts().map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
        // Wrapped in .field so it picks up the app's control styling — a bare
        // <select> falls back to the browser default, which is unreadably
        // small on a phone and triggers iOS zoom on focus.
        toBody.innerHTML = `
          <div class="field" style="margin-bottom:0">
            <label>Contract</label>
            <select id="to-sale-select">${opts}</select>
            ${ctx.saleOpts().length <= 1 ? `<div class="hint">No contracts for this commodity — add one in Sales, or widen the commodity above.</div>` : ''}
          </div>
          <div id="dest-wrap" class="meta" style="margin:6px 0 0"></div>
          <div id="order-wrap"></div>
          <div id="freight-wrap"></div>`;
        const saleSelectEl = toBody.querySelector('#to-sale-select');
        // where the contract delivers to, so it is in front of whoever is capturing the load
        const destWrap = toBody.querySelector('#dest-wrap');
        const drawDest = () => {
          const sale = db.get().sales.find((s) => s.id === String(saleSelectEl.value || '').replace(/^sale:/, ''));
          destWrap.innerHTML = !sale ? '' : (sale.location ? `Contract delivers to: <strong>${esc(sale.location)}</strong>` : '<span class="hint">No delivery site on this contract.</span>');
          // the box is blank until something is typed, and shows the contract's site as its hint
          root.querySelector('#destination')?.setAttribute('placeholder', sale?.location || DEST_HINT);
        };
        saleSelectEl.addEventListener('change', drawDest); drawDest();
        // The orders open against the chosen contract, to say which one this load fills. Nothing shows when it has none.
        const orderWrap = toBody.querySelector('#order-wrap');
        const freightWrap = toBody.querySelector('#freight-wrap');
        // The freight orders open for this contract, to say which truck job this load is on. Nothing shows when it has none.
        const drawFreight = () => {
          const saleId = String(saleSelectEl.value || '').replace(/^sale:/, '');
          const list = saleId ? freightOrdersForLoad(saleId, orderChoice, db.getFreightOrders(), movements, freightChoice) : [];
          if (!list.length) { freightWrap.innerHTML = ''; return; }
          if (!freightTouched && freightChoice === null && !existing && list.length === 1) freightChoice = list[0].id;
          if (freightChoice && !list.some((f) => f.id === freightChoice)) freightChoice = null;
          if (!existing || freightTouched) applyFreightDestination(saleId);
          freightWrap.innerHTML = `
            <div class="field" style="margin-top:10px;margin-bottom:0">
              <label>Carted on</label>
              <select id="to-freight-select">
                <option value="">Not on a freight order</option>
                ${list.map((f) => `<option value="${esc(f.id)}" ${f.id === freightChoice ? 'selected' : ''}>${esc([freightTitle(f), `${num(freightState(f, movements).left, 0)} t left`].join(' · '))}</option>`).join('')}
              </select>
            </div>`;
          freightWrap.querySelector('#to-freight-select').addEventListener('change', (e) => { freightChoice = e.target.value || null; freightTouched = true; applyFreightDestination(saleId); });
        };
        const drawOrders = () => {
          drawOrdersBody();
          drawFreight();
        };
        const drawOrdersBody = () => {
          const saleId = String(saleSelectEl.value || '').replace(/^sale:/, '');
          const list = saleId ? ordersForLoad(saleId, orders, movements, todayLocal(), orderChoice) : [];
          if (!list.length) { orderWrap.innerHTML = ''; return; }
          // a new load with just one order open against the contract is put against it, unless that was said no to
          if (!orderTouched && orderChoice === null && !existing && list.length === 1) orderChoice = list[0].id;
          if (orderChoice && !list.some((o) => o.id === orderChoice)) orderChoice = null;
          orderWrap.innerHTML = `
            <div class="field" style="margin-top:10px;margin-bottom:0">
              <label>Fills order</label>
              <select id="to-order-select">
                <option value="">Not against a grain order</option>
                ${list.map((o) => {
                  const st = orderState(o, movements, todayLocal());
                  const label = [orderTitle(o), windowText(o, tightDate), `${num(st.left, 0)} t left`, st.state === 'overdue' ? 'overdue' : '', o.freightCompany].filter(Boolean).join(' · ');
                  return `<option value="${esc(o.id)}" ${o.id === orderChoice ? 'selected' : ''}>${esc(label)}</option>`;
                }).join('')}
              </select>
            </div>`;
          orderWrap.querySelector('#to-order-select').addEventListener('change', (e) => { orderChoice = e.target.value || null; orderTouched = true; showOrderNote(); drawFreight(); });
          showOrderNote();
        };
        saleSelectEl.addEventListener('change', drawOrders);
        const refreshSale = () => {
          const keep = saleSelectEl.value;
          saleSelectEl.innerHTML = ctx.saleOpts()
            .map((o) => `<option value="${o.value}" ${String(o.value) === keep ? 'selected' : ''}>${o.label}</option>`).join('');
          drawOrders();
        };
        refreshSale.ownedByToBody = true;
        ctx.refreshers.push(refreshSale);
        drawOrders();
      } else if (toKind === 'use') {
        toBody.innerHTML = `
          ${field({ label: 'Used for', id: 'm-use', value: src?.hayLoad?.use || '', placeholder: 'e.g. Fed to cattle', hint: 'Takes it out of the stock. It is not sold, and goes on no contract.' })}`;
      } else {
        toBody.innerHTML = `
          <div id="to-rows"></div>
          <button type="button" class="btn secondary small" id="add-to">+ Add destination</button>
          <div class="row" style="margin-bottom:14px"><span class="label">Destinations total</span><span class="value" id="to-destinations-total">0.0 t</span></div>
        `;
        const toRowsEl = toBody.querySelector('#to-rows');
        const destTotalEl = toBody.querySelector('#to-destinations-total');
        function recomputeDestTotal() {
          const total = readToRows(toRowsEl).reduce((s, t) => s + (Number(t.tons) || 0), 0);
          destTotalEl.textContent = tons(total);
        }
        const initialTos = existingSiloTos.length > 0 ? existingSiloTos : [{ type: '', id: '', tons: '' }];
        initialTos.forEach((t) => addToRow(toRowsEl, ctx, recomputeDestTotal, t));
        toBody.querySelector('#add-to').addEventListener('click', () => addToRow(toRowsEl, ctx, recomputeDestTotal));
        recomputeDestTotal();
      }
    }
    renderToBody();
    root.querySelector('#to-kind').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-kind], button[data-tokind]');
      const kind = btn?.dataset.kind || btn?.dataset.tokind;   // 'use' (hay used on the farm) is not a place a load goes, so it is not a leg type
      if (!btn || kind === toKind) return;
      toKind = kind;
      root.querySelectorAll('#to-kind button').forEach((b) => b.classList.toggle('active', b === btn));
      renderToBody();
    });

    const grossEl = root.querySelector('#gross');
    const tareEl = root.querySelector('#tare');
    const tonsEl = root.querySelector('#tons');
    const loadPreviewEl = root.querySelector('#load-preview');
    const showLoad = () => { loadPreviewEl.textContent = tons(getNum(root, 'tons')); };
    // A load from one paddock into one silo (or one contract) weighs one thing. When the
    // net load is changed — the estimate corrected, or the final weight entered after
    // tipping — the paddock and silo figures follow it, rather than keeping the old weight
    // while the ticket says another. A load split or blended across several is left to the
    // person, because only they know how it divides.
    function syncSingleLegs() {
      const net = parseFloat(tonsEl.value);
      if (Number.isNaN(net)) return;
      const fromRows = fromRowsEl.querySelectorAll('.from-row');
      const toRows = toKind === 'silo' ? root.querySelectorAll('#to-rows .to-row') : [];
      if (fromRows.length !== 1 || (toKind === 'silo' && toRows.length !== 1)) return;
      const follow = (el) => {
        if (el && parseFloat(el.value) !== net) { el.value = net; el.dispatchEvent(new Event('input', { bubbles: true })); }
      };
      follow(fromRows[0].querySelector('.from-tons'));
      if (toRows[0]) follow(toRows[0].querySelector('.to-tons'));
    }
    function recomputeNet() {
      const gross = parseFloat(grossEl.value);
      const tare = parseFloat(tareEl.value);
      if (!Number.isNaN(gross) && !Number.isNaN(tare)) {
        tonsEl.value = (gross - tare).toFixed(2);
      }
      showLoad();
      syncSingleLegs();
    }
    grossEl.addEventListener('input', recomputeNet);
    tareEl.addEventListener('input', recomputeNet);
    tonsEl.addEventListener('input', () => { showLoad(); syncSingleLegs(); });
    showLoad();

    // Hay: a load is counted in bales as well as tonnes. Until the net weight is typed in (or the weighbridge gives it), the
    // weight is the bales times the bale weight, and the load stays an estimate.
    let netTouched = !!existing?.tons;
    let settingNet = false;
    const commodityNow = () => commodities.find((c) => c.id === ctx.commodityId);
    const baleKgNow = () => {
      const from = readFromRows(fromRowsEl).find((f) => f.type === 'field' && f.id);
      const fld = from ? fields.find((x) => x.id === from.id) : null;
      return fld ? avgBaleKg(fld, commodityNow()) : Number(commodityNow()?.hay?.baleKg) || 0;
    };
    function syncHay(fromBales = false) {
      const hay = isHay(commodityNow());
      root.querySelector('#hay-wrap').hidden = !hay && !hasHayLoad(src);
      root.querySelector('#to-use-btn').hidden = !hay && !existingUse;
      if (!hay && toKind === 'use') root.querySelector('#to-kind [data-kind="silo"]').click();
      const bales = getNum(root, 'm-bales');
      const kg = baleKgNow();
      if (fromBales && bales > 0 && kg > 0 && !netTouched) {
        settingNet = true;
        tonsEl.value = ((bales * kg) / 1000).toFixed(2);
        tonsEl.dispatchEvent(new Event('input', { bubbles: true }));
        settingNet = false;
        const est = root.querySelector('#m-status [data-status="estimate"]');
        if (!existing && !est.classList.contains('active')) est.click();
      }
      root.querySelector('#m-bales-note').textContent = bales > 0
        ? `${num(bales, 0)} bales${kg > 0 ? ` at about ${num(kg, 0)} kg = ${num((bales * kg) / 1000, 2)} t` : ''}${netTouched ? '' : '. An estimate until the weighbridge weight is typed in.'}`
        : (kg > 0 ? `About ${num(kg, 0)} kg a bale. Type the bales and the weight fills in.` : '');
    }
    root.querySelector('#m-bales').addEventListener('input', () => syncHay(true));
    tonsEl.addEventListener('input', () => { if (!settingNet) { netTouched = tonsEl.value !== ''; syncHay(); } });
    root.addEventListener('click', (e) => { if (e.target.closest('#from-rows')) setTimeout(() => syncHay(), 0); });
    root.addEventListener('change', (e) => { if (e.target.closest?.('#from-rows')) syncHay(); });
    syncHay();

    let weightStatus = src?.weightStatus || 'estimate';
    root.querySelector('#m-status').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      weightStatus = btn.dataset.status;
      root.querySelectorAll('#m-status button').forEach((b) => b.classList.toggle('active', b === btn));
    });

    let photoDataUrl = existing?.photoDataUrl || null;
    // A photo already uploaded lives in the bucket, not the row. It is fetched
    // through a short-lived signed URL rather than a public link, so it cannot
    // be shared by copying the address out of the page.
    let photoPath = existing?.photoPath || null;
    const photoPreview = root.querySelector('#m-photo-preview');

    async function renderPhotoPreview() {
      const src = photoDataUrl || (photoPath ? await displayUrlFor({ photoPath }) : null);
      // Say where the photo is: still only on this phone, up on the server, or up there but not showing
      const where = photoDataUrl ? 'Waiting to upload. It is kept on this phone and goes up when there is signal.'
        : photoPath ? (src ? 'Uploaded.' : `Uploaded, but it cannot be shown right now${photoLookupError() ? `: ${esc(photoLookupError())}` : ''}. Check your signal and reopen this ticket.`)
          : '';
      const note = where ? `<div class="hint" style="margin-top:6px">${where}</div>` : '';
      photoPreview.innerHTML = src
        ? `<img src="${src}" style="width:100%;border-radius:10px;display:block" />${note}<button class="btn secondary small" id="m-photo-remove" style="margin-top:8px">Remove photo</button>`
        : note;
      const removeBtn = photoPreview.querySelector('#m-photo-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => { photoDataUrl = null; photoPath = null; renderPhotoPreview(); });
    }
    renderPhotoPreview();
    // Two ways in: the camera, and the photo library. A new camera photo is stamped with the time it is taken;
    // one from the library is stamped with when it was taken, as it may be from earlier in the day.
    const onPhoto = (fromLibrary) => async (e) => {
      const file = e.target.files[0];
      e.target.value = '';   // so choosing the same photo again still counts
      if (!file) return;
      try {
        photoDataUrl = await compressAndStampImage(file, fromLibrary && file.lastModified ? { takenAt: new Date(file.lastModified) } : {});
        renderPhotoPreview();
      } catch (err) {
        notify('Could not process that photo.');
      }
    };
    root.querySelector('#m-photo-file').addEventListener('change', onPhoto(false));
    root.querySelector('#m-photo-lib').addEventListener('change', onPhoto(true));
    root.querySelector('#m-photo-take').addEventListener('click', () => root.querySelector('#m-photo-file').click());
    root.querySelector('#m-photo-pick').addEventListener('click', () => root.querySelector('#m-photo-lib').click());

    // the outload number: this person's next one, worked out here, kept when the load is saved
    const olInput = root.querySelector('#outloadNo');
    const olHint = root.querySelector('#ol-hint');
    root.querySelector('#ol-get').addEventListener('click', () => {
      if (olInput.value.trim()) { toast('This load already has a number'); return; }
      const n = db.nextOutloadNo();
      if (!n) {
        notify(db.getOutloadSeries()
          ? 'There is no season to put on the number. Check the season in Settings.'
          : 'You do not have an outload digit yet. It is given when you join the farm: try again with signal, or ask the owner to look in Settings > People.');
        return;
      }
      olInput.value = n;
      olHint.innerHTML = `Quote <strong>${esc(n)}</strong> at the site. Save the load to keep it.`;
    });
    if (template?.wantOutload && !existing) root.querySelector('#ol-get').click();

    root.querySelector('#save').addEventListener('click', async () => {
      const olNo = normaliseOutloadNo(getVal(root, 'outloadNo'));
      if (olNo) {
        const clash = movements.find((m) => m.id !== existing?.id && normaliseOutloadNo(m.outloadNo) === olNo);
        if (clash) { notify(`Outload number ${olNo} is already on load #${clash.ticketNo ?? '?'}. Use a different number, or clear this one.`); return; }
      }
      const froms = readFromRows(fromRowsEl).filter((f) => f.type && f.id);
      let tos;
      if (toKind === 'sale') {
        const saleVal = getVal(root, 'to-sale-select');
        if (!saleVal) {
          root.querySelector('#to-sale-select')?.focus();
          return;
        }
        const [type, ...rest] = saleVal.split(':');
        tos = [{ type, id: rest.join(':'), tons: getNum(root, 'tons') }];
      } else if (toKind === 'use') {
        tos = [];   // used on the farm: out of the stock, to no contract and no other store
      } else {
        tos = readToRows(toBody.querySelector('#to-rows')).filter((t) => t.type && t.id);
      }
      tos = tos.map((t) => (t.type === 'silo' && t.id === '__transit__' ? { ...t, id: db.ensureTransit(ctx.commodityId || null) } : t));
      if (froms.length === 0 || (tos.length === 0 && toKind !== 'use')) {
        if (froms.length === 0) fromRowsEl.querySelector('.from-select')?.focus();
        else toBody.querySelector('.to-select')?.focus();
        return;
      }
      // grain still in its withholding period after a fumigation: a warning, not a block
      const loadDate = getVal(root, 'date');
      if (!existing || existing.date !== loadDate) {
        const held = froms.filter((f) => f.type === 'silo').map((f) => storages.find((x) => x.id === f.id)).filter(Boolean)
          .map((x) => ({ x, hit: withholdingClash(x, loadDate) })).filter((h) => h.hit);
        if (held.length) {
          const msg = held.map((h) => `${h.x.name} was fumigated on ${dmy(h.hit.date)} and is withheld until ${dmy(h.hit.endsOn)}`).join('. ');
          if (!(await askConfirm(`${msg}. Save this load out anyway?`, { confirmLabel: 'Save anyway', danger: true }))) return;
        }
      }
      db.upsertMovement({
        id: existing?.id,
        date: loadDate,
        froms,
        tos,
        // the commodity of the load, when one is chosen: holdings off-farm are kept by commodity and grade
        ...(ctx.commodityId ? { commodityId: ctx.commodityId } : {}),
        loadTime: getVal(root, 'loadTime') || '',
        destination: getVal(root, 'destination')?.trim() || '',
        externalTicketNo: getVal(root, 'extTicket')?.trim() || '',
        manualDocketNo: getVal(root, 'manualDocket')?.trim() || '',
        deductions: readDeductions(root.querySelector('#ded-rows')),
        outloadNo: olNo,
        // the order it fills; only a load going to a contract can be against one
        orderId: toKind === 'sale' ? (getVal(root, 'to-order-select') || null) : null,
        // the freight order it is carted on; kept as it was when this person cannot see freight orders (no select)
        freightOrderId: toKind === 'sale' ? (root.querySelector('#to-freight-select') ? (getVal(root, 'to-freight-select') || null) : (existing?.freightOrderId || null)) : null,
        truckRego: getVal(root, 'truckRego')?.trim(),
        driver: getVal(root, 'driver')?.trim(),
        grossWeight: getVal(root, 'gross') ? getNum(root, 'gross') : null,
        tareWeight: getVal(root, 'tare') ? getNum(root, 'tare') : null,
        tons: getNum(root, 'tons'),
        weightStatus,
        // the bales on a load of hay, and what it was used for when it was used on the farm
        ...(() => {
          const bales = getNum(root, 'm-bales');
          const hay = isHay(commodities.find((c) => c.id === ctx.commodityId)) && (bales > 0 || toKind === 'use');
          if (!hay) return existing?.hayLoad ? { hayLoad: null } : {};
          return { hayLoad: cleanHayLoad({ bales, kg: Math.round(getNum(root, 'tons') * 1000), use: toKind === 'use' ? (getVal(root, 'm-use')?.trim() || 'Used on farm') : '' }) };
        })(),
        notes: getVal(root, 'notes')?.trim(),
        ...(() => {
          const n = (id) => (getVal(root, id) === '' || getVal(root, id) == null ? null : getNum(root, id));
          return {
            grade: gradeCtl.read() || '',
            moisturePct: n('lq-moisture'), proteinPct: n('lq-protein'), screeningsPct: n('lq-screenings'),
            testWeightKgHl: n('lq-tw'), fallingNumber: n('lq-fn'), oilPct: n('lq-oil'), ffaPct: n('lq-ffa'), retentionPct: n('lq-ret'),
          };
        })(),
        photoDataUrl,
        photoPath,
      });
      closeSheet(); toast('Saved');
    });
    // the slip is made from what is on the screen now (so quality or a destination just typed is on it, saved or not);
    // the ticks are remembered with the ones on the report
    root.querySelector('#tk-origin')?.addEventListener('change', (e) => saveOrigin(e.target.checked));
    root.querySelector('#tk-dest')?.addEventListener('change', (e) => saveDestination(e.target.checked));
    root.querySelector('#tk-split')?.addEventListener('change', (e) => saveSplit(e.target.checked));
    root.querySelector('#tk-comments')?.addEventListener('change', (e) => saveComments(e.target.checked));
    root.querySelector('#tk-quality')?.addEventListener('change', (e) => saveQuality(e.target.checked));
    root.querySelector('#tk-send')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      const num = (id) => (getVal(root, id) === '' || getVal(root, id) == null ? null : getNum(root, id));
      const live = {
        ...existing,
        grade: gradeCtl.read() || '',
        moisturePct: num('lq-moisture'), proteinPct: num('lq-protein'), screeningsPct: num('lq-screenings'),
        testWeightKgHl: num('lq-tw'), fallingNumber: num('lq-fn'), oilPct: num('lq-oil'), ffaPct: num('lq-ffa'), retentionPct: num('lq-ret'),
        loadTime: getVal(root, 'loadTime') || '', destination: getVal(root, 'destination')?.trim() || '',
        truckRego: getVal(root, 'truckRego')?.trim(), driver: getVal(root, 'driver')?.trim(),
        grossWeight: num('gross'), tareWeight: num('tare'), tons: getNum(root, 'tons'), weightStatus,
        notes: getVal(root, 'notes')?.trim(),
      };
      try { await sendLoadTicket(live, { showOrigin: root.querySelector('#tk-origin').checked, showDestination: root.querySelector('#tk-dest').checked, showComments: root.querySelector('#tk-comments').checked, showQuality: root.querySelector('#tk-quality').checked, showSplit: root.querySelector('#tk-split').checked }); }
      catch (err) { notify(`The load ticket could not be made: ${err.message}`); }
      finally { btn.disabled = false; }
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete('Delete this movement?', () => {
          db.deleteMovement(existing.id);
          closeSheet();
        });
      });
    }
  });
}
