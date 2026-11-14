// Grain commodity vendor declaration: what the grower declares about grain sold to a buyer.
//
// Two layouts. The default is laid out like the Grain Trade Australia form buyers ask for: buyer and vendor details, the grain, then either
// (A) an accredited quality assurance program, or (B) a statement of what the grain has been treated with, and
// finally whether it is GMO free. It can be made from a contract or from an order against one: choosing the
// contract fills in most of it, and the tonnes and the dates it covers can be changed. The other layout is the national
// Commodity Vendor Declaration (MLA / SAFEMEAT): the same details, then the product integrity questions (source, restricted
// animal material, GMO), the chemical use questions with the withholding period table, and the declaration.
//
// Pure: it builds the declaration's data and its PDF; the screen and the sharing are elsewhere.

import { Pdf, textWidth, wrapText } from './pdf.js?v=240';
import { dmy } from './fmt.js?v=240';
import { hasSignature, strokesInBox } from './signature.js?v=240';

export const MAX_VARIETIES = 4;

/** The three GMO statements on the form. */
export const GMO_OPTIONS = [
  { value: 1, label: 'Free from GMOs as defined by 99% GMO free' },
  { value: 2, label: 'Is free from GMOs as defined by 95% GMO free' },
  { value: 3, label: 'Contains greater than 5% GMO' },
];

/** The two layouts a declaration can be made in. */
export const LAYOUTS = [
  { value: 'gta', label: 'Grain Trade Australia' },
  { value: 'cvd', label: 'National CVD' },
];

/** National CVD, Part A question 1: where the commodity comes from. */
export const CVD_SOURCES = [
  { value: 'single_single', label: 'Single Source, Single Storage (eg off the header)' },
  { value: 'single_comingled', label: 'Single Source, Comingled Storage (eg farm silo)' },
  { value: 'multi_vendor', label: 'Multi-Vendor Storage (eg grain depot, cotton gin seed storage)' },
  { value: 'factory', label: 'Factory Developed Product (eg ethanol plant, gluten plant)' },
];

/** National CVD, Part A question 3: the GMO statements. The values match GMO_OPTIONS. */
export const CVD_GMO_OPTIONS = [
  { value: 1, label: 'Is non GMO as defined by 99% non GMO' },
  { value: 2, label: 'Is non GMO as defined by 95% non GMO' },
  { value: 3, label: 'Contains greater than 5% GMO or content unknown' },
];

/** National CVD, Part B question 8: a by-product's risk assessment. */
export const CVD_BYPRODUCT = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes, attach copy of risk assessment' },
  { value: 'na', label: 'N/A (see explanatory notes)' },
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
      ngr: '',
      pic: '',
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
      pic: clean(business.pic),
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
    // which form it is made on, and the answers only the national CVD asks
    layout: 'gta',
    cvd: {
      source: 'single_comingled',      // 1: a farm silo, the usual case for a grower
      ram: false,                      // 2: restricted animal material
      whpYes: false,                   // 4: within a withholding period, export slaughter or export animal feed interval
      knowsHistory: true,              // 6: aware of the full chemical treatment history
      adjacentCrops: '',               // 7: crops grown within 100 m
      byProduct: 'na',                 // 8: a by-product's risk assessment
      nataTested: false,               // 9: analysed by a NATA accredited lab
    },
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
  if (d.layout === 'cvd') {
    if (d.cvd?.whpYes && !d.chemicals.some((c) => clean(c.product))) out.push('The chemicals still within a withholding period');
  } else {
    if (d.basis === 'declared' && !d.seedUntreated && !d.chemicals.some((c) => clean(c.product))) out.push('The seed treatment or chemical used');
    if (d.basis === 'declared' && !d.notFumigated && !d.chemicals.some((c) => clean(c.product))) out.push('The chemical used');
  }
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
  if (d.layout === 'cvd') return cvdPdf(d);
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

/**
 * The declaration on the national Commodity Vendor Declaration layout: vendor and buyer details, the commodity, Part A
 * (product integrity), Part B (chemical use, with the withholding period table) and Part C (the declaration).
 */
