// The buyer exposure as a PDF: a row for each buyer, and in the columns what they owe now, the grain still to go to them, and how far their
// contracts sit from MTM. Landscape A4 in the same style as the Fert page. The figures come from exposure.js (buyerExposure), the same ones
// the screen uses. Pure: it builds bytes.

import { Pdf, wrapText } from './pdf.js?v=331';

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

/** 'YYYY-MM-DD' as day-month-year, the way the screens write dates. */
const dmyText = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('-');
/** A contract's name on its line: the commodity, its grade and the contract number. */
export const exposureContractLine = (c) => [c.commodity, c.grade, c.contractNo ? `#${c.contractNo}` : ''].filter(Boolean).join(' ') || 'Contract';

/** The MTM gap as the screen writes it: green when above zero, red with a minus sign when below, plain at zero. */
export const mtmText = (v) => dollars(Math.round(num(v)) === 0 ? 0 : v);
export const mtmColour = (v) => (Math.round(num(v)) > 0 ? GREEN : Math.round(num(v)) < 0 ? RED : 0);

/** The columns: heading (name, unit), share of the width, how a buyer's cell is written, whether it is left-aligned, and its text colour. */
export const EXPOSURE_COLUMNS = [
  { head: ['Buyer', ''], w: 0.2, left: true, cell: (r) => r.buyer || r.name },
  { head: ['Unpaid invoices', '$'], w: 0.1, cell: (r) => dollars(r.unpaidTotal) },
  { head: ['Overdue', '$'], w: 0.08, cell: (r) => (num(r.overdueTotal) > 0 ? dollars(r.overdueTotal) : '-'), colour: (r) => (num(r.overdueTotal) > 0 ? RED : 0) },
  { head: ['Not invoiced', '$'], w: 0.1, cell: (r) => dollars(r.notInvoicedValue) },
  { head: ['Owing now', '$'], w: 0.1, cell: (r) => dollars(r.owing), bold: true },
  { head: ['Share', 'of owed'], w: 0.07, cell: (r) => (num(r.share) > 0 ? `${Math.round(num(r.share) * 100)}%` : '-') },
  { head: ['To go', 't'], w: 0.08, cell: (r) => fixed(r.dueTons, 0) },
  { head: ['To go at contract', '$'], w: 0.12, cell: (r) => dollars(r.dueValue) },
  { head: ['Contracts vs MTM', '$'], w: 0.15, cell: (r) => (r.noMtmAll ? 'no MTM' : mtmText(r.mtmGap)), colour: (r) => (r.noMtmAll ? GREY : mtmColour(r.mtmGap)), bold: true },
];

