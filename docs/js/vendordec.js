// Grain commodity vendor declaration: what the grower declares about grain sold to a buyer.
//
// Laid out like the Grain Trade Australia form buyers ask for: buyer and vendor details, the grain, then either
// (A) an accredited quality assurance program, or (B) a statement of what the grain has been treated with, and
// finally whether it is GMO free. It can be made from a contract or from an order against one: choosing the
// contract fills in most of it, and the tonnes and the dates it covers can be changed.
//
// Pure: it builds the declaration's data and its PDF; the screen and the sharing are elsewhere.

import { Pdf, textWidth, wrapText } from './pdf.js?v=238';
import { dmy } from './fmt.js?v=238';
import { hasSignature, strokesInBox } from './signature.js?v=238';

export const MAX_VARIETIES = 4;

/** The three GMO statements on the form. */
export const GMO_OPTIONS = [
  { value: 1, label: 'Free from GMOs as defined by 99% GMO free' },
  { value: 2, label: 'Is free from GMOs as defined by 95% GMO free' },
  { value: 3, label: 'Contains greater than 5% GMO' },
];

const clean = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round1 = (n) => Math.round(n * 10) / 10;

/** An email address inside free text such as "Jo Blogg 0400 000 000 jo@buyer.com.au", or ''. */
export function emailIn(text) {
  const m = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/.exec(String(text || ''));
  return m ? m[0] : '';
}

/** A phone number inside free text, or ''. */
export function phoneIn(text) {
  const m = /(\+?\d[\d\s()-]{6,}\d)/.exec(String(text || '').replace(emailIn(text), ''));
  return m ? m[1].trim() : '';
}

/** The distinct seed varieties of the paddocks growing a commodity, in the order they are found. */
export function varietiesFor(fields, commodityId) {
  const seen = [];
  for (const f of fields || []) {
    if (commodityId && f.commodityId !== commodityId) continue;
    const v = clean(f.seedVariety);
    if (v && !seen.some((x) => x.toLowerCase() === v.toLowerCase())) seen.push(v);
  }
  return seen;
}

/** A name for the document that is the same for the same contract, order and day. */
export function documentId({ sale, order, date }) {
  const ref = clean(order?.orderNo) || clean(sale?.contractNo) || 'DEC';
  return `VD-${ref.replace(/[^A-Za-z0-9]+/g, '')}-${String(date || '').replace(/-/g, '')}`;
}

/**
 * The declaration to start from: everything the contract (and the order, if one is chosen) and the business
 * details can fill in. Whoever makes the declaration changes what is wrong before it is sent.
 *
 * @param {{sale: object, order?: object|null, business: object, commodityName?: string, fields?: object[],
 *          today: string, signature?: {strokes: Array, name?: string}|null}} src
 *   `signature` is the signed-in person's own saved signature, if they have one.
 */
export function buildDeclaration({ sale, order = null, business = {}, commodityName = '', fields = [], today, signature = null }) {
  const varieties = varietiesFor(fields, sale?.commodityId).slice(0, MAX_VARIETIES);
  const tons = order ? num(order.tons) : num(sale?.tons);
  const from = (order && order.deliverFrom) || sale?.deliveryStart || '';
  const to = (order && order.deliverBy) || sale?.deliveryEnd || '';
  const buyerContact = clean(sale?.buyerContact);
  return {
    documentId: documentId({ sale, order, date: today }),
    saleId: sale?.id || '',
    orderId: order?.id || '',
    buyer: {
      name: buyerContact.replace(emailIn(buyerContact), '').replace(phoneIn(buyerContact), '').trim(),
      company: clean(sale?.buyer),
      address: clean(sale?.buyerAddress),
      town: '',
      tel: phoneIn(buyerContact),
      fax: '',
      email: emailIn(buyerContact),
    },
    vendor: {
      name: clean(business.contactName),
      company: clean(business.entityName || business.farmName),
      address: clean(business.address),
      town: '',
      tel: clean(business.phone),
      fax: '',
      email: clean(business.email),
      ngr: clean(business.ngr),
    },
    commodity: clean(commodityName),
    // one variety takes the whole quantity; with several the quantities are filled in by hand
    varieties: (varieties.length ? varieties : ['']).map((name, _i, all) => ({ name, tons: all.length === 1 && tons ? round1(tons) : '' })),
    deliveryFrom: from,
    deliveryTo: to,
    // the buyer's number for the contract (what is written on their paperwork) and our own
    contractNo: clean(sale?.contractNo),
    ourContractNo: clean(sale?.ourRef),
    deliveryAddress: clean(sale?.location),
    // A: an accredited QA program; B: a statement of what the grain was treated with
    basis: clean(business.qaProgram) ? 'qa' : 'declared',
    qaProgram: clean(business.qaProgram),
    qaNumber: clean(business.qaNumber),
    seedUntreated: true,
    notFumigated: true,
    chemicals: [],
    gmo: 1,
    signedBy: clean(signature?.name) || clean(business.contactName),
    signedDate: today,
    // the signer's saved handwritten signature (strokes), drawn on the PDF when `useSignature` is on
    signature: hasSignature(signature?.strokes) ? signature.strokes : [],
    useSignature: hasSignature(signature?.strokes),
  };
}

