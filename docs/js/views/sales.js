import { db } from '../storage.js?v=44';
import { salesByCommodity, saleEconomics, contractTolerance, movementTonsToSale, DEFAULT_TOLERANCE_PCT, DEFAULT_TOLERANCE_CAP_TONS } from '../derived.js?v=44';
import { num, tons, money, esc } from '../fmt.js?v=44';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=44';
import { renderRelatedMovements } from './movements.js?v=44';
import { openInvoiceListSheet } from './invoice.js?v=44';

let unsub = null;

export function renderSales(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, sales, movements } = db.get();
  const rollup = salesByCommodity(commodities, sales, movements).filter((r) => r.contractCount > 0);
  const groups = groupSalesByCommodity(commodities, sales, movements);
  const salesTotals = rollup.reduce((acc, r) => ({
    tons: acc.tons + r.tons,
    tonsDue: acc.tonsDue + Math.max(0, r.tonsDue),
    totalValue: acc.totalValue + r.totalValue,
  }), { tons: 0, tonsDue: 0, totalValue: 0 });
  salesTotals.avgPrice = salesTotals.tons > 0 ? salesTotals.totalValue / salesTotals.tons : 0;

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Sales</h1>
        <div class="sub">Contracts, rolled up by commodity</div>
      </div>
    </div>
    <div class="view">
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        ${rollup.length === 0 ? `<div class="empty">No sales entered yet.</div>` : `
        <div class="table-scroll">
          <table>
            <thead><tr><th>Commodity</th><th>Sold</th><th>Undelivered</th><th>Avg $/t</th><th>Total $</th></tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr>
                  <td>${esc(r.commodity.name)}</td>
                  <td>${num(r.tons, 1)}</td>
                  <td>${num(Math.max(0, r.tonsDue), 1)}</td>
                  <td>${num(r.avgPrice, 2)}</td>
                  <td>${num(r.totalValue, 0)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td>${num(salesTotals.tons, 1)}</td>
              <td>${num(salesTotals.tonsDue, 1)}</td>
              <td>${num(salesTotals.avgPrice, 2)}</td>
              <td>${num(salesTotals.totalValue, 0)}</td>
            </tr></tfoot>
          </table>
        </div>`}
      </div>

      <div class="card input">
        <h2><span class="dot input"></span>Contracts</h2>
        ${groups.length === 0 ? `<div class="empty">Tap + to add your first sale.</div>` : groups.map((g) => `
          <div class="group-label"><span>${esc(g.name)}</span><span class="n">${money(g.totalValue, 0)}</span></div>
          ${g.sales.map((s) => saleRow(s, movements)).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-sale">+</button>
  `;

  root.querySelectorAll('[data-edit-sale]').forEach((el) => {
    el.addEventListener('click', () => openSaleSheet(sales.find((s) => s.id === el.dataset.editSale)));
  });
  root.querySelector('#add-sale').addEventListener('click', () => openSaleSheet(null));
}

function groupSalesByCommodity(commodities, sales, movements) {
  const groups = commodities
    .map((c) => {
      const rows = sales.filter((s) => s.commodityId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return { id: c.id, name: c.name, sales: rows, totalValue: rows.reduce((sum, s) => sum + saleEconomics(s, movements).totalValue, 0) };
    })
    .filter((g) => g.sales.length > 0);

  const noCommodity = sales.filter((s) => !commodities.some((c) => c.id === s.commodityId))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (noCommodity.length > 0) {
    groups.push({ id: null, name: 'No commodity', sales: noCommodity, totalValue: noCommodity.reduce((sum, s) => sum + saleEconomics(s, movements).totalValue, 0) });
  }
  return groups;
}

function fillBadge(econ) {
  if (econ.isOverDelivered) {
    const overBy = econ.tonsDelivered - econ.maxTons;
    return `<span class="badge neg">Over by ${num(overBy, 1)} t</span>`;
  }
  if (econ.isFull) return `<span class="badge pos">Contract full</span>`;
  return `<span class="badge neg">${num(econ.tonsToFill, 1)} t to fill</span>`;
}

function deliveryWindow(s) {
  if (s.deliveryStart && s.deliveryEnd) return `${s.deliveryStart} → ${s.deliveryEnd}`;
  if (s.deliveryStart) return `from ${s.deliveryStart}`;
  if (s.deliveryEnd) return `by ${s.deliveryEnd}`;
  return '';
}

function saleRow(s, movements) {
  const econ = saleEconomics(s, movements);
  const window = deliveryWindow(s);
  const invoices = db.getInvoicesForSale(s.id);
  const outstandingInvoices = invoices.filter((inv) => inv.status !== 'paid');
  return `
    <div class="list-item" data-edit-sale="${s.id}">
      <div>
        <div class="main">${s.buyer ? esc(s.buyer) : 'No buyer'}${s.grade ? ` · ${esc(s.grade)}` : ''}${s.contractNo ? ` · #${esc(s.contractNo)}` : ''}${s.brokerNote ? ` · ${esc(s.brokerNote)}` : ''}</div>
        <div class="meta">${tons(s.tons || 0)} @ ${money(econ.priceExFarm, 2)}/t${econ.movementDelivered > 0 ? ` · ${num(econ.movementDelivered, 1)} t trucked` : ''}</div>
        <div class="meta">${[s.location, window].filter(Boolean).map(esc).join(' · ') || 'No delivery location/date set'}</div>
      </div>
      <div class="right">
        <div class="main">${money(econ.totalValue, 0)}</div>
        <div class="meta">${fillBadge(econ)}</div>
        ${outstandingInvoices.length > 0 ? `<div class="meta"><span class="badge neg">${outstandingInvoices.length} inv. outstanding</span></div>` : invoices.length > 0 ? `<div class="meta"><span class="badge pos">Invoiced &amp; paid</span></div>` : ''}
      </div>
    </div>
  `;
}

function invoiceButtonLabel(sale) {
  const invoices = db.getInvoicesForSale(sale.id);
  if (invoices.length === 0) return 'Invoices';
  const outstanding = invoices.filter((inv) => inv.status !== 'paid').length;
  return `Invoices (${invoices.length}${outstanding > 0 ? `, ${outstanding} outstanding` : ', all paid'})`;
}

function openSaleSheet(existing) {
  const { commodities, movements } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));
  const movementDelivered = existing ? movementTonsToSale(existing.id, movements) : 0;

  openSheet(existing ? 'Edit sale' : 'Add sale', (root) => {
    root.innerHTML = `
      ${field({ label: 'Date', id: 'date', type: 'date', value: existing?.date })}
      <div class="grid-2">
        ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
        ${field({ label: 'Grade', id: 'grade', value: existing?.grade, placeholder: 'e.g. APW1, H2' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Buyer', id: 'buyer', value: existing?.buyer, placeholder: 'e.g. CBH, Cargill' })}
        ${field({ label: 'Contract no.', id: 'contractNo', value: existing?.contractNo })}
      </div>
      ${field({ label: 'Location', id: 'location', value: existing?.location, placeholder: 'Delivery site' })}
      <div class="grid-2">
        ${field({ label: 'Delivery start', id: 'deliveryStart', type: 'date', value: existing?.deliveryStart })}
        ${field({ label: 'Delivery finish', id: 'deliveryEnd', type: 'date', value: existing?.deliveryEnd })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
        ${field({ label: 'Tons delivered (manual)', id: 'tonsDelivered', type: 'number', step: '0.01', value: existing?.tonsDelivered ?? 0, hint: 'For deliveries not tracked as a Movement' })}
      </div>
      ${movementDelivered > 0 ? `<div class="row"><span class="label">+ Delivered via movements</span><span class="value">${num(movementDelivered, 1)} t</span></div>` : ''}
      <div class="grid-2">
        ${field({ label: 'Price ($/t)', id: 'price', type: 'number', step: '0.01', value: existing?.price })}
        ${field({ label: 'Freight ($/t)', id: 'freight', type: 'number', step: '0.01', value: existing?.freight ?? 0 })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Premium/discount ($/t)', id: 'premium', type: 'number', step: '0.01', value: existing?.premiumDiscount ?? 0, allowNegative: true, hint: 'Negative for a discount' })}
        ${field({ label: 'Levies (%)', id: 'levies', type: 'number', step: '0.01', value: existing ? existing.leviesPct * 100 : 1.02, hint: 'e.g. GRDC + state levy' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Tolerance (%)', id: 'tolPct', type: 'number', step: '0.1', value: existing?.tolerancePct ?? DEFAULT_TOLERANCE_PCT })}
        ${field({ label: 'Tolerance cap (t)', id: 'tolCap', type: 'number', step: '0.1', value: existing?.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS, hint: 'Lesser of the two applies' })}
      </div>
      <div class="row"><span class="label">Tolerance range</span><span class="value" id="tol-preview">—</span></div>
      ${field({ label: 'Broker note', id: 'brokerNote', value: existing?.brokerNote })}
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      <div class="grid-2">
        ${field({ label: 'Buyer ABN (optional)', id: 'buyerAbn', value: existing?.buyerAbn, hint: 'For invoices' })}
        ${field({ label: 'Buyer address (optional)', id: 'buyerAddress', value: existing?.buyerAddress })}
      </div>
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn secondary" id="view-invoice" style="margin-top:8px">${invoiceButtonLabel(existing)}</button>` : ''}
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete sale</button>` : ''}
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'sale', existing.id);
    const invoiceBtn = root.querySelector('#view-invoice');
    if (invoiceBtn) invoiceBtn.addEventListener('click', () => openInvoiceListSheet(existing));

    const tolPreview = root.querySelector('#tol-preview');
    const recomputeTolerance = () => {
      const { minTons, maxTons } = contractTolerance(getNum(root, 'tons'), getNum(root, 'tolPct'), getNum(root, 'tolCap'));
      tolPreview.textContent = `${num(minTons, 1)} – ${num(maxTons, 1)} t`;
    };
    ['tons', 'tolPct', 'tolCap'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeTolerance));
    recomputeTolerance();

    root.querySelector('#save').addEventListener('click', () => {
      db.upsertSale({
        id: existing?.id,
        date: getVal(root, 'date'),
        commodityId: getVal(root, 'commodity'),
        grade: getVal(root, 'grade')?.trim(),
        buyer: getVal(root, 'buyer')?.trim(),
        contractNo: getVal(root, 'contractNo')?.trim(),
        location: getVal(root, 'location')?.trim(),
        deliveryStart: getVal(root, 'deliveryStart'),
        deliveryEnd: getVal(root, 'deliveryEnd'),
        tons: getNum(root, 'tons'),
        tonsDelivered: getNum(root, 'tonsDelivered'),
        price: getNum(root, 'price'),
        freight: getNum(root, 'freight'),
        premiumDiscount: getNum(root, 'premium'),
        leviesPct: getNum(root, 'levies') / 100,
        tolerancePct: getNum(root, 'tolPct'),
        toleranceCapTons: getNum(root, 'tolCap'),
        brokerNote: getVal(root, 'brokerNote')?.trim(),
        notes: getVal(root, 'notes')?.trim(),
        buyerAbn: getVal(root, 'buyerAbn')?.trim(),
        buyerAddress: getVal(root, 'buyerAddress')?.trim(),
      });
      closeSheet();
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete('Delete this sale?', () => {
          db.deleteSale(existing.id);
          closeSheet();
        });
      });
    }
  });
}
