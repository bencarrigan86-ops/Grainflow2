// The confirmation of sale as a PDF file, so it can be sent: shared from the phone, or downloaded and attached to an email.
//
// The same terms, in the same order, as the page on screen (views/contract.js reads its rows from here too, so the two can
// never say different things). Pure: it builds bytes from the sale and the farm's details and touches nothing else.

import { Pdf, wrapText } from './pdf.js?v=394';
import { drawBrandLogo } from './brand.js?v=394';
import { letterheadLine } from './docband.js?v=394';
import { addressLinesOf } from './address.js?v=394';
import { num, money, dmy } from './fmt.js?v=394';
import { PATTERN_ON_CONTRACT } from './deliveryplan.js?v=394';
import { INVOICING_ON_CONTRACT } from './invoicing.js?v=394';
import { contactLines } from './buyercontact.js?v=394';
import { signerName } from './signdoc.js?v=394';
import { toleranceText, gradeTermsLines, gradeNamesText } from './contractterms.js?v=394';
import { cottonKind, cleanCottonTerms, netPerBale } from './cottonkinds.js?v=394';
import { hasSignature, strokesInBox } from './signature.js?v=394';

export const DASH = '—';

/** The gin's charges on a contract with the gin, one to a line, and what gin for seed nets a bale. */
export function ginTermsLines(sale, perUnit = 'bale') {
  const k = cottonKind(sale);
  const t = cleanCottonTerms(sale.cottonTerms);
  if (k === 'lint' || !t) return [];
  const lines = [];
  if (t.ginRate) lines.push(`Ginning ${money(t.ginRate, 2)} per ${perUnit}${t.gstOnGin ? ', plus GST' : ''}`);
  if (t.researchLevy) lines.push(`Research levy ${money(t.researchLevy, 2)} per ${perUnit}`);
  if (t.voluntaryLevy) lines.push(`Voluntary levy ${money(t.voluntaryLevy, 2)} per ${perUnit}`);
  if (k === 'ginforseed') lines.push(`Seed value less ginning is ${money(netPerBale(sale), 2)} per ${perUnit}`);
  return lines;
}

/** A date as a document should write it: 01-08-2026, not 2026-08-01. */
export function longDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso);
}

export function paymentText(sale) {
  const days = Number(sale.paymentTermsDays) || 0;
  if (!days) return '';
  return sale.paymentTermsBasis ? `${days} days from ${sale.paymentTermsBasis}` : `${days} days`;
}

export function deliveryPeriodText(sale) {
  const a = longDate(sale.deliveryStart);
  const b = longDate(sale.deliveryEnd);
  if (a && b) return `${a} to ${b}`;
  return a || b || '';
}

export function brokerText(sale) {
  if (!sale.broker) return '';
  const bits = [sale.broker];
  if (sale.brokerRef) bits.push(`ref ${sale.brokerRef}`);
  if (sale.brokeragePaidBy) bits.push(`brokerage paid by ${sale.brokeragePaidBy}`);
  return bits.join(', ');
}

export function carryText(sale) {
  const rate = Number(sale.carryRate) || 0;
  if (!rate) return '';
  const from = longDate(sale.carryFrom);
  return from
    ? `${money(rate, 2)} per tonne per month for grain held from ${from}`
    : `${money(rate, 2)} per tonne per month`;
}

/**
 * The terms of the contract as [label, lines] pairs, in the order the trade expects, leaving out any that are empty
 * (a blank line invites a pen).
 */
