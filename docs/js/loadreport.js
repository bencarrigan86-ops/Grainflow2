// The load report: a plain list of truck loads to send on, one line per load.
//
// Date, time, truck, driver, the contract (or silo) it is going to, the weight, the ticket number and, if wanted,
// where it came from. Pure: it picks the loads and lays out the PDF, and touches nothing else.

import { Pdf, textWidth } from './pdf.js?v=257';
import { dmy } from './fmt.js?v=257';

const plain = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '');

/** "14:30" or '' for anything that is not a time of day. */
export function cleanTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  if (!m) return '';
  const h = Number(m[1]); const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : '';
}

/** The time of day now, as the load sheet fills it in for a new load. */
export function nowTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What a paddock, silo or contract is called on the report. */
export function endName(leg, { fields = [], storages = [], sales = [] } = {}) {
  if (!leg) return '';
  if (leg.type === 'field') return fields.find((f) => f.id === leg.id)?.name || 'Unknown paddock';
  if (leg.type === 'silo') {
    if (leg.id === '__transit__') return 'In transit';
    return storages.find((s) => s.id === leg.id)?.name || 'Unknown silo';
  }
  if (leg.type === 'sale') {
    const s = sales.find((x) => x.id === leg.id);
    if (!s) return 'Unknown contract';
    return [s.buyer, s.contractNo ? `#${s.contractNo}` : ''].filter(Boolean).join(' ') || 'Contract';
  }
  return '';
}

/**
 * The loads for the report, oldest first (date, then time, then ticket). `from` and `to` are inclusive dates,
 * `commodityId` and `saleId` narrow it to one commodity or to the loads going to one contract.
 */
