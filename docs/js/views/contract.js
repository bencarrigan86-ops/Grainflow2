// A confirmation of sale, issued by the grower.
//
// The six real contracts on file are all the other way round: buyer's paper,
// confirming a trade a broker put together, sent to the farm to sign. In that
// arrangement the grower never writes anything.
//
// This is for the trades where nobody else does it — hay to a feedlot, grain
// to a neighbour, a direct deal with no broker and no trading house. Somebody
// still has to write down what was agreed, and a text message saying "600t at
// 340" is not that.
//
// Laid out to match what the trade expects, because a document that looks
// unfamiliar invites an argument about whether it counts. The order of terms
// follows the Cargill and Bunge confirmations: parties, commodity, quantity,
// price, delivery, payment, then the rules that govern.
//
// Printed through the browser rather than a PDF library. window.print() is how
// invoice.js already works, it produces a real PDF on a phone as readily as on
// a desktop, and it costs nothing to carry.

import { db } from '../storage.js?v=409';
import { openSheet, toast, notify, askConfirm } from '../ui.js?v=409';
import { esc, num, money, todayLocal, dmy } from '../fmt.js?v=409';
import { addressLinesOf } from '../address.js?v=409';
import { signedBlockHTML, canSign, signerName } from '../signdoc.js?v=409';
import { contactLines, splitContact } from '../buyercontact.js?v=409';
import { signToggleHtml, wireSignToggle, signerPickHtml, wireSignerPick } from './signtoggle.js?v=409';
import { DASH, longDate, termRows, confirmationPdf, confirmationFooting } from '../contractpdf.js?v=409';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=409';
import { fileSentCopy } from '../sentcopy.js?v=409';
import { docBandHTML } from '../docband.js?v=409';

/** One term, its value on one line or on several (an array). Omitted entirely when empty — a blank line invites a pen. */
const term = (label, value) => {
  const lines = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return lines.length
    ? `<div class="row"><span class="label">${esc(label)}</span><span class="value">${lines.map(esc).join('<br>')}</span></div>`
    : '';
};

/**
 * @param {object} sale
 * @param {object} business  the farm's business details (the logo is printed in the header when it has one)
 * @param {object} commodity
 * @param {{sig: object, date: string}|null} signed  the seller's saved signature, to print instead of the lines to sign on
 * @param {{showFreight?: boolean, showComments?: boolean, printedName?: string}} [opts]  showFreight: whether the freight rate is printed (default: yes, when there is one);
 *   showComments: whether the contract's comments are printed (default: yes, when there are any);
 *   printedName: the person's name printed under the seller's signature (default: the signed-in person's)
 */
