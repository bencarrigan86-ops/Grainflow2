// Outstanding: grain still to deliver, and money still to come in or go out.
//
// Opened from the Sales tab. Deliveries lists the contracts not yet filled, the ones past or near the end of their
// window first. Money owed lists what buyers owe the farm (unpaid invoices) and what the farm owes (unpaid bills),
// each with due dates, what is overdue and the money by age. The arithmetic is in outstanding.js.

import { db } from '../storage.js?v=235';
import { openSheet } from '../ui.js?v=235';
import { num, money, esc, shortDate, tightDate, todayLocal } from '../fmt.js?v=235';
import { deliveries, timeline, uninvoiced, moneyPosition, AGE_BUCKETS, endText, dueText } from '../outstanding.js?v=235';
import { windowText } from '../orders.js?v=235';
import { openOrderSheet } from './orders.js?v=235';
import { openInvoiceListSheet } from './invoice.js?v=235';
import { renderPayables, returnToAfterBill } from './payables.js?v=235';

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

const END_BADGE = { ended: 'neg', soon: 'warn', ok: 'pos', none: 'muted' };
const END_WORD = { ended: 'Past end', soon: 'Ending soon', ok: 'In window', none: 'No end date' };

// which side of the money the sheet shows, and the deliveries filter; kept while the app is open
let moneySide = 'in';          // in | out
let deliveriesFilter = '';     // '' | ended | soon
let deliveriesView = 'timeline'; // timeline | list

/** The Gantt-style chart: a bar per contract on one time axis, filled by what has been delivered. */
function timelineHtml(shown, commodities, today) {
  const tl = timeline(shown, today);
  if (!tl) return '<div class="empty" style="padding:10px 0">None of these contracts has a delivery window to draw.</div>';
  const grid = tl.months.map((m) => `<i class="gantt-grid" style="left:${m.pct.toFixed(2)}%"></i>`).join('');
  return `
    <div class="gantt">
      <div class="gantt-axis">${tl.months.map((m) => `<span style="left:${m.pct.toFixed(2)}%">${esc(m.label)}</span>`).join('')}</div>
      ${tl.bars.map((b) => {
        const r = b.row;
        return `
        <div class="gantt-row ${r.state}">
          <div class="gantt-top"><span class="gantt-name">${esc(contractLabel(r.sale, commodities))}</span><span class="gantt-left">${num(r.due, 0)} t left</span></div>
          <div class="gantt-track" role="img" aria-label="${esc(contractLabel(r.sale, commodities))}: ${num(r.delivered, 0)} of ${num(r.tons, 0)} tonnes delivered, ${esc(endText(r.daysToEnd))}">
            ${grid}
            <i class="gantt-today" style="left:${tl.todayPct.toFixed(2)}%"></i>
            <span class="gantt-bar${b.openEnded ? ' open' : ''}" style="left:${b.left.toFixed(2)}%;width:${b.width.toFixed(2)}%"><b style="width:${b.fill.toFixed(1)}%"></b></span>
            ${b.ticks.map((t) => `<i class="gantt-tick${t.overdue ? ' over' : ''}" style="left:${t.pct.toFixed(2)}%" title="Order due, ${num(t.left, 0)} t left"></i>`).join('')}
          </div>
          <div class="gantt-sub">${r.end ? `${esc(shortDate(r.end))} &middot; ${esc(endText(r.daysToEnd).toLowerCase())}` : 'No end date'}${r.orders.count ? ` &middot; ${r.orders.count} order${r.orders.count === 1 ? '' : 's'}` : ''}</div>
        </div>`;
      }).join('')}
      <div class="gantt-key"><span><i class="k-today"></i>Today</span><span><i class="k-tick"></i>Order due</span><span><i class="k-fill"></i>Delivered</span></div>
      ${tl.unplaced ? `<div class="hint" style="margin-top:6px">${tl.unplaced} contract${tl.unplaced === 1 ? ' has' : 's have'} no delivery dates, so ${tl.unplaced === 1 ? 'it is' : 'they are'} only in the list.</div>` : ''}
    </div>`;
}

