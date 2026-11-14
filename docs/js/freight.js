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

import { Pdf, wrapText } from './pdf.js?v=240';
import { dmy } from './fmt.js?v=240';
import { movementTonsToSale } from './derived.js?v=240';

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
 * A new freight order, filled in from what is already known: the buyer's order gives the tonnes, the window and
 * the carrier; the contract gives where it is going and a starting rate (its Freight $/t estimate).
 */
export function freightDefaults({ sale, order = null, freightOrders = [], carrierEmails = {} }) {
  const carrier = clean(order?.freightCompany);
  return {
    saleId: sale?.id || '',
    orderId: order?.id || '',
    freightNo: nextFreightNo(freightOrders),
    carrier,
    carrierEmail: carrierEmails[carrier.toLowerCase()] || '',
    tons: order ? num(order.tons) : num(sale?.tons),
    rate: num(sale?.freight) || '',
    rateBasis: 'per_t',
    flatRate: '',
    distanceKm: '',
    pickup: '',
    deliverTo: clean(sale?.location),
    loadFrom: (order && order.deliverFrom) || sale?.deliveryStart || '',
    loadBy: (order && order.deliverBy) || sale?.deliveryEnd || '',
    status: 'open',
    notes: clean(order?.notes),
  };
}

/** What would send it back: the carrier, the tonnes, the rate. Empty when it is ready to go. */
export function freightProblems(fo) {
  const out = [];
  if (!clean(fo?.carrier)) out.push('Who is carting it');
  if (!(num(fo?.tons) > 0)) out.push('The tonnes');
  if (fo?.rateBasis === 'flat_tkm' ? !(num(fo?.flatRate) > 0 || num(fo?.rate) > 0) : !(num(fo?.rate) > 0)) out.push('The rate');
  if ((fo?.rateBasis === 'per_tkm' || fo?.rateBasis === 'flat_tkm') && !(num(fo?.distanceKm) > 0)) out.push('The distance in km');
  if (fo?.loadFrom && fo?.loadBy && fo.loadBy < fo.loadFrom) out.push('Load by is before load from');
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
const SHADE = 0.93;

function labelled(pdf, x, y, labelW, valueW, label, value, lines = 1) {
  pdf.text(x, y + 1, label, { size: 8, bold: true });
  const vx = x + labelW;
  pdf.rect(vx, y - 1, valueW, 12 * lines + 1, { stroke: null, fill: SHADE });
  wrapText(clean(value), valueW - 6, 9).slice(0, lines).forEach((l, i) => pdf.text(vx + 3, y + 1 + i * 12, l, { size: 9 }));
  return y + 12 * lines + 4;
}

function box(pdf, x, y, w, h, title) {
  pdf.rect(x, y, w, h, { stroke: LINE, lineWidth: 1 });
  pdf.text(x + 8, y + 7, title, { size: 8.5, bold: true });
}

/**
 * The freight order as a PDF (bytes), for the carrier.
 * @param {{fo: object, sale: object, order?: object|null, commodityName?: string, business: object, issuedBy?: string, date: string}} src
 */
export function freightOrderPdf({ fo, sale, order = null, commodityName = '', business = {}, issuedBy = '', date }) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  pdf.text(M, 30, 'FREIGHT ORDER', { size: 18, bold: true });
  pdf.text(M + W, 30, `No. ${clean(fo.freightNo) || '-'}`, { size: 12, bold: true, align: 'right' });
  pdf.text(M + W, 48, `Issued ${date ? dmy(date) : ''}`, { size: 9, align: 'right', gray: 0.3 });

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
    ['ABN:', business.abn],
  ]);
  party(M + colW + 14, 'TO (THE CARRIER)', [
    ['Carrier:', fo.carrier],
    ['Email:', fo.carrierEmail],
  ]);

  // the job
  const jy = top + 124;
  box(pdf, M, jy, W, 196, 'THE JOB');
  let y = jy + 24;
  const half = (W - 24) / 2;
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Commodity:', [commodityName, sale?.grade ? `(${sale.grade})` : ''].filter(Boolean).join(' '));
  labelled(pdf, M + 8, y, 60, half - 52, 'Tonnes:', num(fo.tons) ? `${num(fo.tons)} t` : '');
  y = labelled(pdf, M + 20 + half, y, 56, half - 52 + 12, 'Load window:', windowText(fo));
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Pick up:', fo.pickup, 2);
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Deliver to:', fo.deliverTo, 2);
  y = labelled(pdf, M + 8, y, 60, W - 76, 'Receiver:', [sale?.buyer, sale?.buyerContact].filter(Boolean).join(' - '), 2);
  labelled(pdf, M + 8, y, 60, half - 52, "Buyer's order:", order?.orderNo ? `${order.orderNo}` : '');
  labelled(pdf, M + 20 + half, y, 56, half - 52 + 12, 'Contract no:', [sale?.contractNo, sale?.ourRef].filter(Boolean).join(' / '));

  // the rate
  const ry = jy + 208;
  box(pdf, M, ry, W, 62, 'RATE');
  pdf.text(M + 8, ry + 24, rateText(fo), { size: 11, bold: true });
  const est = estimatedTotal(fo);
  pdf.text(M + 8, ry + 42, est > 0 ? `About ${money(est, 0)} for ${num(fo.tons)} t, paid on the tonnes actually delivered, per the receival ticket. Rates ex GST.` : 'Paid on the tonnes actually delivered, per the receival ticket. Rates ex GST.', { size: 8.5, gray: 0.25 });

  // instructions
  let ny = ry + 74;
  if (clean(fo.notes)) {
    const lines = wrapText(fo.notes, W - 16, 9.5);
    const h = 24 + Math.min(lines.length, 12) * 12.5 + 6;
    box(pdf, M, ny, W, h, 'INSTRUCTIONS');
    pdf.paragraph(M + 8, ny + 24, lines.slice(0, 12).join('\n'), W - 16, { size: 9.5, lineHeight: 12.5 });
    ny += h + 12;
  }
  pdf.paragraph(M, ny, 'Please quote this freight order number on your tax invoice, and keep the weighbridge or receival ticket for each load. Contact us before loading if anything here does not match your booking.', W, { size: 8.5, lineHeight: 11, gray: 0.25 });
  if (clean(issuedBy)) pdf.text(M, ny + 36, `Issued by ${issuedBy}`, { size: 9, bold: true });
  pdf.text(pdf.width / 2, pdf.height - 28, 'Prepared in Grainflow.', { size: 7, align: 'center', gray: 0.5 });
  return pdf.bytes();
}
