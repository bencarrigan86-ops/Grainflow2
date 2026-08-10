import { db } from '../storage.js';
import { productionByCommodity, fieldTons } from '../derived.js';
import { num, tons, ha, esc } from '../fmt.js';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js';

let unsub = null;

export function renderProduction(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields } = db.get();
  const rollup = productionByCommodity(commodities, fields).filter((r) => r.fieldCount > 0);
  const sortedFields = [...fields].sort((a, b) => a.name.localeCompare(b.name));

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
        ${sortedFields.length === 0 ? `<div class="empty">Tap + to add your first field.</div>` : sortedFields.map((f) => fieldRow(f, commodities)).join('')}
      </div>
    </div>
    <button class="fab" id="add-field">+</button>
  `;

  root.querySelectorAll('[data-edit-field]').forEach((el) => {
    el.addEventListener('click', () => openFieldSheet(fields.find((f) => f.id === el.dataset.editField)));
  });
  root.querySelector('#add-field').addEventListener('click', () => openFieldSheet(null));
}

function fieldRow(f, commodities) {
  const c = commodities.find((c) => c.id === f.commodityId);
  return `
    <div class="list-item" data-edit-field="${f.id}">
      <div>
        <div class="main">${esc(f.name)}</div>
        <div class="meta">${esc(c ? c.name : 'No commodity')} · ${ha(f.areaHa)}</div>
      </div>
      <div class="right">
        <div class="main">${tons(fieldTons(f))}</div>
        <div class="meta">${num(f.yieldTHa || 0, 2)} t/ha</div>
      </div>
    </div>
  `;
}

function openFieldSheet(existing) {
  const { commodities } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));

  const body = openSheet(existing ? 'Edit field' : 'Add field', (root) => {
    root.innerHTML = `
      ${field({ label: 'Field name', id: 'name', value: existing?.name, placeholder: 'e.g. SR1-3' })}
      ${field({ label: 'Area (ha)', id: 'area', type: 'number', step: '0.01', value: existing?.areaHa })}
      ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
      ${field({ label: 'Yield (t/ha)', id: 'yield', type: 'number', step: '0.01', value: existing?.yieldTHa })}
      <div class="row"><span class="label">Total tons</span><span class="value" id="tons-preview">0.0 t</span></div>
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete field</button>` : ''}
    `;

    const preview = root.querySelector('#tons-preview');
    const recompute = () => {
      preview.textContent = tons(getNum(root, 'area') * getNum(root, 'yield'));
    };
    root.querySelector('#area').addEventListener('input', recompute);
    root.querySelector('#yield').addEventListener('input', recompute);
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