function cvdPdf(d) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  const LIMIT = pdf.height - 48;
  const cvd = d.cvd || {};
  let y = 28;
  const ensure = (h) => { if (y + h > LIMIT) { pdf.addPage(); y = M; } };
  const heading = (title) => {
    ensure(40);
    pdf.rect(M, y, W, 16, { stroke: BLUE, fill: 0.3 });
    pdf.text(pdf.width / 2, y + 4, title, { size: 9.5, bold: true, align: 'center', gray: 1 });
    y += 24;
  };
  const question = (n, text) => {
    ensure(40);
    pdf.text(M + 2, y, `${n}.`, { size: 8.5, bold: true });
    y = pdf.paragraph(M + 16, y, text, W - 20, { size: 8.5, lineHeight: 11 }) + 3;
  };
  const choice = (x, yy, label, checked, width) => {
    pdf.checkbox(x, yy, 9, checked);
    return pdf.paragraph(x + 14, yy + 1, label, width - 16, { size: 8.5, lineHeight: 10 });
  };
  const row = (labels, checkedIdx) => {                 // a row of choices side by side
    ensure(22);
    const w = (W - 20) / labels.length;
    let end = y;
    labels.forEach((l, i) => { end = Math.max(end, choice(M + 16 + i * w, y, l, checkedIdx === i, w)); });
    y = Math.max(end, y + 12) + 6;
  };

  pdf.text(pdf.width / 2, y, 'Commodity Vendor Declaration', { size: 16, bold: true, align: 'center' });
  pdf.text(M + W, y + 22, `Document ID: ${d.documentId}`, { size: 7.5, align: 'right', gray: 0.35 });
  y += 36;

  // vendor and buyer
  const colW = (W - 14) / 2;
  const party = (x, title, p, ref, refLabel) => {
    box(pdf, x, y, colW, 186, title);
    let yy = y + 24;
    const lw = 62; const vw = colW - lw - 16;
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Name:', p.company || p.name);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Address:', p.address, { lines: 2 });
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Town:', p.town);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Tel:', p.tel);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Fax:', p.fax);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'Email:', p.email);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'NGR No:', p.ngr);
    yy = labelled(pdf, x + 8, yy, lw, vw, 'PIC:', p.pic);
    labelled(pdf, x + 8, yy, lw, vw, refLabel, ref);
  };
  party(M, 'VENDOR DETAILS', d.vendor, d.ourContractNo, 'Contract no:');
  party(M + colW + 14, 'BUYER DETAILS', d.buyer, d.contractNo, 'Contract no:');
  y += 194;

  // commodity
  const varieties = d.varieties.filter((v) => clean(v.name) || clean(v.tons)).slice(0, MAX_VARIETIES);
  const vrows = Math.max(varieties.length, 2);
  const total = varieties.reduce((a, v) => a + num(v.tons), 0);
  const ch = 24 + 20 + vrows * 16 + 18 + 4;
  ensure(ch + 8);
  box(pdf, M, y, W, ch, 'COMMODITY DETAILS');
  let cy = y + 24;
  const half = W / 2;
  labelled(pdf, M + 8, cy, 58, half - 58 - 16, 'Commodity:', d.commodity);
  cy = labelled(pdf, M + half + 8, cy, 78, half - 78 - 16, 'Delivery period:', deliveryPeriodText(d));
  for (let i = 0; i < vrows; i += 1) {
    const v = varieties[i] || { name: '', tons: '' };
    labelled(pdf, M + 8, cy, 58, half - 58 - 16, 'Variety:', v.name);
    cy = labelled(pdf, M + half + 8, cy, 78, half - 78 - 16, 'Quantity:', v.tons === '' || v.tons === null || v.tons === undefined ? '' : `${v.tons} t`);
  }
  pdf.text(M + half + 8, cy + 1, 'TOTAL QUANTITY:', { size: 8, bold: true });
  pdf.rect(M + half + 86, cy - 1, half - 86 - 16, 13, { stroke: null, fill: SHADE });
  pdf.text(M + half + 89, cy + 1, total ? `${Math.round(total * 10) / 10} t` : '', { size: 9, bold: true });
  y += ch + 10;

  // Part A
  heading('Part A - Product Integrity');
  question(1, 'Commodity source (tick one)');
  {
    const w = (W - 20) / 2;
    ensure(48);
    const a = choice(M + 16, y, CVD_SOURCES[0].label, cvd.source === 'single_single', w);
    const b = choice(M + 16 + w, y, CVD_SOURCES[1].label, cvd.source === 'single_comingled', w);
    y = Math.max(a, b, y + 12) + 4;
    const c = choice(M + 16, y, CVD_SOURCES[2].label, cvd.source === 'multi_vendor', w);
    const e = choice(M + 16 + w, y, CVD_SOURCES[3].label, cvd.source === 'factory', w);
    y = Math.max(c, e, y + 12) + 8;
  }
  question(2, 'Does this commodity contain restricted animal materials (eg meat and bone meal)?');
  row(['No', 'Yes'], cvd.ram ? 1 : 0);
  question(3, 'With respect to Genetically Modified Organisms, this commodity: (tick one)');
  row(CVD_GMO_OPTIONS.map((o) => o.label), CVD_GMO_OPTIONS.findIndex((o) => o.value === Number(d.gmo)));

  // Part B
  heading('Part B - Chemical Use');
  question(4, 'Is this commodity within a withholding period (WHP), Export Slaughter Interval (ESI) or Export Animal Feed Interval (EAFI) following treatment with any plant chemical including a pickling or seed treatment, fumigant, pesticide or insecticide?');
  row(['No', 'Yes, enter details in the table below'], cvd.whpYes ? 1 : 0);
  {
    const cw = W - 16; const cx = M + 8;
    const cols = [cw * 0.36, cw * 0.18, cw * 0.22, cw * 0.24];
    const chems = cvd.whpYes ? d.chemicals.filter((c) => clean(c.product) || clean(c.rate) || clean(c.date) || clean(c.whp)) : [];
    ensure(16 + Math.max(chems.length, 3) * 18);
    pdf.rect(cx, y, cw, 16, { stroke: BLUE, fill: 0.3 });
    ['Chemical applied', 'Rate (Tonne/Ha)', 'Application date', 'WHP/ ESI/ EAFI'].forEach((h, i) => {
      pdf.text(cx + cols.slice(0, i).reduce((a, b) => a + b, 0) + cols[i] / 2, y + 4, h, { size: 8.5, bold: true, align: 'center', gray: 1 });
    });
    y += 16;
    for (let i = 0; i < Math.max(chems.length, 3); i += 1) {
      ensure(18);
      const c = chems[i] || {};
      pdf.rect(cx, y, cw, 18, { stroke: BLUE });
      let x0 = cx;
      [clean(c.product), clean(c.rate), c.date ? dmy(c.date) : '', clean(c.whp)].forEach((val, j) => {
        if (j > 0) pdf.line(x0, y, x0, y + 18, { gray: BLUE });
        pdf.text(x0 + 4, y + 5, wrapText(val, cols[j] - 8, 9)[0] || '', { size: 9 });
        x0 += cols[j];
      });
      y += 18;
    }
    y += 10;
  }
  question(5, 'Has the commodity been grown and/or stored under an independently audited QA program which includes chemical residue management?');
  row(['No', 'Yes, provide details'], d.basis === 'qa' ? 1 : 0);
  ensure(20);
  pdf.text(M + 16, y, 'QA program', { size: 8.5 });
  pdf.line(M + 70, y + 10, M + 270, y + 10);
  pdf.text(M + 74, y, d.basis === 'qa' ? d.qaProgram : '', { size: 9 });
  pdf.text(M + 285, y, 'Accreditation/ Certification Number', { size: 8.5 });
  pdf.line(M + 430, y + 10, M + W, y + 10);
  pdf.text(M + 434, y, d.basis === 'qa' ? d.qaNumber : '', { size: 9 });
  y += 20;
  y = pdf.paragraph(M + 2, y, 'If this commodity has been grown or stored under such a QA program, please now read and sign Part C. If not, please now complete the remainder of Part B.', W - 4, { size: 8, lineHeight: 10, gray: 0.3 }) + 6;

  const answered = d.basis !== 'qa';                     // under a QA program the rest of Part B is skipped
  question(6, 'Is the vendor of this commodity currently aware of its full chemical treatment history or holds a CVD containing this history?');
  row(['No', 'Yes'], answered ? (cvd.knowsHistory ? 1 : 0) : -1);
  question(7, 'List all known adjacent crops grown within 100 metres of this commodity (only applicable for single source commodities)');
  {
    ensure(34);
    pdf.rect(M + 16, y - 2, W - 16, 30, { stroke: BLUE, fill: SHADE });
    wrapText(answered ? clean(cvd.adjacentCrops) : '', W - 28, 9).slice(0, 2).forEach((l, i) => pdf.text(M + 21, y + 1 + i * 12, l, { size: 9 }));
    y += 36;
  }
  question(8, 'If the commodity is a by-product, has a risk assessment been completed? (tick one)');
  row(CVD_BYPRODUCT.map((o) => o.label), answered ? CVD_BYPRODUCT.findIndex((o) => o.value === cvd.byProduct) : -1);
  question(9, 'Has the commodity been analysed for chemical residues or toxins by a lab accredited by NATA for the specific test required?');
  row(['No', 'Yes, attach details of test results'], answered ? (cvd.nataTested ? 1 : 0) : -1);

  // Part C
  heading('Part C - Declaration');
  ensure(130);
  pdf.text(M + 2, y, 'I,', { size: 9 });
  pdf.line(M + 14, y + 10, M + 250, y + 10);
  pdf.text(M + 18, y, d.signedBy, { size: 9 });
  pdf.text(M + 256, y, 'of', { size: 9 });
  pdf.line(M + 270, y + 10, M + W, y + 10);
  pdf.text(M + 274, y, wrapText(d.vendor.company || d.vendor.name, W - 280, 9)[0] || '', { size: 9 });
  pdf.text(M + 2, y + 18, 'declare that:', { size: 9 });
  y += 36;
  for (const t of [
    'a) I am the duly authorised representative of the vendor supplying the commodity;',
    'b) All the information in this document is true and correct;',
    'c) I have read, understood and answered all questions in accordance with the explanatory notes;',
    'd) I understand that regulatory authorities may take legal action, and purchasers may seek damages if the information provided is false or misleading',
  ]) y = pdf.paragraph(M + 16, y, t, W - 24, { size: 8.5, lineHeight: 11 }) + 2;
  y += 12;
  ensure(60);
  const signed = d.useSignature && hasSignature(d.signature);
  if (signed) {
    y += 14;
    for (const stroke of strokesInBox(d.signature, M + 66, y - 27, 120, 40)) pdf.polyline(stroke, { width: 1.1, gray: 0.1 });
  }
  pdf.text(M + 2, y, 'Signature', { size: 9, bold: true });
  pdf.line(M + 60, y + 11, M + 330, y + 11);
  pdf.text(M + 350, y, 'Date', { size: 9, bold: true });
  pdf.line(M + 380, y + 11, M + W, y + 11);
  pdf.text(M + 384, y, d.signedDate ? dmy(d.signedDate) : '', { size: 9 });
  if (clean(d.signedBy)) pdf.text(M + 64, y + 15, d.signedBy, { size: 8, gray: 0.3 });
  pdf.text(pdf.width / 2, pdf.height - 28, 'Prepared in Grainflow in the layout of the national Commodity Vendor Declaration (MLA / SAFEMEAT, May 2014). Read the explanatory notes on the official form before signing.', { size: 7, align: 'center', gray: 0.5 });
  return pdf.bytes();
}

export { textWidth };