export function termRows(sale, commodity, { showFreight = true, showComments = true } = {}) {
  const cotton = commodity?.unit === 'bale';
  const unit = cotton ? 'bales' : 't';
  const perUnit = commodity?.unit === 'bale' ? 'bale' : 'tonne';
  const gradeLines = gradeTermsLines(sale, perUnit);
  const rows = [
    ['Commodity', commodity?.name || DASH],
    ['Season', sale.cropYear],
    [gradeLines.length ? 'Grades' : 'Grade', gradeLines.length ? gradeNamesText(sale) : sale.grade],
    ['Quality', cotton ? `As per ${ICA_NAME} standards` : 'As per Grain Trade Australia standards'],
    ['Quantity', [`${num(sale.tons, 0)} ${unit}`, toleranceText(sale, unit)]],
    [cottonKind(sale) === 'ginforseed' ? 'Seed value' : 'Price', cottonKind(sale) !== 'ginning' && sale.price ? `${money(sale.price, 2)} per ${perUnit}, exclusive of GST` : ''],
    ['Ginning', ginTermsLines(sale, perUnit)],
    ['Freight', showFreight && sale.freight ? `${money(sale.freight, 2)} per ${perUnit}` : ''],
    ['Premium / discount', sale.premiumDiscount ? `${money(sale.premiumDiscount, 2)} per ${perUnit}` : ''],
    ['Premium / discount by grade', gradeLines.length ? [...gradeLines, 'A grade not listed is paid the price as above'] : ''],
    ['Levies', sale.leviesPct ? `${num(sale.leviesPct * 100, 3)}%` : ''],
    ['Pricing point', sale.pricingPoint],
    ['Location', sale.location],
    ['Delivery period', deliveryPeriodText(sale)],
    ['Delivery option', PATTERN_ON_CONTRACT[sale.deliveryPattern]],
    ['Invoicing', INVOICING_ON_CONTRACT[sale.invoicing]],
    ['Delivery terms', sale.deliveryTerms],
    ['Weights and quality to govern', sale.weightsToGovern ? sale.weightsToGovern.charAt(0).toUpperCase() + sale.weightsToGovern.slice(1) : ''],
    ['Payment terms', paymentText(sale)],
    ['Carry', carryText(sale)],
    ['Broker', brokerText(sale)],
    ['Trade rules', sale.tradeRules || (cotton ? `${ICA_NAME} Bylaws and Rules apply` : 'Grain Trade Australia Trade Rules apply')],
    ['Comments', showComments ? sale.notes : ''],
  ];
  return rows
    .map(([label, value]) => [label, (Array.isArray(value) ? value : [value]).filter(Boolean).map(String)])
    .filter(([, lines]) => lines.length);
}

/** Cotton is traded under the International Cotton Association's standards and rules, where grain is traded under Grain Trade Australia's. */
export const ICA_NAME = 'International Cotton Association (ICA)';

/** The words under the terms, as on the page. */
export const CONFIRMATION_FOOTING_COTTON = `This confirmation records the agreement between the parties named above. Unless stated otherwise, the ${ICA_NAME} Bylaws and Rules in force at the date of this contract apply. Failure to sign and return this confirmation does not affect its validity.`;
export const confirmationFooting = (commodity) => (commodity?.unit === 'bale' ? CONFIRMATION_FOOTING_COTTON : CONFIRMATION_FOOTING);
export const CONFIRMATION_FOOTING = 'This confirmation records the agreement between the parties named above. Unless stated otherwise, the Grain Trade Australia Trade Rules in force at the date of this contract apply. Failure to sign and return this confirmation does not affect its validity.';

const M = 40;
const GREEN = [0.18, 0.49, 0.196];
const SHADE = [0.94, 0.97, 0.94];
const LINE = 0.15;

/**
 * @param {{sale: object, business?: object, commodity?: object|null, signature?: {strokes: object[], name?: string}|null,
 *          printedName?: string, date: string, showFreight?: boolean, showComments?: boolean}} src
 *   `signature`, when given, is drawn as the seller's signature in place of the line to sign on; `printedName` is the name under it.
 * @returns {Uint8Array}
 */
