import { db } from '../storage.js?v=36';
import { movementsForEndpoint, invoiceLineItems, invoiceTotals, invoicedMovementIds } from '../derived.js?v=36';
import { num, money, esc } from '../fmt.js?v=36';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete } from '../ui.js?v=36';

/** Entry point from the Sales sheet: shows past invoices for this sale, plus "New invoice". */
export function openInvoiceListSheet(sale) {
  paintList(sale);
}

function paintList(sale) {
  const invoices = db.getInvoicesForSale(sale.id).sort((a, b) => b.invoiceNo - a.invoiceNo);
  const outstanding = invoices.filter((inv) => inv.status !== 'paid').reduce((s, inv) => s + inv.totalPayable, 0);

  openSheet('Invoices', (root) => {
    root.innerHTML = `
      ${invoices.length > 0 ? `<div class="row"><span class="label">Outstanding</span><span class="value">${money(outstanding, 2)}</span></div>` : ''}
      <button class="btn" id="new-invoice" style="margin:10px 0">New invoice</button>
      ${invoices.length === 0 ? `<div class="empty">No invoices created yet for this contract.</div>` : invoices.map((inv) => invoiceRow(inv)).join('')}
    `;
    root.querySelector('#new-invoice').addEventListener('click', () => openInvoiceBuilderSheet(sale, null));
    root.querySelectorAll('[data-view-invoice]').forEach((el) => {
      el.addEventListener('click', () => {
        const inv = invoices.find((i) => i.id === el.dataset.viewInvoice);
        openInvoiceDocSheet(sale, inv);
      });
    });
  });
}

function invoiceRow(inv) {
  const isPaid = inv.status === 'paid';
  const loadCount = inv.lines.length;
  return `
    <div class="list-item" data-view-invoice="${inv.id}">
      <div>
        <div class="main">Invoice #${inv.invoiceNo}</div>
        <div class="meta">${esc(inv.issueDate)} &middot; ${loadCount} item${loadCount === 1 ? '' : 's'}</div>
      </div>
      <div class="right">
        <div class="main">${money(inv.totalPayable, 2)}</div>
        <div class="meta"><span class="badge ${isPaid ? 'pos' : 'neg'}">${isPaid ? 'Paid' : 'Outstanding'}</span></div>
      </div>
    </div>
  `;
}

/**
 * Create or edit an invoice: pick which loads (movements) to include, an
 * optional manual tonnage line, any number of custom premium/deduction
 * lines, and hand-adjust the computed totals (e.g. to match a broker
 * invoice's own rounding). Pass `existingInvoice` to edit one in place.
 */
