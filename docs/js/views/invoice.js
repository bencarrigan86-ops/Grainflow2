import { db } from '../storage.js?v=34';
import { movementsForEndpoint, invoiceLineItems, invoiceTotals, invoicedMovementIds } from '../derived.js?v=34';
import { num, money, esc } from '../fmt.js?v=34';
import { openSheet, field, getVal, getNum } from '../ui.js?v=34';

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
    root.querySelector('#new-invoice').addEventListener('click', () => openLoadSelectionSheet(sale));
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
        <div class="meta">${esc(inv.issueDate)} &middot; ${loadCount} load${loadCount === 1 ? '' : 's'}</div>
      </div>
      <div class="right">
        <div class="main">${money(inv.totalPayable, 2)}</div>
        <div class="meta"><span class="badge ${isPaid ? 'pos' : 'neg'}">${isPaid ? 'Paid' : 'Outstanding'}</span></div>
      </div>
    </div>
  `;
}

/** Pick which loads (movements) go on a new invoice, plus an optional manual line. */
function openLoadSelectionSheet(sale) {
  const { movements } = db.get();
  const allForSale = movementsForEndpoint('sale', sale.id, movements);
  const already = invoicedMovementIds(db.getInvoicesForSale(sale.id));
  const available = allForSale.filter((m) => !already.has(m.id));
  const alreadyCount = allForSale.length - available.length;

  openSheet('New invoice', (root) => {
    root.innerHTML = `
      ${alreadyCount > 0 ? `<div class="field hint" style="margin-bottom:10px">${alreadyCount} load${alreadyCount === 1 ? '' : 's'} already on a previous invoice — not shown below.</div>` : ''}
      ${available.length === 0 ? `<div class="empty">No un-invoiced loads for this contract.</div>` : available.map((m) => `
        <label class="list-item" style="cursor:pointer">
          <div style="display:flex;align-items:center;gap:10px">
            <input type="checkbox" class="ld-check" data-mid="${m.id}" checked style="width:18px;height:18px" />
            <div>
              <div class="main">${esc(m.date || 'No date')}${m.truckRego ? ` &middot; ${esc(m.truckRego)}` : ''}</div>
              <div class="meta">${num(m.tons, 2)} t</div>
            </div>
          </div>
        </label>
      `).join('')}
      <hr class="sep" />
      ${field({ label: 'Manual line (optional — tons not linked to a load)', id: 'manual-tons', type: 'number', step: '0.01' })}
      <button class="btn" id="create-invoice" style="margin-top:12px">Create invoice</button>
    `;
    root.querySelector('#create-invoice').addEventListener('click', () => {
      const checkedIds = Array.from(root.querySelectorAll('.ld-check:checked')).map((el) => el.dataset.mid);
      const selectedMovements = available.filter((m) => checkedIds.includes(m.id));
      const lines = invoiceLineItems(sale, selectedMovements);
      const manualTons = getNum(root, 'manual-tons');
      if (manualTons > 0) {
        const rate = (Number(sale.price) || 0) + (Number(sale.premiumDiscount) || 0);
        lines.push({ date: sale.date, rego: '—', tons: manualTons, movementId: null, rate, subtotal: manualTons * rate });
      }
      if (lines.length === 0) {
        alert('Select at least one load, or enter a manual tonnage.');
        return;
      }
      lines.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const totals = invoiceTotals(sale, lines);
      const business = db.getBusinessDetails();
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = new Date(Date.now() + (Number(business.paymentTermsDays) || 0) * 86400000).toISOString().slice(0, 10);
      const invoice = db.createInvoice({ saleId: sale.id, issueDate: today, dueDate, lines, ...totals });
      openInvoiceDocSheet(sale, invoice);
    });
  });
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
          <thead><tr><th>Date</th><th>Rego</th><th>Tonnes</th><th>Rate</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${invoice.lines.map((l) => `
              <tr>
                <td>${esc(l.date || '—')}</td>
                <td>${esc(l.rego)}</td>
                <td>${num(l.tons, 2)}</td>
                <td>${money(l.rate, 2)}</td>
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
      <button class="btn ${isPaid ? 'secondary' : ''}" id="toggle-paid" style="margin:10px 0">${isPaid ? 'Mark as outstanding' : 'Mark as paid'}</button>
      ${invoiceDocHTML(sale, invoice, business, commodity)}
      <button class="btn" id="print-invoice" style="margin-top:14px">Print / Save as PDF</button>
    `;
    root.querySelector('#toggle-paid').addEventListener('click', () => {
      db.setInvoiceStatus(invoice.id, isPaid ? 'outstanding' : 'paid');
      const refreshed = db.getInvoicesForSale(sale.id).find((i) => i.id === invoice.id);
      openInvoiceDocSheet(sale, refreshed);
    });
    root.querySelector('#print-invoice').addEventListener('click', () => window.print());
  });
}
