import { db } from '../storage.js?v=319';
import { movementsForEndpoint, invoiceLineItems, invoiceTotals, invoicedMovementIds, toTonsForEndpoint, freightOnInvoice, rctiCheck } from '../derived.js?v=319';
import { num, money, esc, dmy, todayLocal } from '../fmt.js?v=319';
import { addressLinesOf } from '../address.js?v=319';
import { signedBlockHTML, canSign } from '../signdoc.js?v=319';
import { signToggleHtml, wireSignToggle } from './signtoggle.js?v=319';
import { attachmentsHtml, wireAttachments } from './attachments.js?v=319';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, notify, askConfirm, toast } from '../ui.js?v=319';
import { isAdjustment, invoiceLabel, noteLabel, netPayable, rctiAdjustment, buildAdjustment } from '../adjustment.js?v=319';

/** Entry point from the Sales sheet: shows past invoices for this sale, plus "New invoice". */
export function openInvoiceListSheet(sale) {
  paintList(sale);
}

function paintList(sale) {
  const all = db.getInvoicesForSale(sale.id);
  // newest invoice first, each with its adjustment notes straight under it
  const numberOf = (inv) => (isAdjustment(inv)
    ? (Number(all.find((i) => i.id === inv.adjustsInvoiceId)?.invoiceNo) || Number(inv.adjustsInvoiceNo) || 0) - (Number(inv.noteNo) || 0) / 1000
    : Number(inv.invoiceNo) || 0);
  const invoices = all.sort((a, b) => numberOf(b) - numberOf(a));
  // a credit note takes its amount off what the buyer owes, so the notes count here with their sign
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
  if (isAdjustment(inv)) {
    return `
    <div class="list-item" data-view-invoice="${inv.id}" style="margin-left:14px">
      <div>
        <div class="main">${esc(invoiceLabel(inv))}</div>
        <div class="meta">${esc(dmy(inv.issueDate))}${inv.adjustsInvoiceNo != null ? ` &middot; adjusts invoice #${esc(inv.adjustsInvoiceNo)}` : ''} &middot; ${esc(inv.reason || '')}</div>
      </div>
      <div class="right">
        <div class="main">${money(inv.totalPayable, 2)}</div>
        <div class="meta"><span class="badge ${isPaid ? 'pos' : 'neg'}">${inv.appliedToInvoice ? 'On the invoice' : isPaid ? 'Settled' : 'Open'}</span></div>
      </div>
    </div>`;
  }
  const loadCount = inv.lines.length;
  const rcti = rctiCheck(inv);
  return `
    <div class="list-item" data-view-invoice="${inv.id}">
      <div>
        <div class="main">Invoice #${inv.invoiceNo}</div>
        <div class="meta">${esc(dmy(inv.issueDate))} &middot; ${loadCount} item${loadCount === 1 ? '' : 's'}${rcti && !rcti.agrees ? ` &middot; <span style="color:var(--danger,#c0392b);font-weight:600">RCTI ${rcti.diff < 0 ? 'less' : 'more'} by ${money(Math.abs(rcti.diff), 2)}</span>` : ''}</div>
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
  // the freight $/t each load had when this invoice was made (older invoices have none: they take the contract's)
  const existingLineFreight = new Map((existingInvoice?.lines || []).filter((l) => l.movementId && l.freightRate != null).map((l) => [l.movementId, l.freightRate]));
  const existingManual = (existingInvoice?.lines || []).find((l) => l.isManual);
  const existingCustoms = (existingInvoice?.lines || []).filter((l) => l.isCustom);
  // adjustment notes applied to this invoice: lines of their own, kept as they are, whose amounts go on top of the totals
  const adjustmentLines = (existingInvoice?.lines || []).filter((l) => l.isAdjustmentLine);

  const body = openSheet(existingInvoice ? `Edit invoice #${existingInvoice.invoiceNo}` : 'New invoice', (root) => {
    root.innerHTML = `
      ${alreadyCount > 0 ? `<div class="field hint" style="margin-bottom:10px">${alreadyCount} load${alreadyCount === 1 ? '' : 's'} already on another invoice — not shown below.</div>` : ''}
      ${available.length === 0 ? `<div class="empty">No un-invoiced loads for this contract.</div>` : available.map((m) => `
        <label class="list-item" style="cursor:pointer">
          <div style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" class="ld-check" data-mid="${m.id}" ${existingInvoice ? (existingMovementIds.has(m.id) ? 'checked' : '') : 'checked'} style="width:18px;height:18px" />
            <div>
              <div class="main">${esc(dmy(m.date) || 'No date')}${m.truckRego ? ` &middot; ${esc(m.truckRego)}` : ''}</div>
              <div class="meta">${num(toTonsForEndpoint(m, 'sale', sale.id), 2)} t</div>
            </div>
            ${freightOnInvoice(sale) ? `<div style="margin-left:auto;flex:none;width:88px">
              <input type="number" inputmode="decimal" step="0.01" class="ld-freight" style="width:100%;min-width:0;box-sizing:border-box;padding:8px 6px" data-mid="${m.id}" value="${existingLineFreight.has(m.id) ? existingLineFreight.get(m.id) : (Number(sale.freight) || 0)}" aria-label="Freight $/t for this load" />
              <div class="meta" style="text-align:right">freight $/t</div>
            </div>` : ''}
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
    root.querySelectorAll('.ld-freight').forEach((el) => el.addEventListener('input', recomputeTotals));
    ['t-subtotal', 't-freight', 't-levies', 't-gst'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeFinalTotal));

    function buildLines() {
      const checkedIds = Array.from(root.querySelectorAll('.ld-check:checked')).map((el) => el.dataset.mid);
      const selectedMovements = available.filter((m) => checkedIds.includes(m.id));
      const freightRates = {};
      root.querySelectorAll('.ld-freight').forEach((el) => { freightRates[el.dataset.mid] = el.value; });
      const lines = invoiceLineItems(sale, selectedMovements, freightRates);
      const rate =(Number(sale.price) || 0) + (Number(sale.premiumDiscount) || 0);
      const manualTons = getNum(root, 'manual-tons');
      if (manualTons > 0) {
        lines.push({ date: sale.date, rego: '—', tons: manualTons, movementId: null, basePrice: Number(sale.price) || 0, adjust: Number(sale.premiumDiscount) || 0, rate, subtotal: manualTons * rate, freightRate: freightOnInvoice(sale) ? Number(sale.freight) || 0 : 0, freight: freightOnInvoice(sale) ? manualTons * (Number(sale.freight) || 0) : 0, isManual: true });
      }
      readCustomItems(customContainer).forEach((item) => {
        if (item.amount === 0) return;
        lines.push({ date: sale.date, rego: item.description || 'Adjustment', tons: null, movementId: null, rate: null, subtotal: item.amount, description: item.description, isCustom: true });
      });
      lines.push(...adjustmentLines);
      lines.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return lines;
    }

    function recomputeTotals() {
      const lines = buildLines();
      // the levies and the GST are worked out on the grain and the items; an applied adjustment moves the totals by its own amounts
      const totals = invoiceTotals(sale, lines.filter((l) => !l.isAdjustmentLine));
      totals.subtotalExGST += adjustmentLines.reduce((sum, l) => sum + (Number(l.subtotal) || 0), 0);
      totals.gst += adjustmentLines.reduce((sum, l) => sum + (Number(l.gst) || 0), 0);
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
        notify('Select at least one load, or enter a manual tonnage / custom item.');
        return;
      }
      const totalTons = lines.reduce((s, l) => s + (Number(l.tons) || 0), 0);
      const subtotalExGST = getNum(root, 't-subtotal');
      const freightTotal = getNum(root, 't-freight');
      const levies = getNum(root, 't-levies');
      const gst = getNum(root, 't-gst');
      const totalPayable = subtotalExGST + gst - levies - freightTotal;

      const business = db.getBusinessDetails();
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(Date.now() + (Number(business.paymentTermsDays) || 0) * 86400000).toISOString().slice(0, 10);
      if (existingInvoice) {
        // an invoice that lost its dates (see mapping.js) gets them back when it is worked out again
        db.updateInvoice(existingInvoice.id, {
          lines, totalTons, subtotalExGST, freightTotal, levies, gst, totalPayable,
          ...(existingInvoice.issueDate ? {} : { issueDate: today }),
          ...(existingInvoice.dueDate ? {} : { dueDate }),
        });
        openInvoiceDocSheet(sale, db.getInvoicesForSale(sale.id).find((i) => i.id === existingInvoice.id));
      } else {
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

/** The seller and the buyer, the same on an invoice and on an adjustment note. */
function partiesHTML(sale, business) {
  return `
      <div class="invoice-parties">
        <div class="invoice-block">
          <h3>Seller</h3>
          <div class="line"><strong>${esc(business.entityName || '—')}</strong></div>
          ${business.abn ? `<div class="line">ABN ${esc(business.abn)}</div>` : ''}
          ${business.ngr ? `<div class="line">NGR ${esc(business.ngr)}</div>` : ''}
          ${addressLinesOf(business.address, business.addressParts).map((l) => `<div class="line">${esc(l)}</div>`).join('')}
          ${business.contactName ? `<div class="line">${esc(business.contactName)}</div>` : ''}
          ${business.phone ? `<div class="line">${esc(business.phone)}</div>` : ''}
          ${business.email ? `<div class="line">${esc(business.email)}</div>` : ''}
        </div>
        <div class="invoice-block">
          <h3>Buyer</h3>
          <div class="line"><strong>${esc(sale.buyer || '—')}</strong></div>
          ${sale.buyerAbn ? `<div class="line">ABN ${esc(sale.buyerAbn)}</div>` : ''}
          ${addressLinesOf(sale.buyerAddress, sale.buyerAddressParts).map((l) => `<div class="line">${esc(l)}</div>`).join('')}
        </div>
      </div>`;
}

function invoiceDocHTML(sale, invoice, business, commodity, signed = null) {
  // loads with freight taken off go in a section of their own below the grain, not in the grain table
  const freightLines = invoice.lines.filter((l) => l.movementId && Number(l.freight) > 0);
  return `
    <div class="invoice-doc">
      <h2 class="title">TAX INVOICE</h2>
      <div class="invoice-meta">
        <span>Invoice #${invoice.invoiceNo}</span>
        <span>Invoice date: <strong>${esc(dmy(invoice.issueDate))}</strong></span>
        <span>Payment due: <strong>${esc(dmy(invoice.dueDate))}</strong></span>
        ${sale.contractNo ? `<span>Contract: <strong>${esc(sale.contractNo)}</strong></span>` : ''}
      </div>
      ${partiesHTML(sale, business)}
      <div class="line" style="margin-bottom:10px"><strong>Commodity:</strong> ${esc(commodity?.name || '—')}${sale.grade ? ` (${esc(sale.grade)})` : ''}${sale.location ? ` &middot; ${esc(sale.location)}` : ''}</div>
      <div class="table-scroll">
        <table>
          <thead><tr>
            <th>Date</th><th>Ticket</th><th>Rego / item</th><th>Grade</th><th>Tonnes</th><th>Base $/t</th><th>Prem / disc $/t</th><th>Rate</th><th>Subtotal</th>
          </tr></thead>
          <tbody>
            ${invoice.lines.map((l) => `
              <tr>
                <td>${esc(dmy(l.date) || '—')}</td>
                <td>${esc(l.ticketNo || '—')}</td>
                <td>${esc(l.description || l.rego || '—')}</td>
                <td>${esc(l.grade || '—')}</td>
                <td>${l.tons != null ? num(l.tons, 2) : '—'}</td>
                <td>${l.basePrice != null ? money(l.basePrice, 2) : '—'}</td>
                <td>${l.adjust != null ? `${l.adjust > 0 ? '+' : ''}${money(l.adjust, 2)}` : '—'}</td>
                <td>${l.rate != null ? money(l.rate, 2) : '—'}</td>
                <td>${money(l.subtotal, 2)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="4">Total</td>
            <td>${num(invoice.totalTons, 2)}</td>
            <td colspan="3"></td>
            <td>${money(invoice.subtotalExGST, 2)}</td>
          </tr></tfoot>
        </table>
      </div>
      ${freightLines.length ? `
      <h3 style="margin:14px 0 6px">Freight deducted</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Rego</th><th>Tonnes</th><th>Freight $/t</th><th>Amount</th></tr></thead>
          <tbody>
            ${freightLines.map((l) => `
              <tr>
                <td>${esc(dmy(l.date) || '—')}</td>
                <td>${esc(l.rego || '—')}</td>
                <td>${num(l.tons, 2)}</td>
                <td>${money(l.freightRate, 2)}</td>
                <td>${money(l.freight, 2)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="2">Total freight</td>
            <td>${num(freightLines.reduce((s, l) => s + (Number(l.tons) || 0), 0), 2)}</td>
            <td></td>
            <td>${money(freightLines.reduce((s, l) => s + (Number(l.freight) || 0), 0), 2)}</td>
          </tr></tfoot>
        </table>
      </div>` : ''}
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
      ${signed && canSign(signed.sig) ? `<div class="invoice-bank">${signedBlockHTML(signed.sig, { date: signed.date })}</div>` : ''}
    </div>
  `;
}

function openInvoiceDocSheet(sale, invoice) {
  if (isAdjustment(invoice)) { openAdjustmentDocSheet(sale, invoice); return; }
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
      ${db.getRole() === 'manager' && !(business.bankName || business.accountNumber) ? '<div class="hint doc-actions" style="margin:6px 0">The payment details are kept from managers, so they are not on this copy. The owner or bookkeeper prints the invoice with them.</div>' : ''}
      <div class="doc-actions">${signToggleHtml('sign-doc', 'Sign this invoice with my signature')}</div>
      <div id="doc-holder">${invoiceDocHTML(sale, invoice, business, commodity)}</div>
      <div class="card input" style="margin-top:14px" id="rcti-card">
        <h2><span class="dot input"></span>Buyer's RCTI</h2>
        <div class="hint">Type what the buyer's recipient created tax invoice says, to see whether it agrees with this invoice. This is for you: it is not printed on the invoice.</div>
        <div class="grid-2">
          ${field({ label: 'RCTI number', id: 'rcti-no', value: invoice.rctiNo || '' })}
          ${field({ label: 'RCTI total payable ($)', id: 'rcti-total', type: 'number', step: '0.01', value: rctiCheck(invoice) ? invoice.rctiTotal : '' })}
        </div>
        <div id="rcti-result"></div>
        <button class="btn secondary" id="rcti-save" type="button">Save RCTI</button>
      </div>
      <div class="card input doc-actions" style="margin-top:14px" id="adj-card">${adjustmentsCardHtml(invoice)}</div>
      ${attachmentsHtml('invoice', invoice.documents || [], { sub: 'A copy of the invoice, the remittance, proof of delivery' })}
      <button class="btn" id="print-invoice" style="margin-top:14px">Print / Save as PDF</button>
      <button class="btn danger" id="delete-invoice" style="margin-top:8px">Delete invoice</button>
    `;
    wireAttachments(root, {
      parentType: 'invoice', parentId: invoice.id, docs: invoice.documents || [],
      persist: (documents) => db.updateInvoice(invoice.id, { documents }),
    });
    root.querySelector('#toggle-paid').addEventListener('click', () => {
      db.setInvoiceStatus(invoice.id, isPaid ? 'outstanding' : 'paid');
      const refreshed = db.getInvoicesForSale(sale.id).find((i) => i.id === invoice.id);
      openInvoiceDocSheet(sale, refreshed);
    });
    root.querySelector('#edit-invoice').addEventListener('click', () => openInvoiceBuilderSheet(sale, invoice));
    // our invoice against the buyer's RCTI
    const showRcti = (inv) => {
      const c = rctiCheck(inv);
      root.querySelector('#rcti-result').innerHTML = !c ? '' : c.agrees
        ? `<div class="row"><span class="label">Against our invoice</span><span class="value"><span class="badge pos">Agrees</span></span></div>`
        : `<div class="row"><span class="label">Our invoice</span><span class="value">${money(c.ours, 2)}</span></div>
           <div class="row"><span class="label">Their RCTI</span><span class="value">${money(c.theirs, 2)}</span></div>
           <div class="row"><span class="label"><strong>Difference</strong></span><span class="value"><span class="badge neg">${c.diff < 0 ? 'RCTI is less by' : 'RCTI is more by'} ${money(Math.abs(c.diff), 2)}</span></span></div>`;
    };
    showRcti(invoice);
    root.querySelector('#rcti-save').addEventListener('click', () => {
      const raw = String(getVal(root, 'rcti-total') ?? '').trim();
      const patch = { rctiNo: String(getVal(root, 'rcti-no') ?? '').trim(), rctiTotal: raw === '' ? null : getNum(root, 'rcti-total') };
      db.updateInvoice(invoice.id, patch);
      showRcti({ ...invoice, ...patch });
      const fresh = db.getInvoicesForSale(sale.id).find((i) => i.id === invoice.id) || invoice;
      root.querySelector('#adj-card').innerHTML = adjustmentsCardHtml(fresh);
      wireAdjustmentsCard();
      toast('RCTI saved');
    });
    // the adjustment notes on this invoice, and a way to make one (from the RCTI difference when there is one)
    const wireAdjustmentsCard = () => {
      root.querySelectorAll('[data-view-note]').forEach((el) => el.addEventListener('click', () => {
        const note = db.getInvoicesForSale(sale.id).find((i) => i.id === el.dataset.viewNote);
        if (note) openAdjustmentDocSheet(sale, note);
      }));
      root.querySelector('#adj-new')?.addEventListener('click', () => {
        const fresh = db.getInvoicesForSale(sale.id).find((i) => i.id === invoice.id) || invoice;
        openAdjustmentSheet(sale, fresh);
      });
    };
    wireAdjustmentsCard();
    wireSignToggle(root, 'sign-doc', (sig) => {
      root.querySelector('#doc-holder').innerHTML = invoiceDocHTML(sale, invoice, business, commodity, sig ? { sig, date: dmy(todayLocal()) } : null);
    });
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

// --- Adjustment notes: a correction to an invoice that has already gone out (see adjustment.js) ---

/** The notes on one invoice, with what they make the amount payable, and the button to add one. */
function adjustmentsCardHtml(invoice) {
  const { invoiceTotal, notes, adjustments, net } = netPayable(invoice, db.getInvoicesForSale(invoice.saleId));
  const rcti = rctiAdjustment(invoice);
  return `
    <h2><span class="dot input"></span>Adjustment notes</h2>
    <div class="hint">When something changes after an invoice has gone out, such as the buyer's RCTI coming to a different total, an adjustment note records the difference, with a number of its own, and the invoice can be corrected to match.</div>
    ${notes.map((n) => `
      <div class="list-item" data-view-note="${n.id}">
        <div><div class="main">${esc(noteLabel(n))} &middot; ${esc(dmy(n.issueDate))}</div><div class="meta">${esc(n.reason || '')}</div></div>
        <div class="right"><div class="main">${money(n.totalPayable, 2)}</div><div class="meta"><span class="badge ${n.status === 'paid' ? 'pos' : 'neg'}">${n.appliedToInvoice ? 'On the invoice' : n.status === 'paid' ? 'Settled' : 'Open'}</span></div></div>
      </div>`).join('')}
    ${notes.length ? `
      <div class="row"><span class="label">Invoice as first issued</span><span class="value">${money(invoiceTotal, 2)}</span></div>
      <div class="row"><span class="label">Adjustments</span><span class="value">${money(adjustments, 2)}</span></div>
      <div class="row"><span class="label"><strong>Now payable</strong></span><span class="value"><strong>${money(net, 2)}</strong></span></div>` : ''}
    <button class="btn secondary" id="adj-new" type="button" style="margin-top:8px">${rcti ? `Make an adjustment note for the ${money(Math.abs(rcti.amount), 2)} difference` : 'Add an adjustment note'}</button>`;
}

/** The form for a new note. The amount starts as the difference against the buyer's RCTI when there is one. */
function openAdjustmentSheet(sale, original) {
  const rcti = rctiAdjustment(original);
  openSheet(`Adjustment note for invoice #${original.invoiceNo}`, (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:8px">Invoice #${esc(original.invoiceNo)} is not changed. This makes a separate numbered note that says what is different and why, and it counts in what the buyer owes.</div>
      ${field({ label: 'Date', id: 'adj-date', type: 'date', value: todayLocal() })}
      ${field({ label: 'Adjustment ($, GST included)', id: 'adj-amount', type: 'number', step: '0.01', allowNegative: true, value: rcti ? rcti.amount : '', hint: 'Negative takes money off what the buyer owes. Positive adds to it.' })}
      <label class="list-item" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="adj-gst" checked style="width:18px;height:18px" />
          <div><div class="main">GST applies to this amount</div><div class="meta">Untick a difference in levies or freight, which carry no GST</div></div>
        </div>
      </label>
      ${field({ label: 'Reason', id: 'adj-reason', value: rcti ? rcti.reason : '', placeholder: 'e.g. Quality discount, weight difference' })}
      <label class="list-item" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="adj-apply" checked style="width:18px;height:18px" />
          <div><div class="main">Also correct invoice #${esc(original.invoiceNo)}</div><div class="meta">The invoice gets a line for this adjustment and comes to the corrected total, so it agrees with the buyer. Untick to leave the invoice as it was sent.</div></div>
        </div>
      </label>
      <div id="adj-preview" style="margin-top:8px"></div>
      <button class="btn" id="adj-save" style="margin-top:12px">Create adjustment note</button>`;

    const make = () => buildAdjustment({
      original, amount: getNum(root, 'adj-amount'), gstApplies: root.querySelector('#adj-gst').checked,
      reason: getVal(root, 'adj-reason'), issueDate: getVal(root, 'adj-date') || todayLocal(),
      paymentTermsDays: db.getBusinessDetails().paymentTermsDays,
      applyToInvoice: root.querySelector('#adj-apply').checked,
    });
    const preview = () => {
      const note = make();
      root.querySelector('#adj-preview').innerHTML = !note ? '' : `
        <div class="row"><span class="label">Before GST</span><span class="value">${money(note.subtotalExGST, 2)}</span></div>
        <div class="row"><span class="label">GST</span><span class="value">${money(note.gst, 2)}</span></div>
        <div class="row"><span class="label"><strong>${note.totalPayable < 0 ? 'Credit to the buyer' : 'Additional charge'}</strong></span><span class="value"><strong>${money(note.totalPayable, 2)}</strong></span></div>
        <div class="row"><span class="label">Invoice #${esc(original.invoiceNo)} then comes to</span><span class="value">${money(netPayable(original, db.getInvoicesForSale(original.saleId)).net + note.totalPayable, 2)}</span></div>
        <div class="hint">${note.appliedToInvoice ? 'The invoice will show this adjustment and come to that amount.' : 'The invoice stays as sent; this note is owed or credited on top of it.'}</div>`;
    };
    ['adj-amount', 'adj-reason', 'adj-date'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', preview));
    root.querySelector('#adj-gst').addEventListener('change', preview);
    root.querySelector('#adj-apply').addEventListener('change', preview);
    preview();

    root.querySelector('#adj-save').addEventListener('click', () => {
      const note = make();
      if (!note) { notify('Enter the adjustment amount. It cannot be nothing.'); return; }
      openAdjustmentDocSheet(sale, db.createAdjustment(note));
    });
  });
}

/** The note as a page to print: its number, the invoice it adjusts, why, the amounts, and what the invoice now comes to. */
function adjustmentDocHTML(sale, note, business, invoices) {
  const original = invoices.find((i) => i.id === note.adjustsInvoiceId);
  const { invoiceTotal, adjustments, net } = original ? netPayable(original, invoices) : { invoiceTotal: 0, adjustments: 0, net: 0 };
  const credit = Number(note.totalPayable) < 0;
  const adjusts = original ? `invoice #${esc(original.invoiceNo)}${original.issueDate ? ` dated ${esc(dmy(original.issueDate))}` : ''}` : (note.adjustsInvoiceNo != null ? `invoice #${esc(note.adjustsInvoiceNo)}` : 'an earlier invoice');
  return `
    <div class="invoice-doc">
      <h2 class="title">ADJUSTMENT NOTE</h2>
      <div class="invoice-meta">
        <span>Adjustment note <strong>${esc(noteLabel(note))}</strong></span>
        <span>Date: <strong>${esc(dmy(note.issueDate))}</strong></span>
        ${original ? `<span>Adjusts invoice: <strong>#${esc(original.invoiceNo)}</strong></span>` : ''}
        ${sale.contractNo ? `<span>Contract: <strong>${esc(sale.contractNo)}</strong></span>` : ''}
      </div>
      ${partiesHTML(sale, business)}
      <div class="line" style="margin-bottom:10px"><strong>Reason:</strong> ${esc(note.reason || '')}</div>
      <div class="line" style="margin-bottom:10px">This note ${credit ? 'decreases' : 'increases'} the amount payable on ${adjusts}.</div>
      <div class="invoice-totals">
        <div class="row"><span class="label">Adjustment (ex GST)</span><span class="value">${money(note.subtotalExGST, 2)}</span></div>
        <div class="row"><span class="label">GST</span><span class="value">${money(note.gst, 2)}</span></div>
        <div class="row total"><span class="label">${credit ? 'Total credit' : 'Total additional charge'}</span><span class="value">${money(note.totalPayable, 2)}</span></div>
      </div>
      ${original ? `
      <div class="invoice-totals" style="margin-top:14px">
        <div class="row"><span class="label">Invoice #${esc(original.invoiceNo)} as first issued</span><span class="value">${money(invoiceTotal, 2)}</span></div>
        <div class="row"><span class="label">Adjustment notes to date</span><span class="value">${money(adjustments, 2)}</span></div>
        <div class="row total"><span class="label">Amount now payable</span><span class="value">${money(net, 2)}</span></div>
      </div>` : ''}
      ${!credit && (business.bankName || business.accountNumber) ? `
      <div class="invoice-bank">
        <strong>Payment details</strong><br/>
        ${business.bankName ? `${esc(business.bankName)} &middot; ` : ''}${business.accountName ? `${esc(business.accountName)} &middot; ` : ''}${business.bsb ? `BSB ${esc(business.bsb)} &middot; ` : ''}${business.accountNumber ? `Acc ${esc(business.accountNumber)}` : ''}
      </div>` : ''}
    </div>`;
}

function openAdjustmentDocSheet(sale, note) {
  const business = db.getBusinessDetails();
  const invoices = db.getInvoicesForSale(sale.id);
  const original = invoices.find((i) => i.id === note.adjustsInvoiceId);
  const isSettled = note.status === 'paid';
  const onInvoice = !!note.appliedToInvoice;
  openSheet(noteLabel(note), (root) => {
    root.innerHTML = `
      <div class="row"><span class="label"><strong>Status</strong></span><span class="value"><span class="badge ${isSettled ? 'pos' : 'neg'}">${onInvoice ? 'On the invoice' : isSettled ? 'Settled' : 'Open'}</span></span></div>
      <div class="hint doc-actions" style="margin:6px 0">${onInvoice ? 'This adjustment is on the invoice, which now shows it and comes to the corrected total. Deleting the note takes it back off the invoice.' : Number(note.totalPayable) < 0 ? 'A credit takes this amount off what the buyer owes you until it is settled, for instance when the buyer pays the invoice less this amount.' : 'This amount is owed by the buyer on top of the invoice until it is settled.'}</div>
      <div class="grid-2 doc-actions" style="margin:10px 0">
        ${onInvoice ? '' : `<button class="btn ${isSettled ? 'secondary' : ''}" id="adj-toggle">${isSettled ? 'Mark as open' : 'Mark as settled'}</button>`}
        ${original ? '<button class="btn secondary" id="adj-open-invoice">Open the invoice</button>' : ''}
      </div>
      <div id="doc-holder">${adjustmentDocHTML(sale, note, business, invoices)}</div>
      <button class="btn" id="print-invoice" style="margin-top:14px">Print / Save as PDF</button>
      <button class="btn danger doc-actions" id="adj-delete" style="margin-top:8px">Delete adjustment note</button>`;
    root.querySelector('#adj-toggle')?.addEventListener('click', () => {
      db.setInvoiceStatus(note.id, isSettled ? 'outstanding' : 'paid');
      openAdjustmentDocSheet(sale, db.getInvoicesForSale(sale.id).find((i) => i.id === note.id));
    });
    root.querySelector('#adj-open-invoice')?.addEventListener('click', () => openInvoiceDocSheet(sale, original));
    root.querySelector('#print-invoice').addEventListener('click', () => window.print());
    root.querySelector('#adj-delete').addEventListener('click', () => {
      confirmDelete(`Delete adjustment note ${noteLabel(note)}?${onInvoice ? ' Its line and amount come off the invoice.' : ''} This cannot be undone.`, () => {
        db.deleteInvoice(note.id);
        closeSheet();
        paintList(sale);
      });
    });
  });
}
