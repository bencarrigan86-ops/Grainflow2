// An invoice, a cotton invoice and an adjustment note as PDF files, so they can be sent or saved on any phone. (The browser's own
// print dialog is not there on every phone, so the buttons on the invoice screen make a file instead.)
//
// The same words, in the same order, as the page on screen (views/invoice.js). Pure: it builds bytes from the records and the
// farm's details and touches nothing else.

import { Pdf, wrapText } from './pdf.js?v=412';
import { drawBrandLogo } from './brand.js?v=412';
import { letterheadLine } from './docband.js?v=412';
import { addressLinesOf } from './address.js?v=412';
import { num, money, dmy } from './fmt.js?v=412';
import { signerName } from './signdoc.js?v=412';
import { deductionNotes } from './deductions.js?v=412';
import { cottonInvoiceModel } from './cottoninvoice.js?v=412';
import { noteLabel, netPayable } from './adjustment.js?v=412';
import { hasSignature, strokesInBox } from './signature.js?v=412';

const M = 40;
const GREEN = [0.18, 0.49, 0.196];
const SHADE = [0.94, 0.97, 0.94];
const LINE = 0.15;
const DASH = '—';

/** The bank rows that have something in them: [['Bank', 'CBA'], ...]. */
export function bankRows(business = {}) {
  return [['Bank', business.bankName], ['Account name', business.accountName], ['BSB', business.bsb], ['Account number', business.accountNumber]]
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => [k, String(v).trim()]);
}

/** A negative amount as a minus in front of the dollar sign, the way the invoice screen writes it. */
const minus = (v, dp = 2) => `-${money(v, dp)}`;

/** The page: the band at the top, the seller and the buyer, then a cursor to write the rest from. */
function startDocument({ title, metaParts, sale, business }) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  pdf.rect(0, 0, pdf.width, 72, { stroke: null, fill: GREEN });
  const rx = drawBrandLogo(pdf, { right: M + W, top: 12, maxW: 110, maxH: 46, tile: true });
  const from = letterheadLine(business);
  if (from) pdf.text(M, 11, from, { size: 9.5, bold: true, gray: 0.93 });
  pdf.text(M, 25, title, { size: 19, bold: true, gray: 1 });
  pdf.text(M, 52, wrapText(metaParts.filter(Boolean).join('  ·  '), rx - M - 6, 9.5)[0] || '', { size: 9.5, gray: 0.95 });

  const top = 84;
  const colW = (W - 14) / 2;
  const sellerLines = [
    business.entityName || DASH,
    business.abn ? `ABN ${business.abn}` : '', business.ngr ? `NGR ${business.ngr}` : '',
    ...addressLinesOf(business.address, business.addressParts),
    business.contactName, business.phone, business.email,
  ].filter(Boolean);
  const buyerLines = [sale.buyer || DASH, sale.buyerAbn ? `ABN ${sale.buyerAbn}` : '', ...addressLinesOf(sale.buyerAddress, sale.buyerAddressParts)].filter(Boolean);
  const partyH = 26 + Math.max(sellerLines.length, buyerLines.length) * 12.5 + 6;
  const party = (x, label, lines) => {
    pdf.rect(x, top, colW, partyH, { stroke: LINE, lineWidth: 1 });
    pdf.text(x + 8, top + 7, label, { size: 8.5, bold: true, gray: GREEN });
    lines.forEach((l, i) => pdf.text(x + 8, top + 24 + i * 12.5, wrapText(l, colW - 16, 9.5, i === 0)[0], { size: 9.5, bold: i === 0 }));
  };
  party(M, 'SELLER', sellerLines);
  party(M + colW + 14, 'BUYER', buyerLines);

  const state = { pdf, W, y: top + partyH + 12 };
  state.room = (h) => { if (state.y + h > pdf.height - 56) { pdf.addPage(); state.y = 44; return true; } return false; };
  return state;
}

