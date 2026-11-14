import { db } from '../storage.js?v=235';
import { positionRows, positionTotals, farmProfitLoss } from '../derived.js?v=235';
import { num, tons, money, pct, esc } from '../fmt.js?v=235';
import { payablesCost } from '../payables.js?v=235';

let unsub = null;

export function renderPosition(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, fields, sales, movements } = db.get();
  const overheads = db.getOverheads();
  const rows = positionRows(commodities, fields, sales, movements);
  const totals = positionTotals(rows);
  // bills owed: brokerage, freight, storage and the rest come off profit as costs
  const cost = payablesCost(sales, movements, db.getPayables());
  const pl = farmProfitLoss(totals.grossMargin, overheads, totals.openingValue, cost.total);

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
          <div class="l">${totals.openingValue ? "Current Crop Value" : "Total position value"}</div>
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

      ${rows.length === 0 ? `<div class="empty">Nothing to report yet.<br/>Add a paddock in Production, or a contract in Sales, and your position appears here.</div>` : ''}

      ${rows.map((r) => commodityCard(r)).join('')}

      ${rows.length > 0 ? farmSummaryCard(totals, overheads, pl, cost) : ''}
    </div>
  `;
}

function farmSummaryCard(totals, overheads, pl, cost) {
  const plClass = pl.profitLoss >= 0 ? 'pos' : 'neg';
  const oh = (label, v) => `<div class="row"><span class="label">${label}</span><span class="value">${money(v, 0)}</span></div>`;
  return `
    <div class="card summary">
      <h2><span class="dot summary"></span>Whole farm</h2>
      <div class="trio">
        <div class="kv"><div class="l">Gross margin</div><div class="v">${money(totals.grossMargin, 0)}</div></div>
        <div class="kv"><div class="l">Overheads</div><div class="v">${money(pl.overheadsTotal, 0)}</div></div>
        <div class="kv"><div class="l">${pl.profitLoss >= 0 ? 'Profit' : 'Loss'}</div><div class="v"><span class="badge ${plClass}" style="font-size:15px">${money(pl.profitLoss, 0)}</span></div></div>
      </div>
      ${pl.payablesTotal ? `
      <details class="fold" style="margin-top:6px">
        <summary><div><h2>Payables</h2><div class="sub">${money(pl.payablesTotal, 0)} taken off profit: brokerage, freight, storage, other</div></div></summary>
        ${[['Brokerage', cost.brokerage], ['Freight, above or below the contract estimate', cost.freight], ['Storage', cost.storage], ['Other', cost.other]].filter(([, v]) => v).map(([l, v]) => `<div class="row"><span class="label">${l}</span><span class="value">${v < 0 ? '&minus;' : ''}${money(Math.abs(v), 0)}</span></div>`).join('')}
        <div class="row"><span class="label"><strong>Total</strong></span><span class="value"><strong>${money(pl.payablesTotal, 0)}</strong></span></div>
        <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Bills count at their amount before GST, paid or not. Brokerage is each contract's $/t on the tonnes delivered, or the broker's bills if more. A freight bill on a contract replaces its Freight ($/t) estimate for those tonnes, so only the difference shows here.</div>
      </details>` : ''}
      ${pl.openingValue ? `
      <div class="liquidity">
        <div class="row"><span class="label">${pl.profitLoss >= 0 ? 'Profit' : 'Loss'} this season</span><span class="value">${money(pl.profitLoss, 0)}</span></div>
        <div class="row"><span class="label">Plus opening stock value</span><span class="value">+${money(pl.openingValue, 0)}</span></div>
        <div class="row total"><span class="label"><strong>Total incl. opening stock</strong><span class="sub">Profit plus the grain brought in</span></span><span class="value"><span class="badge ${pl.profitWithOpening >= 0 ? 'pos' : 'neg'}" style="font-size:15px">${money(pl.profitWithOpening, 0)}</span></span></div>
      </div>` : ''}
      <details class="fold">
        <summary><div><h2>Overheads</h2><div class="sub">Finance, wages, drawings and the rest</div></div></summary>
        ${oh('Finance', overheads.finance)}${oh('Equipment repayments', overheads.equipmentRepayments)}${oh('Depreciation', overheads.depreciation)}
        ${oh('Wages', overheads.wages)}${oh('Drawings', overheads.drawings)}${oh('Admin', overheads.admin)}
        ${oh('Energy', overheads.energy)}${oh('Insurance', overheads.insurance)}${oh('R&amp;M', overheads.repairsMaintenance)}${oh('Other', overheads.other)}
        ${oh('<strong>Total overheads</strong>', pl.overheadsTotal)}
      </details>
    </div>
  `;
}

function commodityCard(r) {
  const sold = Math.min(1, Math.max(0, r.pctSold));
  const pctSoldBadge = r.pctSold >= 1
    ? `<span class="badge pos">Sold out</span>`
    : `<span class="badge ${r.pctSold > 0 ? 'pos' : 'muted'}">${pct(r.pctSold)} sold</span>`;

  return `
    <div class="card summary">
      <h2><span class="dot summary"></span>${esc(r.commodity.name)} ${pctSoldBadge}</h2>
      <div class="trio">
        <div class="kv"><div class="l">Produced</div><div class="v">${tons(r.productionTons, 0)}</div></div>
        <div class="kv"><div class="l">Sold</div><div class="v">${tons(r.soldTons, 0)}</div></div>
        <div class="kv"><div class="l">Unsold</div><div class="v">${tons(r.unsoldTons, 0)}</div></div>
      </div>
      <div class="trio quad">
        <div class="kv sm"><div class="l">Area</div><div class="v">${num(r.area, 0)} ha</div></div>
        <div class="kv sm"><div class="l">Yield</div><div class="v">${num(r.yieldTHa, 2)} t/ha</div></div>
        <div class="kv sm"><div class="l">Avg sold</div><div class="v">${money(r.avgSoldPrice, 0)}/t</div></div>
        <div class="kv sm"><div class="l">MTM</div><div class="v">${money(r.mtmPrice, 0)}/t</div></div>
      </div>
      <div class="gauge" role="img" aria-label="${Math.round(sold * 100)} percent sold"><i style="width:${sold * 100}%"></i></div>
      ${r.openingValue ? `
      <div class="row" style="margin-top:8px"><span class="label">Total Value (Sold + MTM)</span><span class="value">${money(r.totalValue + r.openingValue, 0)}</span></div>
      <div class="row"><span class="label">Less opening stock</span><span class="value">&minus;${money(r.openingValue, 0)}</span></div>
      <div class="row"><span class="label"><strong>Current Crop Value</strong></span><span class="value"><strong>${money(r.totalValue, 0)}</strong></span></div>
      ` : `
      <div class="row" style="margin-top:8px"><span class="label">Total position value</span><span class="value">${money(r.totalValue, 0)}</span></div>
      `}
      <div class="row"><span class="label">Gross margin</span><span class="value">${money(r.grossMargin, 0)} <span class="badge ${r.grossMargin >= 0 ? 'pos' : 'neg'}">${pct(r.grossMarginPct)}</span></span></div>
      <details class="fold">
        <summary><div><h2>Full breakdown</h2><div class="sub">Values, stock and costs</div></div></summary>
        <div class="row"><span class="label">Avg sold price</span><span class="value">${money(r.avgSoldPrice, 2)}/t</span></div>
        <div class="row"><span class="label">Sold value</span><span class="value">${money(r.soldValue, 0)}</span></div>
        ${r.opening || r.retainedSeed ? `
        <div class="row"><span class="label">Opening stock</span><span class="value">${tons(r.opening, 0)}</span></div>
        ${r.openingValue && r.opening > 0 ? `<div class="row"><span class="label">Opening stock value ($/t)</span><span class="value">${money(r.openingValue / r.opening, 2)}/t</span></div>` : ''}
        <div class="row"><span class="label">Retained seed</span><span class="value">${tons(r.retainedSeed, 0)}</span></div>
        ` : ''}
        <div class="row"><span class="label">MTM price</span><span class="value">${money(r.mtmPrice, 2)}/t</span></div>
        <div class="row"><span class="label">Unsold value</span><span class="value">${money(r.unsoldValue, 0)}</span></div>
        ${r.openingValue ? `<div class="row"><span class="label">Less opening stock</span><span class="value">&minus;${money(r.openingValue, 0)}</span></div>` : ''}
        <div class="row"><span class="label">Gross margin cost</span><span class="value">${money(r.grossMarginCost, 0)}</span></div>
      </details>
    </div>
  `;
}
