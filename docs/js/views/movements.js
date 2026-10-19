import { db } from '../storage.js?v=109';
import { movementsForEndpoint } from '../derived.js?v=109';
import { num, tons, esc, shortDate, todayLocal } from '../fmt.js?v=109';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, notify, askConfirm } from '../ui.js?v=109';
import { compressAndStampImage } from '../img.js?v=109';
import { displayUrlFor } from '../photos.js?v=109';

let unsub = null;

export function renderMovements(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

// What the list is narrowed to. Kept across repaints so a ticket saved or a
// sync arriving does not wipe the search someone is part-way through.
let listFilter = { q: '', commodityId: '' };

function ticketSearchText(m, ctx) {
  const ends = [...(m.froms || []).map((f) => endpointLabel(f.type, f.id, ctx)), ...(m.tos || []).map((t) => endpointLabel(t.type, t.id, ctx))];
  const c = ctx.commodities.find((cc) => cc.id === m.commodityId);
  return [m.ticketNo, m.date, m.truckRego, m.driver, m.notes, c?.name, ...ends].filter(Boolean).join(' ').toLowerCase();
}

function dayHeading(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return 'No date';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function paint(root) {
  const { storages, commodities, movements } = db.get();
  const inUse = commodities.filter((c) => movements.some((m) => m.commodityId === c.id));
  if (listFilter.commodityId && !inUse.some((c) => c.id === listFilter.commodityId)) listFilter.commodityId = '';

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Movement</h1>
        <div class="sub">Truck tickets: field/silo &rarr; silo/contract</div>
      </div>
    </div>
    <div class="view">
      <div class="stat-grid" id="move-stats"></div>

      ${storages.some((s) => s.kind === 'tally') ? `<button class="btn secondary small" id="log-ginning" style="margin-bottom:10px">+ Log ginning</button>` : ''}

      ${movements.length > 0 ? `
      <div class="filterbar">
        <input type="search" id="mv-q" placeholder="Search tickets, trucks, drivers, buyers" value="${esc(listFilter.q)}" aria-label="Search tickets" />
        ${inUse.length > 1 ? `<div class="chips">
          <button type="button" class="chip ${listFilter.commodityId ? '' : 'active'}" data-chip="">All</button>
          ${inUse.map((c) => `<button type="button" class="chip ${listFilter.commodityId === c.id ? 'active' : ''}" data-chip="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        </div>` : ''}
      </div>` : ''}

      <div class="card input">
        <h2><span class="dot input"></span>Tickets</h2>
        <div id="ticket-list"></div>
      </div>
    </div>
    ${movements.length > 0 ? `<button class="fab-secondary" id="repeat-movement">Repeat</button>` : ''}
    <button class="fab" id="add-movement">+</button>
  `;

  paintList(root);

  root.querySelector('#add-movement').addEventListener('click', () => openMovementSheet(null));
  root.querySelector('#log-ginning')?.addEventListener('click', () => openGinningSheet());
  // The most recent ticket by date — not the last one typed in, which is
  // whatever order an import or an edit happened to leave.
  root.querySelector('#repeat-movement')?.addEventListener('click', () => {
    const latest = [...movements].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.ticketNo) || 0) - (Number(a.ticketNo) || 0))[0];
    openMovementSheet(null, latest);
  });
  root.querySelector('#mv-q')?.addEventListener('input', (e) => { listFilter.q = e.target.value; paintList(root); });
  root.querySelectorAll('[data-chip]').forEach((el) => {
    el.addEventListener('click', () => { listFilter.commodityId = el.dataset.chip; paint(root); });
  });
}

/** The ticket list and its totals, repainted alone so the search box keeps focus. */
function paintList(root) {
  const { fields, storages, sales, commodities, movements } = db.get();
  const ctx = { fields, storages, sales, commodities, grouped: true };
  const q = listFilter.q.trim().toLowerCase();
  const shown = movements
    .filter((m) => !listFilter.commodityId || m.commodityId === listFilter.commodityId)
    .filter((m) => !q || ticketSearchText(m, ctx).includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.ticketNo) || 0) - (Number(a.ticketNo) || 0));
  const narrowed = !!(q || listFilter.commodityId);
  const totalTons = shown.reduce((s, m) => s + (Number(m.tons) || 0), 0);

  root.querySelector('#move-stats').innerHTML = `
    <div class="stat"><div class="n">${shown.length}</div><div class="l">${narrowed ? 'Loads shown' : 'Loads logged'}</div></div>
    <div class="stat"><div class="n">${num(totalTons, 1)} t</div><div class="l">${narrowed ? 'Moved (shown)' : 'Total moved'}</div></div>`;

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
  let lastDate = null;
  list.innerHTML = shown.map((m) => {
    let head = '';
    if ((m.date || '') !== lastDate) {
      lastDate = m.date || '';
      const day = shown.filter((x) => (x.date || '') === lastDate);
      const dayTons = day.reduce((s, x) => s + (Number(x.tons) || 0), 0);
      head = `<div class="day-label"><span>${esc(dayHeading(m.date))}</span><span>${day.length} load${day.length === 1 ? '' : 's'} · ${num(dayTons, 1)} t</span></div>`;
    }
    return head + movementRow(m, ctx);
  }).join('');
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
  const list = fields.filter((f) => matchesCommodity(f, commodityId));
  return [{ value: '', label: 'Select…' }, ...list.map((f) => ({ value: `field:${f.id}`, label: f.name }))];
}