/** A line of words under the parties; wraps and moves down. */
function lineOf(s, label, value, { gap = 4 } = {}) {
  const text = label ? `${label} ${value}` : value;
  const h = wrapText(text, s.W, 9.5).length * 12.5;
  s.room(h);
  if (label) {
    const lw = s.pdf.text(M, s.y, label, { size: 9.5, bold: true });
    s.y = s.pdf.paragraph(M + lw + 4, s.y, value, s.W - lw - 4, { size: 9.5, lineHeight: 12.5 }) + gap;
  } else {
    s.y = s.pdf.paragraph(M, s.y, text, s.W, { size: 9.5, lineHeight: 12.5 }) + gap;
  }
}

/** A heading above a table or a block of totals. */
function heading(s, text) {
  s.room(34);
  s.pdf.text(M, s.y + 4, text, { size: 10.5, bold: true });
  s.y += 22;
}

/**
 * A table: columns [{ label, w, right }] with widths in proportion, rows of strings, optional notes under a row, optional footing.
 * The header is repeated when a table runs onto a new page.
 */
function table(s, cols, rows, { foot = null, size = 8.5 } = {}) {
  const { pdf, W } = s;
  const total = cols.reduce((a, c) => a + c.w, 0);
  const widths = cols.map((c) => (c.w / total) * W);
  const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const pad = 4;
  const cell = (i, text, y, bold = false) => {
    const c = cols[i];
    const lines = wrapText(String(text ?? ''), widths[i] - pad * 2, size, bold);
    lines.forEach((l, k) => pdf.text(c.right ? xs[i] + widths[i] - pad : xs[i] + pad, y + 4 + k * (size + 3), l, { size, bold, align: c.right ? 'right' : 'left' }));
    return lines.length;
  };
  const head = () => {
    const h = 22;
    pdf.rect(M, s.y, W, h, { stroke: null, fill: GREEN });
    cols.forEach((c, i) => {
      const t = wrapText(c.label, widths[i] - pad * 2, size, true)[0] || '';
      pdf.text(c.right ? xs[i] + widths[i] - pad : xs[i] + pad, s.y + 6, t, { size, bold: true, gray: 1, align: c.right ? 'right' : 'left' });
    });
    s.y += h;
  };
  s.room(22 + 24);
  head();
  rows.forEach((r, n) => {
    const cells = Array.isArray(r) ? r : r.cells;
    const notes = Array.isArray(r) ? [] : (r.notes || []);
    const lines = Math.max(1, ...cells.map((t, i) => wrapText(String(t ?? ''), widths[i] - pad * 2, size).length));
    const noteLines = notes.flatMap((t) => wrapText(t, W - pad * 2 - 8, size - 0.5));
    const h = lines * (size + 3) + 8 + noteLines.length * (size + 2);
    if (s.room(h + 4)) head();
    if (n % 2 === 0) pdf.rect(M, s.y, W, h, { stroke: null, fill: SHADE });
    cells.forEach((t, i) => cell(i, t, s.y));
    noteLines.forEach((l, k) => pdf.text(M + pad + 8, s.y + 4 + lines * (size + 3) + k * (size + 2), l, { size: size - 0.5, gray: 0.35 }));
    s.y += h;
  });
  if (foot) {
    const h = Math.max(1, ...foot.map((t, i) => wrapText(String(t ?? ''), widths[i] - pad * 2, size, true).length)) * (size + 3) + 8;
    s.room(h + 4);
    pdf.line(M, s.y, M + W, s.y, { width: 0.8, gray: 0.35 });
    foot.forEach((t, i) => { if (t !== '' && t != null) cell(i, t, s.y, true); });
    s.y += h;
  }
  s.y += 10;
}

