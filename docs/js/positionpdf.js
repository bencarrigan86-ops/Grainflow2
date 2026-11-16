// The Position screen as a PDF: a page to print, keep or send to the bank or accountant.
//
// Same numbers as the screen (positionRows, positionTotals, farmProfitLoss and the bills from payables.js are passed in),
// laid out landscape so every commodity is one row and the columns fit: area, yield, produced, sold, unsold, how much is
// sold, the prices, the values and the gross margin. Under it the whole farm: gross margin, overheads, bills and the
// profit or loss. Pure: it builds bytes and touches nothing else.

import { Pdf } from './pdf.js?v=292';

const PAGE = { width: 841.89, height: 595.28 };
const M = 36;
const GREY = 0.4;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const group = (n, dp = 0) => Math.abs(num(n)).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const tonnes = (v) => `${group(v, 0)} t`;
const dollars = (v) => `${num(v) < 0 ? '-' : ''}$${group(v, 0)}`;
const price = (v) => (num(v) ? `$${group(v, 0)}` : '-');
const percent = (v) => `${Math.round(num(v) * 100)}%`;
/** A cost taken off a result: always shown as a deduction, whatever the sign it was kept with. */
const takeOff = (v) => `-$${group(v, 0)}`;

const OVERHEADS = [
  ['finance', 'Finance'], ['equipmentRepayments', 'Equipment repayments'], ['depreciation', 'Depreciation'],
  ['wages', 'Wages'], ['drawings', 'Drawings'], ['admin', 'Admin'], ['energy', 'Energy'],
  ['insurance', 'Insurance'], ['repairsMaintenance', 'Repairs and maintenance'], ['other', 'Other'],
];

/** The commodity table's columns: header, share of the width, and how a row's cell is written. */
export const POSITION_COLUMNS = [
  { label: 'Commodity', w: 0.095, cell: (r) => r.commodity.name, total: () => 'Total' },
  { label: 'Area (ha)', w: 0.065, cell: (r) => group(r.area, 0), total: (t) => group(t.area, 0) },
  { label: 'Yield t/ha', w: 0.065, cell: (r) => group(r.yieldTHa, 2), total: () => '' },
  { label: 'Produced', w: 0.075, cell: (r) => tonnes(r.productionTons), total: (t) => tonnes(t.productionTons) },
  { label: 'Sold', w: 0.07, cell: (r) => tonnes(r.soldTons), total: (t) => tonnes(t.soldTons) },
  { label: 'Unsold', w: 0.07, cell: (r) => tonnes(r.unsoldTons), total: (t) => tonnes(t.unsoldTons) },
  { label: '% sold', w: 0.055, cell: (r) => percent(r.pctSold), total: (t) => (t.productionTons > 0 ? percent(t.soldTons / t.productionTons) : '') },
  { label: 'Avg sold', w: 0.06, cell: (r) => price(r.avgSoldPrice), total: (t) => (t.soldTons > 0 ? price(t.soldValue / t.soldTons) : '-') },
  { label: 'MTM', w: 0.055, cell: (r) => price(r.mtmPrice), total: () => '' },
  { label: 'Sold value', w: 0.095, cell: (r) => dollars(r.soldValue), total: (t) => dollars(t.soldValue) },
  { label: 'Unsold value', w: 0.095, cell: (r) => dollars(r.unsoldValue), total: (t) => dollars(t.unsoldValue) },
  { label: 'Position value', w: 0.1, cell: (r) => dollars(r.totalValue), total: (t) => dollars(t.totalValue) },
  { label: 'Gross margin', w: 0.1, cell: (r) => dollars(r.grossMargin), total: (t) => dollars(t.grossMargin) },
];

/**
 * @param {{rows: object[], totals: object, overheads: object, pl: object, cost: object}} data
 *   positionRows(), positionTotals(), the overheads, farmProfitLoss() and payablesCost()
 * @param {{business?: string, season?: string, today?: string}} [opts]  today is written as it should read (dd/mm/yyyy)
 * @returns {Uint8Array} the PDF
 */
