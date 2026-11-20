import { db } from '../storage.js?v=472';
import { tileIcon } from '../tileicon.js?v=472';
import { cropCostPerHa } from '../grossmargin.js?v=472';
import { productionByCommodity, fieldTons, estimateFieldTons, movementTonsFromField, fieldUrea, ureaAppliedKgHaFor, fieldStarter, fieldSeed, soilNUreaEquivalent, fieldUreaForTarget, groupFieldsByCommodity, maxYieldFromUrea, checkNPerTonne, bigFirst, areaShare, productionSummary } from '../derived.js?v=472';
import { num, tons, ha, esc, todayLocal, shortDate } from '../fmt.js?v=472';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, notify, askConfirm, freezeSheet } from '../ui.js?v=472';
import { describeMerge } from '../merge.js?v=472';
import { renderRelatedMovements } from './movements.js?v=472';
import { canSeeYield, canChangeProduction, canSeeArea } from '../nav.js?v=472';
import { wireJumps } from '../jump.js?v=472';
import { openMapSheet } from './farmmap.js?v=472';
import { openInputsSheet } from './inputs.js?v=472';
import { openSprayFormSheet, canSpray } from './spray.js?v=472';
import { stockLevels } from '../inputs.js?v=472';
import { fieldHistory, rotationLine, repeatCrops } from '../fieldhistory.js?v=472';
import { openModulesPickedSheet } from './modulespicked.js?v=472';
import { openBalesBaledSheet } from './balesbaled.js?v=472';
import { isHay, baledTotals, cleanBaled, describeBales, secondaryTypes } from '../hay.js?v=472';
import { pickedTotals, cleanPicked, moduleEstimate, describeEstimate } from '../modulespicked.js?v=472';

let unsub = null;