/** Totals, right-aligned: [[label, value, 'total'?], ...]. */
function totals(s, rows) {
  const { pdf, W } = s;
  const bw = Math.min(300, W);
  const x = M + W - bw;
  for (const [label, value, kind] of rows) {
    const big = kind === 'total';
    const size = big ? 11 : 9.5;
    s.room(big ? 30 : 18);
    if (big) { pdf.line(x, s.y, x + bw, s.y, { width: 0.8, gray: 0.3 }); s.y += 6; }
    const lines = wrapText(label, bw - 90, size, big);
    lines.forEach((l, i) => pdf.text(x, s.y + i * (size + 3), l, { size, bold: big }));
    pdf.text(x + bw, s.y, value, { size, bold: big, align: 'right' });
    s.y += Math.max(1, lines.length) * (size + 3) + 3;
  }
  s.y += 8;
}

/** How to pay, when the farm's bank details have been entered (managers and workers do not get them, so they are not here). */
function bank(s, business) {
  const rows = bankRows(business);
  if (!rows.length) return;
  const h = 26 + rows.length * 14;
  s.room(h + 6);
  s.pdf.rect(M, s.y, s.W, h, { stroke: LINE, lineWidth: 1 });
  s.pdf.text(M + 8, s.y + 7, 'Payment details', { size: 9.5, bold: true });
  rows.forEach(([k, v], i) => {
    s.pdf.text(M + 8, s.y + 24 + i * 14, k, { size: 9, gray: 0.35 });
    s.pdf.text(M + 110, s.y + 24 + i * 14, v, { size: 9.5, bold: true });
  });
  s.y += h + 10;
}

/** The signature, when the invoice is signed: the ink, then the name and the date under it. */
function signature(s, { signature: sig, printedName, date, business }) {
  if (!sig || !hasSignature(sig.strokes)) return;
  s.room(90);
  const name = String(printedName || signerName(sig, business)).trim();
  s.pdf.text(M, s.y, 'Signed', { size: 8.5, gray: 0.45 });
  for (const stroke of strokesInBox(sig.strokes, M, s.y + 12, 120, 40)) s.pdf.polyline(stroke, { width: 1.1, gray: 0.1 });
  s.pdf.line(M, s.y + 56, M + 170, s.y + 56, { width: 0.6, gray: 0.5 });
  s.pdf.text(M, s.y + 60, [name, date ? dmy(date) : ''].filter(Boolean).join('  ·  '), { size: 9, bold: true });
  s.y += 84;
}

const finish = (s) => {
  s.pdf.text(s.pdf.width / 2, s.pdf.height - 28, 'Prepared in Commodity Mate.', { size: 7, align: 'center', gray: 0.5 });
  return s.pdf.bytes();
};

const invoiceMeta = (sale, invoice) => [
  `Invoice #${invoice.invoiceNo}`, `Invoice date: ${dmy(invoice.issueDate) || DASH}`, `Payment due: ${dmy(invoice.dueDate) || DASH}`,
  sale.contractNo ? `Contract: ${sale.contractNo}` : '',
];