function openInvoiceBuilderSheet(sale, existingInvoice) {
  const { movements } = db.get();
  const allForSale = movementsForEndpoint('sale', sale.id, movements);
  const otherInvoices = db.getInvoicesForSale(sale.id).filter((inv) => inv.id !== existingInvoice?.id);
  const usedByOthers = invoicedMovementIds(otherInvoices);
  const available = allForSale.filter((m) => !usedByOthers.has(m.id));
  const alreadyCount = allForSale.length - available.length;
  const existingMovementIds = new Set((existingInvoice?.lines || []).map((l) => l.movementId).filter(Boolean));
  const existingManual = (existingInvoice?.lines || []).find((l) => l.isManual);
  const existingCustoms = (existingInvoice?.lines || []).filter((l) => l.isCustom);

  const body = openSheet(existingInvoice ? `Edit invoice #${existingInvoice.invoiceNo}` : 'New invoice', (root) => {
    root.innerHTML = `
      ${alreadyCount > 0 ? `<div class="field hint" style="margin-bottom:10px">${alreadyCount} load${alreadyCount === 1 ? '' : 's'} already on another invoice — not shown below.</div>` : ''}
      ${available.length === 0 ? `<div class="empty">No un-invoiced loads for this contract.</div>` : available.map((m) => `
        <label class="list-item" style="cursor:pointer">
          <div style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" class="ld-check" data-mid="${m.id}" ${existingInvoice ? (existingMovementIds.has(m.id) ? 'checked' : '') : 'checked'} style="width:18px;height:18px" />
            <div>
              <div class="main">${esc(m.date || 'No date')}${m.truckRego ? ` &middot; ${esc(m.truckRego)}` : ''}</div>
              <div class="meta">${num(m.tons, 2)} t</div>
            </div>
          </div>
        </label>
      `).join('')}
      <hr class="sep" />
      ${field({ label: 'Manual line (optional — tons not linked to a load)', id: 'manual-tons', type: 'number', step: '0.01', value: existingManual?.tons })}
      <hr class="sep" />
      <div class="field">
        <label>Custom items (premium / deduction)</label>
        <div id="custom-items"></div>
        <button type="button" class="btn secondary small" id="add-custom-item" style="margin-top:6px">+ Add custom item</button>
      </div>
      <hr class="sep" />
      <div class="field">
        <label>Totals — hand-adjust for rounding if needed</label>
      </div>
      ${field({ label: 'Subtotal (Ex GST)', id: 't-subtotal', type: 'number', step: '0.01', allowNegative: true })}
      ${field({ label: 'Freight', id: 't-freight', type: 'number', step: '0.01', allowNegative: true })}
      ${field({ label: 'Grain levies', id: 't-levies', type: 'number', step: '0.01', allowNegative: true })}
      ${field({ label: 'GST', id: 't-gst', type: 'number', step: '0.01', allowNegative: true })}
      <div class="row"><span class="label"><strong>Total amount payable</strong></span><span class="value" id="t-total" style="font-size:18px">$0.00</span></div>
      <button class="btn" id="save-invoice" style="margin-top:12px">${existingInvoice ? 'Save changes' : 'Create invoice'}</button>
    `;

    const customContainer = root.querySelector('#custom-items');
    existingCustoms.forEach((c) => addCustomItemRow(customContainer, recomputeTotals, c));
    root.querySelector('#add-custom-item').addEventListener('click', () => addCustomItemRow(customContainer, recomputeTotals));

    root.querySelectorAll('.ld-check').forEach((el) => el.addEventListener('change', recomputeTotals));
    root.querySelector('#manual-tons').addEventListener('input', recomputeTotals);
    ['t-subtotal', 't-freight', 't-levies', 't-gst'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeFinalTotal));

    function buildLines() {
      const checkedIds = Array.from(root.querySelectorAll('.ld-check:checked')).map((el) => el.dataset.mid);
      const selectedMovements = available.filter((m) => checkedIds.includes(m.id));
      const lines = invoiceLineItems(sale, selectedMovements);
      const rate = (Number(sale.price) || 0) + (Number(sale.premiumDiscount) || 0);
      const manualTons = getNum(root, 'manual-tons');
      if (manualTons > 0) {
        lines.push({ date: sale.date, rego: '—', tons: manualTons, movementId: null, rate, subtotal: manualTons * rate, isManual: true });
      }
      readCustomItems(customContainer).forEach((item) => {
        if (item.amount === 0) return;
        lines.push({ date: sale.date, rego: item.description || 'Adjustment', tons: null, movementId: null, rate: null, subtotal: item.amount, description: item.description, isCustom: true });
      });
      lines.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return lines;
    }

    function recomputeTotals() {
      const lines = buildLines();
      const totals = invoiceTotals(sale, lines);
      root.querySelector('#t-subtotal').value = totals.subtotalExGST.toFixed(2);
      root.querySelector('#t-freight').value = totals.freightTotal.toFixed(2);
      root.querySelector('#t-levies').value = totals.levies.toFixed(2);
      root.querySelector('#t-gst').value = totals.gst.toFixed(2);
      recomputeFinalTotal();
    }

    function recomputeFinalTotal() {
      const total = getNum(root, 't-subtotal') + getNum(root, 't-gst') - getNum(root, 't-levies') - getNum(root, 't-freight');
      root.querySelector('#t-total').textContent = money(total, 2);
    }

    if (existingInvoice) {
      root.querySelector('#t-subtotal').value = existingInvoice.subtotalExGST.toFixed(2);
      root.querySelector('#t-freight').value = existingInvoice.freightTotal.toFixed(2);
      root.querySelector('#t-levies').value = existingInvoice.levies.toFixed(2);
      root.querySelector('#t-gst').value = existingInvoice.gst.toFixed(2);
      recomputeFinalTotal();
    } else {
      recomputeTotals();
    }

    root.querySelector('#save-invoice').addEventListener('click', () => {
      const lines = buildLines();
      if (lines.length === 0) {
        alert('Select at least one load, or enter a manual tonnage / custom item.');
        return;
      }
      const totalTons = lines.reduce((s, l) => s + (Number(l.tons) || 0), 0);
      const subtotalExGST = getNum(root, 't-subtotal');
      const freightTotal = getNum(root, 't-freight');
      const levies = getNum(root, 't-levies');
      const gst = getNum(root, 't-gst');
      const totalPayable = subtotalExGST + gst - levies - freightTotal;

      if (existingInvoice) {
        db.updateInvoice(existingInvoice.id, { lines, totalTons, subtotalExGST, freightTotal, levies, gst, totalPayable });
        openInvoiceDocSheet(sale, db.getInvoicesForSale(sale.id).find((i) => i.id === existingInvoice.id));
      } else {
        const business = db.getBusinessDetails();
        const today = new Date().toISOString().slice(0, 10);
        const dueDate = new Date(Date.now() + (Number(business.paymentTermsDays) || 0) * 86400000).toISOString().slice(0, 10);
        const invoice = db.createInvoice({ saleId: sale.id, issueDate: today, dueDate, lines, totalTons, subtotalExGST, freightTotal, levies, gst, totalPayable });
        openInvoiceDocSheet(sale, invoice);
      }
    });
  });
  return body;
}