export function positionPdf({ rows = [], totals = {}, overheads = {}, pl = {}, cost = {} } = {}, { business = '', season = '', today = '' } = {}) {
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 40;
  let page = 1;
  let y = 0;

  const footer = () => pdf.text(M, PAGE.height - 22,
    'Made in Grainflow. Unsold grain is valued at the mark-to-market (MTM) price; sold grain at the contract prices.', { size: 7.5, gray: GREY });
  const header = () => {
    pdf.text(M, 30, 'POSITION', { size: 18, bold: true });
    pdf.text(PAGE.width - M, 36, season, { size: 11, bold: true, align: 'right' });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 56, who, { size: 9.5, gray: 0.2 });
    if (page > 1) pdf.text(PAGE.width - M, 56, `page ${page}`, { size: 8, gray: GREY, align: 'right' });
    return 76;
  };
  const ensure = (h) => {
    if (y + h <= BOTTOM) return;
    footer(); pdf.addPage(); page += 1; y = header();
  };
  y = header();

  // the four figures the screen opens with
  const tiles = [
    ['Total production', tonnes(totals.productionTons)],
    [num(totals.openingValue) ? 'Current crop value' : 'Total position value', dollars(totals.totalValue)],
    ['Sold value', dollars(totals.soldValue)],
    ['Unsold value (MTM)', dollars(totals.unsoldValue)],
  ];
  const tileW = (W - 3 * 10) / tiles.length;
  tiles.forEach(([label, value], i) => {
    const x = M + i * (tileW + 10);
    pdf.rect(x, y, tileW, 46, { stroke: 0.8, fill: 0.96 });
    pdf.text(x + 10, y + 9, label.toUpperCase(), { size: 7.5, bold: true, gray: GREY });
    pdf.text(x + 10, y + 23, value, { size: 15, bold: true });
  });
  y += 64;

  if (!rows.length) {
    pdf.text(M, y, 'Nothing to report yet: add a paddock in Production or a contract in Sales.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  // the commodity table
  const widths = POSITION_COLUMNS.map((c) => c.w * W);
  const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
  const cell = (i, str, opts = {}) => {
    const left = M + edges[i];
    if (i === 0) pdf.text(left + 4, y, String(str).slice(0, Math.floor(widths[i] / 4.8)), { size: 9, ...opts });
    else pdf.text(left + widths[i] - 5, y, String(str), { size: 9, align: 'right', ...opts });
  };
  const headRow = () => {
    pdf.rect(M, y - 4, W, 17, { stroke: null, fill: 0.88 });
    POSITION_COLUMNS.forEach((c, i) => cell(i, c.label, { bold: true, size: 8 }));
    y += 18;
  };
  headRow();
  for (const r of rows) {
    if (y + 20 > BOTTOM) { footer(); pdf.addPage(); page += 1; y = header(); headRow(); }
    POSITION_COLUMNS.forEach((c, i) => cell(i, c.cell(r), i === 0 ? { bold: true } : {}));
    y += 16;
    pdf.line(M, y - 4, M + W, y - 4, { width: 0.4, gray: 0.8 });
  }
  ensure(24);
  pdf.line(M, y - 4, M + W, y - 4, { width: 0.9 });
  y += 2;
  POSITION_COLUMNS.forEach((c, i) => cell(i, c.total(totals), { bold: true }));
  y += 26;

  // the whole farm
  const lines = [
    ['Gross margin', dollars(totals.grossMargin)],
    ['Overheads', takeOff(pl.overheadsTotal)],
  ];
  if (num(pl.payablesTotal)) lines.push(['Bills (brokerage, freight, storage, other)', takeOff(pl.payablesTotal)]);
  lines.push([num(pl.profitLoss) >= 0 ? 'Profit' : 'Loss', dollars(pl.profitLoss), true]);
  if (num(pl.openingValue)) {
    lines.push(['Plus opening stock value', `+${dollars(pl.openingValue)}`]);
    lines.push(['Total including opening stock', dollars(pl.profitWithOpening), true]);
  }

  const overheadLines = OVERHEADS.map(([key, label]) => [label, num(overheads[key])]).filter(([, v]) => v);
  const billLines = [['Brokerage', cost.brokerage], ['Freight, above or below the contract estimate', cost.freight], ['Storage', cost.storage], ['Other', cost.other]]
    .map(([l, v]) => [l, num(v)]).filter(([, v]) => v);
  const colW = (W - 30) / 2;
  const need = 22 + Math.max(lines.length, 0) * 16 + 8;
  ensure(Math.max(need, 30 + Math.max(overheadLines.length, 1) * 14));

  // left: the result; right: where the overheads and the bills went
  const top = y;
  pdf.text(M, y, 'Whole farm', { size: 12, bold: true });
  let ly = y + 20;
  for (const [label, value, strong] of lines) {
    pdf.text(M, ly, label, { size: 10, bold: !!strong });
    pdf.text(M + colW, ly, value, { size: 10, bold: !!strong, align: 'right' });
    ly += 16;
    if (strong) pdf.line(M, ly - 5, M + colW, ly - 5, { width: 0.5, gray: 0.7 });
  }
  const rx = M + colW + 30;
  let ry = top;
  pdf.text(rx, ry, 'Overheads', { size: 12, bold: true });
  ry += 20;
  if (!overheadLines.length) { pdf.text(rx, ry, 'None entered', { size: 9, gray: GREY }); ry += 14; }
  for (const [label, v] of overheadLines) {
    pdf.text(rx, ry, label, { size: 9 });
    pdf.text(rx + colW, ry, dollars(v), { size: 9, align: 'right' });
    ry += 14;
  }
  pdf.line(rx, ry - 4, rx + colW, ry - 4, { width: 0.5, gray: 0.7 });
  pdf.text(rx, ry, 'Total overheads', { size: 9, bold: true });
  pdf.text(rx + colW, ry, dollars(pl.overheadsTotal), { size: 9, bold: true, align: 'right' });
  ry += 22;
  if (billLines.length) {
    if (ry + 20 + billLines.length * 14 > BOTTOM) { footer(); pdf.addPage(); page += 1; ry = header(); }
    pdf.text(rx, ry, 'Bills taken off profit', { size: 12, bold: true });
    ry += 20;
    for (const [label, v] of billLines) {
      pdf.text(rx, ry, label, { size: 9 });
      pdf.text(rx + colW, ry, dollars(v), { size: 9, align: 'right' });
      ry += 14;
    }
  }

  footer();
  return pdf.bytes();
}
