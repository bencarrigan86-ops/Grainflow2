// The Position screen as a PDF: a page to print, keep or send to the bank or accountant.
//
// Same numbers as the screen (positionRows, positionTotals, farmProfitLoss and the bills from payables.js are passed in),
// laid out landscape so every commodity is one row and the columns fit: area, yield, produced, sold, unsold, how much is
// sold, the prices, the values and the gross margin. Under it the whole farm: gross margin, overheads, bills and the
// profit or loss. Pure: it builds bytes and touches nothing else.

import { Pdf } from './pdf.js?v=354';
import { drawBrandLogo } from './brand.js?v=354';

const PAGE = { width: 841.89, height: 595.28 };
const M = 36;
const GREY = 0.4;
// the app's green, #2e7d32, as on the load ticket, with a light tint of it for banding and a deeper one for totals
const GREEN = [0.18, 0.49, 0.196];
const BAND = [0.93, 0.96, 0.93];
const TOTAL = [0.82, 0.9, 0.83];
const LINE = [0.78, 0.86, 0.78];
const LOSS = [0.72, 0.18, 0.15];
/** The commodity table's type sizes, and the room a figure keeps clear of its column's edges (it is centred, so half each side). */
export const BODY = 8.5;
export const HEAD = 7.5;
export const PAD = 9;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const group = (n, dp = 0) => Math.abs(num(n)).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const tonnes = (v) => `${group(v, 0)} t`;
const dollars = (v) => `${num(v) < 0 ? '-' : ''}$${group(v, 0)}`;
const price = (v) => (num(v) ? `$${group(v, 0)}` : '-');
/** The cost entered for a commodity: a dash where none is entered, so it is not read as a free crop. */
const cost = (v) => (num(v) ? dollars(v) : '-');
const costPerHa = (total, ha) => (num(total) && num(ha) > 0 ? `$${group(num(total) / num(ha), 0)}` : '-');
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
  { label: 'Commodity', w: 0.07, cell: (r) => r.commodity.name, total: () => 'Total' },
  { label: 'Area (ha)', w: 0.055, cell: (r) => group(r.area, 0), total: (t) => group(t.area, 0) },
  { label: 'Yield t/ha', w: 0.055, cell: (r) => group(r.yieldTHa, 2), total: () => '' },
  { label: 'Produced', w: 0.065, cell: (r) => tonnes(r.productionTons), total: (t) => tonnes(t.productionTons) },
  { label: 'Sold', w: 0.062, cell: (r) => tonnes(r.soldTons), total: (t) => tonnes(t.soldTons) },
  { label: 'Unsold', w: 0.062, cell: (r) => tonnes(r.unsoldTons), total: (t) => tonnes(t.unsoldTons) },
  { label: '% sold', w: 0.05, cell: (r) => percent(r.pctSold), total: (t) => (t.productionTons > 0 ? percent(t.soldTons / t.productionTons) : '') },
  { label: 'Avg sold', w: 0.054, cell: (r) => price(r.avgSoldPrice), total: (t) => (t.soldTons > 0 ? price(t.soldValue / t.soldTons) : '-') },
  { label: 'MTM', w: 0.045, cell: (r) => price(r.mtmPrice), total: () => '' },
  { label: 'Sold value', w: 0.082, cell: (r) => dollars(r.soldValue), total: (t) => dollars(t.soldValue) },
  { label: 'Unsold value', w: 0.082, cell: (r) => dollars(r.unsoldValue), total: (t) => dollars(t.unsoldValue) },
  { label: 'Position value', w: 0.09, cell: (r) => dollars(r.totalValue), total: (t) => dollars(t.totalValue) },
  { label: 'Cost', w: 0.075, cell: (r) => cost(r.grossMarginCost), total: (t) => cost(t.grossMarginCost) },
  { label: 'Cost $/ha', w: 0.055, cell: (r) => costPerHa(r.grossMarginCost, r.area), total: (t) => costPerHa(t.grossMarginCost, t.area) },
  { label: 'Gross margin', w: 0.098, cell: (r) => dollars(r.grossMargin), total: (t) => dollars(t.grossMargin) },
];

/**
 * @param {{rows: object[], totals: object, overheads: object, pl: object, cost: object}} data
 *   positionRows(), positionTotals(), the overheads, farmProfitLoss() and payablesCost()
 * @param {{business?: string, season?: string, today?: string}} [opts]  today is written as it should read (dd/mm/yyyy)
 * @returns {Uint8Array} the PDF
 */
