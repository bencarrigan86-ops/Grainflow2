// The load report: a plain list of truck loads to send on, one line per load.
//
// Date, time, truck, driver, the contract (or silo) it is going to, the weight, the ticket number and, if wanted,
// where it came from. Pure: it picks the loads and lays out the PDF, and touches nothing else.

import { Pdf, textWidth, wrapText } from './pdf.js?v=397';
import { drawBrandLogo } from './brand.js?v=397';
import { dmy } from './fmt.js?v=397';
import { SPECS, specOf } from './outload.js?v=397';

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

/** Where a contract delivers to: its delivery site, else its pricing point, else the buyer who is receiving it. */
export function siteOf(sale) {
  if (!sale) return '';
  return String(sale.location || sale.pricingPoint || sale.buyer || '').trim();
}

/** What was tested on a load, as label and text pairs (protein 11.8%, test weight 79.5 kg/hL...); nothing for what was not recorded. */
export function testedOn(m) {
  const sp = specOf(m);
  return SPECS.filter(({ key }) => sp[key] !== null).map(({ key, label, unit, dp }) => ({
    key,
    label: key === 'fallingNumber' ? 'Falling no.' : label,
    text: `${Number(sp[key].toFixed(dp))}${unit === '%' ? '%' : ` ${unit}`}`,
  }));
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
      // what was typed on the load, else where its contract delivers to
      destination: String(m.destination || '').trim() || [...new Set((m.tos || []).filter((t) => t.type === 'sale').map((t) => siteOf((ctx.sales || []).find((s) => s.id === t.id))).filter(Boolean))].join(', '),
      notes: String(m.notes || '').trim(),
      grade: String(m.grade || '').trim(),
      quality: testedOn(m),
      from: (m.froms || []).map((f) => endName(f, ctx)).filter(Boolean).join(', '),
      // each place it came from with the tonnes taken from it, for a load drawn from more than one
      fromLegs: (m.froms || []).map((f) => ({ name: endName(f, ctx), tons: Number(f.tons) || 0 })).filter((l) => l.name),
      tons: Number(m.tons) || 0,                       // the net load
      gross: m.grossWeight === null || m.grossWeight === undefined || m.grossWeight === '' ? null : Number(m.grossWeight),
      tare: m.tareWeight === null || m.tareWeight === undefined || m.tareWeight === '' ? null : Number(m.tareWeight),
      final: m.weightStatus === 'final',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (Number(a.ticketNo) || 0) - (Number(b.ticketNo) || 0));
}

