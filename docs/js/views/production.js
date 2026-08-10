import { db } from '../storage.js?v=11';
import { productionByCommodity, fieldTons, estimateFieldTons, movementTonsFromField } from '../derived.js?v=11';
import { num, tons, ha, esc } from '../fmt.js?v=11';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=11';

let unsub = null;

export function renderProduction(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields, movements } = db.get();
  const rollup = productionByCommodity(commodities, fields, movements).filter((r) => r.fieldCount > 0);
  const groups = groupFieldsByCommodity(commodities, fields, movements);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Production</h1>
        <div class="sub">Field level input, rolled up by commodity</div>
      </div>
    </div>
    <div class="view">
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        ${rollup.length === 0 ? `<div class="empty">No fields entered yet.</div>` : `
        <div class="table-scroll">
          <table>
            <thead><tr><th>Commodity</th><th>Area</th><th>Yield</th><th>Tons</th></tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr>
                  <td>${esc(r.commodity.name)}</td>
                  <td>${num(r.area, 1)}</td>
                  <td>${num(r.yieldTHa, 2)}</td>
                  <td>${num(r.tons, 1)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Fields</h2>
        ${groups.length === 0 ? `<div class="empty">Tap + to add your first field.</div>` : groups.map((g) => `
          <div class="group-label"><span>${esc(g.name)}</span><span class="n">${tons(g.totalTons)}</span></div>
          ${g.fields.map((f) => fieldRow(f, movements)).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-field">+</button>
  `;

  root.querySelectorAll('[data-edit-field]').forEach((el) => {
    el.addEventListener('click', () => openFieldSheet(fields.find((f) => f.id === el.dataset.editField)));
  });
  root.querySelector('#add-field').addEventListener('click', () => openFieldSheet(null));
}

function byName(a, b) {
  return (a.name || '').localeCompare(b.name || '');
}

function groupFieldsByCommodity(commodities, fields, movements) {
  const groups = commodities
    .map((c) => {
      const rows = fields.filter((f) => f.commodityId === c.id).sort(byName);
      return { id: c.id, name: c.name, fields: rows, totalTons: rows.reduce((s, f) => s + fieldTons(f, movements), 0) };
    })
    .filter((g) => g.fields.length > 0);

  const noCommodity = fields.filter((f) => !commodities.some((c) => c.id === f.commodityId)).sort(byName);
  if (noCommodity.length > 0) {
    groups.push({ id: null, name: 'No commodity', fields: noCommodity, totalTons: noCommodity.reduce((s, f) => s + fieldTons(f, movements), 0) });
  }
  return groups;
}

function fieldRow(f, movements) {
  const isActual = f.yieldMode === 'actual';
  const t = fieldTons(f, movements);
  const yieldTHa = f.areaHa > 0 ? t / f.areaHa : 0;
  return `
    <div class="list-item" data-edit-field="${f.id}">
      <div>
        <div class="main">${esc(f.name)}</div>
        <div class="meta">${ha(f.areaHa)} · <span class="badge ${isActual ? 'pos' : 'neg'}">${isActual ? 'Actual' : 'Estimate'}</span></div>
      </div>
      <div class="right">
        <div class="main">${tons(t)}</div>
        <div class="meta">${num(yieldTHa, 2)} t/ha</div>
      </div>
    </div>
  `;
}

function openFieldSheet(existing) {
  const { commodities, movements } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));
  const actualTons = existing ? movementTonsFromField(existing.id, movements) : 0;

  const body = openSheet(existing ? 'Edit field' : 'Add field', (root) => {
    root.innerHTML = `
      ${field({ label: 'Field name', id: 'name', value: existing?.name, placeholder: 'e.g. SR1-3' })}
      ${field({ label: 'Area (ha)', id: 'area', type: 'number', step: '0.01', value: existing?.areaHa })}
      ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
      ${field({ label: 'Yield estimate (t/ha)', id: 'yield', type: 'number', step: '0.01', value: existing?.yieldTHa })}
      <div class="field">
        <label>Drive tons from</label>
        <div class="segmented" id="f-mode">
          <button data-mode="estimate" class="${(existing?.yieldMode || 'estimate') === 'estimate' ? 'active' : ''}">Estimate</button>
          <button data-mode="actual" class="${existing?.yieldMode === 'actual' ? 'active' : ''}">Actual (movements)</button>
        </div>
        <div class="hint">Actual sums the Movement tickets carted off this field${actualTons > 0 ? ` — currently ${num(actualTons, 1)} t` : ''}.</div>
      </div>
      <div class="row"><span class="label">Total tons</span><span class="value" id="tons-preview">0.0 t</span></div>
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete field</button>` : ''}
    `;

    let yieldMode = existing?.yieldMode || 'estimate';
    const preview = root.querySelector('#tons-preview');
    const recompute = () => {
      if (yieldMode === 'actual') {
        preview.textContent = tons(actualTons);
      } else {
        preview.textContent = tons(estimateFieldTons({ areaHa: getNum(root, 'area'), yieldTHa: getNum(root, 'yield') }));
      }
    };
    root.querySelector('#area').addEventListener('input', recompute);
    root.querySelector('#yield').addEventListener('input', recompute);
    root.querySelector('#f-mode').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      yieldMode = btn.dataset.mode;
      root.querySelectorAll('#f-mode button').forEach((b) => b.classList.toggle('active', b === btn));
      recompute();
    });
    recompute();

    root.querySelector('#save').addEventListener('click', () => {
      const name = getVal(root, 'name')?.trim();
      if (!name) { root.querySelector('#name').focus(); return; }
      db.upsertField({
        id: existing?.id,
        name,
        areaHa: getNum(root, 'area'),
        commodityId: getVal(root, 'commodity'),
        yieldTHa: getNum(root, 'yield'),
        yieldMode,
      });
      closeSheet();
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete(`Delete field "${existing.name}"?`, () => {
          db.deleteField(existing.id);
          closeSheet();
        });
      });
    }
  });
  return body;
}
