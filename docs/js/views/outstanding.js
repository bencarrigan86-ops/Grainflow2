// Outstanding: grain still to deliver, and money still to come in or go out.
//
// Opened from the Sales tab. Deliveries lists the contracts not yet filled, the ones past or near the end of their
// window first. Money owed lists what buyers owe the farm (unpaid invoices) and what the farm owes (unpaid bills),
// each with due dates, what is overdue and the money by age. The arithmetic is in outstanding.js.

import { canSeeBills, canSeeOrders } from '../nav.js?v=442';
import { db } from '../storage.js?v=442';
import { openSheet, openOver } from '../ui.js?v=442';
import { num, money, esc, shortDate, tightDate, todayLocal, dmy } from '../fmt.js?v=442';
import { deliveries, timeline, uninvoiced, moneyPosition, AGE_BUCKETS, endText, dueText, gather } from '../outstanding.js?v=442';
import { windowText } from '../orders.js?v=442';
import { openOrderSheet } from './orders.js?v=442';
import { openInvoiceListSheet } from './invoice.js?v=442';
import { renderPayables, returnToAfterBill } from './payables.js?v=442';
import { openXeroSheet } from './xero.js?v=442';
import { cashflow } from '../cashflow.js?v=442';
import { deliveryPlan, expectedReceipts } from '../deliveryplan.js?v=442';
import { buyerStatements, statementPdf } from '../statement.js?v=442';
import { buyerExposure } from '../exposure.js?v=442';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=442';
import { exposurePdf } from '../exposurepdf.js?v=442';
import { emailIn } from '../vendordec.js?v=442';
import { invoiceLabel } from '../adjustment.js?v=442';
import { matchesAll, amountText } from '../listsearch.js?v=442';

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

const END_BADGE = { ended: 'neg', soon: 'warn', ok: 'pos', none: 'muted' };
const END_WORD = { ended: 'Past end', soon: 'Ending soon', ok: 'In window', none: 'No end date' };

