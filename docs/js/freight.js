// Freight orders: a job given to a carrier to cart grain against one of the buyer's orders.
//
// Capture it once and it flows on. The job takes its tonnes, window, pick up and delivery from the buyer's order and
// its contract; a load names the freight order it travels on; the carrier's bill names it too. From those the app
// knows what has been carted, what that costs at the agreed rate, and what has not been billed yet (which Payables
// shows as owed, before the carrier's invoice arrives).
//
// The rate is $/t, or $/t/km with a distance, or a flat $/t plus $/t/km with a distance. Only the rate is money; nothing about the grain's price is on the
// carrier's paperwork.
//
// Pure: the screens and the storage layer use it; it touches neither.

import { Pdf, wrapText } from './pdf.js?v=379';
import { drawBrandLogo } from './brand.js?v=379';
import { dmy } from './fmt.js?v=379';
import { movementTonsToSale } from './derived.js?v=379';
import { hasSignature, strokesInBox } from './signature.js?v=379';
import { orderDelivery, orderGrade, bookingRows, orderIssuedText, nilToleranceLines, orderCommentLines, orderCommentText, freightDetailDefaults, showsRate } from './orderdetail.js?v=379';
import { toleranceText } from './contractterms.js?v=379';

export const BASES = [
  { key: 'per_t', label: '$ per tonne' },
  { key: 'per_tkm', label: '$ per tonne per km' },
  { key: 'flat_tkm', label: '$/t flat + per km' },
];

