import { db } from '../storage.js?v=43';
import { groupFieldsByCommodity, fieldUrea, fieldStarter, soilNUreaEquivalent, fieldUreaForTarget, nitrogenCalc, fieldSeed, fieldTons, SEED_BUFFER_PCT } from '../derived.js?v=43';
import { num, tons, esc } from '../fmt.js?v=43';
import { field, getVal, getNum } from '../ui.js?v=43';

let unsub = null;
let view = 'fert';

export function renderReports(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Reports</h1>
        <div class="sub">Fertiliser &amp; seed requirements, by commodity &amp; field</div>
      </div>
    </div>
    <div class="view">
      <div class="segmented" id="reports-view">
        <button data-view="fert" class="${view === 'fert' ? 'active' : ''}">Fert</button>
        <button data-view="seed" class="${view === 'seed' ? 'active' : ''}">Seed</button>
        <button data-view="yield" class="${view === 'yield' ? 'active' : ''}">Yield</button>
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
  } else {
    paintFert(root);
  }
}

function paintFert(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');

  body.innerHTML = `
    <div class="card">
      <h2>Nitrogen calculator</h2>
      <div id="n-calc-form"></div>
      <div id="n-calc-result"></div>
    </div>
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
  const rows = g.fields.map((f) => ({ f, u: fieldUrea(f), soilEquivKgHa: soilNUreaEquivalent(f.soilTestNKgHa), target: fieldUreaForTarget(f, commodity) }));
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
  const avgTargetCalc = rows.length > 0 ? rows.reduce((s, { target }) => s + target.requiredKgHa, 0) / rows.length : 0;

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Soil N kg/ha</th><th>Soil equiv kg/ha</th><th>Target t/ha</th><th>Target calc kg/ha</th><th>Req kg/ha</th><th>App kg/ha</th><th>Left kg/ha</th><th>Req t</th><th>App t</th><th>Left t</th></tr></thead>
        <tbody>
          ${rows.map(({ f, u, soilEquivKgHa, target }) => {
            const leftKgHaField = f.areaHa > 0 ? (u.leftTons * 1000) / f.areaHa : 0;
            return `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td>${num(f.soilTestNKgHa || 0, 0)}</td>
              <td>${num(soilEquivKgHa, 0)}</td>
              <td>${target.targetYieldTHa > 0 ? num(target.targetYieldTHa, 2) : '—'}</td>
              <td>${num(target.requiredKgHa, 0)}</td>
              <td>${num(f.ureaRequiredKgHa || 0, 0)}</td>
              <td>${num(f.ureaAppliedKgHa || 0, 0)}</td>
              <td>${num(leftKgHaField, 0)}</td>
              <td>${num(u.requiredTons, 2)}</td>
              <td>${num(u.appliedTons, 2)}</td>
              <td>${num(u.leftTons, 2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(totals.area, 1)}</td>
          <td>${num(avgSoilTestN, 0)}</td>
          <td>${num(avgSoilEquiv, 0)}</td>
          <td>${avgTargetYield > 0 ? num(avgTargetYield, 2) : '—'}</td>
          <td>${num(avgTargetCalc, 0)}</td>
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

function paintYield(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');
  const grandArea = groups.reduce((s, g) => s + g.fields.reduce((s2, f) => s2 + (Number(f.areaHa) || 0), 0), 0);
  const grandTons = groups.reduce((s, g) => s + g.totalTons, 0);
  const grandYieldTHa = grandArea > 0 ? grandTons / grandArea : 0;

  body.innerHTML = `
    <div class="card report">
      <h2><span class="dot report"></span>Yield by commodity, by field</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields in the Production tab.</div>` : groups.map((g) => yieldTable(g, movements)).join('')}
      ${groups.length > 0 ? `
        <hr class="sep" />
        <div class="row"><span class="label"><strong>Whole farm</strong></span><span class="value">${num(grandArea, 1)} ha &middot; ${num(grandYieldTHa, 2)} t/ha &middot; ${tons(grandTons)}</span></div>
      ` : ''}
    </div>
  `;
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
