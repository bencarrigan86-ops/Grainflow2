// The buyer exposure as a PDF: a row for each buyer, with a line under it for each of its contracts. The contract lines have the contract
// number, the commodity, the sale price, the MTM price, the tonnes delivered and the tonnes still to go in columns, so a contract is one line;
// the buyer's own row carries what they owe (unpaid, overdue, not invoiced, owing now). Landscape A4 in the same style as the Fert page. The
// figures come from exposure.js (buyerExposure), the same ones the screen uses. Pure: it builds bytes.

import { Pdf, wrapText } from './pdf.js?v=507';
import { drawBrandLogo } from './brand.js?v=507';

const PAGE = { width: 841.89, height: 595.28 };
const M = 36;
const GREY = 0.4;
const GREEN = [0.18, 0.49, 0.196];
const RED = [0.72, 0.11, 0.11];
const TOTAL = [0.84, 0.86, 0.88];
const BAND = [0.94, 0.95, 0.96];
const BODY = 8.5;
const HEAD = 7;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fixed = (v, dp = 0) => num(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const dollars = (v) => `${num(v) < 0 ? '-' : ''}$${fixed(Math.abs(num(v)), 0)}`;
/** A price per tonne: whole dollars, or with cents when it has them. */
const price = (v) => `$${fixed(v, Math.abs(num(v) - Math.round(num(v))) < 0.005 ? 0 : 2)}`;
/** Tonnes: whole, or to a decimal. */
const tonnes = (v) => fixed(v, Math.abs(num(v) - Math.round(num(v))) < 0.05 ? 0 : 1);

/** The MTM gap as the screen writes it: green when above zero, red with a minus sign when below, plain at zero. */
export const mtmText = (v) => dollars(Math.round(num(v)) === 0 ? 0 : v);
export const mtmColour = (v) => (Math.round(num(v)) > 0 ? GREEN : Math.round(num(v)) < 0 ? RED : 0);

/**
 * The columns: heading (name, unit), share of the width, whether it is left-aligned, how a buyer's (or the total's) cell is written, and how a
 * contract's line is written. `colour` and `lineColour` give a cell's text colour, and `bold` makes a buyer's cell bold.
 */
export const EXPOSURE_COLUMNS = [
  { key: 'buyer', label: 'Buyer / contract', head: ['Buyer / contract', ''], w: 0.15, left: true, cell: (r) => r.buyer || r.name, line: (c) => (c.contractNo ? `#${c.contractNo}` : 'No contract no.') },
  { key: 'commodity', label: 'Commodity and grade', head: ['Commodity', ''], w: 0.085, left: true, cell: (r) => (r.contracts ? `${r.contracts} contract${r.contracts === 1 ? '' : 's'}` : ''), line: (c) => [c.commodity, c.grade].filter(Boolean).join(' ') },
  { key: 'price', label: 'Sale price', head: ['Sale price', '$/t'], w: 0.05, cell: () => '', line: (c) => price(c.price) },
  { key: 'mtm', label: 'MTM price', head: ['MTM', '$/t'], w: 0.05, cell: () => '', line: (c) => (c.mtm > 0 ? price(c.mtm) : '-') },
  { key: 'delivered', label: 'Delivered tonnes', head: ['Delivered', 't'], w: 0.055, cell: (r) => (r.contracts ? tonnes(r.deliveredTons) : ''), line: (c) => tonnes(c.delivered) },
  { key: 'outstanding', label: 'Outstanding tonnes', head: ['Outstanding', 't'], w: 0.058, cell: (r) => (r.contracts ? tonnes(r.dueTons) : ''), line: (c) => tonnes(c.tons) },
  { key: 'outstandingValue', label: 'Outstanding value', head: ['Outstanding value', '$'], w: 0.078, cell: (r) => (r.contracts ? dollars(r.dueValue) : ''), line: (c) => dollars(c.value) },
  { key: 'vsMtm', label: 'Contracts vs MTM', head: ['Contracts vs MTM', '$'], w: 0.08, cell: (r) => (!r.contracts ? '' : r.noMtmAll ? 'no MTM' : mtmText(r.mtmGap)), colour: (r) => (r.noMtmAll ? GREY : mtmColour(r.mtmGap)), bold: true,
    line: (c) => (c.gap === null || c.gap === undefined ? 'no MTM' : mtmText(c.gap)), lineColour: (c) => (c.gap === null || c.gap === undefined ? GREY : mtmColour(c.gap)) },
  { key: 'unpaid', label: 'Unpaid invoices', head: ['Unpaid invoices', '$'], w: 0.072, cell: (r) => dollars(r.unpaidTotal), line: () => '' },
  { key: 'overdue', label: 'Overdue', head: ['Overdue', '$'], w: 0.064, cell: (r) => (num(r.overdueTotal) > 0 ? dollars(r.overdueTotal) : '-'), colour: (r) => (num(r.overdueTotal) > 0 ? RED : 0), line: () => '' },
  { key: 'notInvoiced', label: 'Delivered, not invoiced', head: ['Not invoiced', '$'], w: 0.07, cell: (r) => dollars(r.notInvoicedValue), line: () => '' },
  { key: 'owing', label: 'Owing now', head: ['Owing now', '$'], w: 0.07, cell: (r) => dollars(r.owing), bold: true, line: () => '' },
  { key: 'exposure', label: 'Total exposure', head: ['Total exposure', '$'], w: 0.078, cell: (r) => dollars(r.exposure), bold: true, line: (c) => (num(c.value) > 0 ? dollars(c.value) : '') },
  { key: 'share', label: 'Share of what is owed', head: ['Share', 'owed'], w: 0.04, cell: (r) => (num(r.share) > 0 ? `${Math.round(num(r.share) * 100)}%` : '-'), line: () => '' },
];

const ALL_KEYS = EXPOSURE_COLUMNS.map((c) => c.key);
/** The columns a PDF has unless someone chooses: all of them. */
export const DEFAULT_EXPOSURE_COLUMNS = ALL_KEYS;
/** One-tap sets for the sheet: the columns, and whether each buyer's contracts are listed under it. */
export const EXPOSURE_PRESETS = [
  { id: 'everything', label: 'Everything', keys: ALL_KEYS, lines: true },
  { id: 'summary', label: 'Summary', keys: ['buyer', 'overdue', 'owing', 'exposure', 'share'], lines: false },
  { id: 'owed', label: 'Money owed', keys: ['buyer', 'unpaid', 'overdue', 'notInvoiced', 'owing', 'share'], lines: false },
  { id: 'contracts', label: 'Contracts', keys: ['buyer', 'commodity', 'price', 'mtm', 'delivered', 'outstanding', 'outstandingValue', 'vsMtm', 'exposure'], lines: true },
];

/**
 * The columns for a choice of keys, in the table's own order with the buyer always first, their widths as shares of the page that add up
 * to 1 (so fewer columns are wider). A choice of nothing but the buyer gives all of them.
 * @param {string[]} [keys]
 */
export function exposureLayout(keys = ALL_KEYS) {
  const want = new Set(Array.isArray(keys) ? keys : ALL_KEYS);
  let picked = EXPOSURE_COLUMNS.filter((c) => c.key === 'buyer' || want.has(c.key));
  if (picked.length < 2) picked = EXPOSURE_COLUMNS;
  const sum = picked.reduce((a, c) => a + c.w, 0);
  return picked.map((c) => ({ ...c, w: c.w / sum }));
}

/**
 * @param {{buyers: object[], total: object}} exposure  buyerExposure()
 * @param {{business?: string, today?: string}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function exposurePdf({ buyers = [], total = {}, weeks = [] } = {}, { business = '', today = '', show = {} } = {}) {
  const COLS = exposureLayout(show.columns);
  const withLines = show.lines !== false && COLS.some((c) => c.key !== 'buyer' && c.line({ contractNo: 'x', commodity: 'x', price: 1, mtm: 1, delivered: 1, tons: 1, value: 1, gap: 1 }));
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 40;
  let page = 1;
  let y = 0;

  const footer = () => {
    const note = 'Made in Commodity Mate. Owing now is unpaid invoices plus grain delivered and not yet invoiced; total exposure adds the outstanding value still to go. Contracts vs MTM is sale price less MTM price over the tonnes outstanding: above zero is in your favour.';
    wrapText(note, W, 7.5).slice(0, 2).forEach((line, i) => pdf.text(M, PAGE.height - 30 + i * 10, line, { size: 7.5, gray: GREY }));
  };
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, 'BUYER EXPOSURE', { size: 20, bold: true, gray: 1 });
    if (today) pdf.text(rx, 20, today, { size: 12, bold: true, align: 'right', gray: 1 });
    if (business) pdf.text(M, 44, business, { size: 9.5, gray: 0.92 });
    if (page > 1) pdf.text(rx, 46, `page ${page}`, { size: 8, gray: 0.85, align: 'right' });
    return 88;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  y = header();

  if (!buyers.length) {
    pdf.text(M, y, 'No buyer owes anything and there is no grain still to deliver.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  const widths = COLS.map((c) => c.w * W);
  const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
  const mid = (i) => M + edges[i] + widths[i] / 2;
  const fit = (str, i, size = BODY, bold = true) => wrapText(String(str ?? ''), widths[i] - 8, size, bold)[0] || '';

  const headRow = () => {
    pdf.rect(M, y - 5, W, 24, { stroke: null, fill: GREEN });
    COLS.forEach((c, i) => {
      const [name, unit] = c.head;
      if (c.left) pdf.text(M + edges[i] + 5, y + 2, name, { size: HEAD + 0.5, bold: true, gray: 1 });
      else {
        // a long heading goes on two lines, with the unit under it
        const words = wrapText(name, widths[i] - 4, HEAD, true);
        const lines = words.length > 1 ? words.slice(0, 2) : [name];
        if (lines.length > 1) {
          pdf.text(mid(i), y - 3, lines[0], { size: HEAD - 0.5, bold: true, align: 'center', gray: 1 });
          pdf.text(mid(i), y + 5, `${lines[1]}${unit ? ` ${unit}` : ''}`, { size: HEAD - 0.5, bold: true, align: 'center', gray: 1 });
        } else {
          pdf.text(mid(i), y - 1, name, { size: HEAD, bold: true, align: 'center', gray: 1 });
          if (unit) pdf.text(mid(i), y + 8, unit, { size: HEAD, align: 'center', gray: 0.93 });
        }
      }
    });
    y += 25;
  };
  // a buyer's row, or the total
  const drawRow = (r, n, isTotal) => {
    const h = isTotal ? 19 : 17;
    if (isTotal) { pdf.rect(M, y - 5, W, h, { stroke: null, fill: TOTAL }); pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: 0.32 }); }
    else if (n % 2 === 1) pdf.rect(M, y - 5, W, h, { stroke: null, fill: BAND });
    COLS.forEach((c, i) => {
      const first = c.key === 'buyer';
      const text = isTotal && first ? 'Total' : c.cell(r);
      const gray = c.colour ? c.colour(r) : 0;
      if (c.left) pdf.text(M + edges[i] + 5, y, isTotal && first ? text : fit(text, i), { size: BODY, bold: first || !!c.bold, gray: first ? 0 : (c.key === 'commodity' ? GREY : gray) });
      else pdf.text(mid(i), y, text, { size: BODY, align: 'center', bold: !!c.bold || isTotal, gray });
    });
    y += h + 1;
  };
  // a contract under its buyer: one line, every figure in its own column
  const CH = 13;
  const drawContract = (c, n) => {
    if (n % 2 === 1) pdf.rect(M, y - 4, W, CH, { stroke: null, fill: BAND });
    COLS.forEach((col, i) => {
      const text = col.line(c);
      if (!text) return;
      const gray = col.lineColour ? col.lineColour(c) : 0.2;
      if (col.left) pdf.text(M + edges[i] + (col.key === 'buyer' ? 14 : 5), y, fit(text, i, BODY - 0.5, false), { size: BODY - 0.5, gray });
      else pdf.text(mid(i), y, text, { size: BODY - 0.5, align: 'center', gray });
    });
    y += CH + 1;
  };

  headRow();
  buyers.forEach((b, n) => {
    const list = withLines ? (b.list || []) : [];
    if (y + 19 + (list.length ? CH + 1 : 0) > BOTTOM) { newPage(); headRow(); }
    drawRow({ ...b, noMtmAll: b.dueTons > 0 && b.noMtm >= b.contracts && b.contracts > 0 }, n, false);
    list.forEach((c) => {
      if (y + CH + 1 > BOTTOM) { newPage(); headRow(); }
      drawContract(c, n);
    });
  });
  if (y + 22 > BOTTOM) { newPage(); headRow(); }
  drawRow({ buyer: 'Total', contracts: buyers.reduce((s, b) => s + b.contracts, 0), unpaidTotal: buyers.reduce((s, b) => s + b.unpaidTotal, 0), overdueTotal: total.overdueTotal,
    notInvoicedValue: buyers.reduce((s, b) => s + b.notInvoicedValue, 0), owing: total.owing, exposure: total.exposure, share: total.owing > 0 ? 1 : 0, deliveredTons: total.deliveredTons,
    dueTons: total.dueTons, dueValue: total.dueValue, mtmGap: total.mtmGap, noMtmAll: false }, 0, true);
  // when the unpaid invoices fall due, a line for each week
  if (weeks.length && show.weeks !== false) {
    y += 14;
    if (y + 40 + weeks.length * 16 > BOTTOM) { newPage(); }
    pdf.text(M, y, 'Invoices due, by week', { size: 11, bold: true, gray: GREEN });
    y += 18;
    weeks.forEach((w, n) => {
      if (y + 16 > BOTTOM) { newPage(); }
      if (n % 2 === 1) pdf.rect(M, y - 5, 330, 16, { stroke: null, fill: BAND });
      const gray = w.late ? RED : 0;
      pdf.text(M + 5, y, w.label, { size: BODY, bold: w.late, gray });
      pdf.text(M + 190, y, `${w.count} invoice${w.count === 1 ? '' : 's'}`, { size: BODY, align: 'center', gray });
      pdf.text(M + 320, y, dollars(w.amount), { size: BODY, bold: true, align: 'right', gray });
      y += 16;
    });
  }
  if (total.noMtm && COLS.some((c) => c.key === 'vsMtm')) {
    y += 10;
    pdf.text(M, y, `${total.noMtm} contract${total.noMtm === 1 ? ' has' : 's have'} no MTM price set on the commodity, so ${total.noMtm === 1 ? 'it is' : 'they are'} left out of the MTM column.`, { size: 8, gray: GREY });
  }

  footer();
  return pdf.bytes();
}