export function confirmationPdf({ sale, business = {}, commodity = null, signature = null, printedName = '', date, showFreight = true, showComments = true }) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  const signed = !!signature && hasSignature(signature.strokes);
  const sellerName = String(printedName || signerName(signature, business)).trim();

  // the band: the farm's name, the title, the reference line, and the logo
  pdf.rect(0, 0, pdf.width, 72, { stroke: null, fill: GREEN });
  const rx = drawBrandLogo(pdf, { right: M + W, top: 12, maxW: 110, maxH: 46, tile: true });
  const from = letterheadLine(business);
  if (from) pdf.text(M, 11, from, { size: 9.5, bold: true, gray: 0.93 });
  pdf.text(M, 25, 'CONFIRMATION OF SALE', { size: 19, bold: true, gray: 1 });
  const meta = [`Contract ${sale.contractNo || DASH}`, `Date: ${longDate(sale.date) || DASH}`, sale.contractType || '']
    .filter(Boolean).join('     ');
  pdf.text(M, 52, wrapText(meta, rx - M - 6, 9.5)[0] || '', { size: 9.5, gray: 0.95 });

  // the parties
  const top = 84;
  const colW = (W - 14) / 2;
  const sellerLines = [
    business.entityName || business.farmName || DASH,
    business.farmName && business.entityName && business.farmName !== business.entityName ? `"${business.farmName}"` : '',
    business.abn ? `ABN ${business.abn}` : '', business.ngr ? `NGR ${business.ngr}` : '',
    ...addressLinesOf(business.address, business.addressParts),
    business.contactName, business.phone, business.email,
  ].filter(Boolean);
  const buyerLines = [
    sale.buyer || DASH, sale.buyerAbn ? `ABN ${sale.buyerAbn}` : '',
    ...addressLinesOf(sale.buyerAddress, sale.buyerAddressParts), ...contactLines(sale.buyerContact),
  ].filter(Boolean);
  const partyH = 26 + Math.max(sellerLines.length, buyerLines.length) * 12.5 + 6;
  const party = (x, title, lines) => {
    pdf.rect(x, top, colW, partyH, { stroke: LINE, lineWidth: 1 });
    pdf.text(x + 8, top + 7, title, { size: 8.5, bold: true, gray: GREEN });
    lines.forEach((l, i) => pdf.text(x + 8, top + 24 + i * 12.5, wrapText(l, colW - 16, 9.5, i === 0)[0], { size: 9.5, bold: i === 0 }));
  };
  party(M, 'SELLER', sellerLines);
  party(M + colW + 14, 'BUYER', buyerLines);

  let y = top + partyH + 12;
  y = pdf.paragraph(M, y, 'The Seller agrees to sell and the Buyer agrees to purchase the following commodity on the terms set out below.', W, { size: 9.5, lineHeight: 12.5 }) + 4;

  // the terms, label on the left; a new page when one would run off the bottom
  const labelW = 150;
  const valueW = W - labelW - 12;
  const room = (h) => { if (y + h > pdf.height - 56) { pdf.addPage(); y = 44; return true; } return false; };
  termRows(sale, commodity, { showFreight, showComments }).forEach(([label, lines], i) => {
    const wrapped = lines.flatMap((l) => wrapText(l, valueW, 9.5));
    const h = Math.max(1, wrapped.length) * 12.5 + 9;
    room(h);
    if (i % 2 === 0) pdf.rect(M, y, W, h, { stroke: null, fill: SHADE });
    pdf.text(M + 6, y + 5, label, { size: 9, bold: true, gray: 0.3 });
    wrapped.forEach((l, k) => pdf.text(M + labelW, y + 5 + k * 12.5, l, { size: 9.5 }));
    y += h;
  });
  pdf.line(M, y, M + W, y, { width: 0.6, gray: 0.55 });
  y += 12;

  // the footing and the signatures
  const footing = confirmationFooting(commodity);
  const footLines = wrapText(footing, W, 8.5);
  room(footLines.length * 11 + 130);
  y = pdf.paragraph(M, y, footing, W, { size: 8.5, lineHeight: 11, gray: 0.3 }) + 16;
  const sigW = (W - 24) / 2;
  const lineFor = (x, yy, label) => { pdf.text(x, yy, label, { size: 9 }); pdf.line(x + 38, yy + 9, x + sigW, yy + 9, { width: 0.5, gray: 0.5 }); };
  pdf.text(M, y, 'SELLER', { size: 8.5, bold: true, gray: GREEN });
  pdf.text(M + sigW + 24, y, 'BUYER', { size: 8.5, bold: true, gray: GREEN });
  y += 18;
  if (signed) {
    for (const stroke of strokesInBox(signature.strokes, M, y, 120, 40)) pdf.polyline(stroke, { width: 1.1, gray: 0.1 });
    pdf.line(M, y + 44, M + 150, y + 44, { width: 0.6, gray: 0.5 });
    pdf.text(M, y + 47, 'Signed', { size: 8, gray: 0.45 });
  } else {
    lineFor(M, y + 24, 'Signed');
  }
  lineFor(M + sigW + 24, y + (signed ? 35 : 24), 'Signed');   // the buyer's line sits level with the one under the seller's signature
  const ny = y + (signed ? 64 : 52);
  if (sellerName) pdf.text(M, ny, `Name  ${sellerName}`, { size: 9, bold: true }); else lineFor(M, ny, 'Name');
  lineFor(M + sigW + 24, ny, 'Name');
  if (signed && date) pdf.text(M, ny + 22, `Date  ${dmy(date)}`, { size: 9 }); else lineFor(M, ny + 22, 'Date');
  lineFor(M + sigW + 24, ny + 22, 'Date');

  pdf.text(pdf.width / 2, pdf.height - 28, 'Prepared in Commodity Mate.', { size: 7, align: 'center', gray: 0.5 });
  return pdf.bytes();
}
