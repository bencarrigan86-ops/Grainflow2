// Accounts payable: what the farm owes.
//
// Opened from the Sales tab. A list of bills (brokerage, freight, storage at third-party sites, anything else),
// what is unpaid and overdue, and the brokerage that has run up on contracts but has not been billed yet. Each
// bill is recorded in a form of its own. The arithmetic is in payables.js.

import { db } from '../storage.js?v=500';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=500';
import { num, money, esc, shortDate, todayLocal } from '../fmt.js?v=500';
import {
  KINDS, kindLabel, billTotal, gstOn, isOverdue, summarise, brokerageOwed, paidByBuyer,
} from '../payables.js?v=500';
import { attachmentsHtml, wireAttachments } from './attachments.js?v=500';
import { activeSales } from '../paidsales.js?v=500';
import { freightOwed, freightTitle, perTonne, rateText } from '../freight.js?v=500';
import { ginOffsetOptions, ginBillTotal, ginBillTakenOff } from '../ginoffset.js?v=500';
import { matchesAll, amountText } from '../listsearch.js?v=500';

// what the list shows, kept while the app is open
let filterStatus = 'unpaid';   // unpaid | paid | all
let filterKind = '';
let filterQ = '';              // the search box

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** What a gin bill the lint buyer pays has had taken off lint invoices so far, and what is still to come off. */
function takenOffText(p) {
  const { movements, invoices } = db.get();
  const open = ginOffsetOptions({ payables: [p], invoices: invoices || [], movements: movements || [] })[0];
  const total = ginBillTotal(p);
  const taken = open ? open.takenElsewhere : total;
  return taken > 0 ? `${money(taken, 2)} taken off lint invoices · ${money(open ? open.outstanding : 0, 2)} still to take off` : 'The lint buyer pays it: take it off a lint invoice';
}

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

// Where saving or deleting a bill goes back to: the Payables screen, unless the combined Receivables & payables
// screen opened the bill and asked to be returned to.
let returnTo = null;
export function returnToAfterBill(fn) { returnTo = fn || null; }
const backToList = () => (returnTo || openPayablesSheet)();

/** The Payables screen on its own. */
export function openPayablesSheet() {
  returnTo = null;
  openSheet('Payables', (root) => renderPayables(root));
}

/**
 * Draws the bills into `root` and keeps them up to date as the person filters and edits. Used on its own by
 * openPayablesSheet and as one side of the Receivables & payables screen, which shows its own totals
 * (`opts.stats = false`).
 */
