// A statement for one buyer: what they have not paid, and what has gone to them that is not invoiced yet.
//
// The invoices are grouped by the buyer on their contract (the same name in any capitals counts as one buyer). Each
// buyer gets their unpaid invoices with how overdue they are, the grain delivered but not yet on an invoice, and the
// total of both. This is the page to send a buyer who says "what do I owe you?". Pure; the PDF is drawn by statementPdf.

import { receivables, uninvoiced } from './outstanding.js?v=319';
import { Pdf, wrapText } from './pdf.js?v=319';
import { refLabel } from './adjustment.js?v=319';

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const keyOf = (name) => String(name || '').trim().toLowerCase();

/**
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{buyer: string, key: string, unpaid: object[], unpaidTotal: number, overdueTotal: number,
 *            notInvoiced: object[], notInvoicedValue: number, notInvoicedTons: number, owing: number}[]}
 *   one per buyer who owes something or has grain not yet invoiced, the one owing most first
 */
export function buyerStatements(invoices, sales, movements, today) {
  const by = new Map();
  const slot = (name) => {
    const k = keyOf(name) || '(no buyer name)';
    if (!by.has(k)) by.set(k, { buyer: String(name || '').trim() || 'No buyer name', key: k, unpaid: [], notInvoiced: [] });
    return by.get(k);
  };
  for (const r of receivables(invoices, sales, today).rows) slot(r.sale?.buyer).unpaid.push(r);
  for (const r of uninvoiced(sales, movements, invoices, today).rows) slot(r.sale?.buyer).notInvoiced.push(r);

  const out = [...by.values()].map((b) => {
    const unpaidTotal = round2(b.unpaid.reduce((s, r) => s + r.amount, 0));
    const overdueTotal = round2(b.unpaid.filter((r) => r.overdue).reduce((s, r) => s + r.amount, 0));
    const notInvoicedValue = round2(b.notInvoiced.reduce((s, r) => s + r.value, 0));
    const notInvoicedTons = round3(b.notInvoiced.reduce((s, r) => s + r.tons, 0));
    return { ...b, unpaidTotal, overdueTotal, notInvoicedValue, notInvoicedTons, owing: round2(unpaidTotal + notInvoicedValue) };
  });
  return out.sort((a, b) => b.owing - a.owing || a.buyer.localeCompare(b.buyer));
}

const dmy = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const money = (n) => `$${(Number(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GREEN = [0.18, 0.49, 0.196];

/**
 * The statement as a PDF.
 * @param {object} st one entry from buyerStatements
 * @param {{businessName?: string, abn?: string, today: string, contractName?: (sale: object) => string}} o
 * @returns {Uint8Array}
 */
export function statementPdf(st, { businessName = '', abn = '', today, contractName = (s) => s.contractNo || s.buyer || 'Contract' } = {}) {
  const pdf = new Pdf();
  const L = 40; const R = 555;
  let y = 48;
  pdf.rect(0, 0, 595, 70, { fill: GREEN, stroke: null });
  pdf.text(L, 24, 'STATEMENT', { size: 18, bold: true, gray: 1 });
  pdf.text(R, 28, dmy(today), { size: 10, align: 'right', gray: 1 });
  y = 92;
  pdf.text(L, y, st.buyer, { size: 13, bold: true });
  y += 16;
  if (businessName) { pdf.text(L, y, `From ${businessName}${abn ? `  ABN ${abn}` : ''}`, { size: 9, gray: 0.35 }); y += 16; }
  y += 6;

  const row = (cells, { bold = false, gray = 0 } = {}) => {
    cells.forEach(([x, text, align]) => pdf.text(x, y, String(text), { size: 9, bold, align: align || 'left', gray }));
    y += 15;
  };
  const rule = () => { pdf.line(L, y - 4, R, y - 4, { width: 0.5, gray: 0.7 }); };

  pdf.text(L, y, 'Unpaid invoices', { size: 11, bold: true }); y += 18;
  if (!st.unpaid.length) { pdf.text(L, y, 'None.', { size: 9, gray: 0.4 }); y += 16; }
  else {
    row([[L, 'Invoice'], [110, 'Contract'], [300, 'Issued'], [370, 'Due'], [R, 'Amount', 'right']], { bold: true }); rule();
    for (const r of st.unpaid) {
      if (y > 760) { pdf.addPage(); y = 50; }
      const late = r.overdue ? `${r.daysOver} days overdue` : '';
      const name = wrapText(r.sale ? contractName(r.sale) : 'Unknown contract', 180, 9)[0] || '';
      row([[L, refLabel(r.invoice)], [110, name], [300, dmy(r.invoice.issueDate)], [370, `${dmy(r.dueDate) || 'no date'}${late ? `  (${late})` : ''}`], [R, money(r.amount), 'right']], { gray: r.overdue ? 0.1 : 0 });
    }
    rule(); row([[L, 'Unpaid invoices'], [R, money(st.unpaidTotal), 'right']], { bold: true });
    if (st.overdueTotal) row([[L, 'of which overdue'], [R, money(st.overdueTotal), 'right']]);
  }

  y += 12;
  pdf.text(L, y, 'Delivered, not yet invoiced', { size: 11, bold: true }); y += 18;
  if (!st.notInvoiced.length) { pdf.text(L, y, 'None. Every delivery is on an invoice.', { size: 9, gray: 0.4 }); y += 16; }
  else {
    row([[L, 'Contract'], [300, 'Loads'], [370, 'Tonnes'], [R, 'At contract price', 'right']], { bold: true }); rule();
    for (const r of st.notInvoiced) {
      if (y > 760) { pdf.addPage(); y = 50; }
      const name = wrapText(contractName(r.sale), 250, 9)[0] || '';
      row([[L, name], [300, r.loads.length], [370, r.tons.toFixed(2)], [R, money(r.value), 'right']]);
    }
    rule(); row([[L, 'Not yet invoiced'], [370, st.notInvoicedTons.toFixed(2)], [R, money(st.notInvoicedValue), 'right']], { bold: true });
    pdf.text(L, y, 'Priced at the contract, before GST and before any levies or freight the buyer deducts.', { size: 8, gray: 0.45 }); y += 14;
  }

  y += 10;
  pdf.rect(L, y - 4, R - L, 26, { stroke: GREEN, lineWidth: 1 });
  pdf.text(L + 10, y + 3, 'Total owing, invoiced and not yet invoiced', { size: 10, bold: true });
  pdf.text(R - 10, y + 3, money(st.owing), { size: 12, bold: true, align: 'right' });
  return pdf.bytes();
}
