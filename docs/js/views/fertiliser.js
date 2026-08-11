import { db } from '../storage.js?v=26';
import { groupFieldsByCommodity, fieldUrea, nitrogenCalc } from '../derived.js?v=26';
import { num, esc } from '../fmt.js?v=26';
import { field, getVal, getNum } from '../ui.js?v=26';

let unsub = null;

export function renderFertiliser(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Fertiliser</h1>
        <div class="sub">Urea required vs. applied, by commodity &amp; field</div>
      </div>
    </div>
    <div class="view">
      <div class="card">
        <h2>Nitrogen calculator</h2>
        <div id="n-calc-form"></div>
        <div id="n-calc-result"></div>
      </div>
      <div class="card report">
        <h2><span class="dot report"></span>Urea</h2>
        ${groups.length === 0 ? `<div class="empty">Add fields with urea rates in the Production tab.</div>` : groups.map((g) => ureaTable(g)).join('')}
      </div>
    </div>
  `;
  buildNitrogenCalc(root, commodities);
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

function ureaTable(g) {
  const rows = g.fields.map((f) => ({ f, u: fieldUrea(f) }));
  const totals = rows.reduce((acc, { f, u }) => ({
    area: acc.area + (Number(f.areaHa) || 0),
    reqT: acc.reqT + u.requiredTons,
    appT: acc.appT + u.appliedTons,
    leftT: acc.leftT + u.leftTons,
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
          ${rows.map(({ f, u }) => {
            const leftKgHaField = f.areaHa > 0 ? (u.leftTons * 1000) / f.areaHa : 0;
            return `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
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
