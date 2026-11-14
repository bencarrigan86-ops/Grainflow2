// End of financial year snapshot: where the grain stood on one day (30 June by default).
//
//   - the grain position: what is sold and what is not, the unsold valued at the average price it was sold at
//   - sold but not yet delivered: tonnes still owed on contracts, and what they come to
//   - delivered but not yet invoiced: loads that have gone and are on no invoice
//   - invoiced but not yet paid
//
// Everything is worked out "as at" the date: a contract, load or invoice dated after it is left out, and an invoice paid
// after it counts as still owed. The result is plain data; eofyPdf() lays it out as the file to keep, which is the frozen
// copy: the figures on screen move on as the books do, the file does not.

import { Pdf } from './pdf.js?v=242';
import { positionRows, saleEconomics } from './derived.js?v=242';
import { uninvoiced, receivables } from './outstanding.js?v=242';
import { dmy } from './fmt.js?v=242';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** The most recent 30 June on or before `today` ('YYYY-MM-DD'). */
export function financialYearEnd(today) {
  const y = Number(String(today).slice(0, 4));
  return `${String(today).slice(5) >= '06-30' ? y : y - 1}-06-30`;
}

/**
 * The snapshot.
 * @param {{asAt: string, commodities: object[], fields: object[], sales: object[], movements: object[], invoices: object[]}} data
 */
export function eofySnapshot({ asAt, commodities = [], fields = [], sales = [], movements = [], invoices = [] }) {
  const contracts = sales.filter((s) => !s.date || s.date <= asAt);
  const loads = movements.filter((m) => !m.date || m.date <= asAt);
  // an invoice paid after the day was still owed on it
  const issued = invoices
    .filter((i) => !i.issueDate || i.issueDate <= asAt)
    .map((i) => (i.status === 'paid' && i.paidDate && i.paidDate > asAt ? { ...i, status: 'outstanding' } : i));

  // the position: unsold tonnes at the average price they were sold at, or the mark-to-market price when nothing is sold yet
  const grain = positionRows(commodities, fields, contracts, loads).filter((r) => r.productionTons || r.soldTons || r.unsoldTons || r.opening).map((r) => {
    const atAverage = r.avgSoldPrice > 0;
    const price = atAverage ? r.avgSoldPrice : r.mtmPrice;
    return {
      commodity: r.commodity,
      productionTons: round3(r.productionTons),
      opening: round3(r.opening),
      retainedSeed: round3(r.retainedSeed),
      soldTons: round3(r.soldTons),
      soldValue: round2(r.soldValue),
      avgSoldPrice: round2(r.avgSoldPrice),
      unsoldTons: round3(r.unsoldTons),
      unsoldPrice: round2(price),
      priceBasis: atAverage ? 'average' : (r.mtmPrice > 0 ? 'mtm' : 'none'),
      unsoldValue: round2(r.unsoldTons * price),
    };
  });
  const sum = (list, key) => round2(list.reduce((s, r) => s + num(r[key]), 0));
  const position = {
    rows: grain,
    soldTons: round3(grain.reduce((s, r) => s + r.soldTons, 0)),
    soldValue: sum(grain, 'soldValue'),
    unsoldTons: round3(grain.reduce((s, r) => s + r.unsoldTons, 0)),
    unsoldValue: sum(grain, 'unsoldValue'),
  };
  position.total = round2(position.soldValue + position.unsoldValue);

  // sold, not delivered: the tonnes still owed on each contract, at the contract's price. A filled contract is not owed.
  const owed = [];
  for (const sale of contracts) {
    if (!(num(sale.tons) > 0)) continue;
    const econ = saleEconomics(sale, loads);
    if (econ.isFull || econ.tonsDue <= 0.005) continue;
    owed.push({ sale, tons: round3(econ.tonsDue), price: round2(econ.priceExFarm), value: round2(econ.tonsDue * econ.priceExFarm) });
  }
  const notDelivered = { rows: owed, tons: round3(owed.reduce((s, r) => s + r.tons, 0)), value: sum(owed, 'value') };

  // delivered, not invoiced
  const un = uninvoiced(contracts, loads, issued, asAt);
  const notInvoiced = { rows: un.rows, tons: round3(un.rows.reduce((s, r) => s + r.tons, 0)), value: round2(un.rows.reduce((s, r) => s + r.value, 0)) };

  // invoiced, not paid
  const rec = receivables(issued, contracts, asAt);
  const unpaid = { rows: rec.rows, count: rec.outstanding.count, total: rec.outstanding.total };

  return { asAt, position, notDelivered, notInvoiced, unpaid };
}

// --- the file ------------------------------------------------------------------------------------------