export function contractDocHTML(sale, business, commodity, signed = null, { showFreight = true, showComments = true, printedName = '' } = {}) {
  const sellerName = String(printedName || signerName(signed?.sig, business)).trim();   // the person signing for the seller, printed under the signature

  return `
    <div class="invoice-doc branded">
      ${docBandHTML(business, { title: 'CONFIRMATION OF SALE', meta: [
        `<span>Contract ${esc(sale.contractNo || DASH)}</span>`,
        `<span>Date: <strong>${esc(longDate(sale.date) || DASH)}</strong></span>`,
        sale.contractType ? `<span>${esc(sale.contractType)}</span>` : '',
      ] })}

      <div class="invoice-parties">
        <div class="invoice-block">
          <h3>Seller</h3>
          <div class="line"><strong>${esc(business.entityName || business.farmName || DASH)}</strong></div>
          ${business.farmName && business.entityName && business.farmName !== business.entityName
            ? `<div class="line">"${esc(business.farmName)}"</div>` : ''}
          ${business.abn ? `<div class="line">ABN ${esc(business.abn)}</div>` : ''}
          ${business.ngr ? `<div class="line">NGR ${esc(business.ngr)}</div>` : ''}
          ${addressLinesOf(business.address, business.addressParts).map((l) => `<div class="line">${esc(l)}</div>`).join('')}
          ${business.contactName ? `<div class="line">${esc(business.contactName)}</div>` : ''}
          ${business.phone ? `<div class="line">${esc(business.phone)}</div>` : ''}
          ${business.email ? `<div class="line">${esc(business.email)}</div>` : ''}
        </div>
        <div class="invoice-block">
          <h3>Buyer</h3>
          <div class="line"><strong>${esc(sale.buyer || DASH)}</strong></div>
          ${sale.buyerAbn ? `<div class="line">ABN ${esc(sale.buyerAbn)}</div>` : ''}
          ${addressLinesOf(sale.buyerAddress, sale.buyerAddressParts).map((l) => `<div class="line">${esc(l)}</div>`).join('')}
          ${contactLines(sale.buyerContact).map((l) => `<div class="line">${esc(l)}</div>`).join('')}
        </div>
      </div>

      <div class="line" style="margin:0 0 10px">The Seller agrees to sell and the Buyer agrees to
        purchase the following commodity on the terms set out below.</div>

      <div class="invoice-totals contract-terms">
        ${termRows(sale, commodity, { showFreight, showComments }).map(([label, lines]) => term(label, lines)).join('')}
      </div>

      <div class="line" style="margin:14px 0 0;font-size:12px;color:#555">${esc(confirmationFooting(commodity))}</div>

      <div class="invoice-parties" style="margin-top:18px">
        <div class="invoice-block">
          <h3>Seller</h3>
          ${signed && canSign(signed.sig) ? signedBlockHTML({ ...signed.sig, name: sellerName }, { date: signed.date }) : `
          <div class="line" style="margin-top:22px">Signed ............................................</div>
          ${sellerName
            ? `<div class="line" style="margin-top:12px">Name <strong>${esc(sellerName)}</strong></div>`
            : '<div class="line" style="margin-top:12px">Name ..............................................</div>'}
          <div class="line" style="margin-top:12px">Date ...............................................</div>`}
        </div>
        <div class="invoice-block">
          <h3>Buyer</h3>
          <div class="line" style="margin-top:22px">Signed ............................................</div>
          <div class="line" style="margin-top:12px">Name ..............................................</div>
          <div class="line" style="margin-top:12px">Date ...............................................</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Show the document, with the one button that turns it into a PDF.
 *
 * Anything missing is named rather than silently left blank, because the whole
 * point of the document is that both parties can read what was agreed — and a
 * confirmation with no price on it is worse than no confirmation at all.
 */
export function openContractDocSheet(sale) {
  const business = db.getBusinessDetails();
  const { commodities } = db.get();
  const commodity = commodities.find((c) => c.id === sale.commodityId);

  const gaps = [];
  if (!business.entityName) gaps.push('your entity name (Settings → Business details)');
  if (!sale.buyer) gaps.push('the buyer');
  if (!sale.contractNo) gaps.push('a contract number');
  if (!sale.price) gaps.push('the price');
  if (!sale.tons) gaps.push('the quantity');

  openSheet('Confirmation of sale', (root) => {
    root.innerHTML = `
      ${gaps.length ? `
        <div class="card input" style="margin-bottom:10px">
          <h2><span class="dot input"></span>Before you send this</h2>
          <div class="hint">Still to fill in: ${esc(gaps.join('; '))}.</div>
        </div>` : ''}
      <div class="doc-actions">${signToggleHtml('sign-doc', 'Sign it as the seller with my signature')}
        ${signerPickHtml('signer-pick')}
        ${Number(sale.freight) > 0 ? `<label class="row" style="gap:10px;align-items:center;justify-content:flex-start;cursor:pointer;margin:6px 0">
          <input type="checkbox" id="show-freight" checked style="width:18px;height:18px" />
          <span>Include the freight rate (${esc(money(sale.freight, 2))} per ${commodity?.unit === 'bale' ? 'bale' : 'tonne'})</span></label>` : ''}
        ${String(sale.notes || '').trim() ? `<label class="row" style="gap:10px;align-items:center;justify-content:flex-start;cursor:pointer;margin:6px 0">
          <input type="checkbox" id="show-comments" checked style="width:18px;height:18px" />
          <span>Include the comments</span></label>` : ''}
      </div>
      <div id="doc-holder">${contractDocHTML(sale, business, commodity)}</div>
      <div class="doc-actions">
        <button class="btn" id="send-contract" style="margin-top:14px">${canShareFiles() ? 'Share PDF' : 'Download PDF and email'}</button>
        <button class="btn secondary" id="download-contract" style="margin-top:8px">Download PDF</button>
        <button class="btn secondary" id="print-contract" style="margin-top:8px">Print</button>
        <div class="hint" style="margin-top:8px">${canShareFiles()
          ? "Share opens your phone's share sheet with the PDF attached: choose Mail or another app. A copy is filed with the contract."
          : 'This device cannot attach the file for you: it is downloaded, and an email to the buyer is opened to attach it to.'}</div>
      </div>
    `;
    // what is on the page follows the tickboxes: whether it carries the seller's signature, and whether it states the freight rate
    let signedWith = null;
    let printedName = '';
    const paintDoc = () => {
      const showFreight = root.querySelector('#show-freight')?.checked !== false;
      const showComments = root.querySelector('#show-comments')?.checked !== false;
      root.querySelector('#doc-holder').innerHTML = contractDocHTML(sale, business, commodity, signedWith ? { sig: signedWith, date: dmy(todayLocal()) } : null, { showFreight, showComments, printedName });
    };
    wireSignToggle(root, 'sign-doc', (sig) => { signedWith = sig; paintDoc(); });
    root.querySelector('#show-freight')?.addEventListener('change', paintDoc);
    root.querySelector('#show-comments')?.addEventListener('change', paintDoc);
    wireSignerPick(root, 'signer-pick', business, (name) => { printedName = name; paintDoc(); });
    root.querySelector('#print-contract').addEventListener('click', () => window.print());

    // the same document as a PDF file: made from what is ticked on this screen, then shared or saved
    const makePdf = () => {
      const showFreight = root.querySelector('#show-freight')?.checked !== false;
      const showComments = root.querySelector('#show-comments')?.checked !== false;
      return confirmationPdf({ sale, business, commodity, signature: signedWith, printedName, date: todayLocal(), showFreight, showComments });
    };
    const fileName = () => safeFileName(`Confirmation of sale ${sale.contractNo || ''} ${dmy(todayLocal())}`);
    root.querySelector('#download-contract').addEventListener('click', () => { downloadFile(makePdf(), fileName()); toast('Downloaded'); });
    root.querySelector('#send-contract').addEventListener('click', async () => {
      if (gaps.length && !(await askConfirm(`Still to fill in: ${gaps.join('; ')}. Send it anyway?`, { confirmLabel: 'Send anyway' }))) return;
      const bytes = makePdf();
      const buyerContact = splitContact(sale.buyerContact);
      const subject = `Confirmation of sale${sale.contractNo ? ` - contract ${sale.contractNo}` : ''}`;
      const body = `Hi${buyerContact.name ? ` ${buyerContact.name.split(' ')[0]}` : ''},\n\nPlease find the confirmation of sale attached${sale.contractNo ? ` for contract ${sale.contractNo}` : ''}. Please sign and return a copy.\n\nRegards,\n${printedName || business.contactName || business.entityName || ''}`;
      const result = await sharePdf(bytes, fileName(), { title: subject, text: body, mail: { to: buyerContact.email, subject, body } });
      if (result === 'cancelled') return;
      toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
      try {
        await fileSentCopy({ saleId: sale.id, bytes, fileName: fileName(), kind: 'confirmation' });
        toast('Copy filed with the contract');
      } catch (e) {
        notify(`It went, but a copy was not filed with the contract: ${e.message}`);
      }
    });
  });
}