export function renderProduction(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const showYield = canSeeYield(db.getRole());
  const { commodities, fields, movements } = db.get();
  // prices are money: the people who see the books see the stock
  const canSeeInputs = canSeeArea(db.getRole(), 'inputs', ['owner', 'manager', 'bookkeeper', 'farm_worker'].includes(db.getRole()));
  const inputProducts = canSeeInputs ? stockLevels(db.getInputMoves()).length : 0;
  const sprayAllowed = canSpray(db.getRole());
  const sprayOpen = sprayAllowed ? db.getSprayJobs().filter((j) => j.status !== 'done').length : 0;
  const { rows: rollup, totals: productionTotals } = productionSummary(commodities, fields, movements);   // most tonnes first
  const groups = groupFieldsByCommodity(commodities, fields, movements);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Production</h1>
        <div class="sub">Field level input, rolled up by commodity</div>
      </div>
    </div>
    <div class="view">
      <div class="prod-tools">
        ${fields.length ? `<button type="button" class="btn secondary tool-tile" id="open-map">${tileIcon('map')}<span class="tt-text"><b>Farm map</b><span>${fields.some((f) => f.boundary) ? `${fields.filter((f) => f.boundary).length} of ${fields.length} mapped` : 'add your outlines'}</span></span></button>` : ''}
        ${canSeeInputs ? `<button type="button" class="btn secondary tool-tile" id="open-inputs">${tileIcon('inputs')}<span class="tt-text"><b>Inputs and spraying</b><span>${[inputProducts ? `${inputProducts} in stock` : 'stock and spraying', sprayOpen ? `${sprayOpen} spray open` : ''].filter(Boolean).join(' · ')}</span></span></button>` : ''}
      </div>
      ${rollup.length === 0 ? '' : `
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Commodity</th><th>Area</th><th>% of area</th>${showYield ? '<th>Yield</th><th>Tons</th>' : ''}</tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr class="jump-row" data-jump="grp-${esc(r.commodity.id)}">
                  <td><button type="button" class="jump-link">${esc(r.commodity.name)}</button></td>
                  <td>${num(r.area, 0)}</td>
                  <td>${areaShare(r.area, productionTotals.area)}</td>
                  ${showYield ? `<td>${num(r.yieldTHa, 2)}</td><td>${num(r.tons, 0)}</td>` : ''}
                </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td>${num(productionTotals.area, 0)}</td>
              <td>${productionTotals.area > 0 ? '100%' : ''}</td>
              ${showYield ? `<td>${num(productionTotals.yieldTHa, 2)}</td><td>${num(productionTotals.tons, 0)}</td>` : ''}
            </tr></tfoot>
          </table>
        </div>
      </div>`}

      <div class="card input">
        <h2><span class="dot input"></span>Fields</h2>
        ${groups.length === 0 ? `<div class="empty">No fields yet.${canChangeProduction(db.getRole()) ? '<br/><button class="btn" id="empty-add-field">Add your first field</button>' : ''}</div>` : groups.map((g) => `
          <div class="group-label" id="grp-${esc(g.id ?? 'none')}"><span>${esc(g.name)}</span><span class="n">${showYield ? tons(g.totalTons, 0) : ''}</span></div>
          ${g.fields.map((f) => fieldRow(f, movements, showYield)).join('')}
        `).join('')}
      </div>
    </div>
    ${canChangeProduction(db.getRole()) ? '<button class="fab" id="add-field">+</button>' : ''}
  `;

  // The commodity rows in the table at the top jump to that commodity's fields below.
  wireJumps(root);

  root.querySelectorAll('[data-edit-field]').forEach((el) => {
    el.addEventListener('click', () => openFieldSheet(fields.find((f) => f.id === el.dataset.editField)));
  });
  root.querySelector('#add-field')?.addEventListener('click', () => openFieldSheet(null));
  root.querySelector('#open-inputs')?.addEventListener('click', () => openInputsSheet());
  root.querySelector('#open-map')?.addEventListener('click', () => openMapSheet({
    onOpenField: openFieldSheet,
    onSpray: canSpray(db.getRole()) ? (ids) => openSprayFormSheet(null, { ids }) : undefined,
  }));
  root.querySelector('#empty-add-field')?.addEventListener('click', () => openFieldSheet(null));
}

function fieldRow(f, movements, showYield = true) {
  const isActual = f.yieldMode === 'actual';
  const t = fieldTons(f, movements);
  const yieldTHa = f.areaHa > 0 ? t / f.areaHa : 0;
  const actualTons = movementTonsFromField(f.id, movements, f.commodityId);
  const actualYieldTHa = f.areaHa > 0 ? actualTons / f.areaHa : 0;
  const inFieldModules = pickedTotals(f, movements).inField;
  const inFieldBales = baledTotals(f, movements).inField + secondaryTypes(f).reduce((s, id) => s + baledTotals(f, movements, id).inField, 0);
  return `
    <div class="list-item" data-edit-field="${f.id}">
      <div>
        <div class="main">${esc(f.name)}</div>
        <div class="meta">${ha(f.areaHa, 0)}${f.harvestDone ? ' · <span class="badge pos">Harvested</span>' : (f.harvestHaLeft != null ? ` · <span class="badge neg">${ha(f.harvestHaLeft, 0)} to cut</span>` : '')}${showYield ? ` · <span class="badge ${isActual ? 'pos' : 'neg'}">${isActual ? 'Actual' : 'Estimate'}</span>` : ''}${inFieldModules > 0 ? ` · ${num(inFieldModules, 0)} module${inFieldModules === 1 ? '' : 's'} in field` : ''}${inFieldBales > 0 ? ` · ${num(inFieldBales, 0)} bale${inFieldBales === 1 ? '' : 's'} in field` : ''}</div>
        ${showYield && !isActual && actualTons > 0 ? `<div class="actual-flag">Harvest tickets: ${num(actualTons, 0)} t · ${num(actualYieldTHa, 2)} t/ha. Switch to Actual</div>` : ''}
      </div>
      ${showYield ? `<div class="right">
        <div class="main">${tons(t, 0)}</div>
        <div class="meta">${num(yieldTHa, 2)} t/ha</div>
      </div>` : ''}
    </div>
  `;
}

export function openFieldSheet(existing) {
  const showYield = canSeeYield(db.getRole());
  const { commodities, movements } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));
  const actualTons = existing ? movementTonsFromField(existing.id, movements) : 0;
  const initialCommodity = commodities.find((c) => c.id === (existing?.commodityId ?? commodities[0]?.id));
  const canSetCost = ['owner', 'manager'].includes(db.getRole());   // who can change a paddock, and sees what a crop costs

  // cotton paddocks: the modules picked, and how many are still in the field
  const isCotton = existing && initialCommodity?.unit === 'bale';
  const pk = isCotton ? pickedTotals(existing, movements) : null;
  const modulesBlock = isCotton ? `
      <div class="field">
        <label>Modules picked</label>
        <div class="row"><span class="label">Picked · moved · in the field</span><span class="value">${num(pk.picked, 0)} · ${num(pk.moved, 0)} · ${num(pk.inField, 0)}</span></div>
        ${cleanPicked(existing.modulesPicked).map((p) => `<div class="row" data-edit-picked="${esc(p.id)}" style="cursor:pointer"><span class="label">${esc(shortDate(p.date))}</span><span class="value">${num(p.count, 0)} module${p.count === 1 ? '' : 's'}${p.kg ? `, ${num(p.kg, 0)} kg` : ''}</span></div>`).join('')}
        ${pk.inField > 0 && describeEstimate(moduleEstimate(initialCommodity.cotton, pk.inFieldBales)) ? `<div class="hint">In the field: ${esc(describeEstimate(moduleEstimate(initialCommodity.cotton, pk.inFieldBales)))}</div>` : ''}
        <button class="btn secondary small" id="log-picked" style="margin-top:6px">+ Log modules picked</button>
      </div>` : '';

  // hay paddocks: the bales baled, and how many are still in the field
  const hayPaddock = existing && isHay(initialCommodity);
  const bt = hayPaddock ? baledTotals(existing, movements) : null;
  // any other paddock can have straw (or hay) baled off it, a commodity of its own on the same ground as the crop
  const hayTypes = commodities.filter((c) => isHay(c) && c.id !== existing?.commodityId);
  const strawIds = existing && !hayPaddock ? secondaryTypes(existing) : [];
  const nameOfType = (id) => commodities.find((c) => c.id === id)?.name || 'Hay';
  const baledRow = (b, withType) => `<div class="row" data-edit-baled="${esc(b.id)}" style="cursor:pointer"><span class="label">${esc(shortDate(b.date))}${withType && b.commodityId ? ` · ${esc(nameOfType(b.commodityId))}` : ''}${b.label ? ` · ${esc(b.label)}` : ''}</span><span class="value">${esc(describeBales(b.bales, b.kg))}</span></div>`;
  const balesBlock = hayPaddock ? `
      <div class="field">
        <label>Bales baled</label>
        <div class="row"><span class="label">Baled · moved · in the field</span><span class="value">${num(bt.baled, 0)} · ${num(bt.moved, 0)} · ${num(bt.inField, 0)}</span></div>
        ${cleanBaled(existing.balesBaled).map((b) => baledRow(b, false)).join('')}
        <button class="btn secondary small" id="log-baled" style="margin-top:6px">+ Log bales baled</button>
      </div>`
    : existing && (hayTypes.length || strawIds.length) ? `
      <div class="field">
        <label>Straw and hay baled off this paddock</label>
        ${strawIds.map((id) => { const t = baledTotals(existing, movements, id); return `<div class="row"><span class="label">${esc(nameOfType(id))}<small style="display:block;font-size:11.5px;color:var(--text-dim)">Baled · moved · in the field</small></span><span class="value">${num(t.baled, 0)} · ${num(t.moved, 0)} · ${num(t.inField, 0)}</span></div>`; }).join('')}
        ${cleanBaled(existing.balesBaled).filter((b) => b.commodityId && b.commodityId !== existing.commodityId).map((b) => baledRow(b, true)).join('')}
        <div class="hint">Straw is its own commodity, on the same ground as the crop. The area is not counted twice.</div>
        <button class="btn secondary small" id="log-baled" style="margin-top:6px">+ Log straw baled</button>
      </div>` : '';

  const body = openSheet(existing ? 'Edit field' : 'Add field', (root) => {
    root.innerHTML = `
      <div class="grid-2">
        ${field({ label: 'Field name', id: 'name', value: existing?.name, placeholder: 'e.g. SR1-3' })}
        ${field({ label: 'Farm', id: 'property', value: existing?.property ?? '', list: 'dl-farms', placeholder: 'e.g. Aralu' })}
      </div>
      <div class="hint" style="margin:-6px 0 10px;font-size:11.5px;color:var(--text-dim)">The farm is the property it is on. The farm map uses it to label each farm and to show or hide them.</div>
      <datalist id="dl-farms">${[...new Set(db.get().fields.map((f) => String(f.property || '').trim()).filter(Boolean))].sort().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
      <div class="grid-2 area-row">
        ${field({ label: 'Area (ha)', id: 'area', type: 'number', step: '0.01', value: existing?.areaHa })}
        <label class="pp-col dc-tick" for="doubleCrop"><input type="checkbox" id="doubleCrop" ${existing?.doubleCrop ? 'checked' : ''} /><span>Double crop<small style="display:block;font-size:11.5px;color:var(--text-dim)">sown straight after another crop</small></span></label>
      </div>
      <div class="yield-only" ${showYield ? '' : 'hidden'}>
      <div class="grid-2">
        ${field({ label: 'Yield estimate (t/ha)', id: 'yield', type: 'number', step: '0.01', value: existing ? existing.yieldTHa : (initialCommodity?.defaultYieldTHa || '') })}
        <div class="field"><label>Crop default</label><div class="readout" style="display:flex;justify-content:space-between;align-items:center;gap:6px"><span id="commodity-yield-preview">— t/ha</span>${existing ? '<button type="button" class="link-btn" id="use-default-yield" style="font-size:13px;min-height:0;padding:0 2px">Use it</button>' : ''}</div></div>
      </div>
      <div class="field">
        <label>Drive tons from</label>
        <div class="segmented" id="f-mode">
          <button data-mode="estimate" class="${(existing?.yieldMode || 'estimate') !== 'actual' ? 'active' : ''}">Estimate</button>
          <button data-mode="actual" class="${existing?.yieldMode === 'actual' ? 'active' : ''}">Actual (movements)</button>
        </div>
        <div class="actual-callout" id="actual-hint"></div>
      </div>
      <div style="display:none"><span id="tons-label">Total tons</span><span id="tons-preview">0.0 t</span><span id="actual-so-far">&ndash;</span></div>
      </div>
      <details class="fold feature">
        <summary><div class="feature-head"><h2>Harvest</h2><div class="sub">${existing?.harvestDone ? 'Finished: all of it is in' : (existing?.harvestHaLeft != null && existing.harvestHaLeft !== '' ? `Part harvested: ${num(existing.harvestHaLeft, 1)} ha left to cut` : 'Finished, or part harvested')}</div></div></summary>
      <div style="margin-top:10px">${field({ label: 'Harvest finished', id: 'harvestDone', type: 'select', value: existing?.harvestDone ? 'yes' : 'no', options: [{ value: 'no', label: 'No, still harvesting' }, { value: 'yes', label: 'Yes, all of it is in' }] })}</div>
      <div class="grid-2">
        ${field({ label: 'Hectares left', id: 'harvestHaLeft', type: 'number', step: '0.01', value: existing?.harvestHaLeft ?? '', placeholder: 'Blank: not part cut' })}
        <div class="yield-only" ${showYield ? '' : 'hidden'}>${field({ label: 'Yield for those (t/ha)', id: 'harvestLeftYield', type: 'number', step: '0.01', value: existing?.harvestLeftYield ?? '', placeholder: 'Blank: as above' })}</div>
      </div>
      <div class="hint" style="margin:-4px 0 4px;font-size:12px;color:var(--text-dim)">For a paddock part harvested: the harvest report counts these hectares at their own yield (or the yield estimate below if that is blank), on top of the tonnes already in. Leave the hectares blank to use the whole paddock's estimate less the tickets.</div>
      <div class="hint" id="cut-so-far" style="margin:0 0 10px;font-size:12px;color:var(--text-dim)"></div>
      </details>
      ${modulesBlock}${balesBlock}
      <details class="fold feature">
        <summary><div class="feature-head"><h2>Fertiliser planning</h2><div class="sub">Target yield, urea required and applied, nitrogen</div></div></summary>
      <div class="hint" style="margin:10px 14px 12px;font-size:12px;color:var(--text-dim)">Separate from the yield estimate above — used only for the urea and starter calculations below.</div>
      <div class="row"><span class="label">Commodity's default target yield</span><span class="value" id="commodity-target-preview">— t/ha</span></div>
      ${field({ label: 'Target yield override (t/ha)', id: 'targetYieldOverride', type: 'number', step: '0.1', value: existing?.targetYieldOverrideTHa || '', placeholder: 'Commodity default', hint: "Leave blank to use the commodity's default above — type a value here to override it for this field" })}
      ${field({ label: 'Soil test N (kg/ha)', id: 'soilTestN', type: 'number', step: '1', value: existing?.soilTestNKgHa ?? 0, hint: 'From your soil test report' })}
      <div class="row"><span class="label">Target yield in use</span><span class="value" id="target-yield-preview">— t/ha</span></div>
      <div class="row"><span class="label">Soil N (urea equivalent)</span><span class="value" id="soiln-preview">0 kg/ha</span></div>
      <div class="row"><span class="label">N needed for that yield</span><span class="value" id="n-demand-preview">0 kg N/ha</span></div>
      <div class="row"><span class="label"><strong>Urea required to hit target</strong></span><span class="value" id="target-urea-preview" style="font-size:18px">0 kg/ha</span></div>
      <div class="field hint" id="n-unit-warning" style="display:none;margin:6px 0 0;color:var(--danger)"></div>
      <button class="btn secondary small" id="use-target-urea" style="margin:8px 0">Use as "Urea required" below</button>
      <hr class="sep" />
      ${field({ label: 'Urea required (kg/ha)', id: 'ureaReq', type: 'number', step: '1', value: existing?.ureaRequiredKgHa ?? 0 })}
      <div class="row"><span class="label">Urea applied (kg/ha)</span><span class="value" id="urea-applied-total">0 kg/ha</span></div>
      <div class="row"><span class="label">N available (soil + applied)</span><span class="value" id="n-available-preview">0 kg N/ha</span></div>
      <div class="row"><span class="label"><strong>Max yield from N applied</strong></span><span class="value" id="max-yield-preview" style="font-size:18px">— t/ha</span></div>
      <div class="field hint" style="margin:-2px 0 12px">A ceiling set by nitrogen alone. Water, disease and everything else can take the crop below this; nothing takes it above.</div>
      <div id="urea-app-list"></div>
      <button class="btn secondary small" id="toggle-urea-app-form" style="margin-bottom:10px">+ Add application</button>
      <div id="urea-app-form" style="display:none;padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px">
        ${field({ label: 'Date', id: 'ua-date', type: 'date', value: todayLocal() })}
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
      </details>
      <details class="fold feature">
        <summary><div class="feature-head"><h2>Starter &amp; seed</h2><div class="sub">Starter fertiliser, seed variety and rate</div></div></summary>
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
      </details>
      ${canSetCost ? `<details class="fold feature" ${existing?.gmCostHa != null && existing.gmCostHa !== '' ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Gross margin cost</h2><div class="sub">Cost per hectare for this paddock</div></div></summary>
      <div class="gm-cost-field" style="margin-top:10px">${field({ label: 'Gross margin cost ($/ha)', id: 'gmCostHa', type: 'number', step: '1', value: existing?.gmCostHa ?? '', placeholder: String(Math.round(cropCostPerHa(initialCommodity, db.get().fields))), hint: 'Blank uses the crop\'s cost from Settings, shown faintly. Type a figure to use your own for this paddock (Gross margin report).' })}</div>
      </details>` : ''}
      <div style="height:12px"></div>
      ${field({ label: 'Notes', id: 'notes', type: 'textarea', value: existing?.notes })}
      ${existing ? historyHtml(existing, showYield) : ''}
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      ${existing && ['owner', 'manager'].includes(db.getRole()) && db.get().fields.length > 1 ? `<button class="btn secondary" id="merge-field" style="margin-top:12px">Merge another paddock into this one&hellip;</button>` : ''}
      ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:8px">Delete field</button>` : ''}
      <div class="save-bar"><div class="total" ${showYield ? '' : 'hidden'}><div class="l">Total tons</div><div class="v" id="tons-bar">—</div></div><button class="btn" id="save">Save</button></div>
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'field', existing.id, { collapsed: true });

    let yieldMode = existing?.yieldMode || 'estimate';
    let applications = (existing?.ureaApplications || []).slice();
    const yieldLabelEl = root.querySelector('label[for="yield"]');
    const tonsLabelEl = root.querySelector('#tons-label');
    const actualHintEl = root.querySelector('#actual-hint');
    const preview = root.querySelector('#tons-preview');
    const actualSoFarEl = root.querySelector('#actual-so-far');
    const ureaPreview = root.querySelector('#urea-preview');
    const ureaAppliedTotalEl = root.querySelector('#urea-applied-total');
    const appListEl = root.querySelector('#urea-app-list');
    const soilNPreview = root.querySelector('#soiln-preview');
    const commodityYieldPreview = root.querySelector('#commodity-yield-preview');
    const commodityTargetPreview = root.querySelector('#commodity-target-preview');
    const targetYieldPreview = root.querySelector('#target-yield-preview');
    const targetUreaPreview = root.querySelector('#target-urea-preview');
    const nDemandPreview = root.querySelector('#n-demand-preview');
    const nAvailablePreview = root.querySelector('#n-available-preview');
    const maxYieldPreview = root.querySelector('#max-yield-preview');
    const nUnitWarning = root.querySelector('#n-unit-warning');
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
              <div class="main">${esc(shortDate(a.date) || 'No date')}${a.appliedBy ? ' &middot; ' + esc(a.appliedBy) : ''}</div>
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
      {
        const a = getNum(root, 'area');
        const actualRate = a > 0 ? actualTons / a : 0;
        const found = actualTons > 0 ? `${num(actualTons, 0)} ${unit} (${num(actualRate, 2)} ${unitPerHa})` : '';
        if (actualSoFarEl) actualSoFarEl.textContent = actualTons > 0 && a > 0 ? `${num(actualRate, 2)} ${unitPerHa}` : '–';
        if (yieldMode === 'actual') {
          actualHintEl.className = 'actual-callout using';
          actualHintEl.innerHTML = `<strong>Using the Movement tickets.</strong> ${found ? `${found} off this field so far.` : 'None recorded yet.'}`;
        } else if (actualTons > 0) {
          actualHintEl.className = 'actual-callout switch';
          actualHintEl.innerHTML = `<strong>Harvest tickets are in: ${found}.</strong> After harvest, switch to <em>Actual (movements)</em> so reports use the real yield.`;
        } else {
          actualHintEl.className = 'actual-callout';
          actualHintEl.innerHTML = `After harvest, switch to <strong>Actual (movements)</strong> to use the tickets carted off this field. None recorded yet.`;
        }
      }

      const tonsVal = yieldMode === 'actual'
        ? actualTons
        : estimateFieldTons({ areaHa: getNum(root, 'area'), yieldTHa: getNum(root, 'yield') });
      const area = getNum(root, 'area');
      const yieldTHa = area > 0 ? tonsVal / area : 0;
      preview.textContent = `${num(tonsVal, 1)} ${unit}`;
      const barEl = root.querySelector('#tons-bar');
      if (barEl) barEl.textContent = `${num(tonsVal, 1)} ${unit}`;
      const applied = appliedKgHa();
      ureaAppliedTotalEl.textContent = `${num(applied, 0)} kg/ha`;
      const u = fieldUrea({ areaHa: getNum(root, 'area'), ureaRequiredKgHa: getNum(root, 'ureaReq'), ureaAppliedKgHa: applied });
      ureaPreview.textContent = tons(u.leftTons);
      soilNPreview.textContent = `${num(soilNUreaEquivalent(getNum(root, 'soilTestN')), 0)} kg/ha`;
      const selectedCommodity = commodities.find((c) => c.id === getVal(root, 'commodity'));
      const commodityDefaultYield = Number(selectedCommodity?.defaultYieldTHa) || 0;
      commodityYieldPreview.textContent = commodityDefaultYield > 0 ? `${num(commodityDefaultYield, 2)} ${unitPerHa}` : '— not set';
      const commodityDefault =Number(selectedCommodity?.targetYieldTHa) || 0;
      commodityTargetPreview.textContent = commodityDefault > 0 ? `${num(commodityDefault, 2)} t/ha` : '— (set one in Settings)';
      const targetCalc = currentTargetCalc();
      targetYieldPreview.textContent = targetCalc.targetYieldTHa > 0 ? `${num(targetCalc.targetYieldTHa, 2)} t/ha` : '— (set a target yield)';
      targetUreaPreview.textContent = `${num(targetCalc.requiredKgHa, 0)} kg/ha`;

      // Show the nitrogen demand as well as the urea, because the two differ
      // by a factor of 2.17 and the difference is exactly where a urea figure
      // entered in the nitrogen field hides.
      const nPerTonne = Number(selectedCommodity?.nPerTonne) || 0;
      nDemandPreview.textContent = `${num(nPerTonne * targetCalc.targetYieldTHa, 0)} kg N/ha`;

      const unitCheck = checkNPerTonne(nPerTonne);
      nUnitWarning.style.display = unitCheck.suspect ? '' : 'none';
      nUnitWarning.textContent = unitCheck.suspect
        ? `${esc(selectedCommodity?.name || 'This commodity')} is set to ${num(nPerTonne, 2)} kg N per tonne, which is far above anything a crop removes — it looks like a urea figure entered where nitrogen belongs. As nitrogen it would be about ${num(unitCheck.asNitrogen, 0)}. Every requirement here is roughly 2.2x too high until it is corrected in Settings.`
        : '';

      const maxYield = maxYieldFromUrea({
        nPerTonne,
        soilTestN: getNum(root, 'soilTestN'),
        ureaAppliedKgHa: applied,
      });
      nAvailablePreview.textContent = `${num(maxYield.nAvailableKgHa, 0)} kg N/ha`;
      maxYieldPreview.textContent = nPerTonne > 0
        ? `${num(maxYield.maxYieldTHa, 2)} t/ha`
        : '— (set N required on the commodity)';
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
    /**
     * Take whatever is typed in the application form and put it on the list.
     * Returns false when there is nothing there — no rate means nothing to log.
     *
     * Extracted so that Save calls it too. Typing a rate and pressing Save is
     * not a mistake, it is the obvious thing to do: the fields are on the
     * screen, filled in, above a button marked Save. Requiring "Add
     * application" first and silently discarding the entry otherwise made the
     * app quietly lose work somebody had just typed, twice.
     */
    const commitPendingApplication = () => {
      const rate = getNum(root, 'ua-rate');
      if (!rate) return false;
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
      return true;
    };

    root.querySelector('#ua-add').addEventListener('click', () => {
      // The button still does what it says, and is still the way to log two
      // applications without closing the sheet in between.
      if (!commitPendingApplication()) { root.querySelector('#ua-rate').focus(); return; }
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

    // what the part already cut is yielding, from the tickets, to go by when giving the hectares left a yield
    const paintCutSoFar = () => {
      const el = root.querySelector('#cut-so-far');
      if (!el) return;
      const area = getNum(root, 'area');
      const raw = String(getVal(root, 'harvestHaLeft') ?? '').trim();
      const cutHa = raw === '' ? 0 : area - Math.min(area, Math.max(0, getNum(root, 'harvestHaLeft')));
      el.textContent = raw !== '' && cutHa > 0 && actualTons > 0
        ? `Cut so far: ${num(actualTons / cutHa, 2)} t/ha (${num(actualTons, 0)} t off ${num(cutHa, 1)} ha)`
        : '';
    };
    root.querySelector('#harvestHaLeft')?.addEventListener('input', paintCutSoFar);
    root.querySelector('#area')?.addEventListener('input', paintCutSoFar);
    paintCutSoFar();

    // the faint figure in the cost box follows the crop chosen
    const showCropCost = () => {
      const box = root.querySelector('#gmCostHa'); if (!box) return;
      const c = commodities.find((x) => x.id === getVal(root, 'commodity'));
      const own = existing && existing.commodityId === c?.id ? 0 : getNum(root, 'area');   // a paddock not yet counted in this crop's area
      box.placeholder = String(Math.round(cropCostPerHa(c, db.get().fields, own)));
    };
    root.querySelector('#commodity')?.addEventListener('change', showCropCost);
    root.querySelector('#area')?.addEventListener('input', showCropCost);
    showCropCost();

    root.querySelector('#save').addEventListener('click', () => {
      const name = getVal(root, 'name')?.trim();
      if (!name) { root.querySelector('#name').focus(); return; }
      // Anything still sitting in the application form is part of what they
      // are saving. Must happen before the payload below is built, because
      // that reads `applications` as it stands.
      commitPendingApplication();
      db.upsertField({
        id: existing?.id,
        name,
        property: String(getVal(root, 'property') ?? '').trim(),
        areaHa: getNum(root, 'area'),
        commodityId: getVal(root, 'commodity'),
        doubleCrop: !!root.querySelector('#doubleCrop')?.checked,
        harvestDone: getVal(root, 'harvestDone') === 'yes',
        harvestHaLeft: String(getVal(root, 'harvestHaLeft') ?? '').trim() === '' ? null : getNum(root, 'harvestHaLeft'),
        harvestLeftYield: String(getVal(root, 'harvestLeftYield') ?? '').trim() === '' ? null : getNum(root, 'harvestLeftYield'),
        ...(canSetCost ? { gmCostHa: String(getVal(root, 'gmCostHa') ?? '').trim() === '' ? null : Math.max(0, getNum(root, 'gmCostHa')) } : {}),
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
      closeSheet(); toast('Saved');
    });
    root.querySelector('#log-baled')?.addEventListener('click', () => { closeSheet(); openBalesBaledSheet(existing.id); });
    root.querySelectorAll('[data-edit-baled]').forEach((el) => el.addEventListener('click', () => {
      const b = cleanBaled(existing.balesBaled).find((x) => x.id === el.dataset.editBaled);
      closeSheet(); openBalesBaledSheet(existing.id, b);
    }));
    root.querySelector('#log-picked')?.addEventListener('click', () => { closeSheet(); openModulesPickedSheet(existing.id); });
    root.querySelectorAll('[data-edit-picked]').forEach((el) => el.addEventListener('click', () => {
      const p = cleanPicked(existing.modulesPicked).find((x) => x.id === el.dataset.editPicked);
      closeSheet(); openModulesPickedSheet(existing.id, p);
    }));
    root.querySelector('#merge-field')?.addEventListener('click', () => { closeSheet(); openMergeSheet(existing); });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete(`Delete field "${existing.name}"?`, () => {
          db.deleteField(existing.id);
          closeSheet();
        });
      });
    }
    // a bookkeeper (or an advisor) looks at a paddock and changes nothing
    if (!canChangeProduction(db.getRole())) freezeSheet(root);
  });
  return body;
}

