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

import { db } from '../storage.js?v=342';
import { openSheet } from '../ui.js?v=342';
import { esc, num, money, todayLocal, dmy } from '../fmt.js?v=342';
import { addressLinesOf } from '../address.js?v=342';
import { signedBlockHTML, canSign, signerName } from '../signdoc.js?v=342';
import { PATTERN_ON_CONTRACT } from '../deliveryplan.js?v=342';
import { INVOICING_ON_CONTRACT } from '../invoicing.js?v=342';
import { contactLines } from '../buyercontact.js?v=342';
import { signToggleHtml, wireSignToggle, signerPickHtml, wireSignerPick } from './signtoggle.js?v=342';
import { toleranceText, gradeTermsLines, gradeNamesText } from '../contractterms.js?v=342';

const DASH = '—';

/** A date as a document should write it: 01-08-2026, not 2026-08-01. */
function longDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
}

function paymentText(sale) {
  const days = Number(sale.paymentTermsDays) || 0;
  if (!days) return '';
  return sale.paymentTermsBasis
    ? `${days} days from ${sale.paymentTermsBasis}`
    : `${days} days`;
}

function deliveryPeriodText(sale) {
  const a = longDate(sale.deliveryStart);
  const b = longDate(sale.deliveryEnd);
  if (a && b) return `${a} to ${b}`;
  return a || b || '';
}

function brokerText(sale) {
  if (!sale.broker) return '';
  const bits = [sale.broker];
  if (sale.brokerRef) bits.push(`ref ${sale.brokerRef}`);
  if (sale.brokeragePaidBy) bits.push(`brokerage paid by ${sale.brokeragePaidBy}`);
  return bits.join(', ');
}

function carryText(sale) {
  const rate = Number(sale.carryRate) || 0;
  if (!rate) return '';
  const from = longDate(sale.carryFrom);
  return from
    ? `${money(rate, 2)} per tonne per month for grain held from ${from}`
    : `${money(rate, 2)} per tonne per month`;
}

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
  const unit = commodity?.unit === 'bale' ? 'bales' : 't';
  const perUnit = commodity?.unit === 'bale' ? 'bale' : 'tonne';
  const sellerName = String(printedName || signerName(signed?.sig, business)).trim();   // the person signing for the seller, printed under the signature

  const quantity = `${num(sale.tons, 0)} ${unit}`;
  const tol = toleranceText(sale, unit);
  // a multigrade contract lists each grade it takes with its premium or discount
  const gradeLines = gradeTermsLines(sale, perUnit);
  const gradeNames = gradeNamesText(sale);

  return `
    <div class="invoice-doc branded">
      <div class="doc-band">
        <div class="doc-band-main">
          <h2 class="title">CONFIRMATION OF SALE</h2>
          <div class="invoice-meta">
            <span>Contract ${esc(sale.contractNo || DASH)}</span>
            <span>Date: <strong>${esc(longDate(sale.date) || DASH)}</strong></span>
            ${sale.cropYear ? `<span>Season: <strong>${esc(sale.cropYear)}</strong></span>` : ''}
            ${sale.contractType ? `<span>${esc(sale.contractType)}</span>` : ''}
          </div>
        </div>
        ${business.logo && !business.logoOff ? `<div class="doc-band-logo"><img src="${esc(business.logo)}" alt="" /></div>` : ''}
      </div>

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

      <div class="invoice-totals">
        ${term('Commodity', commodity?.name || DASH)}
        ${term(gradeLines.length ? 'Grades' : 'Grade', gradeLines.length ? gradeNames : sale.grade)}
        ${term('Quality', 'As per Grain Trade Australia standards')}
        ${term('Quantity', [quantity, tol])}
        ${term('Price', sale.price ? `${money(sale.price, 2)} per ${perUnit}, exclusive of GST` : '')}
        ${term('Freight', showFreight && sale.freight ? `${money(sale.freight, 2)} per ${perUnit}` : '')}
        ${term('Premium / discount', sale.premiumDiscount ? `${money(sale.premiumDiscount, 2)} per ${perUnit}` : '')}
        ${term('Premium / discount by grade', gradeLines.length ? [...gradeLines, 'A grade not listed is paid the price as above'] : '')}
        ${term('Levies', sale.leviesPct ? `${num(sale.leviesPct * 100, 3)}%` : '')}
        ${term('Pricing point', sale.pricingPoint)}
        ${term('Location', sale.location)}
        ${term('Delivery period', deliveryPeriodText(sale))}
        ${term('Delivery option', PATTERN_ON_CONTRACT[sale.deliveryPattern])}
        ${term('Invoicing', INVOICING_ON_CONTRACT[sale.invoicing])}
        ${term('Delivery terms', sale.deliveryTerms)}
        ${term('Weights and quality to govern', sale.weightsToGovern
          ? sale.weightsToGovern.charAt(0).toUpperCase() + sale.weightsToGovern.slice(1) : '')}
        ${term('Payment terms', paymentText(sale))}
        ${term('Carry', carryText(sale))}
        ${term('Broker', brokerText(sale))}
        ${term('Trade rules', sale.tradeRules || 'Grain Trade Australia Trade Rules apply')}
        ${term('Comments', showComments ? sale.notes : '')}
      </div>

      <div class="line" style="margin:14px 0 0;font-size:12px;color:#555">
        This confirmation records the agreement between the parties named above. Unless stated
        otherwise, the Grain Trade Australia Trade Rules in force at the date of this contract
        apply. Failure to sign and return this confirmation does not affect its validity.
      </div>

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
        <button class="btn" id="print-contract" style="margin-top:14px">Print / Save as PDF</button>
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
  });
}