function siloOptions(storages, commodityId) {
  const list = storages.filter((s) => matchesCommodity(s, commodityId));
  return [{ value: '', label: 'Select…' }, ...list.map((s) => ({ value: `silo:${s.id}`, label: s.name }))];
}

function saleOptions(sales, commodities, commodityId) {
  const list = commodityId ? sales.filter((s) => s.commodityId === commodityId) : sales;
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
export function renderRelatedMovements(container, type, id) {
  if (!container) return;
  const { fields, storages, sales, commodities, movements } = db.get();
  const related = movementsForEndpoint(type, id, movements);
  const ctx = { fields, storages, sales, commodities };
  container.className = 'card';
  container.innerHTML = `
    <h2>Related movements</h2>
    ${related.length === 0 ? `<div class="empty">No movements linked to this yet.</div>` : related.map((m) => movementRow(m, ctx)).join('')}
  `;
  container.querySelectorAll('[data-edit-movement]').forEach((el) => {
    el.addEventListener('click', () => openMovementSheet(related.find((m) => m.id === el.dataset.editMovement)));
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
  const toLabel = tos.map((t) => endLabel(t.type, t.id, ctx)).join(' + ') || 'Unknown';
  const isFinal = m.weightStatus === 'final';
  const commodity = ctx.commodities.find((c) => c.id === m.commodityId)?.name;
  const fromBreakdown = froms.length > 1
    ? froms.map((f) => `From ${endpointLabel(f.type, f.id, ctx)}: ${num(f.tons, 2)} t`).join(', ')
    : null;
  const toBreakdown = tos.length > 1
    ? tos.map((t) => `To ${endpointLabel(t.type, t.id, ctx)}: ${num(t.tons, 2)} t`).join(', ')
    : null;
  const details = [commodity, m.ticketNo ? `#${m.ticketNo}` : '', ctx.grouped ? '' : (shortDate(m.date) || 'No date'), m.truckRego, m.driver].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="list-item stack" data-edit-movement="${m.id}">
      <div class="li-top">
        <div class="main">${esc(fromLabel)} &rarr; ${esc(toLabel)}</div>
        <div class="main">${tons(m.tons || 0)}</div>
      </div>
      <div class="li-foot" style="margin-top:2px">
        <span class="meta">${details}</span>
        <span class="badges"><span class="badge ${isFinal ? 'pos' : 'warn'}">${isFinal ? 'Final' : 'Estimate'}</span>${(m.photoDataUrl || m.photoPath) ? '<span aria-label="Has photo">📷</span>' : ''}</span>
      </div>
      ${fromBreakdown ? `<div class="meta">${esc(fromBreakdown)}</div>` : ''}
      ${toBreakdown ? `<div class="meta">${esc(toBreakdown)}</div>` : ''}
    </div>
  `;
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
      <button type="button" class="btn danger small from-remove" style="width:auto">&times;</button>
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
    <button type="button" class="btn danger small to-remove" style="width:auto">&times;</button>
  `;
  container.appendChild(row);

  const toSelectEl = row.querySelector('.to-select');
  let toFirstRender = true;
  function renderToSelect() {
    const selectedVal = toFirstRender
      ? (existingTo?.id ? `silo:${existingTo.id}` : '')
      : toSelectEl.value;
    toFirstRender = false;
    toSelectEl.innerHTML = ctx.siloOpts()
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
 * Ginning converts round bales sitting at the gin into lint bales + seed —
 * a processing step, not a relocation, so the "in" and "out" quantities
 * deliberately don't match. Movements never enforce froms/tos balancing
 * (see the multi-destination silo-split feature), so this is really just a
 * pre-filled movement: round bales out of one tally storage, lint bales +
 * seed tonnes into two others. Saved as a normal movement — editable
 * afterwards via the regular "Edit movement" sheet like any other.
 */
function openGinningSheet() {
  const { storages, commodities } = db.get();
  const tallyStorages = storages.filter((s) => s.kind === 'tally');
  const tallyOptions = [{ value: '', label: 'Select…' }, ...tallyStorages.map((s) => ({ value: s.id, label: s.name }))];

  openSheet('Log ginning', (root) => {
    root.innerHTML = `
      ${field({ label: 'Date', id: 'g-date', type: 'date' })}
      ${field({ label: 'Round bale storage', id: 'g-from', type: 'select', options: tallyOptions, hint: 'Where the round bales being ginned are currently tracked' })}
      ${field({ label: 'Round bales to gin', id: 'g-round', type: 'number', step: '1' })}
      ${field({ label: 'Ginned bales per round bale', id: 'g-ratio', type: 'number', step: '0.1', placeholder: 'e.g. 4.2', hint: "Defaults from the commodity's setting — editable to match the actual gin docket" })}
      ${field({ label: 'Lint bale storage', id: 'g-lint-to', type: 'select', options: tallyOptions })}
      ${field({ label: 'Lint bales produced', id: 'g-lint-bales', type: 'number', step: '1', hint: 'Auto-calculated from the ratio above — adjust to match the docket' })}
      ${field({ label: 'Seed storage', id: 'g-seed-to', type: 'select', options: tallyOptions })}
      ${field({ label: 'Seed produced (t)', id: 'g-seed-t', type: 'number', step: '0.01' })}
      ${field({ label: 'Notes', id: 'g-notes', placeholder: 'Ginning' })}
      <button class="btn" id="g-save" style="margin-top:12px">Save</button>
    `;

    const fromSelect = root.querySelector('#g-from');
    const ratioInput = root.querySelector('#g-ratio');
    const roundInput = root.querySelector('#g-round');
    const lintBalesInput = root.querySelector('#g-lint-bales');
    let lintBalesTouched = false;

    fromSelect.addEventListener('change', () => {
      const source = tallyStorages.find((s) => s.id === getVal(root, 'g-from'));
      const commodity = commodities.find((c) => c.id === source?.commodityId);
      if (commodity?.balesPerRoundBale) ratioInput.value = commodity.balesPerRoundBale;
      recomputeLint();
    });
    const recomputeLint = () => {
      if (lintBalesTouched) return;
      const round = getNum(root, 'g-round');
      const ratio = getNum(root, 'g-ratio');
      lintBalesInput.value = round > 0 && ratio > 0 ? (Math.round(round * ratio * 10) / 10) : '';
    };
    roundInput.addEventListener('input', recomputeLint);
    ratioInput.addEventListener('input', recomputeLint);
    lintBalesInput.addEventListener('input', () => { lintBalesTouched = true; });

    root.querySelector('#g-save').addEventListener('click', () => {
      const fromId = getVal(root, 'g-from');
      const lintToId = getVal(root, 'g-lint-to');
      const seedToId = getVal(root, 'g-seed-to');
      const roundBales = getNum(root, 'g-round');
      if (!fromId) { fromSelect.focus(); return; }
      if (!roundBales) { roundInput.focus(); return; }
      if (!lintToId && !seedToId) { root.querySelector('#g-lint-to').focus(); return; }

      const tos = [];
      const lintBales = getNum(root, 'g-lint-bales');
      const seedTons = getNum(root, 'g-seed-t');
      if (lintToId && lintBales) tos.push({ type: 'silo', id: lintToId, tons: lintBales });
      if (seedToId && seedTons) tos.push({ type: 'silo', id: seedToId, tons: seedTons });
      if (tos.length === 0) { root.querySelector('#g-lint-bales').focus(); return; }

      db.upsertMovement({
        date: getVal(root, 'g-date'),
        froms: [{ type: 'silo', id: fromId, tons: roundBales }],
        tos,
        tons: roundBales,
        weightStatus: 'final',
        notes: getVal(root, 'g-notes')?.trim() || 'Ginning',
      });
      closeSheet(); toast('Saved');
    });
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
  const { fields, storages, sales, commodities, movements } = db.get();
  const src = existing || template;
  const existingFroms = src?.froms?.length ? src.froms : [{ type: '', id: '', tons: '' }];
  const existingSiloTos = (src?.tos || []).filter((t) => t.type === 'silo');
  const existingSaleTo = (src?.tos || []).find((t) => t.type === 'sale');

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

  const ctx = {
    commodityId: inferCommodityId(),
    refreshers: [],
    fieldOpts() { return fieldOptions(fields, this.commodityId); },
    siloOpts() { return siloOptions(storages, this.commodityId); },
    saleOpts() { return saleOptions(sales, commodities, this.commodityId); },
    refreshAll() { this.refreshers.forEach((fn) => fn()); },
  };

  openSheet(existing ? `Edit movement #${existing.ticketNo ?? ''}` : 'Add movement', (root) => {
    root.innerHTML = `
      <datalist id="dl-regos">${distinctOf(movements, 'truckRego').map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-drivers">${distinctOf(movements, 'driver').map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      ${field({ label: 'Date', id: 'date', type: 'date', value: existing ? existing.date : todayLocal() })}
      <div class="field">
        <label>Commodity</label>
        <select id="m-commodity">
          <option value="">All commodities</option>
          ${commodities.map((c) => `<option value="${c.id}" ${c.id === ctx.commodityId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <div class="hint">Narrows the paddocks, silos and contracts below to this grain.</div>
      </div>
      <div class="field"><label>From (add more if a load blends multiple silos/fields)</label></div>
      <div id="from-rows"></div>
      <button type="button" class="btn secondary small" id="add-from">+ Add source</button>
      <div class="row" style="margin-bottom:14px"><span class="label">Sources total</span><span class="value" id="from-sources-total">0.0 t</span></div>
      <div class="field">
        <label>To</label>
        <div class="segmented" id="to-kind">
          <button type="button" data-kind="silo" class="${!existingSaleTo ? 'active' : ''}">Silo</button>
          <button type="button" data-kind="sale" class="${existingSaleTo ? 'active' : ''}">Contract</button>
        </div>
      </div>
      <div id="to-body" style="margin-top:8px"></div>
      <div class="grid-2">
        ${field({ label: 'Truck rego', id: 'truckRego', value: src?.truckRego, list: 'dl-regos' })}
        ${field({ label: 'Driver', id: 'driver', value: src?.driver, list: 'dl-drivers' })}
      </div>
      <hr class="sep" />
      <div class="field"><label>Weight</label></div>
      <div class="grid-2">
        ${field({ label: 'Gross (t, optional)', id: 'gross', type: 'number', step: '0.01', value: src?.grossWeight })}
        ${field({ label: 'Tare (t, optional)', id: 'tare', type: 'number', step: '0.01', value: src?.tareWeight })}
      </div>
      ${field({ label: 'Net weight (t)', id: 'tons', type: 'number', step: '0.01', value: src?.tons, hint: 'Auto-fills from Gross − Tare, or enter it directly if those are unknown' })}
      <div class="field">
        <label>Weight status</label>
        <div class="segmented" id="m-status">
          <button data-status="estimate" class="${(src?.weightStatus || 'estimate') === 'estimate' ? 'active' : ''}">Estimate</button>
          <button data-status="final" class="${src?.weightStatus === 'final' ? 'active' : ''}">Final</button>
        </div>
      </div>
      ${field({ label: 'Notes', id: 'notes', value: src?.notes })}
      <div class="field">
        <label>Photo (e.g. truck rego)</label>
        <input id="m-photo-file" type="file" accept="image/*" capture="environment" />
        <div class="hint">Kept with this load and uploaded once you have signal. A date/time stamp is added automatically.</div>
        <div id="m-photo-preview" style="margin-top:8px"></div>
      </div>
      ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete movement</button>` : ''}
      <div class="save-bar"><div class="total"><div class="l">Net load</div><div class="v" id="load-preview">—</div></div><button class="btn" id="save">Save</button></div>
    `;

    const fromRowsEl = root.querySelector('#from-rows');
    const sourcesTotalEl = root.querySelector('#from-sources-total');
    function recomputeSourcesTotal() {
      const total = readFromRows(fromRowsEl).reduce((s, f) => s + (Number(f.tons) || 0), 0);
      sourcesTotalEl.textContent = tons(total);
    }
    existingFroms.forEach((f) => addFromRow(fromRowsEl, ctx, recomputeSourcesTotal, f));
    root.querySelector('#add-from').addEventListener('click', () => addFromRow(fromRowsEl, ctx, recomputeSourcesTotal));
    recomputeSourcesTotal();

    root.querySelector('#m-commodity').addEventListener('change', (e) => {
      ctx.commodityId = e.target.value;
      ctx.refreshAll();
      recomputeSourcesTotal();
    });

    let toKind = existingSaleTo ? 'sale' : 'silo';
    const toBody = root.querySelector('#to-body');
    function renderToBody() {
      // The To side is rebuilt wholesale when the kind flips, so discard any
      // refreshers pointing at DOM that is about to be replaced.
      ctx.refreshers = ctx.refreshers.filter((fn) => !fn.ownedByToBody);
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
          </div>`;
        const saleSelectEl = toBody.querySelector('#to-sale-select');
        const refreshSale = () => {
          const keep = saleSelectEl.value;
          saleSelectEl.innerHTML = ctx.saleOpts()
            .map((o) => `<option value="${o.value}" ${String(o.value) === keep ? 'selected' : ''}>${o.label}</option>`).join('');
        };
        refreshSale.ownedByToBody = true;
        ctx.refreshers.push(refreshSale);
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
      const btn = e.target.closest('button[data-kind]');
      if (!btn || btn.dataset.kind === toKind) return;
      toKind = btn.dataset.kind;
      root.querySelectorAll('#to-kind button').forEach((b) => b.classList.toggle('active', b === btn));
      renderToBody();
    });

    const grossEl = root.querySelector('#gross');
    const tareEl = root.querySelector('#tare');
    const tonsEl = root.querySelector('#tons');
    const loadPreviewEl = root.querySelector('#load-preview');
    const showLoad = () => { loadPreviewEl.textContent = tons(getNum(root, 'tons')); };
    function recomputeNet() {
      const gross = parseFloat(grossEl.value);
      const tare = parseFloat(tareEl.value);
      if (!Number.isNaN(gross) && !Number.isNaN(tare)) {
        tonsEl.value = (gross - tare).toFixed(2);
      }
      showLoad();
    }
    grossEl.addEventListener('input', recomputeNet);
    tareEl.addEventListener('input', recomputeNet);
    tonsEl.addEventListener('input', showLoad);
    showLoad();

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
      photoPreview.innerHTML = src
        ? `<img src="${src}" style="width:100%;border-radius:10px;display:block" /><button class="btn secondary small" id="m-photo-remove" style="margin-top:8px">Remove photo</button>`
        : '';
      const removeBtn = photoPreview.querySelector('#m-photo-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => { photoDataUrl = null; photoPath = null; renderPhotoPreview(); });
    }
    renderPhotoPreview();
    root.querySelector('#m-photo-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        photoDataUrl = await compressAndStampImage(file);
        renderPhotoPreview();
      } catch (err) {
        notify('Could not process that photo.');
      }
    });

    root.querySelector('#save').addEventListener('click', () => {
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
      } else {
        tos = readToRows(toBody.querySelector('#to-rows')).filter((t) => t.type && t.id);
      }
      if (froms.length === 0 || tos.length === 0) {
        if (froms.length === 0) fromRowsEl.querySelector('.from-select')?.focus();
        else toBody.querySelector('.to-select')?.focus();
        return;
      }
      db.upsertMovement({
        id: existing?.id,
        date: getVal(root, 'date'),
        froms,
        tos,
        truckRego: getVal(root, 'truckRego')?.trim(),
        driver: getVal(root, 'driver')?.trim(),
        grossWeight: getVal(root, 'gross') ? getNum(root, 'gross') : null,
        tareWeight: getVal(root, 'tare') ? getNum(root, 'tare') : null,
        tons: getNum(root, 'tons'),
        weightStatus,
        notes: getVal(root, 'notes')?.trim(),
        photoDataUrl,
        photoPath,
      });
      closeSheet(); toast('Saved');
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