export function loadReportRows(movements, ctx, { from = '', to = '', commodityId = '', saleId = '' } = {}) {
  const commodities = ctx.commodities || [];
  return (movements || [])
    .filter((m) => (!from || (m.date || '') >= from) && (!to || (m.date || '') <= to))
    .filter((m) => !commodityId || m.commodityId === commodityId)
    .filter((m) => !saleId || (m.tos || []).some((t) => t.type === 'sale' && t.id === saleId))
    .map((m) => ({
      id: m.id,
      date: m.date || '',
      time: cleanTime(m.loadTime),
      ticketNo: m.ticketNo ?? '',
      truck: m.truckRego || '',
      driver: m.driver || '',
      commodity: commodities.find((c) => c.id === m.commodityId)?.name || '',
      goingTo: (m.tos || []).map((t) => endName(t, ctx)).filter(Boolean).join(', '),
      // where the contract delivers to
      destination: [...new Set((m.tos || []).filter((t) => t.type === 'sale').map((t) => String((ctx.sales || []).find((s) => s.id === t.id)?.location || '').trim()).filter(Boolean))].join(', '),
      from: (m.froms || []).map((f) => endName(f, ctx)).filter(Boolean).join(', '),
      tons: Number(m.tons) || 0,
      final: m.weightStatus === 'final',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (Number(a.ticketNo) || 0) - (Number(b.ticketNo) || 0));
}

export function loadReportTotals(rows) {
  return { loads: rows.length, tons: rows.reduce((s, r) => s + r.tons, 0) };
}

/** A line of the covered dates: "15-11-2026" or "01-11-2026 to 15-11-2026". */
export function rangeText(from, to) {
  if (from && to) return from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`;
  if (from) return `from ${dmy(from)}`;
  if (to) return `up to ${dmy(to)}`;
  return 'all dates';
}

/** Cuts text to fit a width, ending in "..." when it was cut. */
export function clipText(str, width, size = 9, bold = false) {
  let s = String(str ?? '');
  if (textWidth(s, size, bold) <= width) return s;
  while (s.length > 1 && textWidth(`${s}...`, size, bold) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

const PAGE = { width: 841.89, height: 595.28 };   // A4 landscape
const MARGIN = 36;

/** The columns, left to right, with their widths; the going-to column takes up the slack. */
export function reportColumns({ showOrigin = true, showCommodity = true, showDestination = false } = {}) {
  const cols = [
    { key: 'date', head: 'Date', w: 58 },
    { key: 'time', head: 'Time', w: 38 },
    { key: 'ticketNo', head: 'Ticket', w: 42 },
    { key: 'truck', head: 'Truck', w: 66 },
    { key: 'driver', head: 'Driver', w: 80 },
    ...(showCommodity ? [{ key: 'commodity', head: 'Commodity', w: 62 }] : []),
    { key: 'goingTo', head: 'Contract / going to', w: 0 },
    ...(showDestination ? [{ key: 'destination', head: 'Destination', w: 100 }] : []),
    { key: 'weight', head: 'Est. weight (t)', w: 78, right: true },
    ...(showOrigin ? [{ key: 'from', head: 'From', w: 120 }] : []),
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === 'goingTo').w = PAGE.width - 2 * MARGIN - fixed;
  let x = MARGIN;
  for (const c of cols) { c.x = x; x += c.w; }
  return cols;
}

/** The report as a landscape A4 PDF, as many pages as the loads need. */
export function buildLoadReportPdf(rows, { title = 'Load report', business = '', from = '', to = '', showOrigin = true, showDestination = true, madeAt = '' } = {}) {
  const pdf = new Pdf({ width: PAGE.width, height: PAGE.height });
  const cols = reportColumns({ showOrigin, showCommodity: new Set(rows.map((r) => r.commodity).filter(Boolean)).size > 0, showDestination: showDestination && rows.some((r) => r.destination) });
  const totals = loadReportTotals(rows);
  const ROW = 17; const BOTTOM = PAGE.height - 40;
  const cell = (c, r) => {
    if (c.key === 'date') return dmy(r.date);
    if (c.key === 'weight') return r.tons ? `${plain(r.tons)}${r.final ? ' final' : ''}` : '';
    if (c.key === 'ticketNo') return r.ticketNo === '' ? '' : `#${r.ticketNo}`;
    return r[c.key] || '';
  };

  const header = (page) => {
    pdf.text(MARGIN, 30, title.toUpperCase(), { size: 18, bold: true });
    pdf.text(PAGE.width - MARGIN, 36, `${totals.loads} load${totals.loads === 1 ? '' : 's'}, ${plain(totals.tons)} t`, { size: 11, bold: true, align: 'right' });
    pdf.text(MARGIN, 56, [business, rangeText(from, to)].filter(Boolean).join('   ·   '), { size: 9.5, gray: 0.2 });
    let y = 80;
    pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, 18, { stroke: null, fill: 0.88 });
    for (const c of cols) pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 5, c.head, { size: 8.5, bold: true, align: c.right ? 'right' : 'left' });
    y += 18;
    if (page > 1) pdf.text(PAGE.width - MARGIN, 56, `page ${page}`, { size: 8, gray: 0.4, align: 'right' });
    return y;
  };

  let page = 1; let y = header(page); let n = 0;
  for (const r of rows) {
    if (y + ROW > BOTTOM) { pdf.addPage(); page += 1; y = header(page); n = 0; }
    if (n % 2) pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, ROW, { stroke: null, fill: 0.96 });
    for (const c of cols) {
      const s = clipText(cell(c, r), c.w - 8, 9, false);
      pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 4.5, s, { size: 9, align: c.right ? 'right' : 'left' });
    }
    y += ROW; n += 1;
  }
  if (!rows.length) pdf.text(MARGIN + 4, y + 5, 'No loads match.', { size: 10, gray: 0.4 });
  else {
    pdf.line(MARGIN, y + 1, PAGE.width - MARGIN, y + 1, { width: 0.8 });
    const wc = cols.find((c) => c.key === 'weight');
    pdf.text(cols.find((c) => c.key === 'goingTo').x + 4, y + 6, 'Total', { size: 9.5, bold: true });
    pdf.text(wc.x + wc.w - 4, y + 6, plain(totals.tons), { size: 9.5, bold: true, align: 'right' });
  }
  pdf.text(MARGIN, PAGE.height - 22, `Made in Grainflow${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}

/**
 * One load on a page of its own, to send with the truck or to a buyer: the same details as a line of the report,
 * laid out as a slip. Portrait A4.
 */
export function buildLoadTicketPdf(row, { business = '', showOrigin = true, showDestination = true, madeAt = '' } = {}) {
  const pdf = new Pdf();
  const W = 595.28; const L = 48; const R = W - 48;
  pdf.text(L, 48, 'LOAD TICKET', { size: 20, bold: true });
  if (row.ticketNo !== '') pdf.text(R, 52, `Ticket #${row.ticketNo}`, { size: 14, bold: true, align: 'right' });
  if (business) pdf.text(L, 76, business, { size: 10.5, gray: 0.2 });
  pdf.line(L, 94, R, 94, { width: 1 });
  const lines = [
    ['Date', row.date ? dmy(row.date) : ''],
    ['Time', row.time],
    ['Truck', row.truck],
    ['Driver', row.driver],
    ['Commodity', row.commodity],
    ['Contract / going to', row.goingTo],
    ...(showDestination && row.destination ? [['Destination', row.destination]] : []),
    ['Est. weight', row.tons ? `${plain(row.tons)} t${row.final ? ' (final)' : ''}` : ''],
    ...(showOrigin ? [['From', row.from]] : []),
  ];
  let y = 112; let n = 0;
  for (const [label, value] of lines) {
    if (n % 2 === 0) pdf.rect(L - 8, y - 6, R - L + 16, 34, { stroke: null, fill: 0.95 });
    pdf.text(L, y + 2, label, { size: 9, gray: 0.35 });
    pdf.text(L + 170, y, clipText(value || '-', R - L - 170, 14, true), { size: 14, bold: true });
    y += 34; n += 1;
  }
  pdf.text(L, 806, `Made in Grainflow${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}
