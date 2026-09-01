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

import { db } from '../storage.js?v=93';
import { openSheet } from '../ui.js?v=93';
import { esc, num, money } from '../fmt.js?v=93';

const DASH = '—';

/** A date as a document should write it: 1 Aug 2026, not 2026-08-01. */
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Tolerance in the words the trade uses.
 *
 * Every one of the six says this differently and they all mean the same thing:
 * whichever of the two is smaller. Saying "whichever is the lesser" out loud
 * matters — a reader who has to work out which limit binds is a reader who
 * will assume the one that suits them.
 */
function toleranceText(sale, unit) {
  const pct = Number(sale.tolerancePct) || 0;
  const cap = Number(sale.toleranceCapTons) || 0;
  if (!pct && !cap) return '';
  if (pct && cap) return `+/- ${num(cap, 0)} ${unit} or ${num(pct, 1)}%, whichever is the lesser`;
  if (pct) return `+/- ${num(pct, 1)}%`;
  return `+/- ${num(cap, 0)} ${unit}`;
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

/** One term. Omitted entirely when empty — a blank line invites a pen. */
const term = (label, value) => (value
  ? `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`
  : '');

export function contractDocHTML(sale, business, commodity) {
  const unit = commodity?.unit === 'bale' ? 'bales' : 't';
  const perUnit = commodity?.unit === 'bale' ? 'bale' : 'tonne';

  const quantity = `${num(sale.tons, 0)} ${unit}`;
  const tol = toleranceText(sale, unit);

  return `
    <div class="invoice-doc">
      <h2 class="title">CONFIRMATION OF SALE</h2>
      <div class="invoice-meta">
        <span>Contract ${esc(sale.contractNo || DASH)}</span>
        <span>Date: <strong>${esc(longDate(sale.date) || DASH)}</strong></span>
        ${sale.cropYear ? `<span>Season: <strong>${esc(sale.cropYear)}</strong></span>` : ''}
        ${sale.contractType ? `<span>${esc(sale.contractType)}</span>` : ''}
      </div>

      <div class="invoice-parties">
        <div class="invoice-block">
          <h3>Seller</h3>
          <div class="line"><strong>${esc(business.entityName || business.farmName || DASH)}</strong></div>
          ${business.farmName && business.entityName && business.farmName !== business.entityName
            ? `<div class="line">"${esc(business.farmName)}"</div>` : ''}
          ${business.abn ? `<div class="line">ABN ${esc(business.abn)}</div>` : ''}
          ${business.ngr ? `<div class="line">NGR ${esc(business.ngr)}</div>` : ''}
          ${business.address ? `<div class="line">${esc(business.address)}</div>` : ''}
          ${business.contactName ? `<div class="line">${esc(business.contactName)}</div>` : ''}
          ${business.phone ? `<div class="line">${esc(business.phone)}</div>` : ''}
          ${business.email ? `<div class="line">${esc(business.email)}</div>` : ''}
        </div>
        <div class="invoice-block">
          <h3>Buyer</h3>
          <div class="line"><strong>${esc(sale.buyer || DASH)}</strong></div>
          ${sale.buyerAbn ? `<div class="line">ABN ${esc(sale.buyerAbn)}</div>` : ''}
          ${sale.buyerAddress ? `<div class="line">${esc(sale.buyerAddress)}</div>` : ''}
          ${sale.buyerContact ? `<div class="line">Attn: ${esc(sale.buyerContact)}</div>` : ''}
        </div>
      </div>

      <div class="line" style="margin:0 0 10px">The Seller agrees to sell and the Buyer agrees to
        purchase the following commodity on the terms set out below.</div>

      <div class="invoice-totals">
        ${term('Commodity', [commodity?.name, sale.grade].filter(Boolean).join(' — ') || DASH)}
        ${term('Quality', 'As per Grain Trade Australia standards')}
        ${term('Quantity', tol ? `${quantity} (${tol})` : quantity)}
        ${term('Price', sale.price ? `${money(sale.price, 2)} per ${perUnit}, exclusive of GST` : '')}
        ${term('Freight', sale.freight ? `${money(sale.freight, 2)} per ${perUnit}` : '')}
        ${term('Premium / discount', sale.premiumDiscount ? `${money(sale.premiumDiscount, 2)} per ${perUnit}` : '')}
        ${term('Levies', sale.leviesPct ? `${num(sale.leviesPct * 100, 3)}%` : '')}
        ${term('Pricing point', sale.pricingPoint)}
        ${term('Location', sale.location)}
        ${term('Delivery period', deliveryPeriodText(sale))}
        ${term('Delivery terms', sale.deliveryTerms)}
        ${term('Weights to govern', sale.weightsToGovern
          ? sale.weightsToGovern.charAt(0).toUpperCase() + sale.weightsToGovern.slice(1) : '')}
        ${term('Payment terms', paymentText(sale))}
        ${term('Carry', carryText(sale))}
        ${term('Broker', brokerText(sale))}
        ${term('Trade rules', sale.tradeRules || 'Grain Trade Australia Trade Rules apply')}
        ${term('Notes', sale.notes)}
      </div>

      <div class="line" style="margin:14px 0 0;font-size:12px;color:#555">
        This confirmation records the agreement between the parties named above. Unless stated
        otherwise, the Grain Trade Australia Trade Rules in force at the date of this contract
        apply. Failure to sign and return this confirmation does not affect its validity.
      </div>

      <div class="invoice-parties" style="margin-top:18px">
        <div class="invoice-block">
          <h3>Seller</h3>
          <div class="line" style="margin-top:22px">Signed ............................................</div>
          <div class="line" style="margin-top:12px">Name ..............................................</div>
          <div class="line" style="margin-top:12px">Date ...............................................</div>
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
      ${contractDocHTML(sale, business, commodity)}
      <div class="doc-actions">
        <button class="btn" id="print-contract" style="margin-top:14px">Print / Save as PDF</button>
      </div>
    `;
    root.querySelector('#print-contract').addEventListener('click', () => window.print());
  });
}
