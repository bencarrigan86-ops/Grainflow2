// The traceability report: for each load, the paddocks its grain came from and how many tonnes from each.
//
// The paddock-by-paddock replay is trace.js (the same one the movements CSV column uses); this picks the loads, adds them up
// across the whole list ("which paddocks made up this contract") and lays out the PDF. Pure.

import { Pdf, wrapText } from './pdf.js?v=511';
import { drawBrandLogo } from './brand.js?v=511';
import { dmy } from './fmt.js?v=511';
import { traceDetailed, traceParts } from './trace.js?v=511';
import { endName, rangeText, clipText } from './loadreport.js?v=511';

const plain = (n, d = 2) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '');
const round = (v, dp = 2) => { const f = 10 ** dp; return Math.round(v * f) / f; };

/**
 * The loads to trace, oldest first, each with the paddocks (and stores) its grain came from.
 * `scope` is 'contracts' (loads going to a buyer: the usual question), 'all' (every load), or a contract id.
 * `from` and `to` are inclusive dates, blank for no limit; `commodityId` narrows to one commodity.
 * Every movement of the season is replayed, not just the ones picked, because what leaves a silo depends on what went in before.
 */
export function traceReportRows(data, { from = '', to = '', commodityId = '', scope = 'contracts' } = {}) {
  const { fields = [], storages = [], sales = [], commodities = [], movements = [] } = data;
  const { loads: traced, legs: tracedLegs } = traceDetailed(storages, movements);
  const ctx = { fields, storages, sales };
  const toBuyer = (m) => (m.tos || []).some((t) => t.type === 'sale');
  return movements
    .filter((m) => (!from || (m.date || '') >= from) && (!to || (m.date || '') <= to))
    .filter((m) => !commodityId || m.commodityId === commodityId)
    .filter((m) => (scope === 'all' ? true : scope === 'contracts' ? toBuyer(m) : (m.tos || []).some((t) => t.type === 'sale' && t.id === scope)))
    .map((m) => ({
      id: m.id,
      date: m.date || '',
      ticketNo: m.ticketNo ?? '',
      commodity: commodities.find((c) => c.id === m.commodityId)?.name || '',
      // the buyer when it went to one, not the stores it was also logged through
      goingTo: (toBuyer(m) ? (m.tos || []).filter((t) => t.type === 'sale') : (m.tos || [])).map((t) => endName(t, ctx)).filter(Boolean).join(', '),
      truck: m.truckRego || '',
      // a load split across contracts counts, on one contract's report, only what went to that contract
      tons: scope !== 'all' && scope !== 'contracts' && (m.tos || []).filter((t) => t.type === 'sale').length > 1 && (m.tos || []).some((t) => t.type === 'sale' && t.id === scope && Number(t.tons) > 0)
        ? (m.tos || []).filter((t) => t.type === 'sale' && t.id === scope).reduce((x, t) => x + (Number(t.tons) || 0), 0) : Number(m.tons) || 0,
      // the contracts it went to, with the tonnes to each
      sales: (m.tos || []).filter((t) => t.type === 'sale').map((t) => ({ id: t.id, name: endName(t, ctx), commodity: commodities.find((c) => c.id === (sales.find((s) => s.id === t.id)?.commodityId))?.name || '', tons: Number(t.tons) || 0 })),
      parts: traceParts(traced.get(m.id), { fields, storages }),
      // each place the grain was taken from (a silo or a paddock) with what that was made of, for the silo-in-the-chain view
      legs: (tracedLegs.get(m.id) || []).map((l) => {
        const parts = traceParts(l.from, { fields, storages });
        // a paddock is named as everywhere else on this report (farm and paddock)
        return { type: l.type, name: l.type === 'field' && parts[0] ? parts[0].name : endName(l, ctx), tons: Number(l.tons) || 0, parts };
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (Number(a.ticketNo) || 0) - (Number(b.ticketNo) || 0));
}

/** Loads and tonnes on the report. */
export function traceTotals(rows) {
  return { loads: rows.length, tons: rows.reduce((s, r) => s + r.tons, 0) };
}

/** Across all the loads: each source with its tonnes and its share of what was traced, biggest first. */
export function traceSummary(rows) {
  const by = new Map();
  for (const r of rows) for (const p of r.parts) by.set(p.name, (by.get(p.name) || 0) + p.tons);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()]
    .map(([name, tons]) => ({ name, tons: round(tons), share: total > 0 ? tons / total : 0 }))
    .sort((a, b) => b.tons - a.tons);
}

/**
 * The loads grouped by the contract they went to: each contract with its loads, its tonnes and the paddocks added up across it.
 * A load to more than one contract is shared between them by the tonnes to each (its paddocks too); a load to none is under
 * "Not to a contract". Contracts come in the order of their first load.
 */
export function traceBySale(rows) {
  const groups = new Map();
  for (const r of rows) {
    const legs = r.sales.length ? r.sales : [{ id: '__none__', name: 'Not to a contract', commodity: r.commodity, tons: r.tons }];
    const legTotal = legs.reduce((s, l) => s + l.tons, 0);
    for (const l of legs) {
      const share = legs.length === 1 || legTotal <= 0 ? 1 : l.tons / legTotal;
      if (!groups.has(l.id)) groups.set(l.id, { id: l.id, name: l.name, commodity: l.commodity, rows: [] });
      groups.get(l.id).rows.push({ ...r, tons: legs.length === 1 ? r.tons : round(l.tons), goingTo: l.name, parts: r.parts.map((p) => ({ name: p.name, tons: round(p.tons * share) })), legs: r.legs.map((l) => ({ ...l, tons: round(l.tons * share), parts: l.parts.map((p) => ({ name: p.name, tons: round(p.tons * share) })) })) });
    }
  }
  return [...groups.values()].map((g) => ({ ...g, loads: g.rows.length, tons: g.rows.reduce((s, r) => s + r.tons, 0), summary: traceSummary(g.rows) }));
}

/** One load's sources in words: "Boundary 12.5 t; Long Paddock 8 t", or a plain note when nothing is known. */
export function partsText(parts) {
  return parts.length ? parts.map((p) => `${p.name} ${plain(p.tons)} t`).join('; ') : 'Not recorded';
}

/**
 * Where a load came from in words. Plain: "North 30.00 t; Aralu South 10.00 t". With the silo in the chain: each place it was
 * taken from, a silo with what was in it ("Silo 1 40.00 t: North 30.00 t; Aralu South 10.00 t (blend of 2 paddocks)").
 * A silo holding several paddocks is a blend, and says so.
 */
export function sourceText(row, showStore = false) {
  if (!showStore || !row.legs?.length) return partsText(row.parts);
  return row.legs.map((l) => {
    if (l.type !== 'silo') return `${l.name} ${plain(l.tons)} t`;
    const blend = l.parts.length > 1 ? ` (blend of ${l.parts.length})` : '';
    return `${l.name} ${plain(l.tons)} t: ${partsText(l.parts)}${blend}`;
  }).join(' + ');
}

/**
 * The report as a flat table for Excel: one line for each place a load's grain came from (a paddock, or a paddock inside a silo),
 * so it can be sorted, filtered and totalled. By sale the lines are grouped under each contract. Each line has the load's
 * contract, ticket, date, commodity and truck, the silo it came out of (blank for a paddock straight onto the truck), the
 * paddock, the tonnes from it and its share of the load.
 */
export function traceCsvRows(rows, by = 'load') {
  const out = [];
  const lines = by === 'sale' ? traceBySale(rows).flatMap((g) => g.rows.map((r) => ({ ...r, contract: g.name }))) : rows.map((r) => ({ ...r, contract: r.goingTo }));
  for (const r of lines) {
    const base = { contract: r.contract, ticket: r.ticketNo, date: r.date, commodity: r.commodity, truck: r.truck, loadTons: r.tons };
    const legs = r.legs?.length ? r.legs : [{ type: 'field', name: '', tons: r.tons, parts: r.parts }];
    let any = false;
    // the share is of what was traced for the load, so a load's lines add up to 100%
    const traced = legs.reduce((s, l) => s + (l.parts.length ? l.parts.reduce((x, p) => x + p.tons, 0) : l.tons), 0);
    for (const l of legs) {
      const silo = l.type === 'silo' ? l.name : '';
      const parts = l.parts.length ? l.parts : [{ name: 'Not recorded', tons: l.tons }];
      for (const p of parts) { out.push({ ...base, silo, source: p.name, tons: p.tons, share: traced > 0 ? p.tons / traced : 0 }); any = true; }
    }
    if (!any) out.push({ ...base, silo: '', source: 'Not recorded', tons: r.tons, share: 1 });
  }
  return out;
}

/** The columns of that table, for downloadCSV. */
export const TRACE_CSV_COLUMNS = [
  { label: 'Contract / going to', get: (r) => r.contract },
  { label: 'Ticket', get: (r) => r.ticket },
  { label: 'Date', get: (r) => r.date },
  { label: 'Commodity', get: (r) => r.commodity },
  { label: 'Truck', get: (r) => r.truck },
  { label: 'Load (t)', get: (r) => plain(r.loadTons) },
  { label: 'Silo it came out of', get: (r) => r.silo },
  { label: 'Field it came from', get: (r) => r.source },
  { label: 'Tonnes from it', get: (r) => plain(r.tons) },
  { label: 'Share of the load (%)', get: (r) => plain(r.share * 100, 1) },
];

const PAGE = { width: 841.89, height: 595.28 };   // A4 landscape
const MARGIN = 36;

/**
 * The report as a landscape A4 PDF. By load: the paddocks added up across everything, then every load with where it came from.
 * By sale: a block for each contract (its tonnes, the paddocks that made it up, then its loads).
 */
export function buildTraceReportPdf(rows, { title = 'Traceability', business = '', ngr = '', from = '', to = '', scopeLabel = '', madeAt = '', by = 'load', showStore = false } = {}) {
  const pdf = new Pdf({ width: PAGE.width, height: PAGE.height });
  const totals = traceTotals(rows);
  const W = PAGE.width - 2 * MARGIN;
  const BOTTOM = PAGE.height - 48;
  const cols = [
    { key: 'date', head: 'Date', w: 56 }, { key: 'ticketNo', head: 'Ticket', w: 40 }, { key: 'commodity', head: 'Commodity', w: 62 },
    { key: 'goingTo', head: 'Going to', w: 140 }, { key: 'tons', head: 'Net (t)', w: 54, right: true }, { key: 'from', head: showStore ? 'Silo and fields it came from' : 'Fields it came from', w: 0 },
  ];
  cols.find((c) => c.key === 'from').w = W - cols.reduce((s, c) => s + c.w, 0);
  let x = MARGIN; for (const c of cols) { c.x = x; x += c.w; }

  const header = (page) => {
    pdf.text(MARGIN, 30, (by === 'sale' ? title + ' by sale' : title).toUpperCase(), { size: 18, bold: true });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - MARGIN, top: 10, maxW: 100, maxH: 40 });
    pdf.text(rx, 36, `${totals.loads} load${totals.loads === 1 ? '' : 's'}, ${plain(totals.tons)} t`, { size: 11, bold: true, align: 'right' });
    pdf.text(MARGIN, 56, [business, ngr ? `NGR ${ngr}` : '', scopeLabel, rangeText(from, to)].filter(Boolean).join('   ·   '), { size: 9.5, gray: 0.2 });
    if (page > 1) pdf.text(PAGE.width - MARGIN, 56, `page ${page}`, { size: 8, gray: 0.4, align: 'right' });
    return 80;
  };
  const tableHead = (y) => {
    pdf.rect(MARGIN, y, W, 18, { stroke: null, fill: 0.88 });
    for (const c of cols) pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 5, c.head, { size: 8.5, bold: true, align: c.right ? 'right' : 'left' });
    return y + 18;
  };

  let page = 1; let y = header(page);
  const room = (need) => {
    if (y + need <= BOTTOM) return false;
    pdf.addPage(); page += 1; y = header(page);
    return true;
  };
  // paddocks with a bar for their share, up to `max` of them
  const bars = (summary, max) => {
    const barX = MARGIN + 260; const barW = 220;
    for (const s of summary.slice(0, max)) {
      room(14);
      pdf.text(MARGIN + 4, y, clipText(s.name, 250, 9.5), { size: 9.5 });
      pdf.rect(barX, y + 1, barW, 8, { stroke: null, fill: 0.9 });
      pdf.rect(barX, y + 1, Math.max(1, barW * s.share), 8, { stroke: null, fill: 0.45 });
      pdf.text(barX + barW + 8, y, `${plain(s.tons)} t  ·  ${Math.round(s.share * 100)}%`, { size: 9.5 });
      y += 14;
    }
    if (summary.length > max) { room(14); pdf.text(MARGIN + 4, y, `and ${summary.length - max} more sources, in the loads below`, { size: 8.5, gray: 0.4 }); y += 14; }
  };
  // the loads as table rows, with the head repeated when a page turns
  const table = (list) => {
    room(18 + 17); y = tableHead(y);
    let n = 0;
    for (const r of list) {
      const lines = wrapText(sourceText(r, showStore), cols[5].w - 8, 8.5).slice(0, 6);
      const rowH = Math.max(17, 6 + lines.length * 11);
      if (room(rowH)) { y = tableHead(y); n = 0; }
      if (n % 2) pdf.rect(MARGIN, y, W, rowH, { stroke: null, fill: 0.96 });
      const cell = (c) => (c.key === 'date' ? dmy(r.date) : c.key === 'ticketNo' ? (r.ticketNo === '' ? '' : `#${r.ticketNo}`) : c.key === 'tons' ? (r.tons ? plain(r.tons) : '') : r[c.key] || '');
      for (const c of cols.slice(0, 5)) pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 4.5, clipText(cell(c), c.w - 8, 9), { size: 9, align: c.right ? 'right' : 'left' });
      lines.forEach((l, i) => pdf.text(cols[5].x + 4, y + 4.5 + i * 11, l, { size: 8.5 }));
      y += rowH; n += 1;
    }
  };

  if (!rows.length) pdf.text(MARGIN + 4, y + 5, 'No loads match.', { size: 10, gray: 0.4 });
  else if (by === 'sale') {
    for (const g of traceBySale(rows)) {
      room(70);
      pdf.rect(MARGIN, y, W, 22, { stroke: null, fill: 0.82 });
      pdf.text(MARGIN + 6, y + 6, clipText([g.commodity, g.name].filter(Boolean).join(' · '), W - 200, 11, true), { size: 11, bold: true });
      pdf.text(PAGE.width - MARGIN - 6, y + 6, `${g.loads} load${g.loads === 1 ? '' : 's'}, ${plain(g.tons)} t`, { size: 10, bold: true, align: 'right' });
      y += 32;
      bars(g.summary, 8);
      y += 6;
      table(g.rows);
      y += 18;
    }
  } else {
    const summary = traceSummary(rows);
    if (summary.length) {
      pdf.text(MARGIN, y + 2, 'ACROSS THESE LOADS', { size: 9, bold: true, gray: 0.35 });
      y += 16;
      bars(summary, 14);
      y += 10;
    }
    table(rows);
    room(24);
    pdf.line(MARGIN, y + 1, PAGE.width - MARGIN, y + 1, { width: 0.8 });
    pdf.text(cols[3].x + 4, y + 6, 'Total', { size: 9.5, bold: true });
    pdf.text(cols[4].x + cols[4].w - 4, y + 6, plain(totals.tons), { size: 9.5, bold: true, align: 'right' });
  }
  pdf.text(MARGIN, PAGE.height - 36, 'Worked out from the loads recorded: what leaves a silo is the grain that went in, in the order it went in. Opening stock has no field.', { size: 7.5, gray: 0.5 });
  pdf.text(MARGIN, PAGE.height - 22, `Made in Commodity Mate${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}