const M = 40;
const GREY = 0.45;
const contractText = (sale, commodities) => {
  const c = (commodities || []).find((cc) => cc.id === sale.commodityId);
  return [c?.name, sale.buyer, sale.contractNo ? `#${sale.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};
const n0 = (v) => Math.round(num(v)).toLocaleString('en-AU');
const dollars = (v) => `${num(v) < 0 ? '-' : ''}$${Math.abs(Math.round(num(v))).toLocaleString('en-AU')}`;
const tonnes = (v) => `${(Math.round(num(v) * 10) / 10).toLocaleString('en-AU')} t`;

/**
 * The snapshot as a PDF (bytes).
 * @param {object} snap eofySnapshot()
 * @param {{businessName?: string, commodities?: object[]}} [opts]
 */
export function eofyPdf(snap, { businessName = '', commodities = [] } = {}) {
  const pdf = new Pdf();
  const W = pdf.width - M * 2;
  const LIMIT = pdf.height - 56;
  let y = 40;
  const ensure = (h) => { if (y + h > LIMIT) { pdf.addPage(); y = M; } };

  pdf.text(M, y, 'End of year snapshot', { size: 18, bold: true });
  pdf.text(M + W, y + 4, `As at ${dmy(snap.asAt)}`, { size: 11, bold: true, align: 'right' });
  y += 26;
  if (businessName) { pdf.text(M, y, businessName, { size: 10, gray: GREY }); y += 16; }
  y += 6;

  /** a heading, then a table: cols [{label, x (right edge offset for numbers), w, align}] */
  const table = (title, note, cols, rows, totals) => {
    ensure(70);
    pdf.text(M, y, title, { size: 12, bold: true });
    y += 17;
    if (note) y = pdf.paragraph(M, y, note, W, { size: 8.5, gray: GREY, lineHeight: 11 }) + 4;
    const widths = cols.map((c) => c.w * W);
    const edges = widths.reduce((a, w, i) => { a.push((a[i] ?? 0) + w); return a; }, [0]);
    const cell = (i, str, opts = {}) => {
      const left = M + edges[i];
      if (cols[i].align === 'right') pdf.text(left + widths[i] - 4, y, String(str), { size: 9, align: 'right', ...opts });
      else pdf.text(left + 3, y, String(str).slice(0, Math.floor(widths[i] / 4.6)), { size: 9, ...opts });
    };
    pdf.rect(M, y - 4, W, 16, { stroke: null, fill: 0.88 });
    cols.forEach((c, i) => cell(i, c.label, { bold: true, size: 8.5 }));
    y += 16;
    if (!rows.length) { pdf.text(M + 3, y, 'None', { size: 9, gray: GREY }); y += 17; }
    for (const r of rows) {
      ensure(18);
      cols.forEach((c, i) => cell(i, r[i]));
      y += 15;
      pdf.line(M, y - 4, M + W, y - 4, { width: 0.4, gray: 0.8 });
    }
    if (totals) {
      ensure(20);
      cols.forEach((c, i) => cell(i, totals[i] ?? '', { bold: true }));
      y += 18;
    }
    y += 10;
  };

  const pos = snap.position;
  table('Grain position', 'What is sold and what is not. The unsold grain is valued at the average price that commodity has been sold at; where nothing is sold yet it is valued at the mark-to-market price.', [
    { label: 'Commodity', w: 0.2 }, { label: 'Produced', w: 0.11, align: 'right' }, { label: 'Sold', w: 0.11, align: 'right' },
    { label: 'Sold value', w: 0.15, align: 'right' }, { label: 'Unsold', w: 0.11, align: 'right' }, { label: '$/t used', w: 0.12, align: 'right' }, { label: 'Unsold value', w: 0.2, align: 'right' },
  ], pos.rows.map((r) => [
    r.commodity.name, tonnes(r.productionTons), tonnes(r.soldTons), dollars(r.soldValue), tonnes(r.unsoldTons),
    r.priceBasis === 'none' ? '-' : `$${n0(r.unsoldPrice)}${r.priceBasis === 'mtm' ? ' MTM' : ''}`, dollars(r.unsoldValue),
  ]), ['Total', '', tonnes(pos.soldTons), dollars(pos.soldValue), tonnes(pos.unsoldTons), '', dollars(pos.unsoldValue)]);
  pdf.text(M + W - 4, y - 4, `Sold plus unsold: ${dollars(pos.total)}`, { size: 10, bold: true, align: 'right' });
  y += 14;

  table('Sold, not yet delivered', 'Tonnes still owed on contracts, at each contract price.', [
    { label: 'Contract', w: 0.52 }, { label: 'Tonnes owed', w: 0.16, align: 'right' }, { label: '$/t', w: 0.12, align: 'right' }, { label: 'Value', w: 0.2, align: 'right' },
  ], snap.notDelivered.rows.map((r) => [contractText(r.sale, commodities), tonnes(r.tons), `$${n0(r.price)}`, dollars(r.value)]),
  ['Total', tonnes(snap.notDelivered.tons), '', dollars(snap.notDelivered.value)]);

  table('Delivered, not yet invoiced', 'Loads that have gone to the buyer and are on no invoice, before GST.', [
    { label: 'Contract', w: 0.46 }, { label: 'Tonnes', w: 0.14, align: 'right' }, { label: 'Oldest load', w: 0.18, align: 'right' }, { label: 'Value', w: 0.22, align: 'right' },
  ], snap.notInvoiced.rows.map((r) => [contractText(r.sale, commodities), tonnes(r.tons), r.oldest ? dmy(r.oldest) : '', dollars(r.value)]),
  ['Total', tonnes(snap.notInvoiced.tons), '', dollars(snap.notInvoiced.value)]);

  table('Invoiced, not yet paid', 'What buyers owed on this day, GST included.', [
    { label: 'Contract', w: 0.46 }, { label: 'Invoice', w: 0.12, align: 'right' }, { label: 'Due', w: 0.2, align: 'right' }, { label: 'Amount', w: 0.22, align: 'right' },
  ], snap.unpaid.rows.map((r) => [r.sale ? contractText(r.sale, commodities) : 'Invoice', r.invoice.invoiceNo ? `#${r.invoice.invoiceNo}` : '', r.dueDate ? dmy(r.dueDate) : '', dollars(r.amount)]),
  ['Total', `${snap.unpaid.count}`, '', dollars(snap.unpaid.total)]);

  pdf.text(pdf.width / 2, pdf.height - 28, `Snapshot as at ${dmy(snap.asAt)}, prepared in Grainflow. Contracts, loads and invoices dated after that day are left out.`, { size: 7.5, align: 'center', gray: GREY });
  return pdf.bytes();
}