/**
 * @param {{buyers: object[], total: object}} exposure  buyerExposure()
 * @param {{business?: string, today?: string}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function exposurePdf({ buyers = [], total = {}, weeks = [] } = {}, { business = '', today = '' } = {}) {
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 40;
  let page = 1;
  let y = 0;

  const footer = () => pdf.text(M, PAGE.height - 22,
    'Made in Commodity Mate. Owing now is unpaid invoices plus grain delivered and not yet invoiced. Contracts vs MTM is contract price less MTM price over the tonnes still to go: above zero is in your favour.', { size: 7.5, gray: GREY });
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    pdf.text(M, 16, 'BUYER EXPOSURE', { size: 20, bold: true, gray: 1 });
    if (today) pdf.text(PAGE.width - M, 20, today, { size: 12, bold: true, align: 'right', gray: 1 });
    if (business) pdf.text(M, 44, business, { size: 9.5, gray: 0.92 });
    if (page > 1) pdf.text(PAGE.width - M, 46, `page ${page}`, { size: 8, gray: 0.85, align: 'right' });
    return 88;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  y = header();

  if (!buyers.length) {
    pdf.text(M, y, 'No buyer owes anything and there is no grain still to deliver.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  const widths = EXPOSURE_COLUMNS.map((c) => c.w * W);
  const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
  const mid = (i) => M + edges[i] + widths[i] / 2;
  const fit = (str, i) => wrapText(String(str ?? ''), widths[i] - 8, BODY, true)[0] || '';

  const headRow = () => {
    pdf.rect(M, y - 5, W, 24, { stroke: null, fill: GREEN });
    EXPOSURE_COLUMNS.forEach((c, i) => {
      const [name, unit] = c.head;
      if (c.left) pdf.text(M + 5, y + 2, name, { size: HEAD + 0.5, bold: true, gray: 1 });
      else {
        pdf.text(mid(i), y - 1, name, { size: HEAD, bold: true, align: 'center', gray: 1 });
        if (unit) pdf.text(mid(i), y + 8, unit, { size: HEAD, align: 'center', gray: 0.93 });
      }
    });
    y += 25;
  };
  const drawRow = (r, n, isTotal) => {
    const h = isTotal ? 19 : 17;
    if (isTotal) { pdf.rect(M, y - 5, W, h, { stroke: null, fill: TOTAL }); pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: 0.32 }); }
    else if (n % 2 === 1) pdf.rect(M, y - 5, W, h, { stroke: null, fill: BAND });
    EXPOSURE_COLUMNS.forEach((c, i) => {
      const text = isTotal && i === 0 ? 'Total' : c.cell(r);
      const gray = c.colour ? c.colour(r) : 0;
      if (c.left) pdf.text(M + 5, y, isTotal ? text : fit(text, i), { size: BODY, bold: true, gray });
      else pdf.text(mid(i), y, text, { size: BODY, align: 'center', bold: !!c.bold || isTotal, gray });
    });
    y += h + 1;
  };

  // a contract under its buyer: what it is, its price and MTM and when it ends, then the tonnes left, their value and the gap to MTM
  const CH = 13;
  const drawContract = (c, n) => {
    if (n % 2 === 1) pdf.rect(M, y - 4, W, CH, { stroke: null, fill: BAND });
    pdf.text(M + 14, y, fit(exposureContractLine(c), 0), { size: BODY - 0.5, gray: 0.25 });
    const bits = [`${dollars(c.price)}/t`, c.mtm > 0 ? `MTM ${dollars(c.mtm)}/t` : 'no MTM set', c.end ? `to ${dmyText(c.end)}` : ''].filter(Boolean);
    pdf.text(M + edges[1] + 6, y, bits.join('  ·  '), { size: BODY - 1, gray: GREY });
    pdf.text(mid(6), y, fixed(c.tons, 0), { size: BODY - 0.5, align: 'center' });
    pdf.text(mid(7), y, dollars(c.value), { size: BODY - 0.5, align: 'center' });
    const noGap = c.gap === null || c.gap === undefined;
    pdf.text(mid(8), y, noGap ? 'no MTM' : mtmText(c.gap), { size: BODY - 0.5, align: 'center', gray: noGap ? GREY : mtmColour(c.gap) });
    y += CH + 1;
  };

  headRow();
  buyers.forEach((b, n) => {
    const list = b.list || [];
    if (y + 19 + (list.length ? CH + 1 : 0) > BOTTOM) { newPage(); headRow(); }
    drawRow({ ...b, noMtmAll: b.dueTons > 0 && b.noMtm >= b.contracts && b.contracts > 0 }, n, false);
    list.forEach((c) => {
      if (y + CH + 1 > BOTTOM) { newPage(); headRow(); }
      drawContract(c, n);
    });
  });
  if (y + 22 > BOTTOM) { newPage(); headRow(); }
  drawRow({ buyer: 'Total', unpaidTotal: buyers.reduce((s, b) => s + b.unpaidTotal, 0), overdueTotal: total.overdueTotal, notInvoicedValue: buyers.reduce((s, b) => s + b.notInvoicedValue, 0),
    owing: total.owing, share: total.owing > 0 ? 1 : 0, dueTons: total.dueTons, dueValue: total.dueValue, mtmGap: total.mtmGap, noMtmAll: false }, 0, true);
  // when the unpaid invoices fall due, a line for each week
  if (weeks.length) {
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
  if (total.noMtm) {
    y += 10;
    pdf.text(M, y, `${total.noMtm} contract${total.noMtm === 1 ? ' has' : 's have'} no MTM price set on the commodity, so ${total.noMtm === 1 ? 'it is' : 'they are'} left out of the MTM column.`, { size: 8, gray: GREY });
  }

  footer();
  return pdf.bytes();
}
