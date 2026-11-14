// Accounts payable: what the farm owes.
//
// Opened from the Sales tab. A list of bills (brokerage, freight, storage at third-party sites, anything else),
// what is unpaid and overdue, and the brokerage that has run up on contracts but has not been billed yet. Each
// bill is recorded in a form of its own. The arithmetic is in payables.js.

import { db } from '../storage.js?v=228';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=228';
import { num, money, esc, shortDate, todayLocal } from '../fmt.js?v=228';
import {
  KINDS, kindLabel, billTotal, gstOn, isOverdue, summarise, brokerageOwed,
} from '../payables.js?v=228';

// what the list shows, kept while the app is open
let filterStatus = 'unpaid';   // unpaid | paid | all
let filterKind = '';

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

/** The Payables screen. */
export function openPayablesSheet() {
  openSheet('Payables', (root) => {
    const draw = () => {
      const { sales, movements, storages, commodities } = db.get();
      const payables = db.getPayables();
      const today = todayLocal();
      const sum = summarise(payables, today);
      const unbilled = sales
        .map((s) => ({ s, o: brokerageOwed(s, movements, payables) }))
        .filter((x) => x.o.unbilled > 0.005);
      const unbilledTotal = round2(unbilled.reduce((a, x) => a + x.o.unbilled, 0));

      const shown = payables
        .filter((p) => filterStatus === 'all' || (filterStatus === 'paid' ? p.status === 'paid' : p.status !== 'paid'))
        .filter((p) => !filterKind || p.kind === filterKind)
        .sort((a, b) => (filterStatus === 'paid'
          ? String(b.paidDate || b.invoiceDate || '').localeCompare(String(a.paidDate || a.invoiceDate || ''))
          : String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))));

      const place = (p) => {
        const s = p.saleId ? sales.find((x) => x.id === p.saleId) : null;
        const loc = p.storageId ? storages.find((x) => x.id === p.storageId) : null;
        return [s ? contractLabel(s, commodities) : '', loc?.name || ''].filter(Boolean).join(' · ');
      };

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${money(sum.unpaid.total, 0)}</div><div class="l">Unpaid${sum.unpaid.count ? ` (${sum.unpaid.count})` : ''}</div></div>
          <div class="stat"><div class="n" ${sum.overdue.count ? 'style="color:var(--danger)"' : ''}>${money(sum.overdue.total, 0)}</div><div class="l">Overdue${sum.overdue.count ? ` (${sum.overdue.count})` : ''}</div></div>
        </div>

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

        <div class="subhead">Bills</div>
        <div class="segmented" id="pay-status" style="margin-bottom:8px">
          ${[['unpaid', 'Unpaid'], ['paid', 'Paid'], ['all', 'All']].map(([k, l]) => `<button data-status="${k}" class="${filterStatus === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        <div class="chips" style="margin-bottom:10px">
          <button type="button" class="chip ${filterKind ? '' : 'active'}" data-kind="">All types</button>
          ${KINDS.map((k) => `<button type="button" class="chip ${filterKind === k.key ? 'active' : ''}" data-kind="${k.key}">${k.label}</button>`).join('')}
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${payables.length ? 'No bills match.' : 'No bills recorded yet.'}</div>` : shown.map((p) => {
          const over = isOverdue(p, today);
          return `
          <div class="list-item stack" data-edit-bill="${esc(p.id)}">
            <div class="li-top"><div class="main">${esc(p.supplier || kindLabel(p.kind))}</div><div class="main">${money(billTotal(p), 2)}</div></div>
            <div class="meta">${[kindLabel(p.kind), p.reference ? `#${p.reference}` : '', p.invoiceDate ? shortDate(p.invoiceDate) : ''].filter(Boolean).map(esc).join(' · ')}</div>
            ${place(p) ? `<div class="meta">${esc(place(p))}</div>` : ''}
            <div class="li-foot"><span class="meta">${p.status === 'paid' ? `Paid ${p.paidDate ? shortDate(p.paidDate) : ''}` : (p.dueDate ? `Due ${shortDate(p.dueDate)}` : 'No due date')}</span>
              <span class="badges"><span class="badge ${p.status === 'paid' ? 'pos' : over ? 'neg' : 'warn'}">${p.status === 'paid' ? 'Paid' : over ? 'Overdue' : 'Unpaid'}</span></span></div>
          </div>`;
        }).join('')}
        <button type="button" class="btn" id="add-bill" style="margin-top:10px">+ Add a bill</button>`;

      root.querySelector('#pay-status').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { filterStatus = b.dataset.status; draw(); } });
      root.querySelectorAll('.chips [data-kind]').forEach((b) => b.addEventListener('click', () => { filterKind = b.dataset.kind; draw(); }));
      root.querySelectorAll('[data-edit-bill]').forEach((el) => el.addEventListener('click', () => openBillSheet(payables.find((p) => p.id === el.dataset.editBill))));
      root.querySelector('#add-bill').addEventListener('click', () => openBillSheet(null));
      root.querySelectorAll('[data-bill-for]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = sales.find((x) => x.id === b.dataset.billFor);
        const o = brokerageOwed(s, movements, payables);
        // the unbilled part: tonnes and rate, so the bill adds up to what is owed
        openBillSheet(null, { kind: 'brokerage', supplier: s.broker || '', saleId: s.id, rate: o.rate, tons: round3(o.unbilled / o.rate), amount: o.unbilled });
      }));
    };
    draw();
  });
}

/** One bill: add it, or change it. `defaults` pre-fills a new one. */
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
      ${field({ label: 'Type', id: 'b-kind', type: 'select', value: src.kind || 'other', options: KINDS.map((k) => ({ value: k.key, label: k.label })) })}
      ${field({ label: 'From', id: 'b-supplier', value: src.supplier, placeholder: 'e.g. the broker, the carrier, GrainCorp', list: 'dl-suppliers' })}
      <div class="grid-2">
        ${field({ label: 'Their invoice no.', id: 'b-ref', value: src.reference })}
        ${field({ label: 'Invoice date', id: 'b-date', type: 'date', value: src.invoiceDate ?? (existing ? '' : today) })}
      </div>
      ${field({ label: 'Due date', id: 'b-due', type: 'date', value: src.dueDate })}
      ${field({ label: 'For a contract', id: 'b-sale', type: 'select', value: src.saleId ?? '', options: [{ value: '', label: 'Not for one contract' }, ...sales.map((s) => ({ value: s.id, label: contractLabel(s, commodities) }))],
        hint: 'Brokerage and freight usually are. A freight bill on a contract replaces its Freight ($/t) estimate for those tonnes.' })}
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
      ${existing ? '<button class="btn ghost-danger" id="b-del" style="margin-top:8px">Delete bill</button>' : ''}
      <div class="save-bar solo"><button class="btn" id="save">Save</button></div>`;

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
        confirmDelete('Delete this bill?', () => { db.deletePayable(existing.id); openPayablesSheet(); });
      });
    }

    root.querySelector('#save').addEventListener('click', () => {
      const amount = getNum(root, 'b-amount');
      if (!(amount > 0)) { amountEl.focus(); return; }
      const tons = getVal(root, 'b-tons');
      const rate = getVal(root, 'b-rate');
      db.upsertPayable({
        id: existing?.id,
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
      });
      toast('Saved');
      openPayablesSheet();
    });
  });
}
