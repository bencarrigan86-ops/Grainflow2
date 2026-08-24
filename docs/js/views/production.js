import { db } from '../storage.js?v=42';
import { productionByCommodity, fieldTons, estimateFieldTons, movementTonsFromField, fieldUrea, fieldStarter, fieldSeed, soilNUreaEquivalent, fieldUreaForTarget, groupFieldsByCommodity } from '../derived.js?v=42';
import { num, tons, ha, esc } from '../fmt.js?v=42';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=42';
import { renderRelatedMovements } from './movements.js?v=42';

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
  const productionTotals = rollup.reduce((acc, r) => ({ area: acc.area + r.area, tons: acc.tons + r.tons }), { area: 0, tons: 0 });
  productionTotals.yieldTHa = productionTotals.area > 0 ? productionTotals.tons / productionTotals.area : 0;

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
            <tfoot><tr>
              <td>Total</td>
              <td>${num(productionTotals.area, 1)}</td>
              <td>${num(productionTotals.yieldTHa, 2)}</td>
              <td>${num(productionTotals.tons, 1)}</td>
            </tr></tfoot>
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

function fieldRow(f, movements) {
  const isActual = f.yieldMode === 'actual';
  const t = fieldTons(f, movements);
  const yieldTHa = f.areaHa > 0 ? t / f.areaHa : 0;
  const actualTons = movementTonsFromField(f.id, movements);
  const actualYieldTHa = f.areaHa > 0 ? actualTons / f.areaHa : 0;
  return `
    <div class="list-item" data-edit-field="${f.id}">
      <div>
        <div class="main">${esc(f.name)}</div>
        <div class="meta">${ha(f.areaHa)} · <span class="badge ${isActual ? 'pos' : 'neg'}">${isActual ? 'Actual' : 'Estimate'}</span></div>
        ${!isActual && actualTons > 0 ? `<div class="meta">Actual (movements): ${num(actualTons, 1)} t · ${num(actualYieldTHa, 2)} t/ha</div>` : ''}
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
      <hr class="sep" />
      <div class="row"><span class="label">Commodity's default target yield</span><span class="value" id="commodity-target-preview">— t/ha</span></div>
      ${field({ label: 'Target yield override (t/ha)', id: 'targetYieldOverride', type: 'number', step: '0.1', value: existing?.targetYieldOverrideTHa || '', placeholder: 'Commodity default', hint: "For fert planning — leave blank to use the commodity's default target yield (set in Settings)" })}
      ${field({ label: 'Soil test N (kg/ha)', id: 'soilTestN', type: 'number', step: '1', value: existing?.soilTestNKgHa ?? 0, hint: 'From your soil test report' })}
      <div class="row"><span class="label">Target yield in use</span><span class="value" id="target-yield-preview">— t/ha</span></div>
      <div class="row"><span class="label">Soil N (urea equivalent)</span><span class="value" id="soiln-preview">0 kg/ha</span></div>
      <div class="row"><span class="label"><strong>Urea required to hit target</strong></span><span class="value" id="target-urea-preview" style="font-size:18px">0 kg/ha</span></div>
      <button class="btn secondary small" id="use-target-urea" style="margin:8px 0">Use as "Urea required" below</button>
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Urea required (kg/ha)', id: 'ureaReq', type: 'number', step: '1', value: existing?.ureaRequiredKgHa ?? 0 })}
        ${field({ label: 'Urea applied (kg/ha)', id: 'ureaApp', type: 'number', step: '1', value: existing?.ureaAppliedKgHa ?? 0 })}
      </div>
      <div class="row"><span class="label">Urea left</span><span class="value" id="urea-preview">0.0 t</span></div>
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Starter required (kg/ha)', id: 'starterReq', type: 'number', step: '1', value: existing?.starterRequiredKgHa ?? 0 })}
        ${field({ label: 'Starter applied (kg/ha)', id: 'starterApp', type: 'number', step: '1', value: existing?.starterAppliedKgHa ?? 0 })}
      </div>
      <div class="row"><span class="label">Starter left</span><span class="value" id="starter-preview">0.0 t</span></div>
      <hr class="sep" />
      <div class="grid-2">
        ${field({ label: 'Seed variety', id: 'seedVariety', value: existing?.seedVariety })}
        ${field({ label: 'Seed rate (kg/ha)', id: 'seedRate', type: 'number', step: '1', value: existing?.seedRateKgHa ?? 0 })}
      </div>
      <div class="row"><span class="label">Seed required</span><span class="value" id="seed-preview">0.0 t</span></div>
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete field</button>` : ''}
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'field', existing.id);

    let yieldMode = existing?.yieldMode || 'estimate';
    const preview = root.querySelector('#tons-preview');
    const ureaPreview = root.querySelector('#urea-preview');
    const soilNPreview = root.querySelector('#soiln-preview');
    const commodityTargetPreview = root.querySelector('#commodity-target-preview');
    const targetYieldPreview = root.querySelector('#target-yield-preview');
    const targetUreaPreview = root.querySelector('#target-urea-preview');
    const starterPreview = root.querySelector('#starter-preview');
    const seedPreview = root.querySelector('#seed-preview');
    const currentTargetCalc = () => fieldUreaForTarget(
      { soilTestNKgHa: getNum(root, 'soilTestN'), targetYieldOverrideTHa: getNum(root, 'targetYieldOverride') },
      commodities.find((c) => c.id === getVal(root, 'commodity'))
    );
    const recompute = () => {
      const tonsVal = yieldMode === 'actual'
        ? actualTons
        : estimateFieldTons({ areaHa: getNum(root, 'area'), yieldTHa: getNum(root, 'yield') });
      const area = getNum(root, 'area');
      const yieldTHa = area > 0 ? tonsVal / area : 0;
      preview.textContent = `${tons(tonsVal)} · ${num(yieldTHa, 2)} t/ha`;
      const u = fieldUrea({ areaHa: getNum(root, 'area'), ureaRequiredKgHa: getNum(root, 'ureaReq'), ureaAppliedKgHa: getNum(root, 'ureaApp') });
      ureaPreview.textContent = tons(u.leftTons);
      soilNPreview.textContent = `${num(soilNUreaEquivalent(getNum(root, 'soilTestN')), 0)} kg/ha`;
      const selectedCommodity = commodities.find((c) => c.id === getVal(root, 'commodity'));
      const commodityDefault = Number(selectedCommodity?.targetYieldTHa) || 0;
      commodityTargetPreview.textContent = commodityDefault > 0 ? `${num(commodityDefault, 2)} t/ha` : '— (set one in Settings)';
      const targetCalc = currentTargetCalc();
      targetYieldPreview.textContent = targetCalc.targetYieldTHa > 0 ? `${num(targetCalc.targetYieldTHa, 2)} t/ha` : '— (set a target yield)';
      targetUreaPreview.textContent = `${num(targetCalc.requiredKgHa, 0)} kg/ha`;
      const st = fieldStarter({ areaHa: getNum(root, 'area'), starterRequiredKgHa: getNum(root, 'starterReq'), starterAppliedKgHa: getNum(root, 'starterApp') });
      starterPreview.textContent = tons(st.leftTons);
      const s = fieldSeed({ areaHa: getNum(root, 'area'), seedRateKgHa: getNum(root, 'seedRate') });
      seedPreview.textContent = tons(s.requiredTons);
    };
    root.querySelector('#area').addEventListener('input', recompute);
    root.querySelector('#yield').addEventListener('input', recompute);
    root.querySelector('#commodity').addEventListener('change', recompute);
    root.querySelector('#ureaReq').addEventListener('input', recompute);
    root.querySelector('#ureaApp').addEventListener('input', recompute);
    root.querySelector('#soilTestN').addEventListener('input', recompute);
    root.querySelector('#targetYieldOverride').addEventListener('input', recompute);
    root.querySelector('#starterReq').addEventListener('input', recompute);
    root.querySelector('#starterApp').addEventListener('input', recompute);
    root.querySelector('#seedRate').addEventListener('input', recompute);
    root.querySelector('#f-mode').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      yieldMode = btn.dataset.mode;
      root.querySelectorAll('#f-mode button').forEach((b) => b.classList.toggle('active', b === btn));
      recompute();
    });
    root.querySelector('#use-target-urea').addEventListener('click', () => {
      root.querySelector('#ureaReq').value = Math.round(currentTargetCalc().requiredKgHa);
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
        ureaRequiredKgHa: getNum(root, 'ureaReq'),
        ureaAppliedKgHa: getNum(root, 'ureaApp'),
        soilTestNKgHa: getNum(root, 'soilTestN'),
        targetYieldOverrideTHa: getNum(root, 'targetYieldOverride'),
        starterRequiredKgHa: getNum(root, 'starterReq'),
        starterAppliedKgHa: getNum(root, 'starterApp'),
        seedVariety: getVal(root, 'seedVariety')?.trim(),
        seedRateKgHa: getNum(root, 'seedRate'),
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
