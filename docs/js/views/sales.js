import { db } from '../storage.js?v=93';
import {
  DOCUMENT_KINDS, kindLabel, uploadSaleDocument, signedUrlFor, removeSaleDocument, checkFile,
} from '../documents.js?v=93';
import { salesByCommodity, saleEconomics, contractTolerance, movementTonsToSale, DEFAULT_TOLERANCE_PCT, DEFAULT_TOLERANCE_CAP_TONS } from '../derived.js?v=93';
import { num, tons, money, esc } from '../fmt.js?v=93';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=93';
import { renderRelatedMovements } from './movements.js?v=93';
import { openInvoiceListSheet } from './invoice.js?v=93';
import { openContractDocSheet } from './contract.js?v=93';

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
  if (econ.isFull) return `<span class="badge pos">Contract full</span>`;
  return `<span class="badge neg">${num(econ.tonsToFill, 1)} ${unit} to fill</span>`;
}

function deliveryWindow(s) {
  if (s.deliveryStart && s.deliveryEnd) return `${s.deliveryStart} → ${s.deliveryEnd}`;
  if (s.deliveryStart) return `from ${s.deliveryStart}`;
  if (s.deliveryEnd) return `by ${s.deliveryEnd}`;
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
    <div class="list-item" data-edit-sale="${s.id}">
      <div>
        <div class="main">${s.buyer ? esc(s.buyer) : 'No buyer'}${s.grade ? ` · ${esc(s.grade)}` : ''}${s.contractNo ? ` · #${esc(s.contractNo)}` : ''}${s.brokerNote ? ` · ${esc(s.brokerNote)}` : ''}</div>
        <div class="meta">${amount} @ ${money(econ.priceExFarm, 2)}/${isBales ? 'bale' : 't'}${econ.movementDelivered > 0 ? ` · ${num(econ.movementDelivered, 1)} ${unit} trucked` : ''}</div>
        <div class="meta">${[s.location, window].filter(Boolean).map(esc).join(' · ') || 'No delivery location/date set'}</div>
      </div>
      <div class="right">
        <div class="main">${money(econ.totalValue, 0)}</div>
        <div class="meta">${fillBadge(econ, unit)}</div>
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
      <hr class="sep" />
      <h2 style="margin:0 0 4px">Contract terms</h2>
      <div class="field hint" style="margin-bottom:10px">What the buyer's contract confirmation
        says. Fill in what you have — anything left blank is simply not shown.</div>
      <div class="grid-2">
        ${field({ label: 'Crop year', id: 'cropYear', value: existing?.cropYear, placeholder: 'e.g. 2025/2026', hint: 'As the contract writes it' })}
        ${field({ label: 'Contract type', id: 'contractType', value: existing?.contractType, placeholder: 'e.g. Ex Farm' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Pricing point', id: 'pricingPoint', value: existing?.pricingPoint, placeholder: 'e.g. Goondiwindi - 45km S/W', hint: 'Where the price is struck' })}
        ${field({ label: 'Weights to govern', id: 'weightsToGovern', type: 'select', value: existing?.weightsToGovern ?? '', options: [
          { value: '', label: '—' },
          { value: 'destination', label: 'Destination' },
          { value: 'origin', label: 'Origin' },
        ], hint: 'Whose weighbridge settles it' })}
      </div>
      ${field({ label: 'Delivery terms', id: 'deliveryTerms', value: existing?.deliveryTerms, placeholder: "e.g. Buyer's call, 5 business days notice" })}
      ${field({ label: 'Buyer contact / trader', id: 'buyerContact', value: existing?.buyerContact, placeholder: 'Who to ring about a load' })}
      <div class="grid-2">
        ${field({ label: 'Broker', id: 'broker', value: existing?.broker, placeholder: 'e.g. Knight Commodities' })}
        ${field({ label: 'Broker reference', id: 'brokerRef', value: existing?.brokerRef, placeholder: 'Their contract ref' })}
      </div>
      ${field({ label: 'Brokerage paid by', id: 'brokeragePaidBy', type: 'select', value: existing?.brokeragePaidBy ?? '', options: [
        { value: '', label: '—' },
        { value: 'seller', label: 'Seller (you)' },
        { value: 'buyer', label: 'Buyer' },
      ] })}
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
      <div class="grid-2">
        ${field({ label: 'Carry ($/t/month)', id: 'carryRate', type: 'number', step: '0.01', value: existing?.carryRate ?? 0, hint: 'Paid to leave grain on farm' })}
        ${field({ label: 'Carry starts', id: 'carryFrom', type: 'date', value: existing?.carryFrom })}
      </div>
      ${field({ label: 'Trade rules', id: 'tradeRules', value: existing?.tradeRules, placeholder: 'e.g. GTA contract 3' })}
      <div class="grid-2">
        ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
        ${field({ label: 'Tons delivered (manual)', id: 'tonsDelivered', type: 'number', step: '0.01', value: existing?.tonsDelivered ?? 0, hint: 'For deliveries not tracked as a Movement' })}
      </div>
      ${movementDelivered > 0 ? `<div class="row"><span class="label">+ Delivered via movements</span><span class="value" id="movement-delivered-value">${num(movementDelivered, 1)} t</span></div>` : ''}
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
      ${field({ label: 'Ginning cost ($)', id: 'ginning', type: 'number', step: '0.01', value: existing?.ginning ?? 0, hint: 'Net ginning deduction — e.g. for a cotton seed sale. A total dollar amount, not a rate.' })}
      ${field({ label: 'Broker note', id: 'brokerNote', value: existing?.brokerNote })}
      ${field({ label: 'Notes', id: 'notes', value: existing?.notes })}
      <div class="grid-2">
        ${field({ label: 'Buyer ABN (optional)', id: 'buyerAbn', value: existing?.buyerAbn, hint: 'For invoices' })}
        ${field({ label: 'Buyer address (optional)', id: 'buyerAddress', value: existing?.buyerAddress })}
      </div>
      ${existing ? `
        <hr class="sep" />
        <h2 style="margin:0 0 4px">Documents</h2>
        <div class="field hint" style="margin-bottom:8px">Keep the buyer's contract and the
          broker's note with the sale, so the paper the figures came from is one tap away
          instead of in an inbox.</div>
        <div id="doc-list"></div>
        ${field({ label: 'What is it', id: 'doc-kind', type: 'select', value: 'contract',
          options: DOCUMENT_KINDS.map((k) => ({ value: k.value, label: k.label })) })}
        <input type="file" id="doc-file" accept="application/pdf,image/*" style="display:none" />
        <button class="btn secondary small" id="doc-attach">Attach a file&hellip;</button>
        <div id="doc-problem"></div>
      ` : `
        <div class="field hint" style="margin-top:10px">Save the sale first, then you can
          attach the buyer's contract and the broker's note to it.</div>
      `}
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      <button class="btn" id="save" style="margin-top:12px">Save</button>
      ${existing ? `<button class="btn secondary" id="view-invoice" style="margin-top:8px">${invoiceButtonLabel(existing)}</button>` : ''}
      ${existing ? `<button class="btn secondary" id="view-contract" style="margin-top:8px">Confirmation of sale (PDF)&hellip;</button>` : ''}
      ${existing ? `<button class="btn danger" id="del" style="margin-top:8px">Delete sale</button>` : ''}
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