/** A cotton invoice: the contract, the bale range, the payment per 227 kg bale, premiums and discounts, GST, the gin invoices taken off. */
function cottonInvoice(s, { sale, invoice, business, commodity }) {
  const m = cottonInvoiceModel(invoice);
  lineOf(s, 'Contract:', `${commodity?.name || 'Cotton'} Sales Contract${sale.contractNo ? ` ${sale.contractNo}` : ''}`);
  const range = m.ranges.map((r) => `${r.from} – ${r.to}`).join(', ');
  if (range) lineOf(s, 'Bale range:', `${range} · ${num(m.physicalBales, 0)} bales`, { gap: 8 });
  lineOf(s, '', 'Payment is calculated as follows:', { gap: 6 });
  table(s, [{ label: 'Contract', w: 3 }, { label: 'Per bale', w: 2, right: true }, { label: '227 kg bales', w: 2, right: true }, { label: 'Gross', w: 2, right: true }],
    m.rows.map((r) => [sale.contractNo || 'Contract', money(r.rate, 2), num(r.bales, 2), money(r.amount, 2)]),
    { foot: m.rows.length > 1 ? ['Total', '', num(m.stdBales, 2), money(m.gross, 2)] : null });
  if (m.premiums.length || m.adjustments.length) {
    heading(s, 'Premiums and discounts');
    table(s, [{ label: 'Item', w: 6 }, { label: 'Amount', w: 2, right: true }],
      [...m.premiums, ...m.adjustments].map((l) => ({
        cells: [l.description || l.rego || 'Premium / discount', money(l.subtotal, 2)],
        notes: [
          l.perBale ? `${l.bales ? `${num(l.bales, 2)} bales at ` : ''}${l.foreign ? 'US' : ''}${money(l.perBale, 2)} a bale` : '',
          l.foreign ? `US$ ${num(l.foreign.usd, 2)}` : '',
        ].filter(Boolean),
      })),
      { foot: ['Total premiums and discounts', money(m.premiumTotal + m.adjustmentTotal, 2)] });
    if (m.usdTotal != null) lineOf(s, '', `US$ ${num(m.usdTotal, 2)} at an exchange rate of ${m.fxRate}`);
  }
  totals(s, [
    ['Value nett of premiums and discounts', money(m.valueNett, 2)],
    ...(m.levies > 0 ? [['Levies', minus(m.levies)]] : []),
    ...(m.freight > 0 ? [['Freight', minus(m.freight)]] : []),
    ['GST amount', money(m.gst, 2)],
    ['Total amount due including tax', money(m.dueIncludingTax, 2), m.gin.length ? '' : 'total'],
  ]);
  if (m.gin.length) {
    heading(s, 'Ginning invoices prepaid');
    totals(s, [
      ...m.gin.map((g) => [g.description, money(g.amount, 2)]),
      ['Total gin prepayments on this invoice', minus(m.ginTotal)],
      ['Total due', money(m.totalDue, 2), 'total'],
    ]);
  }
}

/** A grain, hay or other invoice: a line for each load, freight taken off, levies, GST. */
function grainInvoice(s, { sale, invoice, commodity }) {
  lineOf(s, 'Commodity:', `${commodity?.name || DASH}${sale.grade ? ` (${sale.grade})` : ''}${sale.location ? ` · ${sale.location}` : ''}`, { gap: 8 });
  const bales = invoice.lines.reduce((a, l) => a + (Number(l.hayBales) || 0), 0);
  table(s, [
    { label: 'Date', w: 9 }, { label: 'Ticket', w: 7 }, { label: 'Rego / item', w: 13 }, { label: 'Grade', w: 8 }, { label: 'Tonnes', w: 8, right: true },
    { label: 'Base $/t', w: 9, right: true }, { label: 'Prem / disc', w: 10, right: true }, { label: 'Rate', w: 9, right: true }, { label: 'Subtotal', w: 12, right: true },
  ], invoice.lines.map((l) => ({
    cells: [
      dmy(l.date) || DASH, l.ticketNo || DASH, l.description || l.rego || DASH, l.grade || DASH,
      l.tons != null ? `${num(l.tons, 2)}${l.hayBales ? ` (${num(l.hayBales, 0)} bale${l.hayBales === 1 ? '' : 's'})` : ''}` : DASH,
      l.basePrice != null ? money(l.basePrice, 2) : DASH,
      l.adjust != null ? `${l.adjust > 0 ? '+' : ''}${money(l.adjust, 2)}` : DASH,
      l.rate != null ? money(l.rate, 2) : DASH,
      money(l.subtotal, 2),
    ],
    notes: deductionNotes(l.deductions, l.tons),
  })), {
    size: 8,
    foot: ['Total', '', '', '', `${num(invoice.totalTons, 2)}${bales > 0 ? ` (${num(bales, 0)} bales)` : ''}`, '', '', '', money(invoice.subtotalExGST, 2)],
  });
  const freightLines = invoice.lines.filter((l) => l.movementId && Number(l.freight) > 0);
  if (freightLines.length) {
    heading(s, 'Freight deducted');
    table(s, [{ label: 'Date', w: 3 }, { label: 'Rego', w: 3 }, { label: 'Tonnes', w: 2, right: true }, { label: 'Freight $/t', w: 3, right: true }, { label: 'Amount', w: 3, right: true }],
      freightLines.map((l) => [dmy(l.date) || DASH, l.rego || DASH, num(l.tons, 2), money(l.freightRate, 2), money(l.freight, 2)]),
      { foot: ['Total freight', '', num(freightLines.reduce((a, l) => a + (Number(l.tons) || 0), 0), 2), '', money(freightLines.reduce((a, l) => a + (Number(l.freight) || 0), 0), 2)] });
  }
  totals(s, [
    ['Subtotal (Ex GST)', money(invoice.subtotalExGST, 2)],
    ...(invoice.freightTotal > 0 ? [['Freight', minus(invoice.freightTotal)]] : []),
    ['Grain levies', minus(invoice.levies)],
    ['GST', money(invoice.gst, 2)],
    ['Total amount payable', money(invoice.totalPayable, 2), 'total'],
  ]);
}