const clean = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const money = (n, dp = 2) => `$${num(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

/** What one tonne costs to cart: the rate, or the rate times the distance when it is per tonne per km. */
export const perTonne = (fo) => round2(fo?.rateBasis === 'per_tkm' ? num(fo.rate) * num(fo.distanceKm)
  : fo?.rateBasis === 'flat_tkm' ? num(fo.flatRate) + num(fo.rate) * num(fo.distanceKm)
    : num(fo?.rate));

/** The rate in words: "$18.50 per tonne", or "$0.12 per tonne per km x 240 km = $28.80 per tonne". */
export function rateText(fo) {
  if (fo?.rateBasis === 'flat_tkm') {
    const km = num(fo.distanceKm);
    return `${money(fo.flatRate)} flat plus ${money(fo.rate, num(fo.rate) < 1 ? 3 : 2)} per tonne per km${km ? ` x ${km} km = ${money(perTonne(fo))} per tonne` : ' (distance not set)'}`;
  }
  if (fo?.rateBasis === 'per_tkm') {
    const km = num(fo.distanceKm);
    return `${money(fo.rate, num(fo.rate) < 1 ? 3 : 2)} per tonne per km${km ? ` x ${km} km = ${money(perTonne(fo))} per tonne` : ' (distance not set)'}`;
  }
  return `${money(fo?.rate)} per tonne`;
}

/** Tonnes carted on a freight order: the loads that name it, as what they put into its contract. */
export function loadedOn(fo, movements) {
  if (!fo?.id) return 0;
  return round3((movements || []).filter((m) => m.freightOrderId === fo.id)
    .reduce((s, m) => s + movementTonsToSale(fo.saleId, [m]), 0));
}

/** Where a freight order stands: tonnes asked for, carted, left; `active` while it can still take loads. */
export function freightState(fo, movements) {
  const ordered = num(fo?.tons);
  const loaded = loadedOn(fo, movements);
  const filled = ordered > 0 && loaded >= ordered - 0.005;
  const state = fo?.status === 'closed' ? 'closed' : filled ? 'filled' : 'open';
  return { ordered, loaded, left: Math.max(0, round3(ordered - loaded)), over: Math.max(0, round3(loaded - ordered)), pct: ordered > 0 ? Math.min(1, loaded / ordered) : 0, state, active: state === 'open' };
}

export const STATE_LABEL = { open: 'Open', filled: 'Filled', closed: 'Closed' };

/** The bills recorded for a freight order, ex GST. */
export const billedOn = (fo, payables) => round2((payables || [])
  .filter((p) => p.kind === 'freight' && p.freightOrderId === fo?.id)
  .reduce((s, p) => s + num(p.amount), 0));

/**
 * What a freight order has run up and what has been billed: tonnes carted at the agreed rate, less what bills
 * recorded against it already cover. `unbilled` is what the carrier has still to bill.
 */
export function freightOwed(fo, movements, payables) {
  const rate = perTonne(fo);
  const tons = loadedOn(fo, movements);
  const owed = round2(rate * tons);
  const billed = billedOn(fo, payables);
  return { rate, tons, owed, billed, unbilled: Math.max(0, round2(owed - billed)) };
}

/** What the job costs once all of it is carted. */
export const estimatedTotal = (fo) => round2(perTonne(fo) * num(fo?.tons));

/** The next number to offer: FO-001, FO-002 ... one more than the highest already used. */
export function nextFreightNo(list) {
  let max = 0;
  for (const f of list || []) {
    const m = /(\d+)\s*$/.exec(clean(f.freightNo));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `FO-${String(max + 1).padStart(3, '0')}`;
}

/**
 * The number to offer for a new freight order on a contract: the contract's number with -01, -02 ... after it
 * (CF-1094-01), one more than the highest already used on that contract. The buyer's contract number is used, or our
 * own reference when there is none; a contract with neither falls back to FO-001, FO-002 ...
 */
export function contractFreightNo(sale, list) {
  const base = clean(sale?.contractNo) || clean(sale?.ourRef);
  if (!base) return nextFreightNo(list);
  const prefix = `${base}-`;
  let max = 0;
  for (const f of list || []) {
    const no = clean(f.freightNo);
    if (no.startsWith(prefix) && /^\d+$/.test(no.slice(prefix.length))) max = Math.max(max, Number(no.slice(prefix.length)));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/**
 * The freight orders a load into a contract can be carted on: those still open for that contract, the ones for the
 * load's buyer order first. `keepId` stays on the list even once filled or closed, so editing an old load never loses it.
 */
export function freightOrdersForLoad(saleId, orderId, list, movements, keepId = null) {
  return (list || [])
    .filter((f) => f.saleId === saleId && (f.id === keepId || freightState(f, movements).active))
    .sort((a, b) => (Number(b.orderId === orderId && !!orderId) - Number(a.orderId === orderId && !!orderId))
      || String(a.loadBy || '9999').localeCompare(String(b.loadBy || '9999')));
}

/** What to call one in a list. */
export const freightTitle = (f) => [clean(f?.freightNo) || 'Freight order', clean(f?.carrier), f?.tons ? `${num(f.tons)} t` : ''].filter(Boolean).join(' · ');

/**
 * What the last freight order to a carrier knew: their email, ABN, contact and phone, the payment terms, and the rate agreed. The
 * newest first. Used to fill in a new freight order to the same carrier.
 */
export function carrierHistory(carrier, freightOrders = []) {
  const name = clean(carrier).toLowerCase();
  if (!name) return null;
  const last = [...(freightOrders || [])].reverse().find((f) => clean(f.carrier).toLowerCase() === name);
  if (!last) return null;
  const d = last.detail || {};
  return {
    carrierEmail: clean(last.carrierEmail), rate: last.rate, rateBasis: last.rateBasis, flatRate: last.flatRate,
    detail: Object.fromEntries(['carrierAbn', 'carrierContact', 'carrierPhone', 'paymentTerms'].filter((k) => clean(d[k])).map((k) => [k, clean(d[k])])),
  };
}

/**
 * A new freight order, filled in from what is already known: the buyer's order gives the tonnes, the window and
 * the carrier; the contract gives where it is going and a starting rate (its Freight $/t estimate).
 */
export function freightDefaults({ sale, order = null, freightOrders = [], carrierEmails = {}, business = {} }) {
  const carrier = clean(order?.freightCompany);
  // the buyer's order says where it goes; failing that, the contract's delivery site
  const to = orderDelivery(order);
  const hist = carrierHistory(carrier, freightOrders);
  return {
    saleId: sale?.id || '',
    orderId: order?.id || '',
    freightNo: contractFreightNo(sale, freightOrders),
    buyerOrderNo: clean(order?.orderNo),
    carrier,
    carrierEmail: carrierEmails[carrier.toLowerCase()] || hist?.carrierEmail || '',
    tons: order ? num(order.tons) : num(sale?.tons),
    // the contract's freight estimate, or what this carrier was last paid
    rate: num(sale?.freight) || (hist && num(hist.rate) > 0 ? hist.rate : ''),
    rateBasis: !num(sale?.freight) && hist && num(hist.rate) > 0 ? hist.rateBasis || 'per_t' : 'per_t',
    flatRate: !num(sale?.freight) && hist && hist.rateBasis === 'flat_tkm' ? hist.flatRate : '',
    distanceKm: '',
    pickup: clean(business.address),
    deliverTo: to.text || clean(sale?.location),
    ...(to.parts ? { deliverToParts: to.parts } : {}),
    loadFrom: (order && order.deliverFrom) || sale?.deliveryStart || '',
    loadBy: (order && order.deliverBy) || sale?.deliveryEnd || '',
    status: 'open',
    // the order's own note, then the other terms the buyer put on it: the carrier's instructions, to change
    notes: [clean(order?.notes), orderCommentText(order)].filter(Boolean).join('\n'),
    ...(withCarrier(freightDetailDefaults({ order, sale, business }), hist) ? { detail: withCarrier(freightDetailDefaults({ order, sale, business }), hist) } : {}),
  };
}

// a detail with the carrier's own particulars from their last freight order laid over it
const withCarrier = (detail, hist) => (hist && Object.keys(hist.detail).length ? { ...(detail || {}), ...hist.detail } : detail);

/** What would send it back: the carrier, the tonnes, the rate. Empty when it is ready to go. */
export function freightProblems(fo) {
  const out = [];
  if (!clean(fo?.carrier)) out.push('Who is carting it');
  if (!(num(fo?.tons) > 0)) out.push('The tonnes');
  if (fo?.rateBasis === 'flat_tkm' ? !(num(fo?.flatRate) > 0 || num(fo?.rate) > 0) : !(num(fo?.rate) > 0)) out.push('The rate');
  if ((fo?.rateBasis === 'per_tkm' || fo?.rateBasis === 'flat_tkm') && !(num(fo?.distanceKm) > 0)) out.push('The distance in km');
  if (fo?.loadFrom && fo?.loadBy && fo.loadBy < fo.loadFrom) out.push('Deliver to date is before deliver from date');
  return out;
}

/** "01-11-2026 to 20-12-2026", "from ...", "by ..." or ''. */
export function windowText(fo) {
  const from = fo?.loadFrom ? dmy(fo.loadFrom) : '';
  const by = fo?.loadBy ? dmy(fo.loadBy) : '';
  if (from && by) return `${from} to ${by}`;
  if (from) return `from ${from}`;
  if (by) return `by ${by}`;
  return '';
}

// --- the PDF ------------------------------------------------------------------------------------------

const M = 40;
const LINE = 0.15;
const GREEN = [0.18, 0.49, 0.196];    // the same green as the other documents
const SHADE = [0.93, 0.96, 0.93];

function labelled(pdf, x, y, labelW, valueW, label, value, lines = 1) {
  pdf.text(x, y + 1, label, { size: 8, bold: true });
  const vx = x + labelW;
  pdf.rect(vx, y - 1, valueW, 12 * lines + 1, { stroke: null, fill: SHADE });
  wrapText(clean(value), valueW - 6, 9).slice(0, lines).forEach((l, i) => pdf.text(vx + 3, y + 1 + i * 12, l, { size: 9 }));
  return y + 12 * lines + 4;
}

function box(pdf, x, y, w, h, title) {
  pdf.rect(x, y, w, h, { stroke: LINE, lineWidth: 1 });
  pdf.text(x + 8, y + 7, title, { size: 8.5, bold: true, gray: GREEN });
}

/**
 * The freight order as a PDF (bytes), for the carrier.
 * @param {{fo: object, sale: object, order?: object|null, commodityName?: string, business: object, issuedBy?: string, date: string, signature?: {strokes: object[], name?: string}|null}} src
 * `signature`, when given, is drawn above the issuer's name: the order is then signed by the person who sends it.
 */
export function freightOrderPdf({ fo, sale, order = null, commodityName = '', business = {}, issuedBy = '', date, signature = null }) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  pdf.rect(0, 0, pdf.width, 66, { stroke: null, fill: GREEN });
  pdf.text(M, 14, 'FREIGHT ORDER', { size: 20, bold: true, gray: 1 });
  const rx = drawBrandLogo(pdf, { right: M + W, top: 10, maxW: 100, maxH: 40, tile: true });   // the farm's logo, if it has one
  pdf.text(rx, 14, `No. ${clean(fo.freightNo) || '-'}`, { size: 13, bold: true, align: 'right', gray: 1 });
  pdf.text(rx, 38, `Issued ${date ? dmy(date) : ''}`, { size: 9.5, align: 'right', gray: 0.92 });

  // who it is from and to
  const top = 74;
  const colW = (W - 14) / 2;
  const party = (x, title, rows) => {
    box(pdf, x, top, colW, 112, title);
    let y = top + 24;
    for (const [label, value] of rows) y = labelled(pdf, x + 8, y, 44, colW - 44 - 16, label, value);
  };
  party(M, 'FROM (WHO IS BOOKING THE TRUCKS)', [
    ['Name:', business.entityName || business.farmName || business.contactName],
    ['Contact:', [business.contactName, business.phone].filter(Boolean).join('  ')],
    ['Email:', business.email],
    ['Address:', business.address],
    ['ABN / NGR:', [business.abn, business.ngr ? `NGR ${business.ngr}` : ''].filter(Boolean).join('   ')],
  ]);
  party(M + colW + 14, 'TO (THE CARRIER)', [
    ['Carrier:', fo.carrier],
    ['ABN:', fo.detail?.carrierAbn],
    ['Contact:', [fo.detail?.carrierContact, fo.detail?.carrierPhone].filter(Boolean).join('  ')],
    ['Email:', fo.carrierEmail],
  ]);

  // the job
  const jy = top + 124;
  box(pdf, M, jy, W, 196, 'THE JOB');
  let y = jy + 24;
  const half = (W - 24) / 2;
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Commodity:', [commodityName, orderGrade(order, sale) ? `(${orderGrade(order, sale)})` : ''].filter(Boolean).join(' '));
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Contract no:', sale?.contractNo);
  y = labelled(pdf, M + 8, y, 60, W - 76, "Buyer's order:", clean(fo.buyerOrderNo) || (order?.orderNo ? `${order.orderNo}` : ''));
  labelled(pdf, M + 8, y, 60, half - 52, 'Tonnes:', num(fo.tons) ? `${num(fo.tons)} t` : '');
  y = labelled(pdf, M + 20 + half, y, 56, half - 60, 'Dates:', windowText(fo));
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Pick up from:', fo.pickup, 2);
  // the company it goes to, then its address; one made before the company was kept takes the buyer on the contract
  const company = fo.detail?.ownTerms ? fo.detail.deliverCompany : (fo.detail?.deliverCompany || sale?.buyer);
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Deliver to:', company);
  y = labelled(pdf, M + 8, y, 60, W - 76, '', fo.deliverTo, 2);
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Contact:', sale?.buyerContact);

  // the rate
  // (left off the carrier's copy when the freight order says so)
  const ry = jy + 208;
  if (showsRate(fo)) {
    box(pdf, M, ry, W, 62, 'RATE');
    pdf.text(M + 8, ry + 24, rateText(fo), { size: 11, bold: true, gray: GREEN });
    const est = estimatedTotal(fo);
    pdf.text(M + 8, ry + 42, est > 0 ? `About ${money(est, 0)} for ${num(fo.tons)} t, paid on the tonnes actually delivered, per the receival ticket. Rates ex GST.` : 'Paid on the tonnes actually delivered, per the receival ticket. Rates ex GST.', { size: 8.5, gray: 0.25 });
  }

  // instructions, then what the buyer's order says about the receival and what is rejected there
  let ny = showsRate(fo) ? ry + 74 : ry;
  const room = (h) => { if (ny + h > pdf.height - 60) { pdf.addPage(); ny = M; } };
  const section = (title, lines) => {
    const wrapped = lines.flatMap((l) => wrapText(l, W - 16, 9.5));
    const h = 24 + Math.min(wrapped.length, 40) * 12.5 + 6;
    room(h);
    box(pdf, M, ny, W, h, title);
    wrapped.slice(0, 40).forEach((l, i) => pdf.text(M + 8, ny + 24 + i * 12.5, l, { size: 9.5 }));
    ny += h + 10;
  };
  // a box of labelled rows: only those with something in them
  const rowsBox = (title, rows) => {
    const live = rows.filter(([, v]) => clean(v));
    if (!live.length) return;
    const linesOf = (v) => Math.min(3, wrapText(clean(v), W - 16 - 104 - 6, 9).length);
    const h = 24 + live.reduce((s, [, v]) => s + 12 * linesOf(v) + 4, 0) + 4;
    room(h);
    box(pdf, M, ny, W, h, title);
    let ry2 = ny + 24;
    for (const [label, v] of live) ry2 = labelled(pdf, M + 8, ry2, 104, W - 16 - 104, label, v, linesOf(v));
    ny += h + 10;
  };
  // The freight order carries its own booking instructions and rejections, filled in from the grain order. One made before that
  // (with neither) still reads them, and the buyer's other terms, from the grain order.
  const legacy = !fo.detail?.ownTerms && !fo.detail?.deliveryInstructions && !fo.detail?.rejectedOnArrival && !fo.detail?.bookingContact && !fo.detail?.orderIssuedBy;
  const od = order?.detail || {};
  const dt = { ...(legacy ? { deliveryInstructions: od.booking, rejectedOnArrival: nilToleranceLines(od).join('\n'), deliverySite: od.destination, deliverySitePhone: od.sitePhone, deliveryOrderNo: od.deliveryRef, bookingContact: od.bookingContact, orderIssuedBy: orderIssuedText(order) } : {}), ...(fo.detail || {}) };
  rowsBox('COMMODITY AND TERMS', [
    ['Variety:', dt.variety], ['Season:', sale?.cropYear], ['Packaging:', dt.packaging],
    ['Tolerance:', sale ? toleranceText(sale, 't') : ''], ['Transport:', dt.transportMode], ['Payment terms:', dt.paymentTerms],
  ]);
  rowsBox('SITES', [
    ['Pick up site:', dt.pickupSite], ['Pick up phone:', dt.pickupPhone], ['Pick up order no:', dt.pickupOrderNo], ['Pick up instructions:', dt.pickupInstructions],
    ['Delivery site:', dt.deliverySite], ['Delivery phone:', dt.deliverySitePhone], ['Delivery order no:', dt.deliveryOrderNo],
  ]);
  // who to book with, and how: the buyer's booking instructions as the freight order has them
  const booking = [...[['Bookings', dt.bookingContact], ['Order issued by', dt.orderIssuedBy]].filter(([, v]) => clean(v)).map(([label, v]) => `${label}: ${clean(v)}`), ...clean(dt.deliveryInstructions).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)];
  if (booking.length) section('BOOKINGS', booking);
  const nil = nilToleranceLines({ nilTolerance: dt.rejectedOnArrival });
  if (nil.length) section('REJECTED ON ARRIVAL', nil.map((l) => `- ${l}`));
  const terms = legacy ? orderCommentLines(order) : [];
  if (terms.length) section("OTHER TERMS ON THE BUYER'S ORDER", terms);
  if (clean(fo.notes)) {
    const lines = wrapText(fo.notes, W - 16, 9.5);
    const h = 24 + Math.min(lines.length, 12) * 12.5 + 6;
    room(h);
    box(pdf, M, ny, W, h, 'INSTRUCTIONS');
    pdf.paragraph(M + 8, ny + 24, lines.slice(0, 12).join('\n'), W - 16, { size: 9.5, lineHeight: 12.5 });
    ny += h + 12;
  }
  room(96);   // the closing line and the signature stay together
  pdf.paragraph(M, ny, 'Please quote this freight order number on your tax invoice, and keep the weighbridge or receival ticket for each load. Contact us before loading if anything here does not match your booking.', W, { size: 8.5, lineHeight: 11, gray: 0.25 });
  const signed = !!signature && hasSignature(signature.strokes);
  if (signed) {
    for (const stroke of strokesInBox(signature.strokes, M, ny + 30, 120, 40)) pdf.polyline(stroke, { width: 1.1, gray: 0.1 });
    pdf.line(M, ny + 72, M + 150, ny + 72, { width: 0.6, gray: 0.5 });
  }
  const by = signed ? ny + 78 : ny + 36;
  if (clean(issuedBy)) pdf.text(M, by, `Issued by ${issuedBy}${signed && date ? `, ${dmy(date)}` : ''}`, { size: 9, bold: true });
  pdf.text(pdf.width / 2, pdf.height - 28, 'Prepared in Commodity Mate.', { size: 7, align: 'center', gray: 0.5 });
  return pdf.bytes();
}
