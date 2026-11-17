import { db } from '../storage.js?v=363';
import { positionRows, positionTotals, farmProfitLoss } from '../derived.js?v=363';
import { num, tons, money, pct, esc } from '../fmt.js?v=363';
import { payablesCost } from '../payables.js?v=363';
import { openEofySheet } from './eofy.js?v=363';
import { startProgress } from '../helpcontent.js?v=363';
import { attentionItems } from '../attention.js?v=363';
import { lastBackup } from '../backup.js?v=363';
import { todayLocal, dmy } from '../fmt.js?v=363';
import { openMoneySheet, openDeliveriesSheet } from './outstanding.js?v=363';
import { openSheet, closeSheet } from '../ui.js?v=363';
import { positionPdf } from '../positionpdf.js?v=363';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=363';

const TONE = { bad: 'var(--danger)', warn: 'var(--warn)', info: 'var(--accent-input)' };

/** The things that need looking at today, a line each; empty when there is nothing. */
function attentionCard() {
  const { invoices, sales, movements } = db.get();
  const items = attentionItems({ role: db.getRole(), today: todayLocal(), invoices, sales, movements, orders: db.getOrders(), payables: db.getPayables(), lastBackup: lastBackup() });
  if (!items.length) return '';
  return `<div class="card" id="attention-card">
        <h2>Needs attention</h2>
        ${items.map((i) => `<div class="list-item" data-attn="${esc(i.action)}" style="cursor:pointer">
          <div style="display:flex;align-items:flex-start;gap:10px"><span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:none;margin-top:6px;background:${TONE[i.tone]}"></span>
            <div><div class="main">${esc(i.title)}</div><div class="meta">${esc(i.detail)}</div></div></div>
        </div>`).join('')}
      </div>`;
}

let unsub = null;

const START_HIDDEN = 'grainflow.start.hidden';
const startHidden = () => { try { return localStorage.getItem(START_HIDDEN) === '1'; } catch { return false; } };

/** The Getting started list: what a new farm still has to set up, ticking itself off as the farm fills in. */
function startCard() {
  if (startHidden()) return '';
  const start = startProgress(db.getRole(), { business: db.getBusinessDetails(), ...db.get() });
  if (!start.steps.length || start.complete) return '';
  return `<div class="card input" id="start-card">
        <h2><span class="dot input"></span>Getting started &middot; ${start.done} of ${start.total}</h2>
        ${start.steps.map((s) => `<div class="list-item" ${s.canOpen ? `data-start-go="${esc(s.route)}" style="cursor:pointer"` : ''}>
          <div style="display:flex;align-items:center;gap:10px"><span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;${s.done ? 'background:var(--accent-summary);color:#fff' : 'border:1.5px solid var(--border)'}">${s.done ? '&#10003;' : ''}</span>
            <div><div class="main" style="${s.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(s.label)}</div><div class="meta">${esc(s.detail)}</div></div></div>
        </div>`).join('')}
        <div class="swipe-actions" style="margin-top:10px">
          <button type="button" class="btn secondary small" id="start-help">How-to guide</button>
          <button type="button" class="btn secondary small" id="start-hide">Hide this</button>
        </div>
      </div>`;
}

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
      ${attentionCard()}
      ${startCard()}
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn secondary" id="open-eofy" style="flex:1">End of year snapshot</button>
        ${rows.length ? `<button class="btn secondary" id="position-pdf" style="flex:1">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>` : ''}
      </div>
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
  root.querySelector('#open-eofy').addEventListener('click', openEofySheet);
  root.querySelector('#position-pdf')?.addEventListener('click', () => openPdfSheet({ rows, totals, overheads, pl, cost }));
  root.querySelectorAll('[data-start-go]').forEach((el) => el.addEventListener('click', () => { location.hash = `#/${el.dataset.startGo}`; }));
  root.querySelectorAll('[data-attn]').forEach((el) => el.addEventListener('click', () => {
    const go = el.dataset.attn;
    if (go === 'money') openMoneySheet();
    else if (go === 'deliveries') openDeliveriesSheet();
    else if (go === 'settings') location.hash = '#/settings';
  }));
  root.querySelector('#start-help')?.addEventListener('click', () => { location.hash = '#/help'; });
  root.querySelector('#start-hide')?.addEventListener('click', () => { try { localStorage.setItem(START_HIDDEN, '1'); } catch { /* shown again next time */ } paint(root); });
}

