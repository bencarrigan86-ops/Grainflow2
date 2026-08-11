import { db } from '../storage.js?v=25';
import { groupFieldsByCommodity, fieldUrea } from '../derived.js?v=25';
import { num, esc } from '../fmt.js?v=25';

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
      <div class="card report">
        <h2><span class="dot report"></span>Urea</h2>
        ${groups.length === 0 ? `<div class="empty">Add fields with urea rates in the Production tab.</div>` : groups.map((g) => ureaTable(g)).join('')}
      </div>
    </div>
  `;
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
