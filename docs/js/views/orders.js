// Orders: what buyers have asked us to deliver, against which contract, and how much of each is still to go.
//
// Opened from the Sales tab. Each order is one contract's request: the tonnes, the window to deliver in, who is
// carting it and the buyer's own order number. Everything else about the sale is the contract's and is shown from it.
// Loads are matched to an order on the movement. The arithmetic is in orders.js.

import { db } from '../storage.js?v=238';
import { openSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=238';
import { num, esc, shortDate, tightDate, todayLocal } from '../fmt.js?v=238';
import { movementTonsToSale } from '../derived.js?v=238';
import { movementRow, openMovementSheet } from './movements.js?v=238';
import { openVendorDecSheet } from './vendordec.js?v=238';
import { attachmentsHtml, wireAttachments } from './attachments.js?v=238';
import { openFreightOrdersSheet, openFreightOrderSheet } from './freightorders.js?v=238';
import { freightTitle, freightState, rateText } from '../freight.js?v=238';
import { orderState, summarise, windowText, orderTitle, STATE_LABEL } from '../orders.js?v=238';

// what the list shows, kept while the app is open
let filterStatus = 'open';   // open | filled | closed | all

const BADGE = { open: 'pos', soon: 'warn', overdue: 'neg', upcoming: 'muted', filled: 'pos', closed: 'muted' };

const contractLabel = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

/** The Orders screen. */
export function openOrdersSheet() {
  openSheet('Orders', (root) => {
    const draw = () => {
      const { sales, movements, commodities } = db.get();
      const orders = db.getOrders();
      const today = todayLocal();
      const sum = summarise(orders, movements, today);
      const stateOf = (o) => orderState(o, movements, today);

      const shown = orders
        .filter((o) => {
          const st = stateOf(o);
          if (filterStatus === 'all') return true;
          if (filterStatus === 'open') return st.active;
          return st.state === filterStatus;
        })
        .sort((a, b) => (filterStatus === 'open' || filterStatus === 'all'
          ? String(a.deliverBy || '9999').localeCompare(String(b.deliverBy || '9999'))
          : String(b.deliverBy || b.deliverFrom || '').localeCompare(String(a.deliverBy || a.deliverFrom || ''))));

      root.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="n">${num(sum.open.left, 0)} t</div><div class="l">To deliver${sum.open.count ? ` (${sum.open.count} order${sum.open.count === 1 ? '' : 's'})` : ''}</div></div>
          <div class="stat"><div class="n" ${sum.overdue.count ? 'style="color:var(--danger)"' : ''}>${num(sum.overdue.left, 0)} t</div><div class="l">Overdue${sum.overdue.count ? ` (${sum.overdue.count})` : ''}</div></div>
        </div>
        <div class="segmented" id="ord-status" style="margin:12px 0 10px">
          ${[['open', 'Open'], ['filled', 'Filled'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button data-status="${k}" class="${filterStatus === k ? 'active' : ''}">${l}</button>`).join('')}
        </div>
        ${shown.length === 0 ? `<div class="empty" style="padding:10px 0">${orders.length ? 'No orders match.' : 'No orders yet. Add one when a buyer sends you an order against a contract.'}</div>` : shown.map((o) => {
          const st = stateOf(o);
          const s = sales.find((x) => x.id === o.saleId);
          const win = windowText(o, tightDate);
          return `
          <div class="list-item stack" data-edit-order="${esc(o.id)}">
            <div class="li-top"><div class="main">${esc(s ? contractLabel(s, commodities) : 'Unknown contract')}</div><div class="main">${num(st.left, 0)} t left</div></div>
            <div class="meta">${[orderTitle(o), win].filter(Boolean).map(esc).join(' · ')}</div>
            ${o.freightCompany ? `<div class="meta">Freight: ${esc(o.freightCompany)}</div>` : ''}
            <div class="gauge" role="img" aria-label="${Math.round(st.pct * 100)} percent delivered"><i style="width:${st.pct * 100}%"></i></div>
            <div class="li-foot"><span class="meta">${num(st.delivered, 1)} of ${num(st.ordered, 1)} t delivered${st.over ? ` (${num(st.over, 1)} t over)` : ''}</span>
              <span class="badges"><span class="badge ${BADGE[st.state]}">${STATE_LABEL[st.state]}</span></span></div>
          </div>`;
        }).join('')}
        <button type="button" class="btn" id="add-order" style="margin-top:10px">+ Add an order</button>
        <button type="button" class="btn secondary" id="open-freight" style="margin-top:8px">Freight orders${db.getFreightOrders().filter((f) => freightState(f, movements).active).length ? ` &middot; ${db.getFreightOrders().filter((f) => freightState(f, movements).active).length} open` : ''}</button>`;

      root.querySelector('#ord-status').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) { filterStatus = b.dataset.status; draw(); } });
      root.querySelectorAll('[data-edit-order]').forEach((el) => el.addEventListener('click', () => openOrderSheet(orders.find((o) => o.id === el.dataset.editOrder))));
      root.querySelector('#add-order').addEventListener('click', () => openOrderSheet(null));
      root.querySelector('#open-freight').addEventListener('click', () => openFreightOrdersSheet());
    };
    draw();
  });
}

/** A card of one contract's orders for the contract's own sheet: what is ordered, delivered and left, with a way in. */
export function renderContractOrders(container, saleId) {
  if (!container) return;
  const { movements } = db.get();
  const today = todayLocal();
  const mine = db.getOrders().filter((o) => o.saleId === saleId)
    .sort((a, b) => String(a.deliverBy || '9999').localeCompare(String(b.deliverBy || '9999')));
  container.className = 'card';
  container.innerHTML = `
    <h2>Orders</h2>
    ${mine.length === 0 ? '<div class="empty">No orders against this contract yet.</div>' : mine.map((o) => {
      const st = orderState(o, movements, today);
      return `
      <div class="list-item stack" data-edit-order="${esc(o.id)}">
        <div class="li-top"><div class="main">${esc(orderTitle(o))}</div><div class="main">${num(st.left, 0)} t left</div></div>
        <div class="li-foot"><span class="meta">${[windowText(o, tightDate), o.freightCompany].filter(Boolean).map(esc).join(' · ') || 'No window set'}</span>
          <span class="badges"><span class="badge ${BADGE[st.state]}">${STATE_LABEL[st.state]}</span></span></div>
      </div>`;
    }).join('')}
    <button type="button" class="btn secondary small" id="add-contract-order" style="margin-top:8px;width:auto">+ Add an order</button>`;
  container.querySelectorAll('[data-edit-order]').forEach((el) => el.addEventListener('click', () => openOrderSheet(mine.find((o) => o.id === el.dataset.editOrder))));
  container.querySelector('#add-contract-order').addEventListener('click', () => openOrderSheet(null, { saleId }));
}

/** One order: add it, or change it. `defaults` pre-fills a new one (the contract, say). */
export function openOrderSheet(existing, defaults = {}) {
  const { sales, movements, commodities } = db.get();
  const orders = db.getOrders();
  const src = existing || defaults;
  const today = todayLocal();
  const companies = [...new Set([
    ...orders.map((o) => o.freightCompany),
    ...db.getPayables().filter((p) => p.kind === 'freight').map((p) => p.supplier),
  ].map((x) => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  // newest contracts last in the data, so list them as the Sales tab does: by buyer
  const contracts = [...sales].sort((a, b) => contractLabel(a, commodities).localeCompare(contractLabel(b, commodities)));

  openSheet(existing ? 'Edit order' : 'Add an order', (root) => {
    root.innerHTML = `
      <datalist id="dl-freightcos">${companies.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      ${field({ label: 'Contract', id: 'o-sale', type: 'select', value: src.saleId ?? '',
        options: [{ value: '', label: contracts.length ? 'Choose the contract' : 'No contracts yet. Add one in Sales' }, ...contracts.map((s) => ({ value: s.id, label: contractLabel(s, commodities) }))] })}
      <div id="o-contract" class="hint" style="margin:-4px 0 12px"></div>
      ${existing ? '<div id="o-progress" style="margin:0 0 12px"></div>' : ''}
      <div class="grid-2">
        ${field({ label: 'Tonnes ordered', id: 'o-tons', type: 'number', step: '0.01', value: src.tons ?? '' })}
        ${field({ label: "Buyer's order no.", id: 'o-no', value: src.orderNo })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Deliver from', id: 'o-from', type: 'date', value: src.deliverFrom })}
        ${field({ label: 'Deliver by', id: 'o-by', type: 'date', value: src.deliverBy })}
      </div>
      ${field({ label: 'Freight company', id: 'o-freight', value: src.freightCompany, placeholder: 'Who is carting it', list: 'dl-freightcos' })}
      ${field({ label: 'Comments', id: 'o-notes', type: 'textarea', value: src.notes, hint: 'Booking, truck type, gate hours, anything the buyer asked for' })}
      ${existing ? `
      <div class="field">
        <label>Status</label>
        <div class="segmented" id="o-status">
          <button data-status="open" class="${(src.status || 'open') === 'open' ? 'active' : ''}">Open</button>
          <button data-status="closed" class="${src.status === 'closed' ? 'active' : ''}">Closed</button>
        </div>
        <div class="hint">Close an order the buyer cancelled or took less than they ordered. It fills by itself once all the tonnes are delivered.</div>
      </div>
      <div id="o-loads" class="card" style="margin:12px 0"></div>
      <div id="o-fos" class="card" style="margin:12px 0"></div>
      <button type="button" class="btn secondary" id="o-vendordec" style="margin-bottom:8px">Vendor declaration&hellip;</button>
      ` : ''}
      ${attachmentsHtml('order', src.documents || [], { sub: "The buyer's order and anything else that came with it" })}
      ${existing ? '<button class="btn ghost-danger" id="o-del" style="margin-top:8px">Delete order</button>' : ''}
      <div class="save-bar solo"><button class="btn" id="save">Save</button></div>`;
    // a new order has no id yet, so one is minted up front and the files wait here until Save
    const recId = existing?.id || crypto.randomUUID();
    const att = wireAttachments(root, {
      parentType: 'order', parentId: recId, docs: existing?.documents || [],
      persist: existing ? (documents) => db.upsertOrder({ id: existing.id, documents }) : undefined,
    });

    // What the contract says, shown here so the order does not repeat it
    const infoEl = root.querySelector('#o-contract');
    const showContract = () => {
      const s = sales.find((x) => x.id === getVal(root, 'o-sale'));
      if (!s) { infoEl.innerHTML = ''; return; }
      const c = commodities.find((cc) => cc.id === s.commodityId);
      const delivered = movementTonsToSale(s.id, movements);
      const window = windowText({ deliverFrom: s.deliveryStart, deliverBy: s.deliveryEnd }, tightDate);
      const grade = s.gradeOptions?.length ? `${s.gradeOptions.length} grades (multigrade)` : s.grade;
      const lines = [
        [c?.name, s.buyer].filter(Boolean).join(' · '),
        [s.contractNo ? `Contract #${s.contractNo}` : '', grade ? `Grade ${grade}` : ''].filter(Boolean).join(' · '),
        s.location ? `Delivery: ${s.location}` : '',
        window ? `Contract window ${window}` : '',
        `${num(delivered, 1)} of ${num(s.tons, 1)} t delivered, ${num(Math.max(0, (Number(s.tons) || 0) - delivered), 1)} t to go on the contract`,
      ].filter(Boolean);
      infoEl.innerHTML = lines.map(esc).join('<br>');
    };
    root.querySelector('#o-sale').addEventListener('change', showContract);
    showContract();

    if (existing) {
      const progressEl = root.querySelector('#o-progress');
      const st = orderState(existing, movements, today);
      progressEl.innerHTML = `
        <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="stat"><div class="n">${num(st.ordered, 0)} t</div><div class="l">Ordered</div></div>
          <div class="stat"><div class="n">${num(st.delivered, 1)} t</div><div class="l">Delivered</div></div>
          <div class="stat"><div class="n" ${st.state === 'overdue' ? 'style="color:var(--danger)"' : ''}>${num(st.left, 1)} t</div><div class="l">Balance to go${st.over ? ` (${num(st.over, 1)} t over)` : ''}</div></div>
        </div>
        <div class="gauge" role="img" aria-label="${Math.round(st.pct * 100)} percent delivered"><i style="width:${st.pct * 100}%"></i></div>
        <div class="meta" style="margin-top:4px"><span class="badge ${BADGE[st.state]}">${esc(STATE_LABEL[st.state])}</span></div>`;
      // the loads put against it, newest first; tapping one opens it
      const { fields, storages } = db.get();
      const against = movements.filter((m) => m.orderId === existing.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const loadsEl = root.querySelector('#o-loads');
      loadsEl.innerHTML = `<h2>Related movements</h2>${against.length
        ? against.map((m) => movementRow(m, { fields, storages, sales, commodities, orders })).join('')
        : '<div class="empty">No loads against it yet. On a movement going to this contract, choose it under "Fills order".</div>'}`;
      loadsEl.querySelectorAll('[data-edit-movement]').forEach((el) => el.addEventListener('click', () => openMovementSheet(against.find((m) => m.id === el.dataset.editMovement))));
      // the freight orders made from it, with a way to make another
      const fosEl = root.querySelector('#o-fos');
      const mine = db.getFreightOrders().filter((f) => f.orderId === existing.id);
      fosEl.innerHTML = `<h2>Freight orders</h2>${mine.length ? mine.map((f) => {
        const fst = freightState(f, movements);
        return `<div class="list-item stack" data-edit-fo="${esc(f.id)}"><div class="li-top"><div class="main">${esc(freightTitle(f))}</div><div class="main">${num(fst.left, 0)} t left</div></div><div class="meta">${esc(rateText(f))}</div></div>`;
      }).join('') : '<div class="empty">No freight order for this order yet.</div>'}
        <button type="button" class="btn secondary small" id="o-make-fo" style="margin-top:8px;width:auto">+ Make a freight order</button>`;
      fosEl.querySelectorAll('[data-edit-fo]').forEach((el) => el.addEventListener('click', () => openFreightOrderSheet(mine.find((f) => f.id === el.dataset.editFo))));
      fosEl.querySelector('#o-make-fo').addEventListener('click', () => openFreightOrderSheet(null, { orderId: existing.id }));
      let status = existing.status || 'open';
      root.querySelector('#o-status').addEventListener('click', (e) => {
        const b = e.target.closest('[data-status]');
        if (!b) return;
        status = b.dataset.status;
        root.querySelectorAll('#o-status button').forEach((x) => x.classList.toggle('active', x === b));
      });
      root.querySelector('#o-vendordec').addEventListener('click', () => openVendorDecSheet({ orderId: existing.id }));
      root.querySelector('#o-del').addEventListener('click', () => {
        confirmDelete('Delete this order? Loads delivered against it stay, but are no longer against an order.', () => { db.deleteOrder(existing.id); openOrdersSheet(); });
      });
      root.querySelector('#save').addEventListener('click', () => save(status));
    } else {
      root.querySelector('#save').addEventListener('click', () => save('open'));
    }

    function save(status) {
      const saleId = getVal(root, 'o-sale');
      if (!saleId) { root.querySelector('#o-sale').focus(); return; }
      const tons = getNum(root, 'o-tons');
      if (!(tons > 0)) { root.querySelector('#o-tons').focus(); return; }
      const from = getVal(root, 'o-from');
      const by = getVal(root, 'o-by');
      if (from && by && by < from) { root.querySelector('#o-by').focus(); toast('Deliver by is before deliver from'); return; }
      db.upsertOrder({
        id: recId,
        documents: att.docs(),
        saleId,
        orderNo: getVal(root, 'o-no')?.trim(),
        tons,
        deliverFrom: from,
        deliverBy: by,
        freightCompany: getVal(root, 'o-freight')?.trim(),
        status,
        notes: getVal(root, 'o-notes')?.trim(),
      });
      toast('Saved');
      openOrdersSheet();
    }
  });
}