/** The screen as a PDF, shared from the phone's share sheet or downloaded on a computer. */
const PDF_KEY = 'grainflow.positionpdf';
const readShow = () => { try { return { result: true, overheads: true, ...JSON.parse(localStorage.getItem(PDF_KEY) || '{}') }; } catch { return { result: true, overheads: true }; } };
const saveShow = (v) => { try { localStorage.setItem(PDF_KEY, JSON.stringify(v)); } catch { /* not remembered */ } };

/** What goes at the bottom of the PDF: ticks, remembered on this device, then the file. The commodity table is always there. */
function openPdfSheet(data) {
  openSheet('Position PDF', (root) => {
    const d = readShow();
    const tick = (id, on, text) => `<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0 0 12px"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:20px;height:20px;margin-top:1px;flex:none" /><span>${text}</span></label>`;
    root.innerHTML = `
      <div class="hint" style="margin-bottom:12px">The table of commodities is always on the page. Choose what goes under it.</div>
      ${tick('pp-result', d.result, '<strong>Whole farm result</strong><span class="meta" style="display:block">Gross margin, overheads and the profit or loss</span>')}
      ${tick('pp-over', d.overheads, '<strong>Overheads and bills</strong><span class="meta" style="display:block">Each overhead, and the bills taken off profit</span>')}
      <button type="button" class="btn" id="pp-go" style="margin-top:6px">${canShareFiles() ? 'Share PDF' : 'Download PDF'}</button>`;
    root.querySelector('#pp-go').addEventListener('click', () => {
      const show = { result: root.querySelector('#pp-result').checked, overheads: root.querySelector('#pp-over').checked };
      saveShow(show);
      closeSheet();
      exportPdf(data, show);
    });
  }, { askBeforeClose: false });
}

async function exportPdf(data, show = readShow()) {
  const business = db.getBusinessDetails().entityName || '';
  const season = db.getCurrentYear();
  const bytes = positionPdf(data, { business, season, today: dmy(todayLocal()), show });
  const fileName = safeFileName(`Position ${season} ${dmy(todayLocal())}`);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Position ${season}` });
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

/** Cotton's position as three values, shown apart: the lint, the seed, and the ginning that comes off. */
function cottonLines(r) {
  const c = r.cotton;
  if (!c || !(c.seedValue || c.ginningCost)) return '';
  const sub = (t) => `<small style="display:block;font-size:11.5px;color:var(--text-dim);font-weight:400">${t}</small>`;
  const row = (label, note, value) => `<div class="row"><span class="label">${label}${sub(note)}</span><span class="value" style="white-space:nowrap">${value}</span></div>`;
  const est = c.unginnedBales > 0.5 ? `${num(c.unginnedBales, 0)} bales to gin, estimated` : 'From the gin invoices';
  return `
      <div style="margin-top:8px">
      ${row('Cotton (lint)', 'Sold plus unsold at MTM', money(r.soldValue + r.unsoldValue, 0))}
      ${row('Seed', `${num(c.seedT, 1)} t at ${money(c.seedMtm, 0)}/t`, money(c.seedValue, 0))}
      ${row('Less ginning', est, `&minus;${money(c.ginningCost, 0)}`)}
      </div>`;
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
        <div class="kv sm"><div class="l">MTM</div><div class="v">${money(r.mtmPrice, 0)}/${r.commodity.unit === 'bale' ? 'bale' : 't'}</div></div>
      </div>
      <div class="gauge" role="img" aria-label="${Math.round(sold * 100)} percent sold"><i style="width:${sold * 100}%"></i></div>
      ${cottonLines(r)}
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