/** Grain still to deliver, contract by contract. */
export function openDeliveriesSheet() {
  openSheet('Deliveries to go', (root) => {
    const draw = () => {
      const { sales, movements, commodities } = db.get();
      const today = todayLocal();
      const rep = deliveries(sales, movements, db.getOrders(), today);
      const shown = rep.rows.filter((r) => !deliveriesFilter || r.state === deliveriesFilter);
      const canOrder = ['owner', 'manager', 'bookkeeper'].includes(db.getRole());

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${num(rep.total.due, 0)} t</div><div class="l">Still to deliver (${rep.total.count} contract${rep.total.count === 1 ? '' : 's'})</div></div>
          <div class="stat"><div class="n" ${rep.ended.count ? 'style="color:var(--danger)"' : ''}>${num(rep.ended.due, 0)} t</div><div class="l">Past the contract end${rep.ended.count ? ` (${rep.ended.count})` : ''}</div></div>
        </div>
        <div class="row" style="margin-top:8px"><span class="label">Ending within 30 days</span><span class="value">${num(rep.soon.due, 0)} t${rep.soon.count ? ` (${rep.soon.count})` : ''}</span></div>
        ${rep.ordersOverdue ? `<div class="row"><span class="label">Orders past their deliver-by date</span><span class="value"><span class="badge neg">${rep.ordersOverdue}</span></span></div>` : ''}
        <div class="chips" style="margin:12px 0 10px">
          ${[['', 'All'], ['ended', 'Past end'], ['soon', 'Ending soon']].map(([k, l]) => `<button type="button" class="chip ${deliveriesFilter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
        </div>
        <div class="segmented" id="deliv-view" style="margin-bottom:10px">
          <button data-view="timeline" class="${deliveriesView === 'timeline' ? 'active' : ''}">Timeline</button>
          <button data-view="list" class="${deliveriesView === 'list' ? 'active' : ''}">List</button>
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${rep.rows.length ? 'Nothing matches.' : 'Every contract is filled.'}</div>` : deliveriesView === 'timeline' ? timelineHtml(shown, commodities, today) : shown.map((r) => {
          const pct = r.tons > 0 ? Math.min(1, r.delivered / r.tons) : 0;
          const ord = r.orders;
          return `
          <div class="list-item stack">
            <div class="li-top"><div class="main">${esc(contractLabel(r.sale, commodities))}</div><div class="main">${num(r.due, 0)} t left</div></div>
            <div class="meta">${num(r.delivered, 0)} of ${num(r.tons, 0)} t delivered${windowText({ deliverFrom: r.start, deliverBy: r.end }, tightDate) ? ` · window ${esc(windowText({ deliverFrom: r.start, deliverBy: r.end }, tightDate))}` : ''}</div>
            <div class="meta">${esc(endText(r.daysToEnd))}</div>
            <div class="meta">${ord.count ? `${ord.count} open order${ord.count === 1 ? '' : 's'} for ${num(ord.left, 0)} t${ord.nextBy ? `, next due ${esc(shortDate(ord.nextBy))}` : ''}${ord.overdue ? ` (${ord.overdue} overdue)` : ''}` : 'No open orders'}${r.unordered > 0.5 ? ` · ${num(r.unordered, 0)} t not yet ordered` : ''}</div>
            <div class="gauge" role="img" aria-label="${Math.round(pct * 100)} percent delivered"><i style="width:${pct * 100}%"></i></div>
            <div class="li-foot"><span class="badges"><span class="badge ${END_BADGE[r.state]}">${END_WORD[r.state]}</span></span>
              ${canOrder ? `<button type="button" class="btn secondary small" data-add-order="${esc(r.sale.id)}" style="width:auto">Add an order</button>` : ''}</div>
          </div>`;
        }).join('')}`;

      root.querySelector('#deliv-view').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { deliveriesView = b.dataset.view; draw(); } });
      root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { deliveriesFilter = b.dataset.filter; draw(); }));
      root.querySelectorAll('[data-add-order]').forEach((b) => b.addEventListener('click', () => openOrderSheet(null, { saleId: b.dataset.addOrder })));
    };
    draw();
  });
}

/**
 * Receivables and payables in one place: what buyers owe the farm (unpaid invoices) and what the farm owes (bills),
 * with due dates. The toggle picks the side; Payables is the full bills screen (paid, types, brokerage not yet billed,
 * add a bill).
 */
export function openMoneySheet() {
  returnToAfterBill(() => openMoneySheet());
  openSheet('Receivables & payables', (root) => {
    const draw = () => {
      const { sales, commodities, invoices, movements } = db.get();
      const today = todayLocal();
      const pos = moneyPosition(invoices, sales, db.getPayables(), today);
      const unb = uninvoiced(sales, movements, invoices, today);
      const side = moneySide === 'out' ? pos.youOwe : pos.owedToYou;

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${money(pos.owedToYou.outstanding.total, 0)}</div><div class="l">Owed to you (${pos.owedToYou.outstanding.count})</div></div>
          <div class="stat"><div class="n">${money(pos.youOwe.outstanding.total, 0)}</div><div class="l">You owe (${pos.youOwe.outstanding.count})</div></div>
        </div>
        <div class="row" style="margin-top:8px"><span class="label"><strong>Net, once both are settled</strong></span><span class="value"><span class="badge ${pos.net >= 0 ? 'pos' : 'neg'}">${money(pos.net, 0)}</span></span></div>
        <div class="row"><span class="label">Overdue to you / overdue by you</span><span class="value"><span ${pos.owedToYou.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(pos.owedToYou.overdue.total, 0)}</span> / <span ${pos.youOwe.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(pos.youOwe.overdue.total, 0)}</span></span></div>
        <div class="segmented" id="money-side" style="margin:12px 0 10px">
          <button data-side="in" class="${moneySide === 'in' ? 'active' : ''}">Receivables</button>
          <button data-side="out" class="${moneySide === 'out' ? 'active' : ''}">Payables</button>
        </div>
        ${moneySide === 'out' ? '<div id="money-bills"></div>' : `
        <div class="subhead">Delivered, not yet invoiced</div>
        ${unb.rows.length === 0 ? '<div class="empty" style="padding:6px 0">Every delivery is on an invoice.</div>' : `
        <div class="hint" style="margin-bottom:6px">${num(unb.total.tons, 1)} t worth about ${money(unb.total.value, 0)} has gone to buyers with no invoice yet. Tap a contract to invoice it.</div>
        ${unb.rows.map((r) => `
          <div class="list-item stack" data-invoice-sale="${esc(r.sale.id)}">
            <div class="li-top"><div class="main">${esc(contractLabel(r.sale, commodities))}</div><div class="main">${money(r.value, 0)}</div></div>
            <div class="meta">${r.loads.length} load${r.loads.length === 1 ? '' : 's'} &middot; ${num(r.tons, 1)} t not invoiced</div>
            <div class="li-foot"><span class="meta">${r.oldest ? `Oldest ${esc(shortDate(r.oldest))}` : 'No load dates'}</span><span class="badges">${r.days !== null && r.days >= 0 ? `<span class="badge ${r.days > 30 ? 'neg' : r.days > 7 ? 'warn' : 'muted'}">${r.days === 0 ? 'Today' : `${r.days} day${r.days === 1 ? '' : 's'} waiting`}</span>` : ''}</span></div>
          </div>`).join('')}`}
        <div class="subhead" style="margin-top:12px">By age</div>
        ${AGE_BUCKETS.filter((b) => side.buckets[b.key].count).map((b) => `
          <div class="row"><span class="label">${esc(b.label)} (${side.buckets[b.key].count})</span><span class="value" ${b.key.startsWith('d') ? 'style="color:var(--danger)"' : ''}>${money(side.buckets[b.key].total, 0)}</span></div>`).join('') || '<div class="empty" style="padding:6px 0">Nothing outstanding.</div>'}
        <div class="subhead" style="margin-top:12px">Invoices to be paid, oldest due first</div>
        ${side.rows.length === 0 ? '<div class="empty" style="padding:6px 0">None.</div>' : side.rows.map((r) => {
          const badge = r.daysOver === null ? 'muted' : r.overdue ? 'neg' : 'warn';
          return `
          <div class="list-item stack" ${r.sale ? `data-open-invoices="${esc(r.sale.id)}"` : ''}>
            <div class="li-top"><div class="main">${esc(r.sale ? contractLabel(r.sale, commodities) : 'Unknown contract')}</div><div class="main">${money(r.amount, 2)}</div></div>
            <div class="meta">Invoice #${esc(r.invoice.invoiceNo ?? '')}${r.invoice.issueDate ? ` · issued ${esc(shortDate(r.invoice.issueDate))}` : ''}</div>
            <div class="li-foot"><span class="meta">${r.dueDate ? `Due ${esc(shortDate(r.dueDate))}` : 'No due date'}</span><span class="badges"><span class="badge ${badge}">${esc(dueText(r.daysOver))}</span></span></div>
          </div>`;
        }).join('')}`}`;

      root.querySelector('#money-side').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { moneySide = b.dataset.side; draw(); } });
      root.querySelectorAll('[data-invoice-sale]').forEach((el) => el.addEventListener('click', () => openInvoiceListSheet(sales.find((s) => s.id === el.dataset.invoiceSale))));
      root.querySelectorAll('[data-open-invoices]').forEach((el) => el.addEventListener('click', () => openInvoiceListSheet(sales.find((s) => s.id === el.dataset.openInvoices))));
      const bills = root.querySelector('#money-bills');
      if (bills) renderPayables(bills, { stats: false });
    };
    draw();
  });
}