/** "01-11-2026 to 20-12-2026", "from 01-11-2026", "by 20-12-2026" or ''. */
export function deliveryPeriodText(d) {
  const from = d.deliveryFrom ? dmy(d.deliveryFrom) : '';
  const to = d.deliveryTo ? dmy(d.deliveryTo) : '';
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `by ${to}`;
  return '';
}

/** What is wrong or missing that the buyer would send it back for. Empty when it is ready to go. */
export function declarationProblems(d) {
  const out = [];
  if (!clean(d.buyer?.company) && !clean(d.buyer?.name)) out.push("The buyer's name");
  if (!clean(d.commodity)) out.push('The commodity');
  if (!clean(d.vendor?.company) && !clean(d.vendor?.name)) out.push("Your business name (in Settings, Business details)");
  if (d.basis === 'qa' && !clean(d.qaProgram)) out.push('The quality assurance program');
  if (d.basis === 'declared' && !d.seedUntreated && !d.chemicals.some((c) => clean(c.product))) out.push('The seed treatment or chemical used');
  if (d.basis === 'declared' && !d.notFumigated && !d.chemicals.some((c) => clean(c.product))) out.push('The chemical used');
  if (!clean(d.signedBy)) out.push('Who signs it');
  return out;
}

// --- the PDF ------------------------------------------------------------------------------------------

const M = 40;                       // page margin
const BLUE = 0.15;                  // dark gray used for headings and box lines
const SHADE = 0.9;

function labelled(pdf, x, y, labelW, valueW, label, value, { lines = 1 } = {}) {
  pdf.text(x, y + 1, label, { size: 8, bold: true });
  const vx = x + labelW;
  pdf.rect(vx, y - 1, valueW, 12 * lines + 1, { stroke: null, fill: SHADE });
  const text = clean(value);
  if (lines === 1) {
    const fitted = wrapText(text, valueW - 6, 9)[0] || '';
    pdf.text(vx + 3, y + 1, fitted, { size: 9 });
  } else {
    wrapText(text, valueW - 6, 9).slice(0, lines).forEach((l, i) => pdf.text(vx + 3, y + 1 + i * 12, l, { size: 9 }));
  }
  return y + 12 * lines + 4;
}

function box(pdf, x, y, w, h, title) {
  pdf.rect(x, y, w, h, { stroke: BLUE, lineWidth: 1 });
  pdf.text(x + 8, y + 7, title, { size: 8.5, bold: true });
}

