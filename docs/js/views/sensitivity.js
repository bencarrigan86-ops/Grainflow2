// Yield sensitivity: "what if the crop comes in 10% light?"
//
// Lives on the Reports > Yield tab, and only for roles that can open Position.
// It is mostly dollars — position value and profit — and the roles that cannot
// see Position are the ones the app keeps money from.

import { db } from '../storage.js?v=105';
import { positionRows, positionAtYield, positionTotals, farmProfitLoss, fieldTons, paddockAtYield } from '../derived.js?v=105';
import { num, tons, money, esc } from '../fmt.js?v=105';

// Kept across repaints so a sync arriving does not snap the slider back to 0.
let sensPct = -10;
const SENS_STEPS = [-20, -10, 0, 10, 20];

const signed = (n, f) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(Math.abs(n))}`;

export function sensitivityCard() {
  return `
    <div class="card report" id="sens-card">
      <h2><span class="dot report"></span>Yield sensitivity</h2>
      <div class="field hint" style="margin-bottom:10px">Slide to see the position if every paddock's yield comes in above or below what is entered. Contracts stay as signed, so the change lands on the unsold grain. Nothing is saved.</div>
      <div class="field" style="margin-bottom:4px">
        <label for="sens-range">Yield change: <strong id="sens-label"></strong></label>
        <input type="range" id="sens-range" min="-40" max="40" step="5" value="${sensPct}" style="width:100%" />
      </div>
      <div id="sens-detail"></div>
      <div class="subhead" style="margin-top:14px">Whole farm at a glance</div>
      <div class="table-scroll"><table id="sens-steps"></table></div>
    </div>`;
}

/**
 * One commodity's paddocks at the chosen yield change. Contracts belong to the
 * commodity, not the paddock, so a paddock's figure here is what its crop is
 * worth at the MTM price — useful for seeing which paddocks carry the risk,
 * not a share of the contract position.
 */
function paddockFold(commodity, fields, movements, pct) {
  const rows = fields
    .filter((f) => f.commodityId === commodity.id)
    .map((f) => paddockAtYield(f, movements, commodity.mtmPrice, pct))
    .filter((r) => r.baseTons > 0 || r.areaHa > 0);
  if (rows.length === 0) return '';
  const totalDelta = rows.reduce((a, r) => a + (r.tons - r.baseTons), 0);
  return `
    <details class="fold" style="margin-top:0">
      <summary><div><h2 style="font-size:13px">By paddock</h2>
        <div class="sub">${rows.length} paddock${rows.length === 1 ? '' : 's'}${pct === 0 ? '' : ` · ${signed(Math.round(totalDelta), (n) => num(n, 0))} t`}</div></div></summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Paddock</th><th>t/ha</th><th>Tons</th><th>Crop $</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.name)}</td>
          <td>${num(r.yieldTHa, 2)}</td>
          <td>${num(r.tons, 0)}</td>
          <td>${money(r.value, 0)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
}

function paintSensitivity(root) {
  const card = root.querySelector('#sens-card');
  if (!card) return;
  const { commodities, fields, sales, movements } = db.get();
  const overheads = db.getOverheads();
  const base = positionRows(commodities, fields, sales, movements);
  const baseTotals = positionTotals(base);
  const basePl = farmProfitLoss(baseTotals.grossMargin, overheads);

  const at = (p) => {
    const rows = positionAtYield(base, p);
    const t = positionTotals(rows);
    return { rows, t, pl: farmProfitLoss(t.grossMargin, overheads) };
  };

  card.querySelector('#sens-label').textContent = sensPct === 0 ? 'as entered' : `${signed(sensPct, (n) => n)}%`;

  const cur = at(sensPct);
  const delta = (now, was, f) => {
    const d = now - was;
    return Math.abs(d) < 0.5 ? '' : `<div class="meta" style="color:${d < 0 ? 'var(--danger)' : 'var(--accent-summary)'}">${signed(d, f)}</div>`;
  };
  card.querySelector('#sens-detail').innerHTML = cur.rows.map((r, i) => `
    <div class="row" style="align-items:flex-start">
      <span class="label"><strong>${esc(r.commodity.name)}</strong>
        <div class="meta">${tons(r.productionTons, 0)} produced · ${r.unsoldTons < 0 ? `<span style="color:var(--danger)">${tons(-r.unsoldTons, 0)} oversold</span>` : `${tons(r.unsoldTons, 0)} unsold`}</div></span>
      <span class="value">${money(r.totalValue, 0)}${delta(r.totalValue, base[i].totalValue, (n) => money(n, 0))}</span>
    </div>
    ${paddockFold(r.commodity, fields, movements, sensPct)}`).join('') + `
    <div class="row"><span class="label"><strong>Position value</strong></span>
      <span class="value">${money(cur.t.totalValue, 0)}${delta(cur.t.totalValue, baseTotals.totalValue, (n) => money(n, 0))}</span></div>
    <div class="row"><span class="label"><strong>${cur.pl.profitLoss >= 0 ? 'Profit' : 'Loss'}</strong></span>
      <span class="value"><span class="badge ${cur.pl.profitLoss >= 0 ? 'pos' : 'neg'}" style="font-size:15px">${money(cur.pl.profitLoss, 0)}</span>${delta(cur.pl.profitLoss, basePl.profitLoss, (n) => money(n, 0))}</span></div>`;

  card.querySelector('#sens-steps').innerHTML = `
    <thead><tr><th>Yield</th><th>Produced</th><th>Position</th><th>Profit</th></tr></thead>
    <tbody>${SENS_STEPS.map((p) => {
    const s = at(p);
    return `<tr${p === 0 ? ' style="font-weight:700"' : ''}><td>${p === 0 ? 'As entered' : `${signed(p, (n) => n)}%`}</td><td>${num(s.t.productionTons, 0)} t</td><td>${money(s.t.totalValue, 0)}</td><td style="color:${s.pl.profitLoss < 0 ? 'var(--danger)' : 'inherit'}">${money(s.pl.profitLoss, 0)}</td></tr>`;
  }).join('')}</tbody>`;
}

/** Wire the slider after the card's HTML is in the page. Safe to call on every repaint. */
export function bindSensitivity(root) {
  const range = root.querySelector('#sens-range');
  if (!range) return;
  paintSensitivity(root);
  range.addEventListener('input', () => { sensPct = Number(range.value); paintSensitivity(root); });
}