/**
 * Combine another paddock into this one — W3 and W4 into W3/4, say. Says what
 * will happen before it does it: the area that results, how many loads move
 * across, and which of the other paddock's rates will be lost.
 */
function openMergeSheet(keep) {
  const { fields, movements } = db.get();
  const others = fields.filter((f) => f.id !== keep.id)
    .sort((a, b) => (b.commodityId === keep.commodityId) - (a.commodityId === keep.commodityId) || String(a.name).localeCompare(String(b.name)));
  openSheet(`Merge into ${keep.name}`, (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Use this when two paddocks are really one — the weighbridge
        calls them W3/4 and the app has W3 and W4. The paddock you pick is merged into <strong>${esc(keep.name)}</strong>
        and then deleted.</div>
      ${field({ label: 'Paddock to merge in', id: 'mg-other', type: 'select', value: '', options: [{ value: '', label: 'Choose…' }, ...others.map((f) => ({ value: f.id, label: `${f.name} (${num(f.areaHa, 1)} ha)` }))] })}
      ${field({ label: 'Name for the combined paddock', id: 'mg-name', value: keep.name })}
      <div id="mg-preview"></div>
      <div class="save-bar solo"><button class="btn" id="mg-go" disabled>Merge</button></div>`;
    const preview = root.querySelector('#mg-preview');
    const go = root.querySelector('#mg-go');
    const pick = () => {
      const drop = fields.find((f) => f.id === getVal(root, 'mg-other'));
      if (!drop) { preview.innerHTML = ''; go.disabled = true; return null; }
      const d = describeMerge(keep, drop, movements, getVal(root, 'mg-name'));
      preview.innerHTML = `<div class="card">
        <div class="row"><span class="label">Combined area</span><span class="value">${num(d.areaHa, 1)} ha</span></div>
        <div class="row"><span class="label">Loads moved across from ${esc(d.droppedName)}</span><span class="value">${d.loadsMoved}</span></div>
        <div class="row"><span class="label">Paddock deleted</span><span class="value">${esc(d.droppedName)}</span></div>
        ${d.losing.length ? `<div class="field hint" style="margin-top:6px;color:var(--danger)">${esc(d.droppedName)}'s ${d.losing.map(esc).join(', ')} will not carry across; ${esc(keep.name)}'s are kept.</div>` : ''}
      </div>`;
      go.disabled = false;
      return { drop, d };
    };
    root.querySelector('#mg-other').addEventListener('change', pick);
    root.querySelector('#mg-name').addEventListener('input', pick);
    go.addEventListener('click', async () => {
      const chosen = pick();
      if (!chosen) return;
      const ok = await askConfirm(
        `Merge ${chosen.drop.name} into ${keep.name}, as "${chosen.d.name}" (${num(chosen.d.areaHa, 1)} ha)? ${chosen.d.loadsMoved} load${chosen.d.loadsMoved === 1 ? '' : 's'} will move across and ${chosen.drop.name} will be deleted.`,
        { confirmLabel: 'Merge', danger: true });
      if (!ok) return;
      const r = db.mergeFields(keep.id, chosen.drop.id, getVal(root, 'mg-name'));
      closeSheet();
      if (r) toast(`Merged — ${r.loadsMoved} load${r.loadsMoved === 1 ? '' : 's'} moved`);
      else notify('Those paddocks could not be merged.');
    });
  });
}

/** This paddock across the seasons it is in: crop, area, tonnes and yield, and the rotation in a line. */
function historyHtml(existing, showYield) {
  const years = Object.fromEntries(db.getYears().map((y) => [y, db.getYearData(y)]));
  const rows = fieldHistory(existing.name, years);
  if (rows.length < 2) return '';
  const again = repeatCrops(rows);
  return `
    <details class="fold" style="margin:12px 0">
      <summary><div><h2>History</h2><div class="sub">${esc(rotationLine(rows))}</div></div></summary>
      <div class="table-scroll"><table>
        <thead><tr><th style="text-align:left">Season</th><th style="text-align:left">Crop</th><th>Ha</th>${showYield ? '<th>t/ha</th><th>Tons</th>' : ''}</tr></thead>
        <tbody>${rows.map((r) => `<tr><td style="text-align:left">${esc(r.year)}</td><td style="text-align:left">${esc(r.crop || '–')}</td><td>${num(r.areaHa, 0)}</td>${showYield ? `<td>${num(r.yieldTHa, 2)}</td><td>${num(r.tons, 0)}${r.actual ? '' : ' <span class="meta">est</span>'}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div>
      ${again.length ? `<div class="hint" style="margin-top:6px">${esc(rows.find((r) => r.year === again[0][1]).crop)} two seasons running: ${again.map(([a, b]) => `${esc(a)} and ${esc(b)}`).join('; ')}.</div>` : ''}
    </details>`;
}
