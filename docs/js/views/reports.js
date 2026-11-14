import { db } from '../storage.js?v=239';
import { groupFieldsByCommodity, fieldUrea, ureaAppliedKgHaFor, fieldStarter, soilNUreaEquivalent, fieldUreaForTarget, nitrogenCalc, fieldSeed, fieldTons, SEED_BUFFER_PCT, maxYieldFromUrea } from '../derived.js?v=239';
import { num, tons, esc } from '../fmt.js?v=239';
import { field, getVal, getNum } from '../ui.js?v=239';
import { canSeeYield } from '../nav.js?v=239';
import { sensitivityCard, bindSensitivity } from './sensitivity.js?v=239';
import { harvestReport, siloSpace, pctText } from '../harvest.js?v=239';

let unsub = null;
let view = 'yield';   // Yield first; anyone who cannot see yields is moved to Fert below

export function renderReports(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const showYield = canSeeYield(db.getRole());
  if ((view === 'yield' || view === 'harvest') && !showYield) view = 'fert';
  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Reports</h1>
        <div class="sub">Fertiliser &amp; seed requirements, by commodity &amp; field</div>
      </div>
    </div>
    <div class="view">
      <div class="segmented" id="reports-view">
        ${showYield ? `<button data-view="yield" class="${view === 'yield' ? 'active' : ''}">Yield</button>` : ''}
        ${showYield ? `<button data-view="harvest" class="${view === 'harvest' ? 'active' : ''}">Harvest</button>` : ''}
        <button data-view="fert" class="${view === 'fert' ? 'active' : ''}">Fert</button>
        <button data-view="seed" class="${view === 'seed' ? 'active' : ''}">Seed</button>
      </div>
      <div id="reports-body" style="margin-top:12px"></div>
    </div>
  `;

  root.querySelector('#reports-view').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    paint(root);
  });

  if (view === 'seed') {
    paintSeed(root);
  } else if (view === 'yield') {
    paintYield(root);
  } else if (view === 'harvest') {
    paintHarvest(root);
  } else {
    paintFert(root);
  }
}

function paintFert(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');

  // The two tools sit at the top, as the Yield tab's sensitivity does, so they are not lost beneath the tables.
  body.innerHTML = `
    <details class="fold feature" style="margin-top:0">
      <summary><div class="feature-head"><h2>Nitrogen calculator</h2><div class="sub">Urea needed to reach a target yield</div></div></summary>
      <div id="n-calc-form"></div>
      <div id="n-calc-result"></div>
    </details>
    ${groups.length === 0 ? '' : `
    <div class="card report bare">
      <details class="fold feature" id="fert-sens" style="margin-top:0" ${fertSens.open ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Fert sensitivity</h2><div class="sub">Urea needed if the target yield moves</div></div></summary>
        <div class="hint" style="margin:0 0 10px;font-size:12px;color:var(--text-dim)">See how the urea requirement across a commodity's fields changes as its target yield moves. Fields with their own target yield scale from that, not the commodity default. Doesn't change any saved data.</div>
        <div id="fert-sens-form"></div>
        <div id="fert-sens-table"></div>
      </details>
    </div>`}
    <div class="card report">
      <h2><span class="dot report"></span>Urea</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields with urea rates in the Production tab.</div>` : groups.map((g) => ureaTable(g, commodities.find((c) => c.id === g.id))).join('')}
    </div>
    <div class="card report">
      <h2><span class="dot report"></span>Starter fertiliser</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields with starter rates in the Production tab.</div>` : groups.map((g) => starterTable(g)).join('')}
    </div>
  `;
  buildNitrogenCalc(body, commodities);
  if (groups.length > 0) buildFertSensitivity(body, groups.filter((g) => g.id), commodities, fields);
}

// What the panel was last set to, so it survives the page repainting when data changes.
const fertSens = { open: false, commodityId: '', pct: 0 };

/**
 * A what-if for one commodity: flexes its target yield (or, per field, that field's own
 * override) by an adjustment % and recomputes the urea required across every field using it.
 * Reads the commodity's saved target yield and N per tonne from Settings.
 */
function buildFertSensitivity(root, groups, commodities, fields) {
  const formEl = root.querySelector('#fert-sens-form');
  const tableEl = root.querySelector('#fert-sens-table');
  const detailsEl = root.querySelector('#fert-sens');
  if (!formEl || !detailsEl) return;
  detailsEl.addEventListener('toggle', () => { fertSens.open = detailsEl.open; });

  const options = groups.map((g) => ({ value: g.id, label: g.name }));
  if (!options.length) { formEl.innerHTML = '<div class="empty">No fields use a commodity yet.</div>'; return; }
  if (!options.some((o) => o.value === fertSens.commodityId)) fertSens.commodityId = options[0].value;

  formEl.innerHTML = `
    ${field({ label: 'Commodity', id: 'fs-commodity', type: 'select', value: fertSens.commodityId, options })}
    ${field({ label: 'Sensitivity adjustment (%)', id: 'fs-pct', type: 'number', step: '5', value: fertSens.pct, allowNegative: true, hint: "Applied on top of the target yield (or each field's own override)" })}
  `;

  const recompute = () => {
    fertSens.commodityId = getVal(formEl, 'fs-commodity');
    fertSens.pct = getNum(formEl, 'fs-pct');
    const commodity = commodities.find((c) => c.id === fertSens.commodityId);
    const commodityFields = fields.filter((f) => f.commodityId === fertSens.commodityId);
    if (!commodity || commodityFields.length === 0) {
      tableEl.innerHTML = `<div class="empty">No fields use this commodity yet.</div>`;
      return;
    }
    const factor = 1 + fertSens.pct / 100;
    const live = { targetYieldTHa: commodity.targetYieldTHa, nPerTonne: commodity.nPerTonne };

    const rows = commodityFields.map((f) => {
      const base = fieldUreaForTarget(f, live);
      const scenarioYieldTHa = base.targetYieldTHa * factor;
      const { additionalUreaRequired } = nitrogenCalc({ nPerTonne: live.nPerTonne, targetYieldTHa: scenarioYieldTHa, soilTestN: f.soilTestNKgHa });
      const area = Number(f.areaHa) || 0;
      const appliedKgHa = ureaAppliedKgHaFor(f);
      // What the paddock will have once the plan is done: the soil's nitrogen plus all the urea planned (its
      // urea required), and the yield that much nitrogen can carry. The adjustment scales the plan, so +10%
      // is 10% more urea than planned. Urea already on cannot be taken off, so the plan is never counted as
      // less than what is applied. A paddock with nothing in the ground yet still gets a figure.
      const plannedTotalKgHa = Math.max(appliedKgHa, (Number(f.ureaRequiredKgHa) || 0) * Math.max(0, factor));
      const max = maxYieldFromUrea({ nPerTonne: live.nPerTonne, soilTestN: f.soilTestNKgHa, ureaAppliedKgHa: plannedTotalKgHa });
      const reqT = (area * additionalUreaRequired) / 1000;
      return {
        f, area, scenarioYieldTHa, kgHa: additionalUreaRequired, reqT, currentReqT: fieldUrea(f).requiredTons,
        maxYield: max.maxYieldTHa,
        // applied to date, and what the scenario still needs on top of it: rates first, tonnes as the one total
        appliedKgHa,
        leftKgHa: additionalUreaRequired - appliedKgHa,
        leftT: (area * (additionalUreaRequired - appliedKgHa)) / 1000,
      };
    });
    const signed = (n) => `${n >= 0 ? '+' : ''}${num(n, 2)}`;
    const signed0 = (n) => `${n >= 0 ? '+' : ''}${num(n, 0)}`;
    const totalArea = rows.reduce((s, r) => s + r.area, 0);
    // area-weighted, as in the urea report: a big paddock counts for more than a small corner
    const wtd = (key) => (totalArea > 0 ? rows.reduce((s, r) => s + r[key] * r.area, 0) / totalArea : 0);
    const totalReqT = rows.reduce((s, r) => s + r.reqT, 0);
    const totalLeftT = rows.reduce((s, r) => s + r.leftT, 0);
    const totalCurrentT = rows.reduce((s, r) => s + r.currentReqT, 0);
    const delta = totalReqT - totalCurrentT;
    const hasN = Number(live.nPerTonne) > 0;   // without N per tonne there is no yield the nitrogen can carry
    const missing = !hasN || !(Number(live.targetYieldTHa) > 0);

    tableEl.innerHTML = `
      <div class="row"><span class="label">${esc(commodity.name)} in Settings</span><span class="value">${num(live.targetYieldTHa, 1)} t/ha target &middot; ${num(live.nPerTonne, 0)} kg N/t</span></div>
      ${missing ? `<div class="field hint" style="margin:6px 0">Set this commodity's target yield and N required in Settings to get a sensible result.</div>` : ''}
      <div class="hint" style="margin:8px 0 4px;font-size:12px;color:var(--text-dim)">Need, Applied and Left are urea in kg/ha (Left t in tonnes). Diff is the change in tonnes against what is recorded as required. <strong>Calc max</strong> assumes all planned urea is applied, scaled by the adjustment, and shows red when it is below Target.</div>
      <div class="table-scroll tight-wrap">
        <table class="tight wrap-first">
          <thead><tr><th>Field</th><th>Target</th><th>Calc max</th><th>Need</th><th>Applied</th><th>Left</th><th>Left t</th><th>Diff</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.f.name)}</td>
                <td>${num(r.scenarioYieldTHa, 2)}</td>
                <td ${hasN && r.maxYield < r.scenarioYieldTHa ? 'style="color:var(--danger);font-weight:700"' : ''}>${hasN ? num(r.maxYield, 2) : '—'}</td>
                <td>${num(r.kgHa, 0)}</td>
                <td>${num(r.appliedKgHa, 0)}</td>
                <td>${signed0(r.leftKgHa)}</td>
                <td>${signed(r.leftT)}</td>
                <td>${signed(r.reqT - r.currentReqT)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td>
            <td>${num(wtd('scenarioYieldTHa'), 2)}</td>
            <td>${hasN ? num(wtd('maxYield'), 2) : '—'}</td>
            <td>${num(wtd('kgHa'), 0)}</td>
            <td>${num(wtd('appliedKgHa'), 0)}</td>
            <td>${signed0(wtd('leftKgHa'))}</td>
            <td>${signed(totalLeftT)}</td>
            <td>${signed(delta)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="row" style="margin-top:6px"><span class="label">Vs currently recorded "required"</span><span class="value">${num(totalCurrentT, 2)} t &nbsp; <span class="badge ${delta >= 0 ? 'neg' : 'pos'}">${delta >= 0 ? '+' : ''}${num(delta, 2)} t</span></span></div>
    `;
  };

  formEl.querySelector('#fs-commodity').addEventListener('change', recompute);
  formEl.querySelector('#fs-pct').addEventListener('input', recompute);
  recompute();
}

function commodityOptionsCalc(commodities) {
  return [{ value: '', label: 'None / manual' }, ...commodities.map((c) => ({ value: c.id, label: c.name }))];
}

function buildNitrogenCalc(root, commodities) {
  const formEl = root.querySelector('#n-calc-form');
  const resultEl = root.querySelector('#n-calc-result');

  formEl.innerHTML = `
    ${field({ label: 'Crop (autofills N required)', id: 'n-commodity', type: 'select', options: commodityOptionsCalc(commodities) })}
    <div class="grid-2">
      ${field({ label: 'Target yield (t/ha)', id: 'n-yield', type: 'number', step: '0.1' })}
      ${field({ label: 'Soil test N (kg/ha)', id: 'n-soil', type: 'number', step: '1' })}
    </div>
    ${field({ label: 'N required (kg/t)', id: 'n-per-tonne', type: 'number', step: '1', hint: 'From the crop, or enter your own' })}
  `;
  formEl.querySelector('#n-commodity').addEventListener('change', () => {
    const c = commodities.find((c) => c.id === getVal(formEl, 'n-commodity'));
    if (c) formEl.querySelector('#n-per-tonne').value = c.nPerTonne ?? '';
    recompute();
  });
  formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

  function recompute() {
    const r = nitrogenCalc({
      nPerTonne: getNum(formEl, 'n-per-tonne'),
      targetYieldTHa: getNum(formEl, 'n-yield'),
      soilTestN: getNum(formEl, 'n-soil'),
    });
    resultEl.innerHTML = `
      <hr class="sep" />
      <div class="row"><span class="label">Soil N (urea equivalent)</span><span class="value">${num(r.soilUreaEquivalent, 0)} kg/ha</span></div>
      <div class="row"><span class="label">Urea required for target yield</span><span class="value">${num(r.ureaForTargetYield, 0)} kg/ha</span></div>
      <div class="row"><span class="label"><strong>Additional urea required</strong></span><span class="value" style="font-size:22px">${num(r.additionalUreaRequired, 0)} kg/ha</span></div>
    `;
  }
  recompute();
}

function ureaTable(g, commodity) {
  const rows = g.fields.map((f) => ({
    f,
    u: fieldUrea(f),
    soilEquivKgHa: soilNUreaEquivalent(f.soilTestNKgHa),
    target: fieldUreaForTarget(f, commodity),
    // What the nitrogen actually on the paddock will carry, as against what
    // the plan called for. The gap between Target t/ha and Max t/ha is the
    // column worth reading in a dry year.
    max: maxYieldFromUrea({
      nPerTonne: commodity?.nPerTonne,
      soilTestN: f.soilTestNKgHa,
      ureaAppliedKgHa: ureaAppliedKgHaFor(f),
    }),
  }));
  const totals = rows.reduce((acc, { f, u }) => ({
    area: acc.area + (Number(f.areaHa) || 0),
    reqT: acc.reqT + u.requiredTons,
    appT: acc.appT + u.appliedTons,
    leftT: acc.leftT + u.leftTons,
  }), { area: 0, reqT: 0, appT: 0, leftT: 0 });
  const reqKgHa = totals.area > 0 ? (totals.reqT * 1000) / totals.area : 0;
  const appKgHa = totals.area > 0 ? (totals.appT * 1000) / totals.area : 0;
  const leftKgHa = totals.area > 0 ? (totals.leftT * 1000) / totals.area : 0;
  const avgSoilTestN = rows.length > 0 ? rows.reduce((s, { f }) => s + (Number(f.soilTestNKgHa) || 0), 0) / rows.length : 0;
  const avgSoilEquiv = rows.length > 0 ? rows.reduce((s, { soilEquivKgHa }) => s + soilEquivKgHa, 0) / rows.length : 0;
  const avgTargetYield = rows.length > 0 ? rows.reduce((s, { target }) => s + target.targetYieldTHa, 0) / rows.length : 0;
  // Area-weighted, not a plain mean: a 320 ha paddock and a 12 ha corner do
  // not carry the same weight in what the block as a whole can yield.
  const totalNAvail = rows.reduce((s, { f, max }) => s + max.nAvailableKgHa * (Number(f.areaHa) || 0), 0);
  const wtdNAvail = totals.area > 0 ? totalNAvail / totals.area : 0;
  const totalMaxYield = rows.reduce((s, { f, max }) => s + max.maxYieldTHa * (Number(f.areaHa) || 0), 0);
  const wtdMaxYield = totals.area > 0 ? totalMaxYield / totals.area : 0;

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Soil N kg/ha</th><th>Soil equiv kg/ha</th><th>Target t/ha</th><th>Req kg/ha</th><th>App kg/ha</th><th>Left kg/ha</th><th>Req t</th><th>App t</th><th>Left t</th><th>N avail kg/ha</th><th>Max t/ha</th></tr></thead>
        <tbody>
          ${rows.map(({ f, u, soilEquivKgHa, target, max }) => {
            const leftKgHaField = f.areaHa > 0 ? (u.leftTons * 1000) / f.areaHa : 0;
            return `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td>${num(f.soilTestNKgHa || 0, 0)}</td>
              <td>${num(soilEquivKgHa, 0)}</td>
              <td>${target.targetYieldTHa > 0 ? num(target.targetYieldTHa, 2) : '—'}</td>
              <td>${num(f.ureaRequiredKgHa || 0, 0)}</td>
              <td>${num(ureaAppliedKgHaFor(f), 0)}</td>
              <td>${num(leftKgHaField, 0)}</td>
              <td>${num(u.requiredTons, 2)}</td>
              <td>${num(u.appliedTons, 2)}</td>
              <td>${num(u.leftTons, 2)}</td>
              <td>${num(max.nAvailableKgHa, 0)}</td>
              <td>${max.maxYieldTHa > 0 ? num(max.maxYieldTHa, 2) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(totals.area, 1)}</td>
          <td>${num(avgSoilTestN, 0)}</td>
          <td>${num(avgSoilEquiv, 0)}</td>
          <td>${avgTargetYield > 0 ? num(avgTargetYield, 2) : '—'}</td>
          <td>${num(reqKgHa, 0)}</td>
          <td>${num(appKgHa, 0)}</td>
          <td>${num(leftKgHa, 0)}</td>
          <td>${num(totals.reqT, 2)}</td>
          <td>${num(totals.appT, 2)}</td>
          <td>${num(totals.leftT, 2)}</td>
          <td>${num(wtdNAvail, 0)}</td>
          <td>${wtdMaxYield > 0 ? num(wtdMaxYield, 2) : '—'}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

function starterTable(g) {
  const rows = g.fields.map((f) => ({ f, s: fieldStarter(f) }));
  const totals = rows.reduce((acc, { f, s }) => ({
    area: acc.area + (Number(f.areaHa) || 0),
    reqT: acc.reqT + s.requiredTons,
    appT: acc.appT + s.appliedTons,
    leftT: acc.leftT + s.leftTons,
  }), { area: 0, reqT: 0, appT: 0, leftT: 0 });
  const reqKgHa = totals.area > 0 ? (totals.reqT * 1000) / totals.area : 0;
  const appKgHa = totals.area > 0 ? (totals.appT * 1000) / totals.area : 0;
  const leftKgHa = totals.area > 0 ? (totals.leftT * 1000) / totals.area : 0;

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Req kg/ha</th><th>App kg/ha</th><th>Left kg/ha</th><th>Req t</th><th>App t</th><th>Left t</th></tr></thead>
        <tbody>
          ${rows.map(({ f, s }) => {
            const leftKgHaField = f.areaHa > 0 ? (s.leftTons * 1000) / f.areaHa : 0;
            return `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td>${num(f.starterRequiredKgHa || 0, 0)}</td>
              <td>${num(f.starterAppliedKgHa || 0, 0)}</td>
              <td>${num(leftKgHaField, 0)}</td>
              <td>${num(s.requiredTons, 2)}</td>
              <td>${num(s.appliedTons, 2)}</td>
              <td>${num(s.leftTons, 2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(totals.area, 1)}</td>
          <td>${num(reqKgHa, 0)}</td>
          <td>${num(appKgHa, 0)}</td>
          <td>${num(leftKgHa, 0)}</td>
          <td>${num(totals.reqT, 2)}</td>
          <td>${num(totals.appT, 2)}</td>
          <td>${num(totals.leftT, 2)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

function paintSeed(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');

  body.innerHTML = `
    <div class="card report">
      <h2><span class="dot report"></span>Seed</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields with a seed rate in the Production tab.</div>` : groups.map((g) => seedTable(g)).join('')}
    </div>
  `;
}

function seedTable(g) {
  const rows = g.fields.map((f) => ({ f, s: fieldSeed(f) }));
  const totals = rows.reduce((acc, { f, s }) => ({
    area: acc.area + (Number(f.areaHa) || 0),
    requiredT: acc.requiredT + s.requiredTons,
    bufferedT: acc.bufferedT + s.bufferedTons,
  }), { area: 0, requiredT: 0, bufferedT: 0 });
  const rateKgHa = totals.area > 0 ? (totals.requiredT * 1000) / totals.area : 0;

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Variety</th><th>Area</th><th>Rate kg/ha</th><th>Required t</th><th>+${num(SEED_BUFFER_PCT, 0)}% t</th></tr></thead>
        <tbody>
          ${rows.map(({ f, s }) => `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${esc(f.seedVariety || '—')}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td>${num(f.seedRateKgHa || 0, 0)}</td>
              <td>${num(s.requiredTons, 2)}</td>
              <td>${num(s.bufferedTons, 2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td></td>
          <td>${num(totals.area, 1)}</td>
          <td>${num(rateKgHa, 0)}</td>
          <td>${num(totals.requiredT, 2)}</td>
          <td>${num(totals.bufferedT, 2)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

// Which folding sections of the harvest report are open, kept while the app is open. Open until closed.
const harvestOpen = new Map();

// Silos with less room than this are left out of the harvest report: not worth sending a load to. Kept on this device.
const MIN_ROOM_KEY = 'grainflow.harvest.minRoom';
const DEFAULT_MIN_ROOM = 20;
function loadMinRoom() {
  try {
    const raw = localStorage.getItem(MIN_ROOM_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_ROOM;
  } catch { return DEFAULT_MIN_ROOM; }
}
function saveMinRoom(n) { try { localStorage.setItem(MIN_ROOM_KEY, String(n)); } catch { /* the setting just does not stick */ } }

/**
 * Harvest progress: what is in against what is still to come, by commodity and field, and the room left in the silos
 * to take it. "In" is the tonnes carted off the field; "to come" is its estimate less that, until the field is marked
 * finished (see harvest.js). The silos and each commodity's fields fold away.
 */
function paintHarvest(root) {
  const { commodities, fields, storages, movements } = db.get();
  const { groups, farm } = harvestReport(commodities, fields, movements);
  const minRoom = loadMinRoom();
  const space = siloSpace(storages, movements, { minRoom });
  const body = root.querySelector('#reports-body');
  const t1 = (n) => num(n, 0);
  const margin = space.totalRoom - farm.toComeT;

  if (groups.length === 0) {
    body.innerHTML = `<div class="card report"><div class="empty">Add fields in the Production tab.</div></div>`;
    return;
  }
  const nameOf = (id) => commodities.find((c) => c.id === id)?.name || 'No commodity';
  const fold = (key, summary, inner) => `
    <details class="fold" data-fold="${key}" style="border-top:none;margin-top:0" ${harvestOpen.get(key) !== false ? 'open' : ''}>
      <summary>${summary}</summary>
      ${inner}
    </details>`;
  body.innerHTML = `
    <div class="card report">
      <h2><span class="dot report"></span>Whole farm</h2>
      <div class="stat-grid">
        <div class="stat"><div class="n">${t1(farm.inT)} t</div><div class="l">Harvested</div></div>
        <div class="stat"><div class="n">${t1(farm.toComeT)} t</div><div class="l">Still to come</div></div>
        <div class="stat"><div class="n">${pctText(farm.pct)}</div><div class="l">Done</div></div>
        <div class="stat"><div class="n">${t1(farm.toGoHa)} ha</div><div class="l">Left to harvest</div></div>
      </div>
      <div class="row" style="margin-top:8px"><span class="label">Paddocks finished</span><span class="value">${farm.doneFields} of ${farm.fields} · ${t1(farm.doneHa)} of ${t1(farm.areaHa)} ha</span></div>
    </div>

    <div class="card report">
      ${fold('room', `<div><h2><span class="dot report"></span>Room in the silos</h2><div class="sub">${t1(space.totalRoom)} t room left · ${margin >= 0 ? `${t1(margin)} t to spare` : `short by ${t1(-margin)} t`}${minRoom > 0 ? ` · silos under ${t1(minRoom)} t left out` : ''}</div></div>`, `
      <div class="row"><span class="label">In silos already holding a commodity</span><span class="value">${t1(space.totalRoom - space.emptyRoom)} t</span></div>
      <div class="row"><span class="label">In empty silos (${space.emptyCount}), for any grain</span><span class="value">${t1(space.emptyRoom)} t</span></div>
      <div class="row"><span class="label"><strong>Room left</strong></span><span class="value"><strong>${t1(space.totalRoom)} t</strong></span></div>
      <div class="row"><span class="label">Still to come</span><span class="value">${t1(farm.toComeT)} t</span></div>
      <div class="row"><span class="label"><strong>${margin >= 0 ? 'Room to spare' : 'Short of room by'}</strong></span><span class="value"><span class="badge ${margin >= 0 ? 'pos' : 'neg'}">${t1(Math.abs(margin))} t</span></span></div>
      ${space.silos.length ? fold('silos', `<div><h2>Each silo</h2><div class="sub">${space.silos.length} silo${space.silos.length === 1 ? '' : 's'}, most room first</div></div>`, space.silos.map((s) => `
        <div class="list-item stack">
          <div class="li-top"><div class="main">${esc(s.name)}</div><div class="main">${t1(s.room)} t room</div></div>
          <div class="meta">${s.empty ? 'Empty, takes any grain' : esc(nameOf(s.commodityId))} · ${t1(s.stock)} of ${t1(s.capacity)} t</div>
          <div class="gauge" role="img" aria-label="${Math.round(s.pct * 100)} percent full"><i style="width:${s.pct * 100}%"></i></div>
        </div>`).join('')) : ''}
      ${space.notCounted.length ? `<div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Not counted: ${space.notCounted.map(esc).join('; ')}. Set the capacity or commodity on the Storage tab to include them.</div>` : ''}
      ${space.tooSmall.count ? `<div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">${space.tooSmall.count} silo${space.tooSmall.count === 1 ? '' : 's'} with under ${t1(minRoom)} t of room left out (${t1(space.tooSmall.room)} t between them).</div>` : ''}
      <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Third-party storage is not counted. An empty silo can take any grain, so it is counted once, here, and not under each commodity.</div>`)}
      <div class="row" style="margin-top:8px"><label class="label" for="min-room">Leave out silos with less room than (t)</label><span class="value"><input id="min-room" type="number" inputmode="decimal" min="0" step="1" value="${minRoom}" style="width:80px;text-align:right" /></span></div>
    </div>

    ${groups.map((g) => {
      const own = g.id ? space.byCommodity.get(g.id) : null;
      const summary = `<div><h2>${esc(g.name)} <span class="badge ${g.totals.pct >= 1 ? 'pos' : 'muted'}">${pctText(g.totals.pct)} in</span></h2>
        <div class="sub">${t1(g.totals.toComeT)} t still to come · ${t1(g.totals.doneHa)} of ${t1(g.totals.areaHa)} ha finished</div></div>`;
      return `
      <div class="card report">
        ${fold('c-' + (g.id || 'none'), summary, `
        <div class="table-scroll tight-wrap">
          <table class="tight wrap-first">
            <thead><tr><th>Field</th><th>Est t</th><th>In t</th><th>To come</th><th>Done</th></tr></thead>
            <tbody>
              ${g.rows.map((r) => `<tr>
                <td>${r.done ? '&#10003;&nbsp;' : ''}${esc(r.field.name)}${r.haLeft !== null ? `<div class="meta">${t1(r.haLeft)} ha to cut</div>` : ''}</td>
                <td>${t1(r.estimateT)}</td>
                <td>${t1(r.inT)}</td>
                <td>${t1(r.toComeT)}</td>
                <td>${r.done ? 'Done' : (r.ahead ? 'Over' : pctText(r.pct))}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td><td>${t1(g.totals.estimateT)}</td><td>${t1(g.totals.inT)}</td><td>${t1(g.totals.toComeT)}</td><td>${pctText(g.totals.pct)}</td>
            </tr></tfoot>
          </table>
        </div>
        <div class="row" style="margin-top:6px"><span class="label">Hectares finished</span><span class="value">${t1(g.totals.doneHa)} of ${t1(g.totals.areaHa)} ha</span></div>
        ${g.id ? `<div class="row"><span class="label">Room in its silos (${own ? own.silos : 0})</span><span class="value">${t1(own ? own.room : 0)} t</span></div>` : ''}`)}
      </div>`;
    }).join('')}`;

  body.querySelector('#min-room')?.addEventListener('change', (e) => {
    const n = Number(e.target.value);
    saveMinRoom(Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_ROOM);
    paintHarvest(root);
  });

  // remember which sections were opened or closed, so a repaint does not undo it
  body.querySelectorAll('details[data-fold]').forEach((d) => d.addEventListener('toggle', () => harvestOpen.set(d.dataset.fold, d.open)));
}

function paintYield(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');
  const grandArea = groups.reduce((s, g) => s + g.fields.reduce((s2, f) => s2 + (Number(f.areaHa) || 0), 0), 0);
  const grandTons = groups.reduce((s, g) => s + g.totalTons, 0);
  const grandYieldTHa = grandArea > 0 ? grandTons / grandArea : 0;

  body.innerHTML = `
    ${groups.length > 0 ? sensitivityCard() : ''}
    <div class="card report">
      <h2><span class="dot report"></span>Yield by commodity, by field</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields in the Production tab.</div>` : groups.map((g) => yieldTable(g, movements)).join('')}
      ${groups.length > 0 ? `
        <hr class="sep" />
        <div class="row"><span class="label"><strong>Whole farm</strong></span><span class="value">${num(grandArea, 1)} ha &middot; ${num(grandYieldTHa, 2)} t/ha &middot; ${tons(grandTons)}</span></div>
      ` : ''}
    </div>
  `;
  bindSensitivity(body);
}

function yieldTable(g, movements) {
  const rows = g.fields.map((f) => {
    const t = fieldTons(f, movements);
    const yieldTHa = f.areaHa > 0 ? t / f.areaHa : 0;
    return { f, t, yieldTHa };
  });
  const totals = rows.reduce((acc, { f, t }) => ({
    area: acc.area + (Number(f.areaHa) || 0),
    tons: acc.tons + t,
  }), { area: 0, tons: 0 });
  const avgYieldTHa = totals.area > 0 ? totals.tons / totals.area : 0;

  return `
    <div class="group-label"><span>${esc(g.name)}</span><span class="n">${tons(totals.tons)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Mode</th><th>Yield t/ha</th><th>Tons</th></tr></thead>
        <tbody>
          ${rows.map(({ f, t, yieldTHa }) => `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td><span class="badge ${f.yieldMode === 'actual' ? 'pos' : 'neg'}">${f.yieldMode === 'actual' ? 'Actual' : 'Estimate'}</span></td>
              <td>${num(yieldTHa, 2)}</td>
              <td>${num(t, 1)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(totals.area, 1)}</td>
          <td></td>
          <td>${num(avgYieldTHa, 2)}</td>
          <td>${num(totals.tons, 1)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}