/**
 * A tax invoice as a PDF.
 * @param {{ sale: object, invoice: object, business?: object, commodity?: object|null, signature?: object|null, printedName?: string, date?: string }} a
 * @returns {Uint8Array}
 */
export function invoicePdf({ sale, invoice, business = {}, commodity = null, signature: sig = null, printedName = '', date = '' }) {
  const s = startDocument({ title: 'TAX INVOICE', metaParts: invoiceMeta(sale, invoice), sale, business });
  if (commodity?.unit === 'bale') cottonInvoice(s, { sale, invoice, business, commodity });
  else grainInvoice(s, { sale, invoice, commodity });
  bank(s, business);
  signature(s, { signature: sig, printedName, date, business });
  return finish(s);
}

/** An adjustment note as a PDF: the reason, the adjustment, and what is now payable on the invoice it adjusts. */
export function adjustmentPdf({ sale, note, invoices = [], business = {} }) {
  const original = invoices.find((i) => i.id === note.adjustsInvoiceId);
  const { invoiceTotal, adjustments, net } = original ? netPayable(original, invoices) : { invoiceTotal: 0, adjustments: 0, net: 0 };
  const credit = Number(note.totalPayable) < 0;
  const adjusts = original ? `invoice #${original.invoiceNo}${original.issueDate ? ` dated ${dmy(original.issueDate)}` : ''}` : (note.adjustsInvoiceNo != null ? `invoice #${note.adjustsInvoiceNo}` : 'an earlier invoice');
  const s = startDocument({
    title: 'ADJUSTMENT NOTE', sale, business,
    metaParts: [`Adjustment note ${noteLabel(note)}`, `Date: ${dmy(note.issueDate) || DASH}`, original ? `Adjusts invoice: #${original.invoiceNo}` : '', sale.contractNo ? `Contract: ${sale.contractNo}` : ''],
  });
  lineOf(s, 'Reason:', note.reason || '', { gap: 8 });
  lineOf(s, '', `This note ${credit ? 'decreases' : 'increases'} the amount payable on ${adjusts}.`, { gap: 10 });
  totals(s, [
    ['Adjustment (ex GST)', money(note.subtotalExGST, 2)],
    ['GST', money(note.gst, 2)],
    [credit ? 'Total credit' : 'Total additional charge', money(note.totalPayable, 2), 'total'],
  ]);
  if (original) {
    totals(s, [
      [`Invoice #${original.invoiceNo} as first issued`, money(invoiceTotal, 2)],
      ['Adjustment notes to date', money(adjustments, 2)],
      ['Amount now payable', money(net, 2), 'total'],
    ]);
  }
  if (!credit) bank(s, business);
  return finish(s);
}
