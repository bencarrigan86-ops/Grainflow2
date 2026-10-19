import { db } from '../storage.js?v=111';
import {
  DOCUMENT_KINDS, kindLabel, uploadSaleDocument, signedUrlFor, removeSaleDocument, checkFile,
} from '../documents.js?v=111';
import { salesByCommodity, saleEconomics, contractTolerance, movementTonsToSale, DEFAULT_TOLERANCE_PCT, DEFAULT_TOLERANCE_CAP_TONS } from '../derived.js?v=111';
import { num, tons, money, esc, shortDate, todayLocal } from '../fmt.js?v=111';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast } from '../ui.js?v=111';
import { renderRelatedMovements } from './movements.js?v=111';
import { openInvoiceListSheet } from './invoice.js?v=111';
import { openContractDocSheet } from './contract.js?v=111';

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
      ${rollup.length === 0 ? '' : `
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Commodity</th><th>Sold t</th><th>Due t</th><th>Avg $/t</th><th>Total $</th></tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr>
                  <td>${esc(r.commodity.name)}</td>
                  <td>${num(r.tons, 0)}</td>
                  <td>${num(Math.max(0, r.tonsDue), 0)}</td>
                  <td>${num(r.avgPrice, 0)}</td>
                  <td>${num(r.totalValue, 0)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td>${num(salesTotals.tons, 0)}</td>
              <td>${num(salesTotals.tonsDue, 0)}</td>
              <td>${num(salesTotals.avgPrice, 0)}</td>
              <td>${num(salesTotals.totalValue, 0)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`}

      <div class="card input">
        <h2><span class="dot input"></span>Contracts</h2>
        ${groups.length === 0 ? `<div class="empty">No contracts yet.<br/><button class="btn" id="empty-add">Add your first sale</button></div>` : groups.map((g) => `
          <div class="group-label"><span>${esc(g.name)}</span><span class="n">${money(g.totalValue, 0)}</span></div>
          ${g.sales.map((s) => saleRow(s, movements, commodities)).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-sale">+</button>
  `;

  root.querySelectorAll('[data-edit-sale]').forEach((el) => {
    el.addEventListener('click', () => openSaleSheet(sales.find((s) => s.id === el.dataset.editSale)));
  });
  root.querySelector('#add-sale').addEventListener('click', () => openSaleSheet(null));
  root.querySelector('#empty-add')?.addEventListener('click', () => openSaleSheet(null));
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

function fillBadge(econ, unit) {
  if (econ.isOverDelivered) {
    const overBy = econ.tonsDelivered - econ.maxTons;
    return `<span class="badge neg">Over by ${num(overBy, 1)} ${unit}</span>`;
  }
  if (econ.isFull) return `<span class="badge pos">Full</span>`;
  // Open is the normal state of a contract in progress, so amber, not red.
  return `<span class="badge warn">${num(econ.tonsToFill, 0)} ${unit} to go</span>`;
}

/** Delivered against contract as a bar: the shape of a contract reads faster than its numbers. */
function fillGauge(econ, contractTons) {
  const total = Number(contractTons) || 0;
  const pct = total > 0 ? Math.min(100, Math.max(0, (econ.tonsDelivered / total) * 100)) : 0;
  return `<div class="gauge ${econ.isOverDelivered ? 'over' : ''}" role="img" aria-label="${Math.round(pct)} percent delivered"><i style="width:${pct}%"></i></div>`;
}

function deliveryWindow(s) {
  if (s.deliveryStart && s.deliveryEnd) return `${shortDate(s.deliveryStart)} → ${shortDate(s.deliveryEnd)}`;
  if (s.deliveryStart) return `from ${shortDate(s.deliveryStart)}`;
  if (s.deliveryEnd) return `by ${shortDate(s.deliveryEnd)}`;
  return '';
}

function saleRow(s, movements, commodities) {
  const econ = saleEconomics(s, movements);
  const window = deliveryWindow(s);
  const invoices = db.getInvoicesForSale(s.id);
  const outstandingInvoices = invoices.filter((inv) => inv.status !== 'paid');
  const isBales = commodities.find((c) => c.id === s.commodityId)?.unit === 'bale';
  const unit = isBales ? 'bales' : 't';
  const amount = isBales ? `${num(s.tons || 0, 1)} bales` : tons(s.tons || 0);
  return `
    <div class="list-item stack" data-edit-sale="${s.id}">
      <div class="li-top">
        <div class="main">${s.buyer ? esc(s.buyer) : 'No buyer'}</div>
        <div class="main">${money(econ.totalValue, 0)}</div>
      </div>
      <div class="meta">${[s.grade, s.contractNo ? `#${s.contractNo}` : '', s.brokerNote].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      <div class="meta">${amount} @ ${money(econ.priceExFarm, 2)}/${isBales ? 'bale' : 't'} net</div>
      <div class="meta">${[s.location, window].filter(Boolean).map(esc).join(' · ') || 'No delivery location/date set'}</div>
      ${fillGauge(econ, s.tons)}
      <div class="li-foot">
        <span class="meta">${num(econ.tonsDelivered, 0)} of ${num(s.tons || 0, 0)} ${unit} delivered${econ.movementDelivered > 0 ? ` (${num(econ.movementDelivered, 0)} trucked)` : ''}</span>
        <span class="badges">
          ${fillBadge(econ, unit)}
          ${outstandingInvoices.length > 0 ? `<span class="badge neg">${outstandingInvoices.length} unpaid</span>` : invoices.length > 0 ? `<span class="badge pos">Paid</span>` : ''}
        </span>
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
  const allSales = db.get().sales;
  const distinct = (key) => [...new Set(allSales.map((x) => (x[key] || '').trim()).filter(Boolean))].sort((m, n) => m.localeCompare(n));
  const buyerList = distinct('buyer');
  const brokerList = distinct('broker');
  const locationList = distinct('location');
  // Folds start closed on a new contract and open on an edit that has something in them.
  const openTerms = !!existing && ['cropYear', 'contractType', 'pricingPoint', 'deliveryTerms', 'buyerContact', 'tradeRules'].some((k) => existing[k]);
  const openAdjust = !!existing && (!!existing.premiumDiscount || !!existing.ginning || Math.abs((existing.leviesPct ?? 0) * 100 - 1.02) > 1e-6);
  const openDelivered = !!existing && (!!existing.tonsDelivered || !!existing.notes || !!existing.buyerAbn || !!existing.buyerAddress);
  const openAdvanced = !!existing && (!!existing.carryRate || !!existing.carryFrom
    || (existing.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS) !== DEFAULT_TOLERANCE_CAP_TONS);

  openSheet(existing ? 'Edit sale' : 'Add sale', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:0">Fill in the top section and Save — the folds
        underneath are optional detail.</div>
      <datalist id="dl-buyers">${buyerList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-brokers">${brokerList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-locations">${locationList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>

      <div class="subhead">Deal</div>
      <div class="grid-2">
        ${field({ label: 'Date', id: 'date', type: 'date', value: existing?.date ?? todayLocal() })}
        ${field({ label: 'Contract no.', id: 'contractNo', value: existing?.contractNo })}
      </div>
      ${field({ label: 'Buyer', id: 'buyer', value: existing?.buyer, placeholder: 'e.g. CBH, Cargill', list: 'dl-buyers' })}
      <div class="copy-last" id="copy-last"></div>

      <div class="subhead">Quantity &amp; price</div>
      <div class="grid-2">
        ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
        ${field({ label: 'Grade', id: 'grade', value: existing?.grade, placeholder: 'e.g. APW1, H2' })}
      </div>
      ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
      <div class="grid-2">
        ${field({ label: 'Tolerance (%)', id: 'tolPct', type: 'number', step: '0.1', value: existing?.tolerancePct ?? DEFAULT_TOLERANCE_PCT })}
        <div class="field"><label>Tolerance range</label><div class="readout" id="tol-preview">—</div></div>
      </div>
      ${field({ label: 'Price ($/t)', id: 'price', type: 'number', step: '0.01', value: existing?.price })}
      <div class="row"><span class="label">Contract value</span><span class="value" id="value-preview">—</span></div>

      <div class="subhead">Delivery</div>
      ${field({ label: 'Location', id: 'location', value: existing?.location, placeholder: 'Delivery site', list: 'dl-locations' })}
      <div class="grid-2">
        ${field({ label: 'Delivery start', id: 'deliveryStart', type: 'date', value: existing?.deliveryStart })}
        ${field({ label: 'Delivery finish', id: 'deliveryEnd', type: 'date', value: existing?.deliveryEnd })}
      </div>
      ${field({ label: 'Weights to govern', id: 'weightsToGovern', type: 'select', value: existing?.weightsToGovern ?? '', options: [
        { value: '', label: '—' },
        { value: 'destination', label: 'Destination' },
        { value: 'origin', label: 'Origin' },
      ], hint: 'Whose weighbridge settles it' })}

      <div class="subhead">Payment, broker &amp; freight</div>
      <div class="grid-2">
        ${field({ label: 'Payment terms (days)', id: 'paymentTermsDays', type: 'number', step: '1', value: existing?.paymentTermsDays ?? '' })}
        ${field({ label: 'Counted from', id: 'paymentTermsBasis', type: 'select', value: existing?.paymentTermsBasis ?? '', options: [
          { value: '', label: '—' },
          { value: 'end of week of delivery', label: 'End of week of delivery' },
          { value: 'end of week of transfer', label: 'End of week of transfer' },
          { value: 'date of delivery', label: 'Date of delivery' },
          { value: 'invoice date', label: 'Invoice date' },
        ], hint: '"30 days" and "30 days from end of week" are up to six days apart' })}
      </div>
      ${field({ label: 'Broker note', id: 'brokerNote', type: 'textarea', value: existing?.brokerNote })}
      <div class="grid-2">
        ${field({ label: 'Broker', id: 'broker', value: existing?.broker, placeholder: 'e.g. Knight Commodities', list: 'dl-brokers' })}
        ${field({ label: 'Broker reference', id: 'brokerRef', value: existing?.brokerRef, placeholder: 'Their contract ref' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Brokerage paid by', id: 'brokeragePaidBy', type: 'select', value: existing?.brokeragePaidBy ?? '', options: [
          { value: '', label: '—' },
          { value: 'seller', label: 'Seller (you)' },
          { value: 'buyer', label: 'Buyer' },
        ] })}
        ${field({ label: 'Freight ($/t)', id: 'freight', type: 'number', step: '0.01', value: existing?.freight ?? 0 })}
      </div>

      <details class="fold" ${openTerms ? 'open' : ''}>
        <summary><div><h2>Contract terms</h2>
          <div class="sub">Crop year, type, pricing point, delivery terms, contact, trade rules</div></div></summary>
        <div class="field hint" style="margin-bottom:10px">What the buyer's contract confirmation
          says. Fill in what you have — anything left blank is simply not shown.</div>
        <div class="grid-2">
          ${field({ label: 'Crop year', id: 'cropYear', value: existing?.cropYear, placeholder: 'e.g. 2025/2026', hint: 'As the contract writes it' })}
          ${field({ label: 'Contract type', id: 'contractType', value: existing?.contractType, placeholder: 'e.g. Ex Farm' })}
        </div>
        ${field({ label: 'Pricing point', id: 'pricingPoint', value: existing?.pricingPoint, placeholder: 'e.g. Goondiwindi - 45km S/W', hint: 'Where the price is struck' })}
        ${field({ label: 'Delivery terms', id: 'deliveryTerms', value: existing?.deliveryTerms, placeholder: "e.g. Buyer's call, 5 business days notice" })}
        ${field({ label: 'Buyer contact / trader', id: 'buyerContact', value: existing?.buyerContact, placeholder: 'Who to ring about a load' })}
        ${field({ label: 'Trade rules', id: 'tradeRules', value: existing?.tradeRules, placeholder: 'e.g. GTA contract 3' })}
      </details>

      <details class="fold" ${openAdjust ? 'open' : ''}>
        <summary><div><h2>Price adjustments</h2>
          <div class="sub">Premium/discount, levies, ginning</div></div></summary>
        <div class="field hint" style="margin-bottom:10px">Taken off (or added to) the price above to
          get the net price ex-farm.</div>
        <div class="grid-2">
          ${field({ label: 'Premium/discount ($/t)', id: 'premium', type: 'number', step: '0.01', value: existing?.premiumDiscount ?? 0, allowNegative: true, hint: 'Negative for a discount' })}
          ${field({ label: 'Levies (%)', id: 'levies', type: 'number', step: '0.01', value: existing ? +(existing.leviesPct * 100).toFixed(4) : 1.02, hint: 'e.g. GRDC + state levy' })}
        </div>
        ${field({ label: 'Ginning cost ($)', id: 'ginning', type: 'number', step: '0.01', value: existing?.ginning ?? 0, hint: 'Net ginning deduction, e.g. cotton seed. A total, not a rate.' })}
      </details>

      <details class="fold" ${openDelivered ? 'open' : ''}>
        <summary><div><h2>Delivered &amp; other</h2>
          <div class="sub">Tons delivered, notes, buyer ABN and address</div></div></summary>
        ${field({ label: 'Tons delivered (manual)', id: 'tonsDelivered', type: 'number', step: '0.01', value: existing?.tonsDelivered ?? 0, hint: 'For deliveries not tracked as a Movement' })}
        ${movementDelivered > 0 ? `<div class="row"><span class="label">+ Delivered via movements</span><span class="value" id="movement-delivered-value">${num(movementDelivered, 1)} t</span></div>` : ''}
        ${field({ label: 'Notes', id: 'notes', type: 'textarea', value: existing?.notes })}
        <div class="grid-2">
          ${field({ label: 'Buyer ABN (optional)', id: 'buyerAbn', value: existing?.buyerAbn, hint: 'For invoices' })}
          ${field({ label: 'Buyer address (optional)', id: 'buyerAddress', value: existing?.buyerAddress })}
        </div>
      </details>

      <details class="fold" ${openAdvanced ? 'open' : ''}>
        <summary><div><h2>Advanced</h2>
          <div class="sub">Tolerance cap, carry</div></div></summary>
        ${field({ label: 'Tolerance cap (t)', id: 'tolCap', type: 'number', step: '0.1', value: existing?.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS, hint: 'The lesser of the % and this cap applies' })}
        <div class="grid-2">
          ${field({ label: 'Carry ($/t/month)', id: 'carryRate', type: 'number', step: '0.01', value: existing?.carryRate ?? 0, hint: 'Paid to leave grain on farm' })}
          ${field({ label: 'Carry starts', id: 'carryFrom', type: 'date', value: existing?.carryFrom })}
        </div>
      </details>
      ${existing ? `
        <details class="fold" ${(existing.documents || []).length ? 'open' : ''}>
          <summary><div><h2>Documents</h2>
            <div class="sub">The buyer's contract and the broker's note, kept with the sale</div></div></summary>
          <div id="doc-list"></div>
          ${field({ label: 'What is it', id: 'doc-kind', type: 'select', value: 'contract',
            options: DOCUMENT_KINDS.map((k) => ({ value: k.value, label: k.label })) })}
          <input type="file" id="doc-file" accept="application/pdf,image/*" style="display:none" />
          <button class="btn secondary small" id="doc-attach">Attach a file&hellip;</button>
          <div id="doc-problem"></div>
        </details>
      ` : `
        <div class="field hint" style="margin-top:14px">Save the sale first, then you can
          attach the buyer's contract and the broker's note to it.</div>
      `}
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      ${existing ? `<button class="btn secondary" id="view-invoice" style="margin-top:12px">${invoiceButtonLabel(existing)}</button>` : ''}
      ${existing ? `<button class="btn secondary" id="view-contract" style="margin-top:8px">Confirmation of sale (PDF)&hellip;</button>` : ''}
      ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:8px">Delete sale</button>` : ''}
      <div class="save-bar">
        <div class="total"><div class="l">Contract value</div><div class="v" id="total-preview">—</div></div>
        <button class="btn" id="save">Save</button>
      </div>
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'sale', existing.id);
    const invoiceBtn = root.querySelector('#view-invoice');
    if (invoiceBtn) invoiceBtn.addEventListener('click', () => openInvoiceListSheet(existing));
    const contractBtn = root.querySelector('#view-contract');
    // Reads the saved sale rather than the form, so the document can never show
    // a figure that has not been saved yet.
    if (contractBtn) {
      contractBtn.addEventListener('click', () => {
        const fresh = db.get().sales.find((x) => x.id === existing.id) || existing;
        openContractDocSheet(fresh);
      });
    }

    const tolPreview = root.querySelector('#tol-preview');
    let currentUnit = 't';
    const recomputeTolerance = () => {
      const { minTons, maxTons } = contractTolerance(getNum(root, 'tons'), getNum(root, 'tolPct'), getNum(root, 'tolCap'));
      tolPreview.textContent = `${num(minTons, 1)} – ${num(maxTons, 1)} ${currentUnit}`;
    };
    ['tons', 'tolPct', 'tolCap'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeTolerance));

    // What the figures above come to, as you type — the same arithmetic the
    // sales list uses, run on the form's values rather than a saved record.
    const valuePreview = root.querySelector('#value-preview');
    const totalPreview = root.querySelector('#total-preview');
    const recomputeValue = () => {
      const e = saleEconomics({
        tons: getNum(root, 'tons'),
        price: getNum(root, 'price'),
        freight: getNum(root, 'freight'),
        premiumDiscount: getNum(root, 'premium'),
        ginning: getNum(root, 'ginning'),
        leviesPct: getNum(root, 'levies') / 100,
      });
      valuePreview.textContent = `${money(e.totalValue, 0)} · ${money(e.priceExFarm, 2)}/${currentUnit === 'bales' ? 'bale' : 't'} net`;
      totalPreview.textContent = money(e.totalValue, 0);
    };
    ['tons', 'price', 'freight', 'premium', 'ginning', 'levies']
      .forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeValue));

    // A new contract with a buyer you have sold to before: offer their last
    // one's standing terms (site, payment, broker, delivery rules) so only the
    // numbers that change are typed. Fills blanks only — never overwrites.
    const copyEl = root.querySelector('#copy-last');
    const lastForBuyer = (name) => {
      const k = (name || '').trim().toLowerCase();
      if (!k) return null;
      return allSales
        .filter((x) => (x.buyer || '').trim().toLowerCase() === k)
        .sort((m, n) => String(n.date || '').localeCompare(String(m.date || '')))[0] || null;
    };
    const COPY_FIELDS = [
      'location', 'paymentTermsDays', 'paymentTermsBasis', 'weightsToGovern', 'broker', 'brokeragePaidBy',
      'freight', 'deliveryTerms', 'contractType', 'pricingPoint', 'buyerContact', 'tradeRules', 'buyerAbn', 'buyerAddress',
    ];
    const isBlank = (el) => el.value === '' || el.value === '0';
    const offerCopy = () => {
      if (existing || !copyEl) return;
      const prev = lastForBuyer(getVal(root, 'buyer'));
      if (!prev) { copyEl.innerHTML = ''; return; }
      copyEl.innerHTML = '<button type="button" class="btn secondary small"></button>';
      const btn = copyEl.querySelector('button');
      btn.textContent = `Fill from your last ${prev.buyer} contract${prev.date ? ` (${prev.date})` : ''}`;
      btn.addEventListener('click', () => {
        let filled = 0;
        COPY_FIELDS.forEach((key) => {
          const el = root.querySelector('#' + key);
          const v = prev[key];
          if (!el || v === undefined || v === null || v === '' || v === 0) return;
          if (isBlank(el)) { el.value = v; filled += 1; }
        });
        root.querySelectorAll('details.fold').forEach((d) => {
          if ([...d.querySelectorAll('input,select,textarea')].some((i) => i.value !== '' && i.value !== '0' && i.id !== 'levies' && i.id !== 'tolCap')) d.open = true;
        });
        recomputeValue();
        copyEl.innerHTML = filled
          ? '<div class="hint">Filled ' + filled + ' blank field' + (filled === 1 ? '' : 's') + ' from that contract — check they still apply.</div>'
          : '<div class="hint">Nothing to fill — those fields already have values.</div>';
      });
    };
    root.querySelector('#buyer').addEventListener('input', offerCopy);
    root.querySelector('#buyer').addEventListener('change', offerCopy);
    offerCopy();

    const tonsLabelEl = root.querySelector('label[for="tons"]');
    const tonsDeliveredLabelEl = root.querySelector('label[for="tonsDelivered"]');
    const priceLabelEl = root.querySelector('label[for="price"]');
    const freightLabelEl = root.querySelector('label[for="freight"]');
    const tolCapLabelEl = root.querySelector('label[for="tolCap"]');
    const movementDeliveredValueEl = root.querySelector('#movement-delivered-value');
    const syncUnitLabels = () => {
      const c = commodities.find((cc) => cc.id === getVal(root, 'commodity'));
      const isBales = c?.unit === 'bale';
      currentUnit = isBales ? 'bales' : 't';
      const perUnit = isBales ? '$/bale' : '$/t';
      tonsLabelEl.textContent = isBales ? 'Bales' : 'Tons';
      tonsDeliveredLabelEl.textContent = isBales ? 'Bales delivered (manual)' : 'Tons delivered (manual)';
      priceLabelEl.textContent = `Price (${perUnit})`;
      freightLabelEl.textContent = `Freight (${perUnit})`;
      tolCapLabelEl.textContent = isBales ? 'Tolerance cap (bales)' : 'Tolerance cap (t)';
      if (movementDeliveredValueEl) movementDeliveredValueEl.textContent = `${num(movementDelivered, 1)} ${currentUnit}`;
      recomputeTolerance();
      recomputeValue();
    };
    root.querySelector('#commodity').addEventListener('change', syncUnitLabels);
    syncUnitLabels();

    // --- documents -------------------------------------------------------
    //
    // Attaching saves immediately rather than waiting for the Save button.
    // Uploading a 2MB contract and then losing it because you closed the sheet
    // is the same fault as the fertiliser application that was discarded
    // unless you pressed "Add" first, and it is worse here because the file
    // has already gone to the server by then.
    let documents = (existing?.documents || []).slice();
    const docListEl = root.querySelector('#doc-list');
    const docProblemEl = root.querySelector('#doc-problem');
    const fileEl = root.querySelector('#doc-file');

    const saveDocuments = () => db.upsertSale({ id: existing.id, documents });

    const sayProblem = (msg) => {
      if (docProblemEl) {
        docProblemEl.innerHTML = msg
          ? `<div class="hint" style="color:var(--danger);margin-top:8px">${esc(msg)}</div>` : '';
      }
    };

    const renderDocuments = () => {
      if (!docListEl) return;
      if (!documents.length) {
        docListEl.innerHTML = '<div class="field hint" style="margin-bottom:8px">Nothing attached yet.</div>';
        return;
      }
      docListEl.innerHTML = documents.map((d) => `
        <div class="list-item" style="padding:8px 4px">
          <div>
            <div class="main">${esc(d.fileName || 'Document')}</div>
            <div class="meta">${esc(kindLabel(d.kind))}${d.byteSize ? ` &middot; ${Math.round(d.byteSize / 1024)} KB` : ''}</div>
          </div>
          <div class="right swipe-actions">
            <button type="button" class="btn secondary small" data-open-doc="${esc(d.id)}">Open</button>
            <button type="button" class="btn danger small" data-remove-doc="${esc(d.id)}">&times;</button>
          </div>
        </div>`).join('');

      docListEl.querySelectorAll('[data-open-doc]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const d = documents.find((x) => x.id === btn.dataset.openDoc);
          btn.textContent = 'Opening…';
          const url = await signedUrlFor(d?.storagePath);
          btn.textContent = 'Open';
          if (!url) { sayProblem('That document could not be opened. It may still be uploading.'); return; }
          window.open(url, '_blank', 'noopener');
        });
      });

      docListEl.querySelectorAll('[data-remove-doc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = documents.find((x) => x.id === btn.dataset.removeDoc);
          confirmDelete(`Remove ${d?.fileName || 'this document'} from the sale? The file is deleted for good.`, async () => {
            documents = documents.filter((x) => x.id !== d.id);
            renderDocuments();
            saveDocuments();
            await removeSaleDocument(d?.storagePath);
          });
        });
      });
    };

    const attachBtn = root.querySelector('#doc-attach');
    if (attachBtn) {
      renderDocuments();
      attachBtn.addEventListener('click', () => fileEl.click());
      fileEl.addEventListener('change', async () => {
        const file = fileEl.files?.[0];
        fileEl.value = '';                       // so the same file can be re-picked
        if (!file) return;
        const problem = checkFile(file);
        if (problem) { sayProblem(problem); return; }

        sayProblem('');
        attachBtn.disabled = true;
        attachBtn.textContent = 'Uploading…';
        try {
          const stored = await uploadSaleDocument(file, {
            farmId: db.getFarmId(), saleId: existing.id,
          });
          documents.push({
            id: crypto.randomUUID(),
            kind: getVal(root, 'doc-kind') || 'contract',
            uploadedAt: new Date().toISOString(),
            ...stored,
          });
          renderDocuments();
          saveDocuments();
        } catch (e) {
          sayProblem(e.message);
        } finally {
          attachBtn.disabled = false;
          attachBtn.textContent = 'Attach a file…';
        }
      });
    }

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
        ginning: getNum(root, 'ginning'),
        leviesPct: getNum(root, 'levies') / 100,
        tolerancePct: getNum(root, 'tolPct'),
        toleranceCapTons: getNum(root, 'tolCap'),
        brokerNote: getVal(root, 'brokerNote')?.trim(),
        notes: getVal(root, 'notes')?.trim(),
        buyerAbn: getVal(root, 'buyerAbn')?.trim(),
        buyerAddress: getVal(root, 'buyerAddress')?.trim(),
        cropYear: getVal(root, 'cropYear')?.trim(),
        contractType: getVal(root, 'contractType')?.trim(),
        pricingPoint: getVal(root, 'pricingPoint')?.trim(),
        weightsToGovern: getVal(root, 'weightsToGovern'),
        deliveryTerms: getVal(root, 'deliveryTerms')?.trim(),
        buyerContact: getVal(root, 'buyerContact')?.trim(),
        broker: getVal(root, 'broker')?.trim(),
        brokerRef: getVal(root, 'brokerRef')?.trim(),
        brokeragePaidBy: getVal(root, 'brokeragePaidBy'),
        paymentTermsDays: getNum(root, 'paymentTermsDays'),
        paymentTermsBasis: getVal(root, 'paymentTermsBasis'),
        carryRate: getNum(root, 'carryRate'),
        carryFrom: getVal(root, 'carryFrom'),
        tradeRules: getVal(root, 'tradeRules')?.trim(),
        documents,
      });
      closeSheet(); toast('Saved');
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
