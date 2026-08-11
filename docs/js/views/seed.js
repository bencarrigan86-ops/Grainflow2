import { db } from '../storage.js?v=25';
import { groupFieldsByCommodity, fieldSeed, SEED_BUFFER_PCT } from '../derived.js?v=25';
import { num, esc } from '../fmt.js?v=25';

let unsub = null;

export function renderSeed(root) {
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
        <h1>Seed</h1>
        <div class="sub">Seed rate &amp; total required, by commodity &amp; field</div>
      </div>
    </div>
    <div class="view">
      <div class="card report">
        <h2><span class="dot report"></span>Seed</h2>
        ${groups.length === 0 ? `<div class="empty">Add fields with a seed rate in the Production tab.</div>` : groups.map((g) => seedTable(g)).join('')}
      </div>
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
