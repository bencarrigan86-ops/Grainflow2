import { db } from '../storage.js?v=50';
import { movementsForEndpoint } from '../derived.js?v=50';
import { num, tons, esc } from '../fmt.js?v=50';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=50';
import { compressAndStampImage } from '../img.js?v=50';

let unsub = null;

export function renderMovements(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { fields, storages, sales, commodities, movements } = db.get();
  const sorted = [...movements].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const totalTons = movements.reduce((s, m) => s + (Number(m.tons) || 0), 0);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Movement</h1>
        <div class="sub">Truck tickets: field/silo &rarr; silo/contract</div>
      </div>
    </div>
    <div class="view">
      <div class="stat-grid">
        <div class="stat"><div class="n">${movements.length}</div><div class="l">Loads logged</div></div>
        <div class="stat"><div class="n">${num(totalTons, 1)} t</div><div class="l">Total moved</div></div>
      </div>

      ${storages.some((s) => s.kind === 'tally') ? `<button class="btn secondary small" id="log-ginning" style="margin-bottom:4px">+ Log ginning</button>` : ''}

      <div class="card input">
        <h2><span class="dot input"></span>Tickets</h2>
        ${sorted.length === 0 ? `<div class="empty">Tap + to log your first truck movement.</div>` : sorted.map((m) => movementRow(m, { fields, storages, sales, commodities })).join('')}
      </div>
    </div>
    ${movements.length > 0 ? `<button class="fab-secondary" id="repeat-movement">Repeat</button>` : ''}
    <button class="fab" id="add-movement">+</button>
  `;

  root.querySelectorAll('[data-edit-movement]').forEach((el) => {
    el.addEventListener('click', () => openMovementSheet(movements.find((m) => m.id === el.dataset.editMovement)));
  });
  root.querySelector('#add-movement').addEventListener('click', () => openMovementSheet(null));
  const ginBtn = root.querySelector('#log-ginning');
  if (ginBtn) ginBtn.addEventListener('click', () => openGinningSheet());
  const repeatBtn = root.querySelector('#repeat-movement');
  if (repeatBtn) repeatBtn.addEventListener('click', () => openMovementSheet(null, movements[movements.length - 1]));
}

function fieldOptions(fields) {
  return [{ value: '', label: 'Select…' }, ...fields.map((f) => ({ value: `field:${f.id}`, label: f.name }))];
}

function siloOptions(storages) {
  return [{ value: '', label: 'Select…' }, ...storages.map((s) => ({ value: `silo:${s.id}`, label: s.name }))];
}

function saleOptions(sales, commodities) {
  const opts = sales.map((s) => {
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

export function movementRow(m, ctx) {
  const froms = m.froms || [];
  const tos = m.tos || [];
  const fromLabel = froms.map((f) => endpointLabel(f.type, f.id, ctx)).join(' + ') || 'Unknown';
  const toLabel = tos.map((t) => endpointLabel(t.type, t.id, ctx)).join(' + ') || 'Unknown';
  const isFinal = m.weightStatus === 'final';
  const fromBreakdown = froms.length > 1
    ? froms.map((f) => `From ${endpointLabel(f.type, f.id, ctx)}: ${num(f.tons, 2)} t`).join(', ')
    : null;
  const toBreakdown = tos.length > 1
    ? tos.map((t) => `To ${endpointLabel(t.type, t.id, ctx)}: ${num(t.tons, 2)} t`).join(', ')
    : null;
  return `
    <div class="list-item" data-edit-movement="${m.id}">
      <div>
        <div class="main">${m.ticketNo ? `<span style="color:var(--text-dim);font-weight:500">#${m.ticketNo}</span> ` : ''}${esc(fromLabel)} &rarr; ${esc(toLabel)}</div>
        <div class="meta">${esc(m.date || 'No date')}${m.truckRego ? ` · ${esc(m.truckRego)}` : ''}${m.driver ? ` · ${esc(m.driver)}` : ''}</div>
        ${fromBreakdown ? `<div class="meta">${esc(fromBreakdown)}</div>` : ''}
        ${toBreakdown ? `<div class="meta">${esc(toBreakdown)}</div>` : ''}
      </div>
      <div class="right">
        <div class="main">${tons(m.tons || 0)}</div>
        <div class="meta"><span class="badge ${isFinal ? 'pos' : 'neg'}">${isFinal ? 'Final' : 'Estimate'}</span>${m.photoDataUrl ? ' 📷' : ''}</div>
      </div>
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
  function renderSelect() {
    const options = kind === 'silo' ? ctx.siloOpts : ctx.fieldOpts;
    const selectedVal = existingFrom?.type === kind ? `${existingFrom.type}:${existingFrom.id}` : '';
    selectEl.innerHTML = options.map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
  }
  renderSelect();

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
function addToRow(container, siloOpts, onChange, existingTo) {
  const row = document.createElement('div');
  row.className = 'to-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:10px';
  const selectedVal = existingTo?.id ? `silo:${existingTo.id}` : '';
  const opts = siloOpts.map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
  row.innerHTML = `
    <div class="field" style="flex:2;margin-bottom:0">
      <label>Silo</label>
      <select class="to-select">${opts}</select>
    </div>
    <div class="field" style="flex:1;margin-bottom:0">
      <label>Tons</label>
      <input type="number" step="0.01" inputmode="decimal" class="to-tons" value="${existingTo?.tons ?? ''}" />
    </div>
    <button type="button" class="btn danger small to-remove" style="width:auto">&times;</button>
  `;
  container.appendChild(row);
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
      closeSheet();
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
  const { fields, storages, sales, commodities } = db.get();
  const src = existing || template;
  const ctx = {
    fieldOpts: fieldOptions(fields),
    siloOpts: siloOptions(storages),
    saleOpts: saleOptions(sales, commodities),
  };
  const existingFroms = src?.froms?.length ? src.froms : [{ type: '', id: '', tons: '' }];
  const existingSiloTos = (src?.tos || []).filter((t) => t.type === 'silo');
  const existingSaleTo = (src?.tos || []).find((t) => t.type === 'sale');

  openSheet(existing ? `Edit movement #${existing.ticketNo ?? ''}` : 'Add movement', (root) => {
    root.innerHTML = `
      ${field({ label: 'Date', id: 'date', type: 'date', value: src?.date })}
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
        ${field({ label: 'Truck rego', id: 'truckRego', value: src?.truckRego })}
        ${field({ label: 'Driver', id: 'driver', value: src?.driver })}
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
        <div class="hint">Saved on this device only. A date/time stamp is added automatically.</div>
        <div id="m-photo-preview" style="margin-top:8px"></div>
      </div>
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete movement</button>` : ''}
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

    let toKind = existingSaleTo ? 'sale' : 'silo';
    const toBody = root.querySelector('#to-body');
    function renderToBody() {
      if (toKind === 'sale') {
        const selectedVal = existingSaleTo ? `sale:${existingSaleTo.id}` : '';
        const opts = ctx.saleOpts.map((o) => `<option value="${o.value}" ${String(o.value) === selectedVal ? 'selected' : ''}>${o.label}</option>`).join('');
        toBody.innerHTML = `<select id="to-sale-select">${opts}</select>`;
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
        initialTos.forEach((t) => addToRow(toRowsEl, ctx.siloOpts, recomputeDestTotal, t));
        toBody.querySelector('#add-to').addEventListener('click', () => addToRow(toRowsEl, ctx.siloOpts, recomputeDestTotal));
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
    function recomputeNet() {
      const gross = parseFloat(grossEl.value);
      const tare = parseFloat(tareEl.value);
      if (!Number.isNaN(gross) && !Number.isNaN(tare)) {
        tonsEl.value = (gross - tare).toFixed(2);
      }
    }
    grossEl.addEventListener('input', recomputeNet);
    tareEl.addEventListener('input', recomputeNet);

    let weightStatus = src?.weightStatus || 'estimate';
    root.querySelector('#m-status').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      weightStatus = btn.dataset.status;
      root.querySelectorAll('#m-status button').forEach((b) => b.classList.toggle('active', b === btn));
    });

    let photoDataUrl = existing?.photoDataUrl || null;
    const photoPreview = root.querySelector('#m-photo-preview');
    function renderPhotoPreview() {
      photoPreview.innerHTML = photoDataUrl
        ? `<img src="${photoDataUrl}" style="width:100%;border-radius:10px;display:block" /><button class="btn secondary small" id="m-photo-remove" style="margin-top:8px">Remove photo</button>`
        : '';
      const removeBtn = photoPreview.querySelector('#m-photo-remove');
      if (removeBtn) removeBtn.addEventListener('click', () => { photoDataUrl = null; renderPhotoPreview(); });
    }
    renderPhotoPreview();
    root.querySelector('#m-photo-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        photoDataUrl = await compressAndStampImage(file);
        renderPhotoPreview();
      } catch (err) {
        alert('Could not process that photo.');
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
      });
      closeSheet();
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
