import { db } from '../storage.js?v=28';
import { position, positionTotals, farmProfitLoss } from '../derived.js?v=28';
import { num, tons, money, pct } from '../fmt.js?v=28';

let unsub = null;

export function renderPosition(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields, sales, movements } = db.get();
  const overheads = db.getOverheads();
  const rows = position(commodities, fields, sales, movements).filter((r) => r.area > 0 || r.soldTons > 0 || r.commodity.openingStock);
  const totals = positionTotals(rows);
  const pl = farmProfitLoss(totals.grossMargin, overheads);

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

      ${rows.length > 0 ? farmSummaryCard(totals, overheads, pl) : ''}
    </div>
  `;
}

function farmSummaryCard(totals, overheads, pl) {
  const plClass = pl.profitLoss >= 0 ? 'pos' : 'neg';
  return `
    <div class="card summary">
      <h2><span class="dot summary"></span>Whole farm</h2>
      <div class="row"><span class="label"><strong>Total gross margin</strong></span><span class="value"><strong>${money(totals.grossMargin, 0)}</strong></span></div>
      <hr class="sep" />
      <div class="row"><span class="label">Finance</span><span class="value">${money(overheads.finance, 0)}</span></div>
      <div class="row"><span class="label">Equipment repayments</span><span class="value">${money(overheads.equipmentRepayments, 0)}</span></div>
      <div class="row"><span class="label">Depreciation</span><span class="value">${money(overheads.depreciation, 0)}</span></div>
      <div class="row"><span class="label">Wages</span><span class="value">${money(overheads.wages, 0)}</span></div>
      <div class="row"><span class="label">Drawings</span><span class="value">${money(overheads.drawings, 0)}</span></div>
      <div class="row"><span class="label">Admin</span><span class="value">${money(overheads.admin, 0)}</span></div>
      <div class="row"><span class="label">Energy</span><span class="value">${money(overheads.energy, 0)}</span></div>
      <div class="row"><span class="label">Insurance</span><span class="value">${money(overheads.insurance, 0)}</span></div>
      <div class="row"><span class="label">R&amp;M</span><span class="value">${money(overheads.repairsMaintenance, 0)}</span></div>
      <div class="row"><span class="label">Other</span><span class="value">${money(overheads.other, 0)}</span></div>
      <div class="row"><span class="label">Total overheads</span><span class="value">${money(pl.overheadsTotal, 0)}</span></div>
      <hr class="sep" />
      <div class="row"><span class="label"><strong>${pl.profitLoss >= 0 ? 'Profit' : 'Loss'}</strong></span><span class="value"><span class="badge ${plClass}" style="font-size:16px">${money(pl.profitLoss, 0)}</span></span></div>
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
      <hr class="sep" />
      <div class="row"><span class="label">Gross margin cost</span><span class="value">${money(r.grossMarginCost, 0)}</span></div>
      <div class="row"><span class="label"><strong>Gross margin</strong></span><span class="value"><strong>${money(r.grossMargin, 0)}</strong> <span class="badge ${r.grossMargin >= 0 ? 'pos' : 'neg'}">${pct(r.grossMarginPct)}</span></span></div>
    </div>
  `;
}
