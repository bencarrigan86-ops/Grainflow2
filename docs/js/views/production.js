import { db } from '../storage.js?v=50';
import { productionByCommodity, fieldTons, estimateFieldTons, movementTonsFromField, fieldUrea, ureaAppliedKgHaFor, fieldStarter, fieldSeed, soilNUreaEquivalent, fieldUreaForTarget, groupFieldsByCommodity } from '../derived.js?v=50';
import { num, tons, ha, esc } from '../fmt.js?v=50';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=50';
import { renderRelatedMovements } from './movements.js?v=50';

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
  const initialCommodity = commodities.find((c) => c.id === (existing?.commodityId ?? commodities[0]?.id));

  const body = openSheet(existing ? 'Edit field' : 'Add field', (root) => {
    root.innerHTML = `
      ${field({ label: 'Field name', id: 'name', value: existing?.name, placeholder: 'e.g. SR1-3' })}
      ${field({ label: 'Area (ha)', id: 'area', type: 'number', step: '0.01', value: existing?.areaHa })}
      ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
      ${field({ label: 'Yield estimate (t/ha)', id: 'yield', type: 'number', step: '0.01', value: existing ? existing.yieldTHa : (initialCommodity?.defaultYieldTHa || ''), hint: 'For production &amp; sales. Pre-filled from the commodity default below — type in this box to override it for this field.' })}
      <div class="row"><span class="label">Commodity's default yield estimate</span><span class="value" id="commodity-yield-preview">— t/ha</span></div>
      ${existing ? `<button class="btn secondary small" id="use-default-yield" style="margin-bottom:8px">Use commodity default</button>` : ''}
      <div class="field">
        <label>Drive tons from</label>
        <div class="segmented" id="f-mode">
          <button data-mode="estimate" class="${(existing?.yieldMode || 'estimate') === 'estimate' ? 'active' : ''}">Estimate</button>
          <button data-mode="actual" class="${existing?.yieldMode === 'actual' ? 'active' : ''}">Actual (movements)</button>
        </div>
        <div class="hint" id="actual-hint">Actual sums the Movement tickets carted off this field${actualTons > 0 ? ` — currently ${num(actualTons, 1)} t` : ''}.</div>
      </div>
      <div class="row"><span class="label" id="tons-label">Total tons</span><span class="value" id="tons-preview">0.0 t</span></div>
      <hr class="sep" />
      <div class="group-label"><span>Fertiliser planning</span></div>
      <div class="field hint" style="margin:-4px 0 12px">Separate from the yield estimate above — used only for the urea and starter calculations below.</div>
      <div class="row"><span class="label">Commodity's default target yield</span><span class="value" id="commodity-target-preview">— t/ha</span></div>
      ${field({ label: 'Target yield override (t/ha)', id: 'targetYieldOverride', type: 'number', step: '0.1', value: existing?.targetYieldOverrideTHa || '', placeholder: 'Commodity default', hint: "Leave blank to use the commodity's default above — type a value here to override it for this field" })}
      ${field({ label: 'Soil test N (kg/ha)', id: 'soilTestN', type: 'number', step: '1', value: existing?.soilTestNKgHa ?? 0, hint: 'From your soil test report' })}
      <div class="row"><span class="label">Target yield in use</span><span class="value" id="target-yield-preview">— t/ha</span></div>
      <div class="row"><span class="label">Soil N (urea equivalent)</span><span class="value" id="soiln-preview">0 kg/ha</span></div>
      <div class="row"><span class="label"><strong>Urea required to hit target</strong></span><span class="value" id="target-urea-preview" style="font-size:18px">0 kg/ha</span></div>
      <button class="btn secondary small" id="use-target-urea" style="margin:8px 0">Use as "Urea required" below</button>
      <hr class="sep" />
      ${field({ label: 'Urea required (kg/ha)', id: 'ureaReq', type: 'number', step: '1', value: existing?.ureaRequiredKgHa ?? 0 })}
      <div class="row"><span class="label">Urea applied (kg/ha)</span><span class="value" id="urea-applied-total">0 kg/ha</span></div>
      <div id="urea-app-list"></div>
      <button class="btn secondary small" id="toggle-urea-app-form" style="margin-bottom:10px">+ Add application</button>
      <div id="urea-app-form" style="display:none;padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px">
        ${field({ label: 'Date', id: 'ua-date', type: 'date' })}
        <div class="grid-2">
          ${field({ label: 'Applied by', id: 'ua-by', placeholder: 'e.g. Ben' })}
          ${field({ label: 'Machine', id: 'ua-machine', placeholder: 'e.g. Boomspray' })}
        </div>
        ${field({ label: 'Rate (kg/ha)', id: 'ua-rate', type: 'number', step: '1' })}
        ${field({ label: 'Comment', id: 'ua-comment', placeholder: 'e.g. windy, cut rate back on the headland' })}
        <button class="btn small" id="ua-add" style="margin-top:2px">Add application</button>
        ${!existing ? `<div class="hint" style="margin-top:8px">Saved automatically once you save this new field below.</div>` : ''}
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
      <hr class="sep" />
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete field</button>` : ''}
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'field', existing.id);

    let yieldMode = existing?.yieldMode || 'estimate';
    let applications = (existing?.ureaApplications || []).slice();
    const yieldLabelEl = root.querySelector('label[for="yield"]');
    const tonsLabelEl = root.querySelector('#tons-label');
    const actualHintEl = root.querySelector('#actual-hint');
    const preview = root.querySelector('#tons-preview');
    const ureaPreview = root.querySelector('#urea-preview');
    const ureaAppliedTotalEl = root.querySelector('#urea-applied-total');
    const appListEl = root.querySelector('#urea-app-list');
    const soilNPreview = root.querySelector('#soiln-preview');
    const commodityYieldPreview = root.querySelector('#commodity-yield-preview');
    const commodityTargetPreview = root.querySelector('#commodity-target-preview');
    const targetYieldPreview = root.querySelector('#target-yield-preview');
    const targetUreaPreview = root.querySelector('#target-urea-preview');
    const starterPreview = root.querySelector('#starter-preview');
    const seedPreview = root.querySelector('#seed-preview');
    const currentTargetCalc = () => fieldUreaForTarget(
      { soilTestNKgHa: getNum(root, 'soilTestN'), targetYieldOverrideTHa: getNum(root, 'targetYieldOverride') },
      commodities.find((c) => c.id === getVal(root, 'commodity'))
    );
    const appliedKgHa = () => ureaAppliedKgHaFor({ ureaApplications: applications, ureaAppliedKgHa: existing?.ureaAppliedKgHa });
    // Application entries save immediately, independent of the field's main
    // Save button — logging one shouldn't require also saving every other
    // field on the sheet, and shouldn't be lost if the sheet gets closed
    // without hitting Save. A brand-new field has no id to attach to yet, so
    // those just stay pending in `applications` until the field itself is saved.
    const persistApplications = () => {
      if (!existing) return;
      db.upsertField({ ...existing, ureaApplications: applications });
    };
    const renderApplications = () => {
      if (applications.length === 0) {
        const legacy = Number(existing?.ureaAppliedKgHa) || 0;
        appListEl.innerHTML = legacy > 0
          ? `<div class="field hint" style="margin-bottom:8px">No applications logged yet — showing the ${num(legacy, 0)} kg/ha entered before detailed logging started. Add an application below to begin tracking history.</div>`
          : `<div class="field hint" style="margin-bottom:8px">No applications logged yet.</div>`;
      } else {
        appListEl.innerHTML = applications.map((a) => `
          <div class="list-item" style="padding:8px 4px">
            <div>
              <div class="main">${esc(a.date || 'No date')}${a.appliedBy ? ' &middot; ' + esc(a.appliedBy) : ''}</div>
              <div class="meta">${esc(a.machine || '—')} &middot; ${num(a.rateKgHa, 0)} kg/ha</div>
              ${a.comment ? `<div class="meta">${esc(a.comment)}</div>` : ''}
            </div>
            <button type="button" class="btn danger small" data-remove-app="${a.id}" style="width:auto">&times;</button>
          </div>
        `).join('');
        appListEl.querySelectorAll('[data-remove-app]').forEach((btn) => {
          btn.addEventListener('click', () => {
            applications = applications.filter((a) => a.id !== btn.dataset.removeApp);
            renderApplications();
            recompute();
            persistApplications();
          });
        });
      }
    };
    const recompute = () => {
      const selectedCommodityEarly = commodities.find((c) => c.id === getVal(root, 'commodity'));
      const isBales = selectedCommodityEarly?.unit === 'bale';
      const unit = isBales ? 'bales' : 't';
      const unitPerHa = isBales ? 'bales/ha' : 't/ha';
      yieldLabelEl.textContent = `Yield estimate (${unitPerHa})`;
      tonsLabelEl.textContent = isBales ? 'Total bales' : 'Total tons';
      actualHintEl.textContent = `Actual sums the Movement tickets carted off this field${actualTons > 0 ? ` — currently ${num(actualTons, 1)} ${unit}` : ''}.`;

      const tonsVal = yieldMode === 'actual'
        ? actualTons
        : estimateFieldTons({ areaHa: getNum(root, 'area'), yieldTHa: getNum(root, 'yield') });
      const area = getNum(root, 'area');
      const yieldTHa = area > 0 ? tonsVal / area : 0;
      preview.textContent = `${num(tonsVal, 1)} ${unit} · ${num(yieldTHa, 2)} ${unitPerHa}`;
      const applied = appliedKgHa();
      ureaAppliedTotalEl.textContent = `${num(applied, 0)} kg/ha`;
      const u = fieldUrea({ areaHa: getNum(root, 'area'), ureaRequiredKgHa: getNum(root, 'ureaReq'), ureaAppliedKgHa: applied });
      ureaPreview.textContent = tons(u.leftTons);
      soilNPreview.textContent = `${num(soilNUreaEquivalent(getNum(root, 'soilTestN')), 0)} kg/ha`;
      const selectedCommodity = commodities.find((c) => c.id === getVal(root, 'commodity'));
      const commodityDefaultYield = Number(selectedCommodity?.defaultYieldTHa) || 0;
      commodityYieldPreview.textContent = commodityDefaultYield > 0 ? `${num(commodityDefaultYield, 2)} ${unitPerHa}` : '— (set one in Settings)';
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
    root.querySelector('#commodity').addEventListener('change', () => {
      if (!existing) {
        const c = commodities.find((cc) => cc.id === getVal(root, 'commodity'));
        root.querySelector('#yield').value = c?.defaultYieldTHa || '';
      }
      recompute();
    });
    const useDefaultYieldBtn = root.querySelector('#use-default-yield');
    if (useDefaultYieldBtn) {
      useDefaultYieldBtn.addEventListener('click', () => {
        const c = commodities.find((cc) => cc.id === getVal(root, 'commodity'));
        root.querySelector('#yield').value = c?.defaultYieldTHa || '';
        recompute();
      });
    }
    root.querySelector('#ureaReq').addEventListener('input', recompute);
    root.querySelector('#toggle-urea-app-form').addEventListener('click', () => {
      const formEl = root.querySelector('#urea-app-form');
      formEl.style.display = formEl.style.display === 'none' ? 'block' : 'none';
    });
    root.querySelector('#ua-add').addEventListener('click', () => {
      const rate = getNum(root, 'ua-rate');
      if (!rate) { root.querySelector('#ua-rate').focus(); return; }
      applications.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        date: getVal(root, 'ua-date') || '',
        appliedBy: getVal(root, 'ua-by')?.trim() || '',
        machine: getVal(root, 'ua-machine')?.trim() || '',
        rateKgHa: rate,
        comment: getVal(root, 'ua-comment')?.trim() || '',
      });
      root.querySelector('#ua-date').value = '';
      root.querySelector('#ua-by').value = '';
      root.querySelector('#ua-machine').value = '';
      root.querySelector('#ua-rate').value = '';
      root.querySelector('#ua-comment').value = '';
      renderApplications();
      recompute();
      persistApplications();
    });
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
    renderApplications();
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
        ureaAppliedKgHa: existing?.ureaAppliedKgHa ?? 0,
        ureaApplications: applications,
        soilTestNKgHa: getNum(root, 'soilTestN'),
        targetYieldOverrideTHa: getNum(root, 'targetYieldOverride'),
        starterRequiredKgHa: getNum(root, 'starterReq'),
        starterAppliedKgHa: getNum(root, 'starterApp'),
        seedVariety: getVal(root, 'seedVariety')?.trim(),
        seedRateKgHa: getNum(root, 'seedRate'),
        notes: getVal(root, 'notes')?.trim(),
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