// which side of the money the sheet shows, and the deliveries filter; kept while the app is open
let scheduleGrain = 'month';     // week | month
let moneySide = 'in';          // in | out | month
let deliveriesFilter = '';     // '' | ended | soon
let deliveriesView = 'timeline'; // timeline | list
let recView = 'unpaid';        // receivables: notinvoiced | unpaid | paid | all
let recCommodity = '';         // receivables: '' (every commodity) or a commodity id
let recQ = '';                 // receivables: the search box

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
      <div class="gantt-key"><span><i class="k-today"></i>Today</span><span><i class="k-tick"></i>Order due</span><span><i class="k-bar"></i>Delivered so far</span><span><i class="k-bar soon"></i>Ends soon</span><span><i class="k-bar ended"></i>Ended</span></div>
      ${tl.unplaced ? `<div class="hint" style="margin-top:6px">${tl.unplaced} contract${tl.unplaced === 1 ? ' has' : 's have'} no delivery dates, so ${tl.unplaced === 1 ? 'it is' : 'they are'} only in the list.</div>` : ''}
    </div>`;
}

/** Grain still to deliver, contract by contract. */
export function openDeliveriesSheet() {
  openSheet('Sales timeline', (root) => {
    const draw = () => {
      const { sales, movements, commodities } = db.get();
      const today = todayLocal();
      const rep = deliveries(sales, movements, db.getOrders(), today);
      const shown = rep.rows.filter((r) => !deliveriesFilter || r.state === deliveriesFilter);
      const plan = deliveryPlan(rep.rows, today, scheduleGrain);
      const canOrder = canSeeOrders(db.getRole());

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${num(rep.total.due, 0)} t</div><div class="l">Still to deliver (${rep.total.count} contract${rep.total.count === 1 ? '' : 's'})</div></div>
          <div class="stat"><div class="n" ${rep.ended.count ? 'style="color:var(--danger)"' : ''}>${num(rep.ended.due, 0)} t</div><div class="l">Past the contract end${rep.ended.count ? ` (${rep.ended.count})` : ''}</div></div>
        </div>
        <div class="row" style="margin-top:8px"><span class="label">Ending within 30 days</span><span class="value">${num(rep.soon.due, 0)} t${rep.soon.count ? ` (${rep.soon.count})` : ''}</span></div>
        ${rep.ordersOverdue ? `<div class="row"><span class="label">Grain orders past their deliver-by date</span><span class="value"><span class="badge neg">${rep.ordersOverdue}</span></span></div>` : ''}
        ${scheduleHtml(plan, rep)}
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
            <div class="meta">${esc(endText(r.daysToEnd))}${patternText(r, plan)}</div>
            <div class="meta">${ord.count ? `${ord.count} open order${ord.count === 1 ? '' : 's'} for ${num(ord.left, 0)} t${ord.nextBy ? `, next due ${esc(shortDate(ord.nextBy))}` : ''}${ord.overdue ? ` (${ord.overdue} overdue)` : ''}` : 'No open orders'}${r.unordered > 0.5 ? ` · ${num(r.unordered, 0)} t not yet ordered` : ''}</div>
            <div class="gauge" role="img" aria-label="${Math.round(pct * 100)} percent delivered"><i style="width:${pct * 100}%"></i></div>
            <div class="li-foot"><span class="badges"><span class="badge ${END_BADGE[r.state]}">${END_WORD[r.state]}</span></span>
              ${canOrder ? `<button type="button" class="btn secondary small" data-add-order="${esc(r.sale.id)}" style="width:auto">Add a grain order</button>` : ''}</div>
          </div>`;
        }).join('')}`;

      root.querySelector('#sched-grain')?.addEventListener('click', (e) => { const b = e.target.closest('[data-grain]'); if (b) { scheduleGrain = b.dataset.grain; draw(); } });
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
/** `side` opens it on that tab: 'in' (receivables) or 'out' (payables); left out, it opens where it was last left. */
export function openMoneySheet(side = null) {
  if (side === 'in' || side === 'out') moneySide = side;
  if (moneySide === 'buyer') moneySide = 'in';
  returnToAfterBill(() => openMoneySheet());
  openSheet('Invoices', (root) => {
    const draw = () => {
      const { sales, commodities, invoices, movements } = db.get();
      const today = todayLocal();
      const pos = moneyPosition(invoices, sales, db.getPayables(), today);
      const unb = uninvoiced(sales, movements, invoices, today);
      const side = moneySide === 'out' ? pos.youOwe : pos.owedToYou;

      root.innerHTML = `
        <div class="segmented" id="money-side" style="margin:0 0 12px">
          <button data-side="in" class="${moneySide === 'in' ? 'active' : ''}">Receivables</button>
          <button data-side="out" class="${moneySide === 'out' ? 'active' : ''}">Payables</button>
          <button data-side="month" class="${moneySide === 'month' ? 'active' : ''}">By month</button>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="n">${money(pos.owedToYou.outstanding.total, 0)}</div><div class="l">Owed to you (${pos.owedToYou.outstanding.count})</div></div>
          <div class="stat"><div class="n">${money(pos.youOwe.outstanding.total, 0)}</div><div class="l">You owe (${pos.youOwe.outstanding.count})</div></div>
        </div>
        <div class="row" style="margin-top:8px"><span class="label"><strong>Net, once both are settled</strong></span><span class="value"><span class="badge ${pos.net >= 0 ? 'pos' : 'neg'}">${money(pos.net, 0)}</span></span></div>
        <div class="row" style="margin-bottom:10px"><span class="label">Overdue to you / overdue by you</span><span class="value"><span ${pos.owedToYou.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(pos.owedToYou.overdue.total, 0)}</span> / <span ${pos.youOwe.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(pos.youOwe.overdue.total, 0)}</span></span></div>
        ${moneySide === 'month' ? cashflowHtml(cashflow(invoices, sales, db.getPayables(), today, 6, expectedReceipts(deliveries(sales, movements, db.getOrders(), today).rows, unb.rows, today))) : moneySide === 'out' ? '<div id="money-bills"></div>' : receivablesHtml({ unb, unpaidRows: side.rows, paidInvoices: invoices.filter((i) => i.status === 'paid' && !i.appliedToInvoice), sales, commodities })}
        ${['owner', 'manager', 'bookkeeper'].includes(db.getRole()) && canSeeBills(db.getRole()) ? '<button type="button" class="btn secondary" id="open-xero" style="margin-top:14px">Export for Xero</button>' : ''}`;

      root.querySelector('#rec-q')?.addEventListener('input', (e) => {
        const at = e.target.selectionStart;
        recQ = e.target.value; draw();
        const box = root.querySelector('#rec-q');
        if (box) { box.focus(); try { box.setSelectionRange(at, at); } catch { /* no caret in some browsers */ } }
      });
      root.querySelector('#rec-view')?.addEventListener('click', (e) => { const b = e.target.closest('[data-rec]'); if (b) { recView = b.dataset.rec; draw(); } });
      root.querySelectorAll('[data-rec-com]').forEach((b) => b.addEventListener('click', () => { recCommodity = b.dataset.recCom; draw(); }));
      root.querySelector('#money-side').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) { moneySide = b.dataset.side; draw(); } });
      root.querySelectorAll('[data-invoice-sale]').forEach((el) => el.addEventListener('click', () => openOver(() => openInvoiceListSheet(sales.find((s) => s.id === el.dataset.invoiceSale)), draw)));
      root.querySelectorAll('[data-open-invoices]').forEach((el) => el.addEventListener('click', () => openOver(() => openInvoiceListSheet(sales.find((s) => s.id === el.dataset.openInvoices)), draw)));
      root.querySelector('#open-xero')?.addEventListener('click', () => openOver(() => openXeroSheet()));
      root.querySelector('#exposure-pdf')?.addEventListener('click', () => exportExposurePdf(buyerExposure(invoices, sales, movements, commodities, today), today));
      root.querySelectorAll('[data-statement]').forEach((b) => b.addEventListener('click', () => sendStatement(b.dataset.statement, { invoices, sales, movements, commodities, today })));
      const bills = root.querySelector('#money-bills');
      if (bills) renderPayables(bills, { stats: false });
    };
    draw();
  });
}

/**
 * MTM, in a report of its own: what each buyer owes now, the grain still to go to them, and how far their contracts sit from the market
 * (the buyer's exposure). A statement can be sent to any buyer who owes, and the whole thing is a PDF.
 */
export function openMtmSheet() {
  openSheet('MTM', (root) => {
    const draw = () => {
      const { sales, commodities, invoices, movements } = db.get();
      const today = todayLocal();
      root.innerHTML = buyersHtml(buyerExposure(invoices, sales, movements, commodities, today), commodities);
      root.querySelectorAll('[data-open-invoices]').forEach((el) => el.addEventListener('click', () => openOver(() => openInvoiceListSheet(sales.find((s) => s.id === el.dataset.openInvoices)), draw)));
      root.querySelector('#exposure-pdf')?.addEventListener('click', () => exportExposurePdf(buyerExposure(invoices, sales, movements, commodities, today), today));
      root.querySelectorAll('[data-statement]').forEach((b) => b.addEventListener('click', () => sendStatement(b.dataset.statement, { invoices, sales, movements, commodities, today })));
    };
    draw();
  });
}

/**
 * What buyers owe, as Payables lays out its bills: pills for what to see (delivered and not invoiced, unpaid, paid, all), and chips to
 * narrow it to one commodity.
 */
function receivablesHtml({ unb, unpaidRows, paidInvoices, sales, commodities }) {
  const comOf = (sale) => sale?.commodityId || '';
  const paid = paidInvoices
    .map((invoice) => ({ invoice, sale: sales.find((s) => s.id === invoice.saleId) }))
    .sort((a, b) => String(b.invoice.paidDate || b.invoice.issueDate || '').localeCompare(String(a.invoice.paidDate || a.invoice.issueDate || '')));
  const showNot = recView === 'notinvoiced' || recView === 'all';
  const showUnpaid = recView === 'unpaid' || recView === 'all';
  const showPaid = recView === 'paid' || recView === 'all';

  // the commodities there is something to show for, in the pills chosen
  const present = new Set([
    ...(showNot ? unb.rows.map((r) => comOf(r.sale)) : []),
    ...(showUnpaid ? unpaidRows.map((r) => comOf(r.sale)) : []),
    ...(showPaid ? paid.map((r) => comOf(r.sale)) : []),
  ]);
  const chips = commodities.filter((c) => present.has(c.id));
  if (recCommodity && !present.has(recCommodity)) recCommodity = '';
  const keep = (sale) => !recCommodity || comOf(sale) === recCommodity;
  // what a row can be found by: the buyer, the commodity and contract, the invoice, and the amount
  const textOf = (sale, extra = '') => [sale?.buyer, commodities.find((c) => c.id === sale?.commodityId)?.name, sale?.contractNo, sale?.grade, extra].join(' ');
  const notInvoiced = unb.rows.filter((r) => keep(r.sale) && matchesAll(textOf(r.sale, amountText(r.value)), recQ));
  const unpaid = unpaidRows.filter((r) => keep(r.sale) && matchesAll(textOf(r.sale, [invoiceLabel(r.invoice), amountText(r.amount)].join(' ')), recQ));
  const paidShown = paid.filter((r) => keep(r.sale) && matchesAll(textOf(r.sale, [invoiceLabel(r.invoice), amountText(r.invoice.totalPayable)].join(' ')), recQ));
  // each row names the buyer first, then the commodity and contract
  const buyerOf = (sale) => (sale ? (sale.buyer || 'No buyer') : 'Unknown contract');
  const aboutOf = (sale) => (sale ? [commodities.find((c) => c.id === sale.commodityId)?.name, sale.contractNo ? `#${sale.contractNo}` : ''].filter(Boolean).join(' · ') : '');
  const band = (i) => `band ${i % 2 ? 'alt' : ''}`;
  const age = gather(unpaid);
  const sub = (text) => (recView === 'all' ? `<div class="subhead" style="margin-top:12px">${text}</div>` : '');
  const none = (text) => `<div class="empty" style="padding:6px 0">${text}</div>`;

  const notHtml = !showNot ? '' : `${sub('Delivered, not yet invoiced')}
    ${notInvoiced.length === 0 ? none('Every delivery is on an invoice.') : `
    <div class="hint" style="margin-bottom:6px">${num(notInvoiced.reduce((s, r) => s + r.tons, 0), 1)} t worth about ${money(notInvoiced.reduce((s, r) => s + r.value, 0), 0)} has gone to buyers with no invoice yet. Tap a contract to invoice it.</div>
    ${notInvoiced.map((r, i) => `
      <div class="list-item stack ${band(i)}" data-invoice-sale="${esc(r.sale.id)}">
        <div class="li-top"><div class="main">${esc(buyerOf(r.sale))}</div><div class="main">${money(r.value, 0)}</div></div>
        <div class="meta">${esc(aboutOf(r.sale))} &middot; ${r.loads.length} load${r.loads.length === 1 ? '' : 's'} &middot; ${num(r.tons, 1)} t not invoiced</div>
        <div class="li-foot"><span class="meta">${r.oldest ? `Oldest ${esc(shortDate(r.oldest))}` : 'No load dates'}</span><span class="badges">${r.days !== null && r.days >= 0 ? `<span class="badge ${r.days > 30 ? 'neg' : r.days > 7 ? 'warn' : 'muted'}">${r.days === 0 ? 'Today' : `${r.days} day${r.days === 1 ? '' : 's'} waiting`}</span>` : ''}</span></div>
      </div>`).join('')}`}`;

  const unpaidHtml = !showUnpaid ? '' : `${sub('Invoices to be paid, oldest due first')}
    ${recView === 'unpaid' && unpaid.length ? `<div class="subhead">By age</div>
    ${AGE_BUCKETS.filter((b) => age.buckets[b.key].count).map((b) => `
      <div class="row"><span class="label">${esc(b.label)} (${age.buckets[b.key].count})</span><span class="value" ${b.key.startsWith('d') ? 'style="color:var(--danger)"' : ''}>${money(age.buckets[b.key].total, 0)}</span></div>`).join('')}
    <div class="subhead" style="margin-top:12px">Invoices to be paid, oldest due first</div>` : ''}
    ${unpaid.length === 0 ? none('No unpaid invoices.') : unpaid.map((r, i) => {
      const badge = r.daysOver === null ? 'muted' : r.overdue ? 'neg' : 'warn';
      return `
      <div class="list-item stack ${band(i)}" ${r.sale ? `data-open-invoices="${esc(r.sale.id)}"` : ''}>
        <div class="li-top"><div class="main">${esc(buyerOf(r.sale))}</div><div class="main">${money(r.amount, 2)}</div></div>
        <div class="meta">${esc([aboutOf(r.sale), invoiceLabel(r.invoice)].filter(Boolean).join(' · '))}${r.invoice.issueDate ? ` · issued ${esc(shortDate(r.invoice.issueDate))}` : ''}</div>
        <div class="li-foot"><span class="meta">${r.dueDate ? `Due ${esc(shortDate(r.dueDate))}` : 'No due date'}</span><span class="badges"><span class="badge ${badge}">${esc(dueText(r.daysOver))}</span></span></div>
      </div>`;
    }).join('')}`;

  const paidHtml = !showPaid ? '' : `${sub('Paid invoices')}
    ${paidShown.length === 0 ? none('No paid invoices.') : paidShown.map((r, i) => `
      <div class="list-item stack ${band(i)}" ${r.sale ? `data-open-invoices="${esc(r.sale.id)}"` : ''}>
        <div class="li-top"><div class="main">${esc(buyerOf(r.sale))}</div><div class="main">${money(r.invoice.totalPayable, 2)}</div></div>
        <div class="meta">${esc([aboutOf(r.sale), invoiceLabel(r.invoice)].filter(Boolean).join(' · '))}${r.invoice.issueDate ? ` · issued ${esc(shortDate(r.invoice.issueDate))}` : ''}</div>
        <div class="li-foot"><span class="meta">${r.invoice.paidDate ? `Paid ${esc(shortDate(r.invoice.paidDate))}` : 'Paid'}</span><span class="badges"><span class="badge pos">Paid</span></span></div>
      </div>`).join('')}`;

  return `
    <div class="filterbar" style="margin-bottom:8px"><input type="search" id="rec-q" placeholder="Search buyer, commodity, contract, invoice, amount" value="${esc(recQ)}" aria-label="Search receivables" /></div>
    <div class="segmented" id="rec-view" style="margin-bottom:8px">
      ${[['notinvoiced', 'Not invoiced'], ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([k, l]) => `<button data-rec="${k}" class="${recView === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    ${chips.length > 1 ? `<div class="chips" style="margin-bottom:10px">
      <button type="button" class="chip ${recCommodity ? '' : 'active'}" data-rec-com="">All commodities</button>
      ${chips.map((c) => `<button type="button" class="chip ${recCommodity === c.id ? 'active' : ''}" data-rec-com="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
    </div>` : ''}
    ${notHtml}${unpaidHtml}${paidHtml}`;
}

/** The next months' money in and out, by the month each falls due, with a running balance. */
function cashflowHtml(cf) {
  const neg = (n) => (n < 0 ? 'style="color:var(--danger)"' : '');
  return `
    <div class="table-scroll"><table class="tight cf">
      <thead>
        <tr><th></th><th colspan="2" style="text-align:center;color:var(--accent-summary);border-bottom:2px solid var(--accent-summary)">Money in</th><th style="text-align:center;color:var(--danger);border-bottom:2px solid var(--danger)">Money out</th><th></th></tr>
        <tr><th style="text-align:left">When</th><th>Invoiced</th><th>Expected</th><th>Bills</th><th>Running</th></tr>
      </thead>
      <tbody>${cf.rows.map((r) => `
        <tr>
          <td style="text-align:left;${r.key === 'overdue' ? 'color:var(--danger);font-weight:600' : ''}">${esc(r.label)}${r.inCount + r.outCount ? `<div class="meta" style="font-size:11px">${r.inCount ? `${r.inCount} invoice${r.inCount === 1 ? '' : 's'}` : ''}${r.inCount && r.outCount ? ', ' : ''}${r.outCount ? `${r.outCount} bill${r.outCount === 1 ? '' : 's'}` : ''}</div>` : ''}</td>
          <td>${r.in ? `<span class="mtm pos">${money(r.in, 0)}</span>` : '&ndash;'}</td>
          <td style="font-style:italic">${r.expected ? `<span class="mtm pos">${money(r.expected, 0)}</span>` : '&ndash;'}</td>
          <td>${r.out ? `<span class="mtm neg">${money(r.out, 0)}</span>` : '&ndash;'}</td>
          <td ${neg(r.balance)}>${money(r.balance, 0)}</td>
        </tr>`).join('')}</tbody>
      <tfoot><tr><td style="text-align:left">Total</td><td>${money(cf.totalIn, 0)}</td><td style="font-style:italic">${money(cf.totalExpected, 0)}</td><td>${money(cf.totalOut, 0)}</td><td ${neg(cf.net)}>${money(cf.net, 0)}</td></tr></tfoot>
    </table></div>
    <div class="hint" style="margin-top:8px">Money in (green) is what buyers pay you: invoiced is already owed to you. Money out (red) is your bills. Expected is a forecast for grain not yet invoiced: what is delivered, what is due to go, and what is ordered, paid on each contract’s terms at the contract price plus GST, before freight, levies and grade adjustments.</div>`;
}

/** The MTM gap in colour: green above zero, red with a minus sign below, plain at zero. */
const mtmHtml = (v) => {
  const r = Math.round(v);
  return r === 0 ? money(0, 0) : `<span class="mtm ${r > 0 ? 'pos' : 'neg'}">${r < 0 ? '-' : ''}${money(Math.abs(r), 0)}</span>`;
};

/**
 * What each buyer could cost the farm: what they owe now (unpaid invoices and grain not yet invoiced), the grain still to go to
 * them and what it is worth, and how far their contracts sit from the market. A statement can be sent to any buyer who owes.
 */
function buyersHtml({ buyers, total, weeks }, commodities) {
  if (!buyers.length) return '<div class="empty" style="padding:6px 0">No buyer owes you anything, and there is no grain still to deliver.</div>';
  const gapNote = total.noMtm ? ` ${total.noMtm} contract${total.noMtm === 1 ? ' has' : 's have'} no MTM price set on the commodity, so ${total.noMtm === 1 ? 'it is' : 'they are'} left out.` : '';
  return `
    <button type="button" class="btn secondary small" id="exposure-pdf" style="margin-bottom:10px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>
    <div class="stat-grid">
      <div class="stat" style="grid-column:1 / -1"><div class="n">${money(total.owing, 0)}</div><div class="l">Owing now · ${total.overdueTotal ? `<span class="mtm neg">${money(total.overdueTotal, 0)} overdue</span>` : 'none overdue'}</div></div>
      <div class="stat"><div class="n">${money(total.unpaidTotal, 0)}</div><div class="l">Invoiced, unpaid</div></div>
      <div class="stat"><div class="n">${money(total.notInvoicedValue, 0)}</div><div class="l">Delivered, not invoiced (${num(total.notInvoicedTons, 0)} t)</div></div>
      <div class="stat"><div class="n">${money(total.dueValue, 0)}</div><div class="l">Still to go (${num(total.dueTons, 0)} t)</div></div>
      <div class="stat"><div class="n">${mtmHtml(total.mtmGap)}</div><div class="l">Contracts vs MTM</div></div>
    </div>
    ${weeks.length ? `
    <div class="subhead" style="margin-top:12px">Invoices due, by week</div>
    <div class="table-scroll" style="margin:0">
      <table class="tight">
        <thead><tr><th>Due</th><th>Invoices</th><th>Amount</th></tr></thead>
        <tbody>
          ${weeks.map((w) => `
            <tr>
              <td>${w.late ? `<span class="mtm neg">${esc(w.label)}</span>` : esc(w.label)}</td>
              <td>${w.count}</td>
              <td>${w.late ? `<span class="mtm neg">${money(w.amount, 0)}</span>` : money(w.amount, 0)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${weeks.reduce((n, w) => n + w.count, 0)}</td>
          <td>${money(total.unpaidTotal, 0)}</td>
        </tr></tfoot>
      </table>
    </div>` : ''}
    <div class="hint" style="margin:8px 0;font-size:12px;color:var(--text-dim)">Owing now is credit already given: invoices not yet paid, plus grain delivered that is not on an invoice. Still to go is the tonnes left on open contracts at the contract price. Against MTM is the contract price less your MTM price over those tonnes: above zero, the contracts are worth more than the market today, which is what you are out if the buyer does not take the grain.${esc(gapNote)}</div>
    ${buyers.map((b) => `
      <div class="list-item stack">
        <div class="li-top"><div class="main">${esc(b.buyer)}</div><div class="main">${money(b.owing, 0)}</div></div>
        <div class="meta">${b.unpaidCount ? `${b.unpaidCount} unpaid invoice${b.unpaidCount === 1 ? '' : 's'} · ${money(b.unpaidTotal, 0)}` : 'No unpaid invoices'}${b.notInvoicedValue ? ` · ${num(b.notInvoicedTons, 1)} t not invoiced · ${money(b.notInvoicedValue, 0)}` : ''}</div>
        ${b.nextDue ? `<div class="meta">Next payment: ${money(b.nextDue.amount, 0)} due ${esc(shortDate(b.nextDue.date))}</div>` : ''}
        <div class="meta">${b.dueTons > 0 ? `To go: ${num(b.dueTons, 0)} t on ${b.contracts} contract${b.contracts === 1 ? '' : 's'} · ${money(b.dueValue, 0)}${b.contracts > b.noMtm ? ` · <strong>${mtmHtml(b.mtmGap)} vs MTM</strong>` : ' · no MTM price set'}` : 'Nothing left to deliver'}</div>
        <div class="li-foot"><span class="badges">${b.overdueTotal ? `<span class="badge neg">${money(b.overdueTotal, 0)} overdue</span>` : '<span class="badge muted">None overdue</span>'}${b.share >= 0.005 ? `<span class="badge muted">${Math.round(b.share * 100)}% of what is owed</span>` : ''}</span>
          ${b.owing > 0 ? `<button type="button" class="btn secondary small" data-statement="${esc(b.key)}">Send statement</button>` : ''}</div>
      </div>`).join('')}`;
}

/** The buyer exposure as a PDF: shared where the phone can share, downloaded elsewhere. */
async function exportExposurePdf(exposure, today) {
  const biz = db.getBusinessDetails();
  const bytes = exposurePdf(exposure, { business: biz.entityName || biz.farmName || '', today: dmy(today) });
  const name = safeFileName(`Buyer exposure ${dmy(today)}`);
  if (!canShareFiles()) { downloadFile(bytes, name); return; }
  await sharePdf(bytes, name, { title: 'Buyer exposure' });
}

/** Makes the buyer's statement as a PDF and sends it on: the share sheet on a phone, a download and an email on a computer. */
async function sendStatement(key, { invoices, sales, movements, commodities, today }) {
  const st = buyerStatements(invoices, sales, movements, today).find((b) => b.key === key);
  if (!st) return;
  const biz = db.getBusinessDetails();
  const bytes = statementPdf(st, { businessName: biz.entityName || biz.farmName || '', abn: biz.abn || '', today, contractName: (s) => contractLabel(s, commodities) });
  const to = emailIn(sales.find((s) => String(s.buyer || '').trim().toLowerCase() === key && emailIn(s.buyerContact))?.buyerContact) || '';
  await sharePdf(bytes, `Statement ${st.buyer} ${today}`, {
    title: `Statement from ${biz.entityName || biz.farmName || 'us'}`, text: `Statement for ${st.buyer}, ${today}.`,
    mail: { to, subject: `Statement for ${st.buyer} as at ${today}`, body: 'Please find our statement attached.' },
  });
}

/** How a contract is delivered, and for an even one the weekly or monthly rate: " · spread evenly, about 30 t a week". */
function patternText(r, plan) {
  const pc = plan.perContract.get(r.sale.id);
  if (!pc || !pc.pattern) return '';
  if (pc.pattern === 'call') return ' · buyer calls it';
  return pc.spread ? ` · spread evenly, about ${num(pc.perWeek, 0)} t a week (${num(pc.perMonth, 0)} t a month)` : ' · spread evenly';
}

/** When the grain still to deliver is due to go: tonnes a week or a month, from the even contracts and the open orders. */
function scheduleHtml(plan, rep) {
  if (!plan.periods.length && !plan.overdue.tons && !plan.unscheduled.tons) return '';
  const anySet = rep.rows.some((r) => r.sale.deliveryPattern);
  const sum = (k) => plan.periods.reduce((a, p) => a + p[k], 0);
  const rows = plan.periods.map((p) => `<tr><td style="text-align:left">${esc(p.label)}</td><td>${p.even ? num(p.even, 0) : '&ndash;'}</td><td>${p.ordered ? num(p.ordered, 0) : '&ndash;'}</td><td><strong>${num(p.total, 0)}</strong></td></tr>`).join('');
  return `
    <div class="subhead" style="margin-top:14px">When it is due to go (tonnes)</div>
    <div class="segmented" id="sched-grain" style="margin:6px 0 8px">
      <button data-grain="week" class="${scheduleGrain === 'week' ? 'active' : ''}">Weekly</button>
      <button data-grain="month" class="${scheduleGrain === 'month' ? 'active' : ''}">Monthly</button>
    </div>
    ${plan.periods.length ? `<div class="table-scroll"><table>
      <thead><tr><th style="text-align:left">${scheduleGrain === 'week' ? 'Week' : 'Month'}</th><th>Spread evenly</th><th>Ordered</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td style="text-align:left">Total dated</td><td>${num(sum('even'), 0)}</td><td>${num(sum('ordered'), 0)}</td><td>${num(sum('total'), 0)}</td></tr></tfoot>
    </table></div>` : '<div class="empty" style="padding:6px 0">Nothing has a date yet.</div>'}
    ${plan.overdue.tons ? `<div class="row"><span class="label">Was due before today</span><span class="value" style="color:var(--danger)">${num(plan.overdue.tons, 0)} t (${plan.overdue.contracts})</span></div>` : ''}
    ${plan.unscheduled.tons ? `<div class="row"><span class="label">No date yet (not ordered)</span><span class="value">${num(plan.unscheduled.tons, 0)} t (${plan.unscheduled.contracts})</span></div>` : ''}
    <div class="hint" style="margin-top:6px">${anySet ? 'A contract that is spread evenly is carted evenly from today to the end of its window. A contract the buyer calls is dated by its open grain orders.' : 'Set how each contract is delivered on the contract (the buyer calls it, or spread evenly over the window) and the weekly or monthly tonnes appear here.'}</div>`;
}