export function renderPayables(root, opts = {}) {
  {
    const draw = () => {
      const { sales, movements, storages, commodities } = db.get();
      // a gin bill the lint invoices have taken off in full is settled, even if it has not been marked so yet
      const { invoices: allInvoices, movements: allMovements } = db.get();
      const payables = db.getPayables().map((p) => (p.status !== 'paid' && ginBillTakenOff(p, allInvoices, allMovements) ? { ...p, status: 'paid' } : p));
      const today = todayLocal();
      const sum = summarise(payables, today);
      const unbilled = sales
        .map((s) => ({ s, o: brokerageOwed(s, movements, payables) }))
        .filter((x) => x.o.unbilled > 0.005);
      const unbilledTotal = round2(unbilled.reduce((a, x) => a + x.o.unbilled, 0));
      // freight carted on a freight order and not yet billed by the carrier: owed, before the invoice arrives
      const freightUnbilled = db.getFreightOrders()
        .map((f) => ({ f, o: freightOwed(f, movements, payables) }))
        .filter((x) => x.o.unbilled > 0.005);
      const freightUnbilledTotal = round2(freightUnbilled.reduce((a, x) => a + x.o.unbilled, 0));

      const placeOf = (p) => {
        const s = p.saleId ? sales.find((x) => x.id === p.saleId) : null;
        const loc = p.storageId ? storages.find((x) => x.id === p.storageId) : null;
        return [s ? contractLabel(s, commodities) : '', loc?.name || ''].filter(Boolean).join(' · ');
      };
      const shown = payables
        .filter((p) => filterStatus === 'all' || (filterStatus === 'paid' ? p.status === 'paid' : p.status !== 'paid'))
        .filter((p) => !filterKind || p.kind === filterKind)
        .filter((p) => matchesAll([p.supplier, kindLabel(p.kind), p.reference, p.notes, placeOf(p), amountText(billTotal(p))].join(' '), filterQ))
        .sort((a, b) => (filterStatus === 'paid'
          ? String(b.paidDate || b.invoiceDate || '').localeCompare(String(a.paidDate || a.invoiceDate || ''))
          : String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))));

      const place = placeOf;

      root.innerHTML = `
        ${opts.stats === false ? '' : `<div class="stat-grid">
          <div class="stat"><div class="n">${money(sum.unpaid.total, 0)}</div><div class="l">Unpaid${sum.unpaid.count ? ` (${sum.unpaid.count})` : ''}</div></div>
          <div class="stat"><div class="n" ${sum.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(sum.overdue.total, 0)}</div><div class="l">Overdue${sum.overdue.count ? ` (${sum.overdue.count})` : ''}</div></div>
        </div>`}

        ${unbilled.length ? `
        <div class="subhead">Brokerage not yet billed</div>
        <div class="hint" style="margin-bottom:6px">Run up on the tonnes delivered, at each contract's $/t. Record the broker's bill when it arrives.</div>
        ${unbilled.map(({ s, o }) => `
          <div class="list-item stack">
            <div class="li-top"><div class="main">${esc(contractLabel(s, commodities))}</div><div class="main">${money(o.unbilled, 0)}</div></div>
            <div class="meta">${num(o.tons, 1)} t delivered at ${money(o.rate, 2)}/t${o.billed ? ` · ${money(o.billed, 0)} billed already` : ''}</div>
            <div class="li-foot"><span class="meta">${s.broker ? esc(s.broker) : 'No broker named'}</span>
              <button type="button" class="btn secondary small" data-bill-for="${esc(s.id)}" style="width:auto">Record bill</button></div>
          </div>`).join('')}
        <div class="row" style="margin:4px 0 8px"><span class="label">Not yet billed, all contracts</span><span class="value">${money(unbilledTotal, 0)}</span></div>` : ''}

        ${freightUnbilled.length ? `
        <div class="subhead">Freight not yet billed</div>
        <div class="hint" style="margin-bottom:6px">Carted on freight orders, at each order's rate. Record the carrier's bill when it arrives.</div>
        ${freightUnbilled.map(({ f, o }) => {
          const s = sales.find((x) => x.id === f.saleId);
          return `
          <div class="list-item stack">
            <div class="li-top"><div class="main">${esc(freightTitle(f))}</div><div class="main">${money(o.unbilled, 0)}</div></div>
            <div class="meta">${num(o.tons, 1)} t carted · ${esc(rateText(f))}${o.billed ? ` · ${money(o.billed, 0)} billed already` : ''}</div>
            <div class="li-foot"><span class="meta">${s ? esc(contractLabel(s, commodities)) : ''}</span>
              <button type="button" class="btn secondary small" data-bill-freight="${esc(f.id)}" style="width:auto">Record bill</button></div>
          </div>`;
        }).join('')}
        <div class="row" style="margin:4px 0 8px"><span class="label">Freight not yet billed</span><span class="value">${money(freightUnbilledTotal, 0)}</span></div>` : ''}

        <div class="subhead">Bills</div>
        <div class="filterbar" style="margin-bottom:8px"><input type="search" id="pay-q" placeholder="Search supplier, reference, contract, amount" value="${esc(filterQ)}" aria-label="Search bills" /></div>
        <div class="segmented" id="pay-status" style="margin-bottom:8px">
          ${[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([k, l]) => `<button data-status="${k}" class="${filterStatus === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <div class="chips" style="margin-bottom:10px">
          <button type="button" class="chip ${filterKind ? '' : 'active'}" data-kind="">All types</button>
          ${KINDS.map((k) => `<button type="button" class="chip ${filterKind === k.key ? 'active' : ''}" data-kind="${k.key}">${k.label}</button>`).join('')}
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${payables.length ? 'No bills match.' : 'No bills recorded yet.'}</div>` : shown.map((p, i) => {
          const viaBuyer = paidByBuyer(p);
          const over = !viaBuyer && isOverdue(p, today);
          return `
          <div class="list-item stack band ${i % 2 ? 'alt' : ''}" data-edit-bill="${esc(p.id)}">
            <div class="li-top"><div class="main">${esc(p.supplier || kindLabel(p.kind))}</div><div class="main">${money(billTotal(p), 2)}</div></div>
            <div class="meta">${[kindLabel(p.kind), p.reference ? `#${p.reference}` : '', p.invoiceDate ? shortDate(p.invoiceDate) : ''].filter(Boolean).map(esc).join(' · ')}</div>
            ${place(p) ? `<div class="meta">${esc(place(p))}</div>` : ''}
            <div class="li-foot"><span class="meta">${p.status === 'paid' ? viaBuyer ? `Taken off the lint invoices${p.paidDate ? ` · ${shortDate(p.paidDate)}` : ''}` : `Paid ${p.paidDate ? shortDate(p.paidDate) : ''}` : viaBuyer ? takenOffText(p) : (p.dueDate ? `Due ${shortDate(p.dueDate)}` : 'No due date')}</span>
              <span class="badges"><span class="badge ${p.status === 'paid' ? 'pos' : over ? 'neg' : 'warn'}">${p.status === 'paid' ? (viaBuyer ? 'Taken off' : 'Paid') : over ? 'Overdue' : viaBuyer ? 'Buyer pays' : 'Unpaid'}</span></span></div>
          </div>`;
        }).join('')}
        <button type="button" class="btn" id="add-bill" style="margin-top:10px">+ Add a bill</button>`;

      root.querySelector('#pay-q')?.addEventListener('input', (e) => {
        const at = e.target.selectionStart;
        filterQ = e.target.value; draw();
        const box = root.querySelector('#pay-q');
        if (box) { box.focus(); try { box.setSelectionRange(at, at); } catch { /* a search box has no caret in some browsers */ } }
      });
      root.querySelector('#pay-status').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { filterStatus = b.dataset.status; draw(); } });
      root.querySelectorAll('.chips [data-kind]').forEach((b) => b.addEventListener('click', () => { filterKind = b.dataset.kind; draw(); }));
      root.querySelectorAll('[data-edit-bill]').forEach((el) => el.addEventListener('click', () => openBillSheet(payables.find((p) => p.id === el.dataset.editBill))));
      root.querySelector('#add-bill').addEventListener('click', () => openBillSheet(null));
      root.querySelectorAll('[data-bill-freight]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = db.getFreightOrders().find((x) => x.id === b.dataset.billFreight);
        const o = freightOwed(f, movements, payables);
        const per = perTonne(f);
        // the unbilled part: tonnes and rate, so the bill adds up to what is owed
        openBillSheet(null, { kind: 'freight', supplier: f.carrier, saleId: f.saleId, freightOrderId: f.id, rate: per || '', tons: per > 0 ? round3(o.unbilled / per) : '', amount: o.unbilled });
      }));
      root.querySelectorAll('[data-bill-for]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = sales.find((x) => x.id === b.dataset.billFor);
        const o = brokerageOwed(s, movements, payables);
        // the unbilled part: tonnes and rate, so the bill adds up to what is owed
        openBillSheet(null, { kind: 'brokerage', supplier: s.broker || '', saleId: s.id, rate: o.rate, tons: round3(o.unbilled / o.rate), amount: o.unbilled });
      }));
    };
    draw();
  }
}