function addCustomItemRow(container, onChange, existing) {
  const row = document.createElement('div');
  row.className = 'grid-2 ci-row';
  row.style.marginBottom = '6px';
  row.innerHTML = `
    <input type="text" class="ci-desc" placeholder="e.g. Quality premium" value="${existing ? esc(existing.description || '') : ''}" />
    <div style="display:flex;gap:6px">
      <input type="number" step="0.01" class="ci-amount" placeholder="Amount (+/-)" style="flex:1" value="${existing ? existing.subtotal : ''}" />
      <button type="button" class="btn danger small ci-remove" style="width:auto">&times;</button>
    </div>
  `;
  container.appendChild(row);
  row.querySelector('.ci-amount').addEventListener('input', onChange);
  row.querySelector('.ci-remove').addEventListener('click', () => { row.remove(); onChange(); });
}

function readCustomItems(container) {
  return Array.from(container.querySelectorAll('.ci-row')).map((row) => ({
    description: row.querySelector('.ci-desc').value.trim(),
    amount: parseFloat(row.querySelector('.ci-amount').value) || 0,
  }));
}

function invoiceDocHTML(sale, invoice, business, commodity) {
  return `
    <div class="invoice-doc">
      <h2 class="title">TAX INVOICE</h2>
      <div class="invoice-meta">
        <span>Invoice #${invoice.invoiceNo}</span>
        <span>Invoice date: <strong>${esc(invoice.issueDate)}</strong></span>
        <span>Payment due: <strong>${esc(invoice.dueDate)}</strong></span>
        ${sale.contractNo ? `<span>Contract: <strong>${esc(sale.contractNo)}</strong></span>` : ''}
      </div>
      <div class="invoice-parties">
        <div class="invoice-block">
          <h3>Seller</h3>
          <div class="line"><strong>${esc(business.entityName || '—')}</strong></div>
          ${business.abn ? `<div class="line">ABN ${esc(business.abn)}</div>` : ''}
          ${business.ngr ? `<div class="line">NGR ${esc(business.ngr)}</div>` : ''}
          ${business.address ? `<div class="line">${esc(business.address)}</div>` : ''}
          ${business.contactName ? `<div class="line">${esc(business.contactName)}</div>` : ''}
          ${business.phone ? `<div class="line">${esc(business.phone)}</div>` : ''}
          ${business.email ? `<div class="line">${esc(business.email)}</div>` : ''}
        </div>
        <div class="invoice-block">
          <h3>Buyer</h3>
          <div class="line"><strong>${esc(sale.buyer || '—')}</strong></div>
          ${sale.buyerAbn ? `<div class="line">ABN ${esc(sale.buyerAbn)}</div>` : ''}
          ${sale.buyerAddress ? `<div class="line">${esc(sale.buyerAddress)}</div>` : ''}
        </div>
      </div>
      <div class="line" style="margin-bottom:10px"><strong>Commodity:</strong> ${esc(commodity?.name || '—')}${sale.grade ? ` (${esc(sale.grade)})` : ''}${sale.location ? ` &middot; ${esc(sale.location)}` : ''}</div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Rego / item</th><th>Tonnes</th><th>Rate</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${invoice.lines.map((l) => `
              <tr>
                <td>${esc(l.date || '—')}</td>
                <td>${esc(l.description || l.rego || '—')}</td>
                <td>${l.tons != null ? num(l.tons, 2) : '—'}</td>
                <td>${l.rate != null ? money(l.rate, 2) : '—'}</td>
                <td>${money(l.subtotal, 2)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="2">Total</td>
            <td>${num(invoice.totalTons, 2)}</td>
            <td></td>
            <td>${money(invoice.subtotalExGST, 2)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="invoice-totals">
        <div class="row"><span class="label">Subtotal (Ex GST)</span><span class="value">${money(invoice.subtotalExGST, 2)}</span></div>
        ${invoice.freightTotal > 0 ? `<div class="row"><span class="label">Freight</span><span class="value">-${money(invoice.freightTotal, 2)}</span></div>` : ''}
        <div class="row"><span class="label">Grain levies</span><span class="value">-${money(invoice.levies, 2)}</span></div>
        <div class="row"><span class="label">GST</span><span class="value">${money(invoice.gst, 2)}</span></div>
        <div class="row total"><span class="label">Total amount payable</span><span class="value">${money(invoice.totalPayable, 2)}</span></div>
      </div>
      ${(business.bankName || business.accountNumber) ? `
      <div class="invoice-bank">
        <strong>Payment details</strong><br/>
        ${business.bankName ? `${esc(business.bankName)} &middot; ` : ''}${business.accountName ? `${esc(business.accountName)} &middot; ` : ''}${business.bsb ? `BSB ${esc(business.bsb)} &middot; ` : ''}${business.accountNumber ? `Acc ${esc(business.accountNumber)}` : ''}
      </div>` : ''}
    </div>
  `;
}

function openInvoiceDocSheet(sale, invoice) {
  const { commodities } = db.get();
  const commodity = commodities.find((c) => c.id === sale.commodityId);
  const business = db.getBusinessDetails();
  const isPaid = invoice.status === 'paid';

  openSheet(`Invoice #${invoice.invoiceNo}`, (root) => {
    root.innerHTML = `
      <div class="row"><span class="label"><strong>Status</strong></span><span class="value"><span class="badge ${isPaid ? 'pos' : 'neg'}">${isPaid ? 'Paid' : 'Outstanding'}</span></span></div>
      <div class="grid-2" style="margin:10px 0">
        <button class="btn ${isPaid ? 'secondary' : ''}" id="toggle-paid">${isPaid ? 'Mark as outstanding' : 'Mark as paid'}</button>
        <button class="btn secondary" id="edit-invoice">Edit</button>
      </div>
      ${invoiceDocHTML(sale, invoice, business, commodity)}
      <button class="btn" id="print-invoice" style="margin-top:14px">Print / Save as PDF</button>
      <button class="btn danger" id="delete-invoice" style="margin-top:8px">Delete invoice</button>
    `;
    root.querySelector('#toggle-paid').addEventListener('click', () => {
      db.setInvoiceStatus(invoice.id, isPaid ? 'outstanding' : 'paid');
      const refreshed = db.getInvoicesForSale(sale.id).find((i) => i.id === invoice.id);
      openInvoiceDocSheet(sale, refreshed);
    });
    root.querySelector('#edit-invoice').addEventListener('click', () => openInvoiceBuilderSheet(sale, invoice));
    root.querySelector('#print-invoice').addEventListener('click', () => window.print());
    root.querySelector('#delete-invoice').addEventListener('click', () => {
      confirmDelete(`Delete invoice #${invoice.invoiceNo}? This cannot be undone.`, () => {
        db.deleteInvoice(invoice.id);
        closeSheet();
        paintList(sale);
      });
    });
  });
}