export function positionPdf({ rows = [], totals = {}, overheads = {}, pl = {}, cost = {} } = {}, { business = '', season = '', today = '', show = {} } = {}) {
  const showResult = show.result !== false;          // the whole-farm result: gross margin, overheads, profit or loss
  const showOverheads = show.overheads !== false;    // the overheads list, and the bills taken off profit
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 40;
  let page = 1;
  let y = 0;

  const footer = () => pdf.text(M, PAGE.height - 22,
    'Made in Commodity Mate. Unsold grain is valued at the mark-to-market (MTM) price; sold grain at the contract prices.', { size: 7.5, gray: GREY });
  // the green band across the top of every page, as on the load ticket
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, 'POSITION', { size: 20, bold: true, gray: 1 });
    pdf.text(rx, 20, season, { size: 12, bold: true, align: 'right', gray: 1 });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 44, who, { size: 9.5, gray: 0.92 });
    if (page > 1) pdf.text(rx, 46, `page ${page}`, { size: 8, gray: 0.85, align: 'right' });
    return 88;
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
    pdf.rect(x, y, tileW, 48, { stroke: LINE, fill: BAND, lineWidth: 0.6 });
    pdf.rect(x, y, 4, 48, { stroke: null, fill: GREEN });
    pdf.text(x + 14, y + 9, label.toUpperCase(), { size: 7.5, bold: true, gray: GREEN });
    pdf.text(x + 14, y + 24, value, { size: 15, bold: true });
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
    if (i === 0) pdf.text(left + 4, y, String(str).slice(0, Math.floor(widths[i] / 4.8)), { size: BODY, ...opts });
    else pdf.text(left + widths[i] / 2, y, String(str), { size: BODY, align: 'center', ...opts });   // figures and headings centred in their column
  };
  const headRow = () => {
    pdf.rect(M, y - 5, W, 19, { stroke: null, fill: GREEN });
    POSITION_COLUMNS.forEach((c, i) => cell(i, c.label, { bold: true, size: HEAD, gray: 1 }));
    y += 20;
  };
  headRow();
  // banded rows: every second one tinted, so the eye can follow a commodity across the page
  rows.forEach((r, n) => {
    if (y + 20 > BOTTOM) { footer(); pdf.addPage(); page += 1; y = header(); headRow(); }
    if (n % 2 === 1) pdf.rect(M, y - 5, W, 18, { stroke: null, fill: BAND });
    POSITION_COLUMNS.forEach((c, i) => cell(i, c.cell(r), i === 0 ? { bold: true } : {}));
    y += 18;
  });
  ensure(26);
  pdf.rect(M, y - 5, W, 19, { stroke: null, fill: TOTAL });
  pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: GREEN });
  POSITION_COLUMNS.forEach((c, i) => cell(i, c.total(totals), { bold: true }));
  y += 34;

  // the whole farm
  const lines = [
    ['Gross margin', dollars(totals.grossMargin)],
    ['Overheads', takeOff(pl.overheadsTotal)],
  ];
  if (num(pl.payablesTotal)) lines.push(['Bills (brokerage, freight, storage, other)', takeOff(pl.payablesTotal)]);
  // the result lines (bold) carry the figure they show, so each is green or red by its own sign, not by the other's
  lines.push([num(pl.profitLoss) >= 0 ? 'Profit' : 'Loss', dollars(pl.profitLoss), true, num(pl.profitLoss)]);
  if (num(pl.openingValue)) {
    lines.push(['Plus opening stock value', `+${dollars(pl.openingValue)}`]);
    lines.push(['Total including opening stock', dollars(pl.profitWithOpening), true, num(pl.profitWithOpening)]);
  }

  const overheadLines = OVERHEADS.map(([key, label]) => [label, num(overheads[key])]).filter(([, v]) => v);
  const billLines = [['Brokerage', cost.brokerage], ['Freight, above or below the contract estimate', cost.freight], ['Storage', cost.storage], ['Other', cost.other]]
    .map(([l, v]) => [l, num(v)]).filter(([, v]) => v);
  if (!showResult && !showOverheads) { footer(); return pdf.bytes(); }       // only the table
  // two columns side by side; one alone takes the left
  const colW = (W - 30) / 2;
  const need = showResult ? 28 + lines.length * 18 + 8 : 0;
  ensure(Math.max(need, showOverheads ? 28 + (Math.max(overheadLines.length, 1) + 1) * 15 : 0));

  // left: the result; right: where the overheads and the bills went
  const top = y;
  // a section heading: green, with a rule under it the width of its column
  const heading = (x, at, label) => {
    pdf.text(x, at, label, { size: 12, bold: true, gray: GREEN });
    pdf.line(x, at + 17, x + colW, at + 17, { width: 1, gray: GREEN });
  };
  // banded lines under a heading; returns the y below them
  const bandedLines = (x, at, list, { size = 9, step = 15 } = {}) => {
    list.forEach(([label, value, strong, ink], n) => {
      if (n % 2 === 0) pdf.rect(x, at - 4, colW, step, { stroke: null, fill: BAND });
      pdf.text(x + 5, at, label, { size, bold: !!strong, gray: ink || 0 });
      pdf.text(x + colW - 5, at, value, { size, bold: !!strong, align: 'right', gray: ink || 0 });
      at += step;
    });
    return at;
  };

  if (showResult) {
    heading(M, top, 'Whole farm');
    bandedLines(M, top + 28, lines.map(([label, value, strong, sign]) => [label, value, strong, strong ? (sign >= 0 ? GREEN : LOSS) : 0]), { size: 10, step: 18 });
  }

  if (showOverheads) {
    const rx = showResult ? M + colW + 30 : M;
    let ry = top;
    heading(rx, ry, 'Overheads');
    ry += 28;
    if (!overheadLines.length) { pdf.text(rx + 5, ry, 'None entered', { size: 9, gray: GREY }); ry += 15; }
    ry = bandedLines(rx, ry, [...overheadLines.map(([l, v]) => [l, dollars(v)]), ['Total overheads', dollars(pl.overheadsTotal), true]]);
    ry += 12;
    if (billLines.length) {
      if (ry + 28 + billLines.length * 15 > BOTTOM) { footer(); pdf.addPage(); page += 1; ry = header(); }
      heading(rx, ry, 'Bills taken off profit');
      ry += 28;
      bandedLines(rx, ry, billLines.map(([l, v]) => [l, dollars(v)]));
    }
  }

  footer();
  return pdf.bytes();
}
