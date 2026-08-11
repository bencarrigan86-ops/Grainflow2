import { db } from '../storage.js?v=26';
import { num, tons, esc } from '../fmt.js?v=26';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=26';

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

      <div class="card input">
        <h2><span class="dot input"></span>Tickets</h2>
        ${sorted.length === 0 ? `<div class="empty">Tap + to log your first truck movement.</div>` : sorted.map((m) => movementRow(m, { fields, storages, sales, commodities })).join('')}
      </div>
    </div>
    <button class="fab" id="add-movement">+</button>
  `;

  root.querySelectorAll('[data-edit-movement]').forEach((el) => {
    el.addEventListener('click', () => openMovementSheet(movements.find((m) => m.id === el.dataset.editMovement)));
  });
  root.querySelector('#add-movement').addEventListener('click', () => openMovementSheet(null));
}

function endpointOptions(fields, storages, sales, commodities, kind) {
  const fieldOpts = fields.map((f) => ({ value: `field:${f.id}`, label: f.name }));
  const siloOpts = storages.map((s) => ({ value: `silo:${s.id}`, label: s.name }));
  if (kind === 'from') {
    return [{ value: '', label: 'Select…' }, ...fieldOpts, ...siloOpts];
  }
  const saleOpts = sales.map((s) => {
    const c = commodities.find((cc) => cc.id === s.commodityId);
    const label = [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Sale';
    return { value: `sale:${s.id}`, label };
  });
  return [{ value: '', label: 'Select…' }, ...siloOpts, ...saleOpts];
}

function endpointLabel(type, id, { fields, storages, sales, commodities }) {
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

function movementRow(m, ctx) {
  const fromLabel = endpointLabel(m.fromType, m.fromId, ctx);
  const toLabel = endpointLabel(m.toType, m.toId, ctx);
  const isFinal = m.weightStatus === 'final';
  return `
    <div class="list-item" data-edit-movement="${m.id}">
      <div>
        <div class="main">${esc(fromLabel)} &rarr; ${esc(toLabel)}</div>
        <div class="meta">${esc(m.date || 'No date')}${m.truckRego ? ` · ${esc(m.truckRego)}` : ''}${m.driver ? ` · ${esc(m.driver)}` : ''}</div>
      </div>
      <div class="right">
        <div class="main">${tons(m.tons || 0)}</div>
        <div class="meta"><span class="badge ${isFinal ? 'pos' : 'neg'}">${isFinal ? 'Final' : 'Estimate'}</span></div>
      </div>
    </div>
  `;
}

function openMovementSheet(existing) {
  const { fields, storages, sales, commodities } = db.get();
  const fromOptions = endpointOptions(fields, storages, sales, commodities, 'from');
  const toOptions = endpointOptions(fields, storages, sales, commodities, 'to');
  const existingFrom = existing ? `${existing.fromType}:${existing.fromId}` : '';
  const existingTo = existing ? `${existing.toType}:${existing.toId}` : '';

  openSheet(existing ? 'Edit movement' : 'Add movement', (root) => {
    root.innerHTML = `
      ${field({ label: 'Date', id: 'date', type: 'date', value: existing?.date })}
      ${field({ label: 'From (field or silo)', id: 'from', type: 'select', value: existingFrom, options: fromOptions })}
      ${field({ label: 'To (silo or contract)', id: 'to', type: 'select', value: existingTo, options: toOptions })}
      <div class="grid-2">
        ${field({ label: 'Truck rego', id: 'truckRego', value: existing?.truckRego })}
        ${field({ label: 'Driver', id: 'driver', value: existing?.driver })}
      </div>
      ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
      <div class="field">
        <label>Weight</label>
        <div class="segmented" id="m-status">
          <button data-status="estimate" class="${(existing?.weightStatus || 'estimate') === 'estimate' ? 'active' : ''}">Estimate</button>
          <button data-status="final" class="${existing?.weightStatus === 'final' ? 'active' : ''}">Final</button>
        </div>
      </div>
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete movement</button>` : ''}
    `;

    let weightStatus = existing?.weightStatus || 'estimate';
    root.querySelector('#m-status').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-status]');
      if (!btn) return;
      weightStatus = btn.dataset.status;
      root.querySelectorAll('#m-status button').forEach((b) => b.classList.toggle('active', b === btn));
    });

    root.querySelector('#save').addEventListener('click', () => {
      const fromVal = getVal(root, 'from');
      const toVal = getVal(root, 'to');
      if (!fromVal || !toVal) {
        if (!fromVal) root.querySelector('#from').focus();
        else root.querySelector('#to').focus();
        return;
      }
      const [fromType, ...fromRest] = fromVal.split(':');
      const [toType, ...toRest] = toVal.split(':');
      db.upsertMovement({
        id: existing?.id,
        date: getVal(root, 'date'),
        fromType,
        fromId: fromRest.join(':'),
        toType,
        toId: toRest.join(':'),
        truckRego: getVal(root, 'truckRego')?.trim(),
        driver: getVal(root, 'driver')?.trim(),
        tons: getNum(root, 'tons'),
        weightStatus,
        notes: getVal(root, 'notes')?.trim(),
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
