import { db } from '../storage.js?v=26';
import { position, positionTotals } from '../derived.js?v=26';
import { num, tons, money, pct } from '../fmt.js?v=26';

let unsub = null;

export function renderPosition(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields, sales, movements } = db.get();
  const rows = position(commodities, fields, sales, movements).filter((r) => r.area > 0 || r.soldTons > 0 || r.commodity.openingStock);
  const totals = positionTotals(rows);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Position</h1>
        <div class="sub">Production, sales &amp; unsold at MTM</div>
      </div>
    </div>
    <div class="view">
      <div class="stat-grid">
        <div class="stat">
          <div class="n">${tons(totals.productionTons, 0)}</div>
          <div class="l">Total production</div>
        </div>
        <div class="stat">
          <div class="n">${money(totals.totalValue, 0)}</div>
          <div class="l">Total position value</div>
        </div>
        <div class="stat">
          <div class="n">${money(totals.soldValue, 0)}</div>
          <div class="l">Sold value</div>
        </div>
        <div class="stat">
          <div class="n">${money(totals.unsoldValue, 0)}</div>
          <div class="l">Unsold value (MTM)</div>
        </div>
      </div>

      ${rows.length === 0 ? `<div class="empty">No production, sales or opening stock yet.<br/>Add data in the Production and Sales tabs.</div>` : ''}

      ${rows.map((r) => commodityCard(r)).join('')}
    </div>
  `;
}

function commodityCard(r) {
  const pctSoldBadge = r.pctSold >= 1
    ? `<span class="badge pos">Sold out</span>`
    : `<span class="badge ${r.pctSold > 0 ? 'pos' : 'neg'}">${pct(r.pctSold)} sold</span>`;

  return `
    <div class="card summary">
      <h2><span class="dot summary"></span>${r.commodity.name} ${pctSoldBadge}</h2>
      <div class="row"><span class="label">Area</span><span class="value">${num(r.area, 1)} ha</span></div>
      <div class="row"><span class="label">Yield</span><span class="value">${num(r.yieldTHa, 2)} t/ha</span></div>
      <div class="row"><span class="label">Production</span><span class="value">${tons(r.productionTons)}</span></div>
      <hr class="sep" />
      <div class="row"><span class="label">Sold</span><span class="value">${tons(r.soldTons)}</span></div>
      <div class="row"><span class="label">Avg sold price</span><span class="value">${money(r.avgSoldPrice, 2)}/t</span></div>
      <div class="row"><span class="label">Sold value</span><span class="value">${money(r.soldValue, 0)}</span></div>
      <hr class="sep" />
      ${r.opening || r.retainedSeed ? `
      <div class="row"><span class="label">Opening stock</span><span class="value">${tons(r.opening)}</span></div>
      <div class="row"><span class="label">Retained seed</span><span class="value">${tons(r.retainedSeed)}</span></div>
      ` : ''}
      <div class="row"><span class="label">Unsold</span><span class="value">${tons(r.unsoldTons)}</span></div>
      <div class="row"><span class="label">MTM price</span><span class="value">${money(r.mtmPrice, 2)}/t</span></div>
      <div class="row"><span class="label">Unsold value</span><span class="value">${money(r.unsoldValue, 0)}</span></div>
      <hr class="sep" />
      <div class="row"><span class="label"><strong>Total position value</strong></span><span class="value"><strong>${money(r.totalValue, 0)}</strong></span></div>
    </div>
  `;
}