/** The declaration as a PDF (bytes). */
export function declarationPdf(d) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  pdf.text(pdf.width / 2, 34, 'GRAIN COMMODITY VENDOR DECLARATION', { size: 16, bold: true, align: 'center' });

  // document id
  pdf.rect(M + W - 230, 62, 230, 18, { stroke: null, fill: SHADE });
  pdf.text(M + W - 224, 66, 'DOCUMENT ID:', { size: 8, bold: true });
  pdf.text(M + W - 150, 66, d.documentId, { size: 9 });

  // buyer and vendor
  const top = 92;
  const colW = (W - 14) / 2;
  const party = (x, title, p, withNgr) => {
    box(pdf, x, top, colW, 172, title);
    let y = top + 24;
    const lw = 44;
    const vw = colW - lw - 16;
    y = labelled(pdf, x + 8, y, lw, vw, 'Name:', p.name);
    y = labelled(pdf, x + 8, y, lw, vw, 'Company:', p.company);
    y = labelled(pdf, x + 8, y, lw, vw, 'Address:', p.address, { lines: 2 });
    y = labelled(pdf, x + 8, y, lw, vw, 'Town:', p.town);
    y = labelled(pdf, x + 8, y, lw, vw, 'Tel:', p.tel);
    y = labelled(pdf, x + 8, y, lw, vw, 'Fax:', p.fax);
    y = labelled(pdf, x + 8, y, lw, vw, 'Email:', p.email);
    if (withNgr) labelled(pdf, x + 8, y, lw, vw, 'NGR No:', p.ngr);
  };
  party(M, "BUYER'S DETAILS", d.buyer, false);
  party(M + colW + 14, "VENDOR'S DETAILS", d.vendor, true);

  // grain
  const gy = top + 180;
  const nVar = Math.max(d.varieties.filter((v) => clean(v.name) || clean(v.tons)).slice(0, MAX_VARIETIES).length, 1);
  const gh = 24 + 16 + nVar * 16 + 48 + 6;
  box(pdf, M, gy, W, gh, 'GRAIN DETAILS represented by this declaration');
  let y = gy + 24;
  y = labelled(pdf, M + 8, y, 54, 230, 'Commodity:', d.commodity);
  const varieties = d.varieties.filter((v) => clean(v.name) || clean(v.tons)).slice(0, MAX_VARIETIES);
  const rows = Math.max(varieties.length, 1);
  for (let i = 0; i < rows; i += 1) {
    const v = varieties[i] || { name: '', tons: '' };
    labelled(pdf, M + 8, y, 54, 230, 'Variety:', v.name);
    pdf.text(M + 310, y + 1, 'Quantity:', { size: 8, bold: true });
    pdf.rect(M + 356, y - 1, W - 356 - 8, 13, { stroke: null, fill: SHADE });
    pdf.text(M + 359, y + 1, v.tons === '' || v.tons === null || v.tons === undefined ? '' : `${v.tons} t`, { size: 9 });
    y += 16;
  }
  y = labelled(pdf, M + 8, y, 74, 210, 'Delivery Period:', deliveryPeriodText(d));
  y = labelled(pdf, M + 8, y, 74, W - 74 - 16, 'Delivery Address:', d.deliveryAddress);
  labelled(pdf, M + 8, y, 94, 130, "Buyer's Contract No:", d.contractNo);
  labelled(pdf, M + 290, y, 74, W - 290 - 74 - 8 + M - M, 'Our Contract No:', d.ourContractNo);

  // A
  let ay = gy + gh + 8;
  pdf.rect(M, ay, W, 62, { stroke: BLUE, lineWidth: 1 });
  pdf.text(M + 8, ay + 8, 'A', { size: 9, bold: true });
  pdf.checkbox(M + W - 22, ay + 6, 9, d.basis === 'qa');
  pdf.paragraph(M + 40, ay + 8, 'I certify that the property on which the grain is grown or storage facility in which the commodity has been stored carries accreditation under an independently audited QA program which includes chemical residue management and that the name of the program is as follows:', W - 80, { size: 8.5, lineHeight: 11 });
  const qy = ay + 42;
  pdf.text(M + 8, qy, 'Quality Assurance Program', { size: 8.5 });
  pdf.line(M + 120, qy + 10, M + 260, qy + 10);
  pdf.text(M + 124, qy, d.basis === 'qa' ? d.qaProgram : '', { size: 9 });
  pdf.text(M + 275, qy, 'Accreditation / Certification Number', { size: 8.5 });
  pdf.line(M + 420, qy + 10, M + W - 8, qy + 10);
  pdf.text(M + 424, qy, d.basis === 'qa' ? d.qaNumber : '', { size: 9 });
  ay += 62;
  pdf.text(M + 8, ay + 6, 'Or', { size: 9, bold: true });
  ay += 22;

  // B
  const bTop = ay;
  pdf.text(M + 8, bTop + 8, 'B', { size: 9, bold: true });
  const B = d.basis === 'declared';
  pdf.text(M + 40, bTop + 8, 'I certify that the grain delivered against this receipt', { size: 8.5 });
  pdf.checkbox(M + W - 22, bTop + 6, 9, B);
  let by = bTop + 26;
  const statement = (join, tag, text, checked) => {
    if (join) pdf.text(M + 8, by, join, { size: 8.5 });
    pdf.text(M + 40, by, tag, { size: 8.5, bold: true });
    const end = pdf.paragraph(M + 70, by, text, W - 110, { size: 8.5, lineHeight: 11 });
    pdf.checkbox(M + W - 22, by - 1, 9, B && checked);
    by = Math.max(by + 18, end + 6);
  };
  statement('', '1.0', 'has not been treated with a pickling compound or other seed treatment;', d.seedUntreated);
  statement('And/or', '2.1', 'has not been treated with any fumigant/pesticide/insecticide;', d.notFumigated);
  statement('or', '2.2', 'has been treated as detailed below: in accordance with the registered label of those chemicals; at rates not exceeding the maximum rates set out on the label; the withholding period for those chemicals has been observed.', !d.notFumigated || d.chemicals.some((c) => clean(c.product)));
  by += 4;

  // chemicals table
  const cx = M + 8;
  const cw = W - 16;
  const cols = [cw * 0.46, cw * 0.27, cw * 0.27];
  pdf.rect(cx, by, cw, 16, { stroke: BLUE, fill: 0.3 });
  ['Chemical Applied', 'Rate', 'Application Date'].forEach((h, i) => {
    const x0 = cx + cols.slice(0, i).reduce((a, b) => a + b, 0);
    pdf.text(x0 + cols[i] / 2, by + 4, h, { size: 8.5, bold: true, align: 'center', gray: 1 });
  });
  by += 16;
  const chems = d.chemicals.filter((c) => clean(c.product) || clean(c.rate) || clean(c.date));
  const rowsToDraw = Math.max(chems.length, 3);
  for (let i = 0; i < rowsToDraw; i += 1) {
    if (by > 740) { pdf.addPage(); by = M; }
    const c = chems[i] || {};
    pdf.rect(cx, by, cw, 18, { stroke: BLUE });
    let x0 = cx;
    [clean(c.product), clean(c.rate), c.date ? dmy(c.date) : ''].forEach((val, j) => {
      if (j > 0) pdf.line(x0, by, x0, by + 18, { gray: BLUE });
      pdf.text(x0 + 4, by + 5, wrapText(val, cols[j] - 8, 9)[0] || '', { size: 9 });
      x0 += cols[j];
    });
    by += 18;
  }
  by += 12;

  // GMO
  if (by > 690) { pdf.addPage(); by = M; }
  pdf.text(M + 8, by, 'The grain represented on this Commodity Vendor Declaration is', { size: 8.5 });
  by += 16;
  GMO_OPTIONS.forEach((o, i) => {
    pdf.checkbox(M + 30, by - 1, 9, Number(d.gmo) === o.value);
    pdf.text(M + 46, by, `${i + 1}. ${o.label}${i < 2 ? '; or' : ''}`, { size: 8.5 });
    by += 15;
  });
  by += 18;

  // signature
  const signed = d.useSignature && hasSignature(d.signature);
  if (signed) by += 16;
  if (by > 760) { pdf.addPage(); by = M + 30; }
  if (signed) {
    for (const stroke of strokesInBox(d.signature, M + 108, by - 27, 120, 40)) pdf.polyline(stroke, { width: 1.1, gray: 0.1 });
  }
  pdf.text(M + 8, by, "Vendor's signature:", { size: 9, bold: true });
  pdf.line(M + 100, by + 11, M + 330, by + 11);
  pdf.text(M + 350, by, 'Date:', { size: 9, bold: true });
  pdf.line(M + 380, by + 11, M + W - 8, by + 11);
  pdf.text(M + 384, by, d.signedDate ? dmy(d.signedDate) : '', { size: 9 });
  if (clean(d.signedBy)) pdf.text(M + 104, by + 15, d.signedBy, { size: 8, gray: 0.3 });
  pdf.text(pdf.width / 2, pdf.height - 28, 'Prepared in Grainflow, in the layout of the Grain Trade Australia commodity vendor declaration.', { size: 7, align: 'center', gray: 0.5 });
  return pdf.bytes();
}

export { textWidth };
