// Freight orders: jobs given to carriers, each linked to a buyer's order and its contract.
//
// Opened from the Orders screen and from an order. A freight order is made from the buyer's order, so the tonnes,
// the window, the carrier and where it is going are already filled in; what is added is the rate and the pick up.
// It goes to the carrier as a PDF (shared or emailed) and a copy is filed with the contract. Loads then name the
// freight order they travel on, and the carrier's bill is recorded against it. The arithmetic is in freight.js.

import { db } from '../storage.js?v=397';
import { signToggleHtml, wireSignToggle, signerPickHtml, wireSignerPick } from './signtoggle.js?v=397';
import { signerName } from '../signdoc.js?v=397';
import { addressFields, readAddress, partsOf, joinAddress } from '../address.js?v=397';
import { openSheet, openOver, field, getVal, getNum, confirmDelete, toast, notify } from '../ui.js?v=397';
import { num, money, esc, todayLocal, dmy } from '../fmt.js?v=397';
import { orderTitle } from '../orders.js?v=397';
import { orderDelivery, bookingRows, nilToleranceLines, cleanFreightDetail, freightDetailDefaults, showsRate } from '../orderdetail.js?v=397';
import { activeSales } from '../paidsales.js?v=397';
import {
  BASES, STATE_LABEL, contractFreightNo, freightState, freightOwed, freightTitle, freightDefaults, freightProblems,
  perTonne, rateText, estimatedTotal, windowText, freightOrderPdf,
} from '../freight.js?v=397';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=397';
import { fileSentCopy } from '../sentcopy.js?v=397';
import { movementRow, openMovementSheet } from './movements.js?v=397';
import { openBillSheet, returnToAfterBill } from './payables.js?v=397';

// what the list shows, kept while the app is open
let filterStatus = 'open';   // open | closed | all

const BADGE = { open: 'warn', filled: 'pos', closed: 'muted' };

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

