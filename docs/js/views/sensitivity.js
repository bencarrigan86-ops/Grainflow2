// Yield sensitivity: "what if the crop comes in 10% light?"
//
// Lives on the Reports > Yield tab, and only for roles that can open Position.
// Half of it is dollars — position value and profit — and the roles that cannot
// see Position are the ones the app keeps money from.

import { db } from '../storage.js?v=109';
import { positionRows, positionAtYield, positionTotals, farmProfitLoss, paddockAtYield } from '../derived.js?v=109';
import { num, money, esc } from '../fmt.js?v=109';

// Starts folded away: it is a what-if, not the first thing the Yield tab is for.
// Kept across repaints so a sync arriving does not change what you left open.
let sensOpen = false;
const openCommodities = new Set();

// The columns, in the order they are read: shortfalls left, as entered in the
// middle, upsides right.
const STEPS = [-15, -10, -5, 0, 5, 10, 15];

const signed = (n, f) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(Math.abs(n))}`;
const stepLabel = (pct) => (pct === 0 ? 'As entered' : `${signed(pct, (n) => n)}%`);

export function sensitivityCard() {
  return `
    <div class="card report" id="sens-card">
      <h2><span class="dot report"></span>Yield sensitivity
        <button type="button" class="btn secondary small" id="sens-toggle" aria-expanded="${sensOpen}" aria-controls="sens-body" style="margin-left:auto">${sensOpen ? 'Collapse' : 'Expand'}</button></h2>
      <div id="sens-body" ${sensOpen ? '' : 'hidden'}>
        <div class="subhead" style="margin-top:0">Total tons by yield change</div>
        <div class="table-scroll" style="margin:0;padding:0"><table id="sens-tons"></table></div>
        <div class="field hint" style="margin-top:6px">Tap a commodity to see its paddocks. Every paddock is
          moved by the same percentage. Nothing here is saved.</div>

        <div class="subhead" style="margin-top:16px">What it does to the farm</div>
        <div class="table-scroll" style="margin:0;padding:0"><table id="sens-steps"></table></div>
        <div class="field hint" style="margin-top:6px">Contracts stay as signed, so a change in yield lands on
          the unsold grain, valued at MTM. "Oversold" is grain contracted that the crop would not cover.</div>
      </div>
    </div>`;
}

function paintSensitivity(root) {
  const card = root.querySelector('#sens-card');
  if (!card) return;
  const { commodities, fields, sales, movements } = db.get();
  const overheads = db.getOverheads();
  const base = positionRows(commodities, fields, sales, movements);

  const cols = STEPS.map((pct) => {
    const rows = positionAtYield(base, pct);
    const t = positionTotals(rows);
    return { pct, rows, t, pl: farmProfitLoss(t.grossMargin, overheads) };
  });
  const cell = (c, text) => `<td${c.pct === 0 ? ' style="font-weight:700"' : ''}>${text}</td>`;

  // ---- tons: commodities down the side, a paddock fold under each ----------
  const tonRows = base.map((r, i) => {
    const paddocks = fields
      .filter((f) => f.commodityId === r.commodity.id)
      .map((f) => ({ f, byStep: STEPS.map((pct) => paddockAtYield(f, movements, r.commodity.mtmPrice, pct)) }))
      .filter((p) => p.byStep[0].baseTons > 0 || p.byStep[0].areaHa > 0);
    const open = openCommodities.has(r.commodity.id);
    const head = `<tr class="sens-commodity"><td>${paddocks.length
      ? `<button type="button" class="link-btn" data-commodity="${esc(r.commodity.id)}" aria-expanded="${open}" style="padding:0;min-height:0;color:inherit;font:inherit;text-align:left">${open ? '▾' : '▸'} ${esc(r.commodity.name)}</button>`
      : esc(r.commodity.name)}</td>${cols.map((c) => cell(c, num(c.rows[i].productionTons, 0))).join('')}</tr>`;
    const kids = paddocks.map(({ f, byStep }) => `<tr class="sens-paddock" data-of="${esc(r.commodity.id)}" ${open ? '' : 'hidden'} style="color:var(--text-dim)">
      <td style="padding-left:18px">${esc(f.name)}</td>${STEPS.map((pct, k) => `<td${pct === 0 ? ' style="font-weight:700"' : ''}>${num(byStep[k].tons, 0)}</td>`).join('')}</tr>`).join('');
    return head + kids;
  }).join('');
  const totalRow = `<tr><td>Total</td>${cols.map((c) => cell(c, num(c.t.productionTons, 0))).join('')}</tr>`;
  card.querySelector('#sens-tons').innerHTML = `<thead><tr><th>Tons</th>${STEPS.map((p) => `<th>${stepLabel(p)}</th>`).join('')}</tr></thead><tbody>${tonRows}</tbody><tfoot>${totalRow}</tfoot>`;

  // ---- money: one row per yield change ------------------------------------
  const asEntered = cols.find((c) => c.pct === 0);
  const delta = (now, was) => {
    const d = now - was;
    return Math.abs(d) < 0.5 ? '' : `<div class="meta" style="color:${d < 0 ? 'var(--danger)' : 'var(--accent-summary)'}">${signed(d, (n) => money(n, 0))}</div>`;
  };
  card.querySelector('#sens-steps').innerHTML = `
    <thead><tr><th>Yield</th><th>Position</th><th>Profit</th><th>Oversold</th></tr></thead>
    <tbody>${cols.map((c) => {
    const oversold = c.rows.reduce((a, r) => a + Math.max(0, -r.unsoldTons), 0);
    return `<tr${c.pct === 0 ? ' style="font-weight:700"' : ''}>
      <td>${stepLabel(c.pct)}</td>
      <td>${money(c.t.totalValue, 0)}${c.pct === 0 ? '' : delta(c.t.totalValue, asEntered.t.totalValue)}</td>
      <td style="color:${c.pl.profitLoss < 0 ? 'var(--danger)' : 'inherit'}">${money(c.pl.profitLoss, 0)}</td>
      <td style="color:${oversold > 0 ? 'var(--danger)' : 'var(--text-dim)'}">${oversold > 0 ? `${num(oversold, 0)} t` : '–'}</td></tr>`;
  }).join('')}</tbody>`;
}

/**
 * Seven columns do not fit a phone, and the one that matters is the middle one.
 * Scroll the table so "as entered" is what is on screen, with the shortfalls
 * just off to the left and the upsides to the right.
 */
function centreAsEntered(card) {
  const box = card.querySelector('#sens-tons')?.parentElement;
  const th = card.querySelector('#sens-tons thead th:nth-child(5)');   // label column, then 3 below, then this
  if (!box || !th || !box.clientWidth) return;
  // The commodity column stays put while the rest scrolls beneath it, so centre
  // within what is left of the width, not the whole box.
  const label = card.querySelector('#sens-tons thead th:first-child').offsetWidth;
  box.scrollLeft = th.offsetLeft - label - (box.clientWidth - label - th.offsetWidth) / 2;
}

/** Fill the card and wire it up once its HTML is in the page. Safe on every repaint. */
export function bindSensitivity(root) {
  const card = root.querySelector('#sens-card');
  if (!card) return;
  paintSensitivity(root);
  centreAsEntered(card);

  card.querySelector('#sens-tons').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-commodity]');
    if (!btn) return;
    const id = btn.dataset.commodity;
    const open = !openCommodities.has(id);
    if (open) openCommodities.add(id); else openCommodities.delete(id);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = `${open ? '▾' : '▸'} ${btn.textContent.slice(2)}`;
    card.querySelectorAll(`.sens-paddock[data-of="${CSS.escape(id)}"]`).forEach((tr) => { tr.hidden = !open; });
    centreAsEntered(card);
  });

  const toggle = card.querySelector('#sens-toggle');
  const body = card.querySelector('#sens-body');
  toggle.addEventListener('click', () => {
    sensOpen = !sensOpen;
    body.hidden = !sensOpen;
    toggle.textContent = sensOpen ? 'Collapse' : 'Expand';
    toggle.setAttribute('aria-expanded', String(sensOpen));
    if (sensOpen) centreAsEntered(card);
  });
}