export function loadReportTotals(rows) {
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return { loads: rows.length, tons: sum('tons'), gross: sum('gross'), tare: sum('tare') };
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
export function reportColumns({ showOrigin = true, showCommodity = true, showDestination = false, showGrossTare = true, showGrade = false } = {}) {
  const cols = [
    { key: 'date', head: 'Date', w: 56 },
    { key: 'time', head: 'Time', w: 34 },
    { key: 'ticketNo', head: 'Ticket', w: 40 },
    { key: 'truck', head: 'Truck', w: 58 },
    { key: 'driver', head: 'Driver', w: 66 },
    ...(showCommodity ? [{ key: 'commodity', head: 'Commodity', w: 52 }] : []),
    ...(showGrade ? [{ key: 'grade', head: 'Grade', w: 36 }] : []),
    { key: 'goingTo', head: 'Contract / going to', w: 0 },
    ...(showDestination ? [{ key: 'destination', head: 'Destination', w: 90 }] : []),
    ...(showGrossTare ? [{ key: 'gross', head: 'Gross (t)', w: 48, right: true }, { key: 'tare', head: 'Tare (t)', w: 46, right: true }] : []),
    { key: 'net', head: 'Net (t)', w: 64, right: true },
    ...(showOrigin ? [{ key: 'from', head: 'From', w: 104 }] : []),
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === 'goingTo').w = PAGE.width - 2 * MARGIN - fixed;
  let x = MARGIN;
  for (const c of cols) { c.x = x; x += c.w; }
  return cols;
}

/** The report as a landscape A4 PDF, as many pages as the loads need. */
export function buildLoadReportPdf(rows, { title = 'Load report', business = '', ngr = '', from = '', to = '', showOrigin = true, showDestination = true, showQuality = true, madeAt = '' } = {}) {
  const pdf = new Pdf({ width: PAGE.width, height: PAGE.height });
  const cols = reportColumns({ showOrigin, showCommodity: new Set(rows.map((r) => r.commodity).filter(Boolean)).size > 0, showDestination: showDestination && rows.some((r) => r.destination), showGrossTare: rows.some((r) => r.gross !== null || r.tare !== null), showGrade: rows.some((r) => r.grade) });
  const totals = loadReportTotals(rows);
  const ROW = 17; const BOTTOM = PAGE.height - 40;
  const cell = (c, r) => {
    if (c.key === 'date') return dmy(r.date);
    if (c.key === 'net') return r.tons ? `${plain(r.tons)} ${r.final ? 'final' : 'est'}` : '';
    if (c.key === 'gross' || c.key === 'tare') return r[c.key] === null ? '' : plain(r[c.key]);
    if (c.key === 'ticketNo') return r.ticketNo === '' ? '' : `#${r.ticketNo}`;
    return r[c.key] || '';
  };

  const header = (page) => {
    pdf.text(MARGIN, 30, title.toUpperCase(), { size: 18, bold: true });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - MARGIN, top: 10, maxW: 100, maxH: 40 });   // the farm's logo, if it has one
    pdf.text(rx, 36, `${totals.loads} load${totals.loads === 1 ? '' : 's'}, ${plain(totals.tons)} t`, { size: 11, bold: true, align: 'right' });
    pdf.text(MARGIN, 56, [business, ngr ? `NGR ${ngr}` : '', rangeText(from, to)].filter(Boolean).join('   ·   '), { size: 9.5, gray: 0.2 });
    let y = 80;
    pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, 18, { stroke: null, fill: 0.88 });
    for (const c of cols) pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 5, c.head, { size: 8.5, bold: true, align: c.right ? 'right' : 'left' });
    y += 18;
    if (page > 1) pdf.text(PAGE.width - MARGIN, 56, `page ${page}`, { size: 8, gray: 0.4, align: 'right' });
    return y;
  };

  let page = 1; let y = header(page); let n = 0;
  for (const r of rows) {
    // a load that was tested has its results on a line of their own under it
    const qline = showQuality && r.quality?.length ? clipText(`Tested:  ${r.quality.map((q) => `${q.label} ${q.text}`).join('   ·   ')}`, PAGE.width - 2 * MARGIN - 8, 7.5) : '';
    const rowH = qline ? ROW + 10 : ROW;
    if (y + rowH > BOTTOM) { pdf.addPage(); page += 1; y = header(page); n = 0; }
    if (n % 2) pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, rowH, { stroke: null, fill: 0.96 });
    for (const c of cols) {
      const s = clipText(cell(c, r), c.w - 8, 9, false);
      pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 4.5, s, { size: 9, align: c.right ? 'right' : 'left' });
    }
    if (qline) pdf.text(MARGIN + 4, y + ROW - 3, qline, { size: 7.5, gray: 0.4 });
    y += rowH; n += 1;
  }
  if (!rows.length) pdf.text(MARGIN + 4, y + 5, 'No loads match.', { size: 10, gray: 0.4 });
  else {
    pdf.line(MARGIN, y + 1, PAGE.width - MARGIN, y + 1, { width: 0.8 });
    pdf.text(cols.find((c) => c.key === 'goingTo').x + 4, y + 6, 'Total', { size: 9.5, bold: true });
    for (const [key, value] of [['gross', totals.gross], ['tare', totals.tare], ['net', totals.tons]]) {
      const wc = cols.find((c) => c.key === key);
      if (wc && value) pdf.text(wc.x + wc.w - 4, y + 6, plain(value), { size: 9.5, bold: true, align: 'right' });
    }
  }
  pdf.text(MARGIN, PAGE.height - 22, `Made in Commodity Mate${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}

/**
 * One load on a page of its own, to send with the truck or to a buyer. A coloured heading with the ticket number, the
 * details in cards, where it came from and where it is going, the weights (the net picked out), and a ruled box for
 * comments. Portrait A4.
 */
export function buildLoadTicketPdf(row, { business = '', ngr = '', showOrigin = true, showDestination = true, showComments = true, showQuality = true, showSplit = true, madeAt = '' } = {}) {
  const pdf = new Pdf();
  const W = 595.28; const L = 40; const R = W - 40; const CW = R - L;
  const GREEN = [0.18, 0.49, 0.196];   // the app's green, #2e7d32
  const WHITE = 1; const CARD = 0.955; const DIM = 0.42;

  // heading band
  pdf.rect(0, 0, W, 96, { stroke: null, fill: GREEN });
  const rx = drawBrandLogo(pdf, { right: R, top: 14, maxW: 80, maxH: 64, tile: true });   // the farm's logo, if it has one
  pdf.text(L, 30, 'LOAD TICKET', { size: 22, bold: true, gray: WHITE });
  // the trading name and the grower's NGR
  if (business) pdf.text(L, 58, clipText(business, Math.min(CW * 0.6, rx - L - 120), 12, true), { size: 12, bold: true, gray: 0.95 });
  if (ngr) pdf.text(L, 75, `NGR ${ngr}`, { size: 9.5, gray: 0.85 });
  if (row.ticketNo !== '') {
    pdf.text(rx, 24, 'TICKET', { size: 8, bold: true, gray: 0.85, align: 'right' });
    pdf.text(rx, 36, `#${row.ticketNo}`, { size: 28, bold: true, gray: WHITE, align: 'right' });
  }

  // a labelled card: the label small and grey, the value large
  const card = (x, y, w, h, label, value, { size = 15, fill = CARD, ink = 0, labelInk = DIM } = {}) => {
    pdf.rect(x, y, w, h, { stroke: null, fill });
    pdf.text(x + 12, y + 10, label, { size: 7.5, bold: true, gray: labelInk });
    pdf.text(x + 12, y + 26, clipText(value || '-', w - 24, size, true), { size, bold: true, gray: ink });
  };
  const GAP = 12;
  let y = 116;

  // when, and what, with its grade
  const quarter = (CW - 3 * GAP) / 4;
  card(L, y, quarter, 56, 'DATE', row.date ? dmy(row.date) : '', { size: 14 });
  card(L + quarter + GAP, y, quarter, 56, 'TIME', row.time, { size: 14 });
  card(L + 2 * (quarter + GAP), y, quarter, 56, 'COMMODITY', row.commodity, { size: 14 });
  card(L + 3 * (quarter + GAP), y, quarter, 56, 'GRADE', row.grade, { size: 14 });
  y += 56 + GAP;

  // who
  const half = (CW - GAP) / 2;
  card(L, y, half, 56, 'TRUCK', row.truck);
  card(L + half + GAP, y, half, 56, 'DRIVER', row.driver);
  y += 56 + GAP + 6;

  // where: from, an arrow, then the contract and the destination
  const fromW = showOrigin ? (CW - 34) * 0.42 : 0;
  const toX = showOrigin ? L + fromW + 34 : L;
  const toW = R - toX;
  // a load from more than one place can list the tonnes taken from each, one to a line
  const legs = showOrigin && showSplit && (row.fromLegs || []).length > 1 ? row.fromLegs : [];
  const routeH = Math.max(78, legs.length ? 36 + legs.length * 16 + 8 : 0);
  if (showOrigin) {
    if (legs.length) {
      pdf.rect(L, y, fromW, routeH, { stroke: null, fill: CARD });
      pdf.text(L + 12, y + 10, 'FROM', { size: 7.5, bold: true, gray: DIM });
      legs.forEach((l, i) => {
        const ty = y + 26 + i * 16;
        const tons = `${plain(l.tons)} t`;
        pdf.text(L + fromW - 12, ty, tons, { size: 11, bold: true, align: 'right' });
        pdf.text(L + 12, ty, clipText(l.name, fromW - 24 - textWidth(tons, 11, true) - 8, 11, true), { size: 11, bold: true });
      });
    } else card(L, y, fromW, routeH, 'FROM', row.from);
    const ay = y + routeH / 2;
    pdf.line(L + fromW + 6, ay, L + fromW + 26, ay, { width: 2, gray: GREEN });
    pdf.polyline([[L + fromW + 20, ay - 6], [L + fromW + 27, ay], [L + fromW + 20, ay + 6]], { width: 2, gray: GREEN });
  }
  pdf.rect(toX, y, toW, routeH, { stroke: null, fill: CARD });
  pdf.text(toX + 12, y + 10, 'GOING TO', { size: 7.5, bold: true, gray: DIM });
  pdf.text(toX + 12, y + 26, clipText(row.goingTo || '-', toW - 24, 15, true), { size: 15, bold: true });
  if (showDestination && row.destination) {
    pdf.text(toX + 12, y + 50, 'DESTINATION', { size: 7.5, bold: true, gray: DIM });
    pdf.text(toX + 12, y + 61, clipText(row.destination, toW - 24, 11, true), { size: 11, bold: true, gray: GREEN });
  }
  y += routeH + GAP + 6;

  // weights: gross, tare and the net picked out
  const w3 = (CW - 2 * GAP) / 3;
  const weight = (v) => (v === null || v === undefined ? '' : `${plain(v)} t`);
  card(L, y, w3, 70, 'GROSS', weight(row.gross), { size: 20 });
  card(L + w3 + GAP, y, w3, 70, 'TARE', weight(row.tare), { size: 20 });
  card(L + 2 * (w3 + GAP), y, w3, 70, 'NET', row.tons ? weight(row.tons) : '', { size: 20, fill: GREEN, ink: WHITE, labelInk: 0.85 });
  if (row.tons) pdf.text(L + 2 * (w3 + GAP) + 12, y + 54, row.final ? 'final weight' : 'estimate', { size: 8, gray: 0.9 });
  y += 70 + GAP + 10;

  // what was tested on the load, when anything was
  if (showQuality && row.quality?.length) {
    const n = row.quality.length; const per = Math.min(4, n); const rowsQ = Math.ceil(n / per);
    const qh = 22 + rowsQ * 34;
    pdf.rect(L, y, CW, qh, { stroke: null, fill: CARD });
    pdf.text(L + 12, y + 10, 'QUALITY TESTED ON THIS LOAD', { size: 7.5, bold: true, gray: DIM });
    const cw = (CW - 24) / per;
    row.quality.forEach((q, i) => {
      const qx = L + 12 + (i % per) * cw; const qy = y + 24 + Math.floor(i / per) * 34;
      pdf.text(qx, qy, q.label.toUpperCase(), { size: 7, bold: true, gray: DIM });
      pdf.text(qx, qy + 10, clipText(q.text, cw - 8, 13, true), { size: 13, bold: true });
    });
    y += qh + GAP + 10;
  }

  // comments: what was noted on the load, with ruled lines to write more
  if (showComments) {
    pdf.text(L, y, 'COMMENTS', { size: 7.5, bold: true, gray: DIM });
    y += 14;
    const boxH = 168;
    pdf.rect(L, y, CW, boxH, { stroke: 0.7, fill: null, lineWidth: 0.8 });
    for (let ly = y + 36; ly < y + boxH - 6; ly += 26) pdf.line(L + 10, ly, R - 10, ly, { width: 0.4, gray: 0.8 });
    if (row.notes) {
      let ny = y + 22;
      for (const line of wrapText(row.notes, CW - 24, 11).slice(0, 5)) { pdf.text(L + 12, ny, line, { size: 11 }); ny += 26; }
    }
  }

  // foot
  pdf.line(L, 800, R, 800, { width: 0.5, gray: 0.8 });
  pdf.text(L, 809, `Made in Commodity Mate${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}
