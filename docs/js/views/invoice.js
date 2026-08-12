import { db } from '../storage.js?v=33';
import { invoiceForSale } from '../derived.js?v=33';
import { num, money, esc } from '../fmt.js?v=33';
import { openSheet } from '../ui.js?v=33';

export function openInvoiceSheet(sale) {
  const { commodities, movements } = db.get();
  const commodity = commodities.find((c) => c.id === sale.commodityId);
  const business = db.getBusinessDetails();
  const inv = invoiceForSale(sale, movements);

  const today = new Date();
  const issueDate = today.toLocaleDateString('en-AU');
  const dueDate = new Date(today.getTime() + (Number(business.paymentTermsDays) || 0) * 86400000).toLocaleDateString('en-AU');

  openSheet('Invoice', (root) => {
    root.innerHTML = `
      <div class="invoice-doc">
        <h2 class="title">TAX INVOICE</h2>
        <div class="invoice-meta">
          <span>Invoice date: <strong>${esc(issueDate)}</strong></span>
          <span>Payment due: <strong>${esc(dueDate)}</strong></span>
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
              ${inv.lines.map((l) => `
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
              <td>${num(inv.totalTons, 2)}</td>
              <td></td>
              <td>${money(inv.subtotalExGST, 2)}</td>
            </tr></tfoot>
          </table>
        </div>
        <div class="invoice-totals">
          <div class="row"><span class="label">Subtotal (Ex GST)</span><span class="value">${money(inv.subtotalExGST, 2)}</span></div>
          ${inv.freightTotal > 0 ? `<div class="row"><span class="label">Freight</span><span class="value">-${money(inv.freightTotal, 2)}</span></div>` : ''}
          <div class="row"><span class="label">Grain levies</span><span class="value">-${money(inv.levies, 2)}</span></div>
          <div class="row"><span class="label">GST</span><span class="value">${money(inv.gst, 2)}</span></div>
          <div class="row total"><span class="label">Total amount payable</span><span class="value">${money(inv.totalPayable, 2)}</span></div>
        </div>
        ${(business.bankName || business.accountNumber) ? `
        <div class="invoice-bank">
          <strong>Payment details</strong><br/>
          ${business.bankName ? `${esc(business.bankName)} &middot; ` : ''}${business.accountName ? `${esc(business.accountName)} &middot; ` : ''}${business.bsb ? `BSB ${esc(business.bsb)} &middot; ` : ''}${business.accountNumber ? `Acc ${esc(business.accountNumber)}` : ''}
        </div>` : ''}
      </div>
      <button class="btn" id="print-invoice" style="margin-top:14px">Print / Save as PDF</button>
    `;
    root.querySelector('#print-invoice').addEventListener('click', () => window.print());
  });
}