/**One bill: add it, or change it. `defaults` pre-fills a new one. */
export function openBillSheet(existing, defaults = {}) {
  const { sales, storages, commodities } = db.get();
  const payables = db.getPayables();
  const src = existing || defaults;
  const suppliers = [...new Set([
    ...payables.map((p) => p.supplier),
    ...sales.map((s) => s.broker),
    ...storages.filter((s) => s.offFarm).map((s) => s.offFarm.operator),
  ].map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const locations = storages.filter((s) => s.offFarm);
  const today = todayLocal();

  openSheet(existing ? 'Edit bill' : 'Add a bill', (root) => {
    root.innerHTML = `
      <datalist id="dl-suppliers">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <div class="grid-2">
        ${field({ label: 'Type', id: 'b-kind', type: 'select', value: src.kind || 'other', options: KINDS.map((k) => ({ value: k.key, label: k.label })) })}
        ${field({ label: 'Due date', id: 'b-due', type: 'date', value: src.dueDate })}
      </div>
      ${field({ label: 'From', id: 'b-supplier', value: src.supplier, placeholder: 'e.g. the broker, the carrier, GrainCorp', list: 'dl-suppliers' })}
      <div class="grid-2">
        ${field({ label: 'Their invoice no.', id: 'b-ref', value: src.reference })}
        ${field({ label: 'Invoice date', id: 'b-date', type: 'date', value: src.invoiceDate ?? (existing ? '' : today) })}
      </div>
      ${field({ label: 'For a contract', id: 'b-sale', type: 'select', value: src.saleId ?? '', options: [{ value: '', label: 'Not for one contract' }, ...activeSales(sales, [src.saleId]).map((s) => ({ value: s.id, label: contractLabel(s, commodities) }))],
        hint: "Brokerage and freight usually are. A freight bill replaces the contract's Freight ($/t) estimate." })}
      <div id="b-loc-wrap">
        ${field({ label: 'Storage location', id: 'b-loc', type: 'select', value: src.storageId ?? '', options: [{ value: '', label: 'Not for one location' }, ...locations.map((s) => ({ value: s.id, label: s.name }))] })}
      </div>
      <div class="subhead">Amount</div>
      <div class="grid-2">
        ${field({ label: 'Tonnes (optional)', id: 'b-tons', type: 'number', step: '0.01', value: src.tons ?? '' })}
        ${field({ label: 'Rate ($/t, optional)', id: 'b-rate', type: 'number', step: '0.01', value: src.rate ?? '' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Amount ex GST ($)', id: 'b-amount', type: 'number', step: '0.01', value: src.amount ?? '', hint: 'Fills from tonnes × rate if you give both' })}
        ${field({ label: 'GST ($)', id: 'b-gst', type: 'number', step: '0.01', value: src.gst ?? '' })}
      </div>
      <div class="row"><span class="label"><strong>Total to pay</strong></span><span class="value" id="b-total" style="font-size:20px">—</span></div>
      <div class="field" style="margin-top:12px">
        <label>Status</label>
        <div class="segmented" id="b-status">
          <button data-status="unpaid" class="${(src.status || 'unpaid') === 'unpaid' ? 'active' : ''}">Unpaid</button>
          <button data-status="paid" class="${src.status === 'paid' ? 'active' : ''}">Paid</button>
        </div>
      </div>
      <div id="b-paid-wrap" ${src.status === 'paid' ? '' : 'hidden'}>${field({ label: 'Paid on', id: 'b-paid', type: 'date', value: src.paidDate || today })}</div>
      ${field({ label: 'Comments', id: 'b-notes', type: 'textarea', value: src.notes })}
      ${attachmentsHtml('payable', src.documents || [], { sub: "The supplier's bill, a receipt, anything that backs it up" })}
      ${existing ? '<button class="btn ghost-danger" id="b-del" style="margin-top:8px">Delete bill</button>' : ''}
      <div class="save-bar solo"><button class="btn" id="save">Save</button></div>`;
    // a new bill has no id yet, so one is minted up front and the files wait here until Save
    const recId = existing?.id || crypto.randomUUID();
    const att = wireAttachments(root, {
      parentType: 'payable', parentId: recId, docs: existing?.documents || [],
      persist: existing ? (documents) => db.upsertPayable({ id: existing.id, documents }) : undefined,
    });

    const amountEl = root.querySelector('#b-amount');
    const gstEl = root.querySelector('#b-gst');
    // Amount and GST fill themselves until you type in them. A bill being edited starts as the person left it.
    let amountAuto = !existing || !existing.amount;
    let gstAuto = !existing || !existing.gst;
    const showTotal = () => { root.querySelector('#b-total').textContent = money(round2(getNum(root, 'b-amount') + getNum(root, 'b-gst')), 2); };
    const fromTonsAndRate = () => {
      const t = getNum(root, 'b-tons');
      const r = getNum(root, 'b-rate');
      if (amountAuto && t > 0 && r > 0) amountEl.value = round2(t * r);
    };
    const fillGst = () => { if (gstAuto) gstEl.value = getNum(root, 'b-amount') > 0 ? gstOn(getNum(root, 'b-amount')) : ''; };
    root.querySelector('#b-tons').addEventListener('input', () => { fromTonsAndRate(); fillGst(); showTotal(); });
    root.querySelector('#b-rate').addEventListener('input', () => { fromTonsAndRate(); fillGst(); showTotal(); });
    amountEl.addEventListener('input', () => { amountAuto = false; fillGst(); showTotal(); });
    gstEl.addEventListener('input', () => { gstAuto = false; showTotal(); });
    if (!existing && src.amount && !src.gst) fillGst();
    showTotal();

    // the storage location only matters for a storage fee
    const locWrap = root.querySelector('#b-loc-wrap');
    const syncKind = () => { locWrap.hidden = getVal(root, 'b-kind') !== 'storage' || locations.length === 0; };
    root.querySelector('#b-kind').addEventListener('change', syncKind);
    syncKind();

    let status = src.status || 'unpaid';
    root.querySelector('#b-status').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      status = b.dataset.status;
      root.querySelectorAll('#b-status button').forEach((x) => x.classList.toggle('active', x === b));
      root.querySelector('#b-paid-wrap').hidden = status !== 'paid';
    });

    if (existing) {
      root.querySelector('#b-del').addEventListener('click', () => {
        confirmDelete('Delete this bill?', () => { db.deletePayable(existing.id); backToList(); });
      });
    }

    root.querySelector('#save').addEventListener('click', () => {
      const amount = getNum(root, 'b-amount');
      if (!(amount > 0)) { amountEl.focus(); return; }
      const tons = getVal(root, 'b-tons');
      const rate = getVal(root, 'b-rate');
      db.upsertPayable({
        id: recId,
        documents: att.docs(),
        kind: getVal(root, 'b-kind'),
        supplier: getVal(root, 'b-supplier')?.trim(),
        reference: getVal(root, 'b-ref')?.trim(),
        invoiceDate: getVal(root, 'b-date'),
        dueDate: getVal(root, 'b-due'),
        amount: round2(amount),
        gst: round2(getNum(root, 'b-gst')),
        saleId: getVal(root, 'b-sale') || null,
        storageId: getVal(root, 'b-kind') === 'storage' ? (getVal(root, 'b-loc') || null) : null,
        tons: tons === '' ? '' : getNum(root, 'b-tons'),
        rate: rate === '' ? '' : getNum(root, 'b-rate'),
        status,
        paidDate: status === 'paid' ? (getVal(root, 'b-paid') || today) : '',
        notes: getVal(root, 'b-notes')?.trim(),
        ...(src.freightOrderId ? { freightOrderId: src.freightOrderId } : {}),
      });
      toast('Saved');
      backToList();
    });
  });
}