/** The freight orders screen. `onBack` is where Close returns to (the Orders screen, say). */
export function openFreightOrdersSheet({ saleId = '' } = {}) {
  openSheet('Freight orders', (root) => {
    const draw = () => {
      const { sales, movements, commodities } = db.get();
      const list = db.getFreightOrders().filter((f) => !saleId || f.saleId === saleId);
      const payables = db.getPayables();
      const shown = list
        .filter((f) => filterStatus === 'all' || (filterStatus === 'open' ? freightState(f, movements).active : !freightState(f, movements).active))
        .sort((a, b) => String(a.loadBy || '9999').localeCompare(String(b.loadBy || '9999')));
      const open = list.filter((f) => freightState(f, movements).active);
      const left = open.reduce((s, f) => s + freightState(f, movements).left, 0);
      const unbilled = list.reduce((s, f) => s + freightOwed(f, movements, payables).unbilled, 0);

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${num(left, 0)} t</div><div class="l">Still to cart${open.length ? ` (${open.length} job${open.length === 1 ? '' : 's'})` : ''}</div></div>
          <div class="stat"><div class="n">${money(unbilled, 0)}</div><div class="l">Carted, not yet billed</div></div>
        </div>
        <div class="segmented" id="fo-status" style="margin:12px 0 10px">
          ${[['open', 'Open'], ['closed', 'Done'], ['all', 'All']].map(([k, l]) => `<button data-status="${k}" class="${filterStatus === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${list.length ? 'No freight orders match.' : 'No freight orders yet. Make one from a grain order, or add one here.'}</div>` : shown.map((f) => {
          const st = freightState(f, movements);
          const s = sales.find((x) => x.id === f.saleId);
          const o = freightOwed(f, movements, payables);
          return `
          <div class="list-item stack" data-edit-fo="${esc(f.id)}">
            <div class="li-top"><div class="main">${esc(freightTitle(f))}</div><div class="main">${num(st.left, 0)} t left</div></div>
            <div class="meta">${[s ? contractLabel(s, commodities) : '', windowText(f)].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="meta">${esc(rateText(f))}</div>
            <div class="gauge" role="img" aria-label="${Math.round(st.pct * 100)} percent carted"><i style="width:${st.pct * 100}%"></i></div>
            <div class="li-foot"><span class="meta">${num(st.loaded, 1)} of ${num(st.ordered, 1)} t carted${o.unbilled > 0.005 ? ` · ${money(o.unbilled, 0)} not billed` : ''}</span>
              <span class="badges"><span class="badge ${BADGE[st.state]}">${STATE_LABEL[st.state]}</span></span></div>
          </div>`;
        }).join('')}
        <button type="button" class="btn" id="add-fo" style="margin-top:10px">+ Add a freight order</button>`;

      root.querySelector('#fo-status').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { filterStatus = b.dataset.status; draw(); } });
      root.querySelectorAll('[data-edit-fo]').forEach((el) => el.addEventListener('click', () => openFreightOrderSheet(list.find((f) => f.id === el.dataset.editFo))));
      root.querySelector('#add-fo').addEventListener('click', () => openFreightOrderSheet(null, saleId ? { saleId } : {}));
    };
    draw();
  });
}

/** A card of one contract's freight orders for the contract's own sheet, with a way to make a new one from it. */
export function renderContractFreight(container, saleId) {
  if (!container) return;
  const { movements } = db.get();
  const mine = db.getFreightOrders().filter((f) => f.saleId === saleId)
    .sort((a, b) => String(a.loadBy || '9999').localeCompare(String(b.loadBy || '9999')));
  container.className = 'card';
  container.innerHTML = `
    <h2>Freight orders</h2>
    ${mine.length === 0 ? '<div class="empty">No freight orders against this contract yet.</div>' : mine.map((f) => {
      const st = freightState(f, movements);
      return `
      <div class="list-item stack" data-edit-fo="${esc(f.id)}">
        <div class="li-top"><div class="main">${esc(freightTitle(f))}</div><div class="main">${num(st.left, 0)} t left</div></div>
        <div class="li-foot"><span class="meta">${esc(windowText(f)) || 'No window set'}</span>
          <span class="badges"><span class="badge ${st.active ? 'warn' : 'pos'}">${st.active ? 'Open' : 'Done'}</span></span></div>
      </div>`;
    }).join('')}
    <button type="button" class="btn secondary small" id="add-contract-fo" style="margin-top:8px;width:auto">+ Add a freight order</button>`;
  container.querySelectorAll('[data-edit-fo]').forEach((el) => el.addEventListener('click', () => openFreightOrderSheet(mine.find((f) => f.id === el.dataset.editFo))));
  container.querySelector('#add-contract-fo').addEventListener('click', () => openFreightOrderSheet(null, { saleId }));
}

/**
 * One freight order: add it, change it, send it to the carrier, record the carrier's bill.
 * `start` ({saleId, orderId}) says which contract and buyer's order a new one is made from.
 */
export function openFreightOrderSheet(existing, start = {}) {
  const { sales, movements, commodities } = db.get();
  const orders = db.getOrders();
  const all = db.getFreightOrders();
  const payables = db.getPayables();
  if (!sales.length) { notify('Add a contract first. A freight order is made against a contract.'); return; }

  const startOrder = start.orderId ? orders.find((o) => o.id === start.orderId) : null;
  const startSale = sales.find((s) => s.id === (start.saleId || startOrder?.saleId)) || sales[0];
  const carrierEmails = {};
  for (const f of all) if (f.carrier && f.carrierEmail) carrierEmails[f.carrier.trim().toLowerCase()] = f.carrierEmail;
  const make = (sale, order) => freightDefaults({ sale, order, freightOrders: all, carrierEmails, business: db.getBusinessDetails() });
  let d = existing ? { ...existing } : make(startSale, startOrder && startOrder.saleId === startSale.id ? startOrder : null);
  let autoNo = existing ? '' : d.freightNo;   // the number offered, so changing the contract can offer that contract's own, unless it was typed over
  const carriers = [...new Set([
    ...all.map((f) => f.carrier),
    ...orders.map((o) => o.freightCompany),
    ...payables.filter((p) => p.kind === 'freight').map((p) => p.supplier),
  ].map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  openSheet(existing ? 'Freight order' : 'Add a freight order', (root) => {
    const foldOpen = {};
    const isOpen = (k, dflt) => (k in foldOpen ? foldOpen[k] : dflt);
    const paint = () => {
      const sale = sales.find((s) => s.id === d.saleId) || startSale;
      const saleOrders = orders.filter((o) => o.saleId === sale.id);
      const st = existing ? freightState(d, movements) : null;
      const dt = d.detail || {};
      const foldSub = (parts, empty) => esc(parts.filter(Boolean).join(' · ') || empty);
      const lineCount = (s) => String(s || '').split(/\r?\n/).filter((l) => l.trim()).length;
      const nLoads = existing ? movements.filter((m) => m.freightOrderId === existing.id).length : 0;
      const loadsLine = `${nLoads} load${nLoads === 1 ? '' : 's'} so far`;
      // the number is offered as the contract's own (CF-1094-01); an older freight order keeps the one it has until asked
      const base = String(sale.contractNo || sale.ourRef || '').trim();
      const suggested = contractFreightNo(sale, all.filter((f) => f.id !== d.id));
      const numberHint = !base
        ? '<div class="hint" style="margin:-6px 0 10px">Give the contract a number and freight orders are numbered from it (CF-1094-01).</div>'
        : String(d.freightNo || '').startsWith(`${base}-`) ? ''
          : `<div class="hint" style="margin:-6px 0 10px">Not numbered from the contract. <button type="button" class="link-btn" id="fo-renumber">Use ${esc(suggested)}</button></div>`;
      root.innerHTML = `
        <datalist id="dl-carriers">${carriers.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        ${field({ label: 'Contract', id: 'fo-sale', type: 'select', value: d.saleId,
          options: activeSales(sales, [d.saleId]).map((s) => ({ value: s.id, label: contractLabel(s, commodities) })) })}
        <div class="row" style="margin:-4px 0 10px"><span class="label">Contract no.</span><span class="value">${esc(sale.contractNo || 'none on this contract')}</span></div>
        ${field({ label: 'Select grain order', id: 'fo-order', type: 'select', value: d.orderId || '',
          options: [{ value: '', label: 'N/A' }, ...saleOrders.map((o) => ({ value: o.id, label: [orderTitle(o), o.freightCompany].filter(Boolean).join(' · ') }))],
          hint: 'Choosing one fills in most of this order. N/A if there is no grain order.' })}
        ${(() => { const o = orders.find((x) => x.id === d.orderId); return o && (bookingRows(o).length || nilToleranceLines(o.detail).length || o.detail?.booking || o.detail?.comments) ? `<div class="hint" style="margin:-4px 0 10px">Its booking instructions, what is rejected and other terms are filled in below. Change them for the carrier.</div>` : ''; })()}
        ${field({ label: "Buyer's order no.", id: 'fo-boo', value: d.buyerOrderNo || orders.find((o) => o.id === d.orderId)?.orderNo || '', placeholder: "The number on the buyer's order", hint: "Comes from the grain order when you choose one. Type it here if there is none. It is printed on the carrier's copy." })}
        ${existing ? '<div id="fo-progress" style="margin:0 0 12px"></div>' : ''}
        <div class="grid-2">
          ${field({ label: 'Freight order no.', id: 'fo-no', value: d.freightNo })}
          ${field({ label: 'Tonnes to cart', id: 'fo-tons', type: 'number', step: '0.01', value: d.tons ?? '' })}
        </div>
        ${numberHint}
        ${field({ label: 'Carrier', id: 'fo-carrier', value: d.carrier, placeholder: 'Who is carting it', list: 'dl-carriers' })}
        ${field({ label: 'Carrier email (to send it to)', id: 'fo-email', type: 'email', value: d.carrierEmail })}

        <details class="fold feature" data-fold="rate" ${isOpen('rate', !(Number(d.rate) > 0)) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Rate</h2><div class="sub">${esc([Number(d.rate) > 0 ? rateText(d) : 'Not set yet', showsRate(d) ? '' : 'not on the carrier\'s copy'].filter(Boolean).join(' · '))}</div></div></summary>
        <div class="segmented" id="fo-basis" style="margin-bottom:10px">
          ${BASES.map((b) => `<button data-basis="${b.key}" class="${d.rateBasis === b.key ? 'active' : ''}">${esc(b.label)}</button>`).join('')}
        </div>
        ${d.rateBasis === 'flat_tkm' ? field({ label: 'Flat rate ($/t)', id: 'fo-flat', type: 'number', step: '0.01', value: d.flatRate ?? '' }) : ''}
        <div class="grid-2">
          ${field({ label: d.rateBasis === 'per_t' ? 'Rate ($/t)' : 'Rate ($/t/km)', id: 'fo-rate', type: 'number', step: '0.0001', value: d.rate ?? '' })}
          ${d.rateBasis !== 'per_t' ? field({ label: 'Distance (km)', id: 'fo-km', type: 'number', step: '0.1', value: d.distanceKm ?? '' }) : '<div></div>'}
        </div>
        <div class="row"><span class="label">Works out at</span><span class="value" id="fo-calc">-</span></div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:10px"><input type="checkbox" id="fo-showrate" ${showsRate(d) ? 'checked' : ''} style="width:18px;height:18px" /> Show the rate on the carrier's copy</label>
        </details>

        <details class="fold feature" data-fold="job" ${isOpen('job', !(d.pickup && d.deliverTo)) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Pick up and delivery</h2><div class="sub">${esc([d.pickup && d.deliverTo ? 'Addresses filled in' : 'Addresses needed', dt.pickupPhone && `Pick up ${dt.pickupPhone}`, dt.deliverySitePhone && `Delivery ${dt.deliverySitePhone}`, windowText(d)].filter(Boolean).join(' · '))}</div></div></summary>
        <div class="subhead">Pick up from</div>
        ${addressFields('fo-pick', partsOf(d.pickup, d.pickupParts), { label: 'Pick up from' })}
        ${field({ label: 'Pick up phone', id: 'fd-pphone', type: 'tel', value: d.detail?.pickupPhone })}
        <div class="subhead">Deliver to</div>
        ${field({ label: 'Company', id: 'fd-dco', value: d.detail?.deliverCompany, placeholder: 'Who it is delivered to' })}
        ${addressFields('fo-drop', partsOf(d.deliverTo, d.deliverToParts), { label: 'Deliver to' })}
        ${field({ label: 'Delivery phone', id: 'fd-dphone', type: 'tel', value: d.detail?.deliverySitePhone })}
        <div class="grid-2">
          ${field({ label: 'Deliver from (date)', id: 'fo-from', type: 'date', value: d.loadFrom })}
          ${field({ label: 'Deliver to (date)', id: 'fo-by', type: 'date', value: d.loadBy })}
        </div>
        <div class="hint" style="margin:-4px 0 10px">The bookings and who issued the order come from the grain order when you choose one. Check them, change them or clear them.</div>
        ${field({ label: 'Bookings', id: 'fd-bkc', value: d.detail?.bookingContact, placeholder: 'Who to book with, phone or email' })}
        ${field({ label: 'Order issued by', id: 'fd-iss', value: d.detail?.orderIssuedBy })}
        </details>

        <details class="fold" data-fold="carrier" ${isOpen('carrier', false) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>The carrier</h2><div class="sub">${foldSub([dt.carrierAbn && `ABN ${dt.carrierAbn}`, dt.carrierContact, dt.carrierPhone], 'ABN, contact, phone')}</div></div></summary>
        <div class="grid-2">
          ${field({ label: 'Carrier ABN', id: 'fd-abn', value: d.detail?.carrierAbn })}
          ${field({ label: 'Carrier phone', id: 'fd-cphone', type: 'tel', value: d.detail?.carrierPhone })}
        </div>
        ${field({ label: 'Carrier contact', id: 'fd-contact', value: d.detail?.carrierContact, placeholder: 'Who to ring' })}
        </details>

        <details class="fold" data-fold="grain" ${isOpen('grain', false) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>The grain and the terms</h2><div class="sub">${foldSub([dt.variety, dt.paymentTerms], 'Variety, payment terms')}</div></div></summary>
        <div class="grid-2">
          ${field({ label: 'Variety', id: 'fd-variety', value: d.detail?.variety })}
          ${field({ label: 'Payment terms', id: 'fd-terms', value: d.detail?.paymentTerms, placeholder: 'e.g. 30 days end of week' })}
        </div>
        </details>

        <details class="fold" data-fold="notes" ${isOpen('notes', !!d.notes) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Instructions</h2><div class="sub">${foldSub([d.notes && 'Instructions', dt.pickupInstructions && 'Pick up', dt.deliveryInstructions && 'Booking', dt.rejectedOnArrival && `${lineCount(dt.rejectedOnArrival)} rejected`], 'Booking, gate hours, what is rejected, who to call')}</div></div></summary>
        <div class="hint" style="margin:-4px 0 10px">All of this goes on the carrier's copy. What the grain order says is filled in when you choose one. Check it, change it or clear it.</div>
        ${field({ label: 'Instructions', id: 'fo-notes', type: 'textarea', value: d.notes })}
        ${field({ label: 'Pick up instructions', id: 'fd-pins', type: 'textarea', value: d.detail?.pickupInstructions })}
        ${field({ label: 'Booking instructions', id: 'fd-dins', type: 'textarea', value: d.detail?.deliveryInstructions })}
        ${field({ label: 'Rejected on arrival', id: 'fd-rej', type: 'textarea', value: d.detail?.rejectedOnArrival, hint: 'One to a line' })}
        </details>
        ${existing ? `
        <div class="field">
          <label>Status</label>
          <div class="segmented" id="fo-state">
            <button data-state="open" class="${(d.status || 'open') === 'open' ? 'active' : ''}">Open</button>
            <button data-state="closed" class="${d.status === 'closed' ? 'active' : ''}">Done</button>
          </div>
          <div class="hint">Mark it done once the carting is finished. Loads and bills stay linked.</div>
        </div>
        <details class="fold" data-fold="loads" ${isOpen('loads', false) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Loads carted</h2><div class="sub">${esc(loadsLine)}</div></div></summary>
        <div id="fo-loads" style="margin:8px 0"></div>
        </details>` : ''}

        <details class="fold" data-fold="sign" ${isOpen('sign', !!mySig) ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Signing</h2><div class="sub">Sign it, or choose who it is issued by</div></div></summary>
        ${signToggleHtml('fo-sign', 'Sign it with my signature', !!mySig)}
        ${signerPickHtml('fo-signer')}
        </details>
        <div id="fo-problems" class="hint" style="color:var(--danger);margin:8px 0"></div>
        <button class="btn" id="fo-send">${canShareFiles() ? 'Save and send to carrier' : 'Save, download and email'}</button>
        <button class="btn secondary" id="fo-download" style="margin-top:8px">Save and download PDF</button>
        ${existing ? `<button class="btn secondary" id="fo-bill" style="margin-top:8px">Record the carrier's bill&hellip;</button>
        <button class="btn ghost-danger" id="fo-del" style="margin-top:8px">Delete freight order</button>` : ''}
        <div class="save-bar solo"><button class="btn secondary" id="fo-save">Save</button></div>`;

      if (existing) {
        const owed = freightOwed(d, movements, payables);
        root.querySelector('#fo-progress').innerHTML = `
          <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
            <div class="stat"><div class="n">${num(st.loaded, 1)} t</div><div class="l">Carted of ${num(st.ordered, 0)}</div></div>
            <div class="stat"><div class="n">${money(owed.owed, 0)}</div><div class="l">Run up</div></div>
            <div class="stat"><div class="n" ${owed.unbilled > 0.005 ? 'style="color:var(--danger)"' : ''}>${money(owed.unbilled, 0)}</div><div class="l">Not billed</div></div>
          </div>
          <div class="gauge" role="img" aria-label="${Math.round(st.pct * 100)} percent carted"><i style="width:${st.pct * 100}%"></i></div>
          <div class="meta" style="margin-top:4px"><span class="badge ${BADGE[st.state]}">${esc(STATE_LABEL[st.state])}</span>${owed.billed ? ` ${money(owed.billed, 0)} billed so far` : ''}</div>`;
        const { fields, storages } = db.get();
        const against = movements.filter((m) => m.freightOrderId === existing.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        const loadsEl = root.querySelector('#fo-loads');
        loadsEl.innerHTML = `<h2>Loads carted</h2>${against.length
          ? against.map((m) => movementRow(m, { fields, storages, sales, commodities, orders })).join('')
          : '<div class="empty">No loads yet. On a movement going to this contract, choose it under "Carted on".</div>'}`;
        loadsEl.querySelectorAll('[data-edit-movement]').forEach((el) => el.addEventListener('click', () => openOver(() => openMovementSheet(against.find((m) => m.id === el.dataset.editMovement)))));
      }
      wire();
      calc();
    };

    // read what is on the screen back into d
    const collect = () => {
      const val = (id) => getVal(root, id) ?? '';
      d = {
        ...d,
        freightNo: val('fo-no').trim(),
        buyerOrderNo: val('fo-boo').trim(),
        tons: val('fo-tons') === '' ? '' : getNum(root, 'fo-tons'),
        carrier: val('fo-carrier').trim(),
        carrierEmail: val('fo-email').trim(),
        rate: val('fo-rate') === '' ? '' : getNum(root, 'fo-rate'),
        flatRate: root.querySelector('#fo-flat') ? (val('fo-flat') === '' ? '' : getNum(root, 'fo-flat')) : d.flatRate,
        distanceKm: root.querySelector('#fo-km') ? (val('fo-km') === '' ? '' : getNum(root, 'fo-km')) : d.distanceKm,
        pickup: joinAddress(readAddress(root, 'fo-pick')),
        pickupParts: readAddress(root, 'fo-pick'),
        deliverTo: joinAddress(readAddress(root, 'fo-drop')),
        deliverToParts: readAddress(root, 'fo-drop'),
        loadFrom: val('fo-from'),
        loadBy: val('fo-by'),
        notes: val('fo-notes').trim(),
        detail: root.querySelector('#fd-abn') ? cleanFreightDetail({
          carrierAbn: val('fd-abn'), carrierPhone: val('fd-cphone'), carrierContact: val('fd-contact'),
          variety: val('fd-variety'), paymentTerms: val('fd-terms'),
          pickupPhone: val('fd-pphone'), pickupInstructions: val('fd-pins'),
          hideRate: !root.querySelector('#fo-showrate').checked,
          deliverySitePhone: val('fd-dphone'), deliveryInstructions: val('fd-dins'), rejectedOnArrival: val('fd-rej'), bookingContact: val('fd-bkc'), deliverCompany: val('fd-dco'), orderIssuedBy: val('fd-iss'), ownTerms: true,
        }) : d.detail,
      };
    };

    const calc = () => {
      collect();
      const per = perTonne(d);
      const total = estimatedTotal(d);
      root.querySelector('#fo-calc').textContent = per > 0 ? `${money(per, 2)} /t${total > 0 ? ` · about ${money(total, 0)} for ${num(d.tons, 0)} t` : ''}` : '-';
    };

    const wire = () => {
      root.querySelectorAll('details[data-fold]').forEach((el) => el.addEventListener('toggle', () => { foldOpen[el.dataset.fold] = el.open; }));
      root.querySelector('#fo-renumber')?.addEventListener('click', () => {
        collect();
        const sale = sales.find((s) => s.id === d.saleId);
        d.freightNo = contractFreightNo(sale, all.filter((f) => f.id !== d.id));
        autoNo = d.freightNo;
        paint();
      });
      root.querySelector('#fo-sale').addEventListener('change', () => {
        collect();
        const sale = sales.find((s) => s.id === getVal(root, 'fo-sale'));
        if (!existing) { const fresh = make(sale, null); const typedNo = d.freightNo && d.freightNo !== autoNo ? d.freightNo : ''; autoNo = fresh.freightNo; d = { ...fresh, freightNo: typedNo || fresh.freightNo, carrier: d.carrier || fresh.carrier, carrierEmail: d.carrierEmail || fresh.carrierEmail, rateBasis: d.rateBasis, rate: d.rate || fresh.rate, flatRate: d.flatRate, distanceKm: d.distanceKm, pickup: d.pickup, pickupParts: d.pickupParts, notes: d.notes }; }
        else { d.saleId = sale.id; d.orderId = ''; }
        paint();
      });
      root.querySelector('#fo-order').addEventListener('change', () => {
        collect();
        const order = orders.find((o) => o.id === getVal(root, 'fo-order')) || null;
        const sale = sales.find((s) => s.id === d.saleId);
        d.orderId = order?.id || '';
        if (order) {
          const fresh = make(sale, order);
          // the buyer's site, phone and delivery reference come over what is blank; what was typed stays
          const fill = freightDetailDefaults({ order, sale, business: db.getBusinessDetails() }) || {};
          fresh.detail = cleanFreightDetail({ ...fill, ...(fresh.detail || {}), ...Object.fromEntries(Object.entries(d.detail || {}).filter(([, v]) => v)) });
          // the buyer's order fills in what it knows, over what was there; the rate and the pick up stay as typed
          d = { ...d, detail: fresh.detail, buyerOrderNo: fresh.buyerOrderNo || d.buyerOrderNo, tons: fresh.tons, loadFrom: fresh.loadFrom, loadBy: fresh.loadBy, carrier: fresh.carrier || d.carrier, carrierEmail: fresh.carrierEmail || d.carrierEmail, pickup: d.pickup || fresh.pickup, pickupParts: d.pickup ? d.pickupParts : fresh.pickupParts, ...(Number(d.rate) > 0 ? {} : { rate: fresh.rate, rateBasis: fresh.rateBasis, flatRate: fresh.flatRate }), ...(orderDelivery(order).text ? { deliverTo: fresh.deliverTo, deliverToParts: fresh.deliverToParts } : { deliverTo: d.deliverTo || fresh.deliverTo, deliverToParts: d.deliverTo ? d.deliverToParts : fresh.deliverToParts }), notes: d.notes || fresh.notes };
        }
        paint();
      });
      root.querySelectorAll('[data-basis]').forEach((b) => b.addEventListener('click', () => { collect(); d.rateBasis = b.dataset.basis; paint(); }));
      root.querySelector('#fo-carrier').addEventListener('change', () => {
        const email = carrierEmails[getVal(root, 'fo-carrier').trim().toLowerCase()];
        if (email && !getVal(root, 'fo-email')) root.querySelector('#fo-email').value = email;
      });
      ['fo-tons', 'fo-rate', 'fo-km', 'fo-flat'].forEach((id) => root.querySelector(`#${id}`)?.addEventListener('input', calc));
      root.querySelector('#fo-state')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-state]');
        if (!b) return;
        d.status = b.dataset.state;
        root.querySelectorAll('#fo-state button').forEach((x) => x.classList.toggle('active', x === b));
      });
      root.querySelector('#fo-save').addEventListener('click', () => { if (persist(true)) { toast('Saved'); openFreightOrdersSheet(); } });
      wireSignToggle(root, 'fo-sign', (sig) => { mySig = sig; });
      wireSignerPick(root, 'fo-signer', db.getBusinessDetails(), (name) => { printedName = name; });
      root.querySelector('#fo-send').addEventListener('click', () => send(true));
      root.querySelector('#fo-download').addEventListener('click', () => send(false));
      root.querySelector('#fo-bill')?.addEventListener('click', () => recordBill());
      root.querySelector('#fo-del')?.addEventListener('click', () => {
        confirmDelete('Delete this freight order? Loads carted on it and bills for it stay, but no longer name it.', () => { db.deleteFreightOrder(existing.id); openFreightOrdersSheet(); });
      });
    };

    // saves what is on the screen; returns the id, or null when it cannot be saved yet
    let printedName = '';   // the name picked to print as who issued it
    let mySig = null;   // the signed-in person's saved signature, once they tick "sign it"
    let savedId = existing?.id || null;
    function persist(strict) {
      collect();
      const box = root.querySelector('#fo-problems');
      if (!d.saleId) { box.textContent = 'Choose the contract.'; return null; }
      if (strict && !(Number(d.tons) > 0)) { root.querySelector('#fo-tons').focus(); box.textContent = 'Enter the tonnes to cart.'; return null; }
      if (d.loadFrom && d.loadBy && d.loadBy < d.loadFrom) { box.textContent = 'Deliver to date is before deliver from date.'; return null; }
      box.textContent = '';
      savedId = db.upsertFreightOrder({ ...d, id: savedId || undefined, status: d.status || 'open' }) || savedId;
      d.id = savedId;
      return savedId;
    }

    async function send(share) {
      collect();
      const problems = freightProblems(d);
      const box = root.querySelector('#fo-problems');
      if (problems.length) { box.textContent = `Needed before it goes: ${problems.join('; ')}.`; return; }
      if (!persist(true)) return;
      const sale = sales.find((s) => s.id === d.saleId);
      const order = orders.find((o) => o.id === d.orderId) || null;
      const business = db.getBusinessDetails();
      const bytes = freightOrderPdf({
        fo: d, sale, order, business, date: todayLocal(), issuedBy: printedName || signerName(mySig, business), signature: mySig,
        commodityName: commodities.find((c) => c.id === sale?.commodityId)?.name || '',
      });
      const fileName = safeFileName(`Freight order ${d.freightNo || ''} ${dmy(todayLocal())}`);
      const subject = `Freight order ${d.freightNo || ''}${sale?.buyer ? ` - ${sale.buyer}` : ''}`.trim();
      const body = `Hi,\n\nPlease find freight order ${d.freightNo || ''} attached: ${num(d.tons, 0)} t${showsRate(d) ? ` at ${rateText(d)}` : ""}.\n\nPlease quote the order number on your invoice.\n\nRegards,\n${business.contactName || business.entityName || ''}`;
      if (!share) { downloadFile(bytes, fileName); toast('Saved and downloaded'); return; }
      const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: d.carrierEmail, subject, body } });
      if (result === 'cancelled') { toast('Saved'); return; }
      toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
      try {
        await fileSentCopy({ saleId: d.saleId, bytes, fileName, kind: 'freight_order' });
        toast('Copy filed with the contract');
      } catch (e) {
        notify(`It went, but a copy was not filed with the contract: ${e.message}`);
      }
    }

    // the carrier's invoice: pre-filled with what has been carted and not yet billed
    function recordBill() {
      if (!persist(false)) return;
      const o = freightOwed({ ...d, id: existing.id }, db.get().movements, db.getPayables());
      returnToAfterBill(() => openFreightOrderSheet(db.getFreightOrders().find((f) => f.id === existing.id)));
      const per = perTonne(d);
      openBillSheet(null, {
        kind: 'freight', supplier: d.carrier, saleId: d.saleId, freightOrderId: existing.id,
        rate: per || '', tons: per > 0 && o.unbilled > 0 ? Math.round((o.unbilled / per) * 1000) / 1000 : '',
        amount: o.unbilled > 0 ? o.unbilled : '', reference: '',
      });
    }

    paint();
  });
}
