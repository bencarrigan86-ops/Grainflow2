// The load report: a plain list of truck loads to send on, one line per load.
//
// Date, time, truck, driver, the contract (or silo) it is going to, the weight, the ticket number and, if wanted,
// where it came from. Pure: it picks the loads and lays out the PDF, and touches nothing else.

import { Pdf, textWidth, wrapText } from './pdf.js?v=453';
import { gradeSorter } from './grades.js?v=453';
import { drawBrandLogo } from './brand.js?v=453';
import { dmy } from './fmt.js?v=453';
import { SPECS, specOf } from './outload.js?v=453';
import { ASPECT, strokesInBox } from './signature.js?v=453';
import { SIGN_WORDS, cleanDriverSignature, signState, signedWhen } from './driversign.js?v=453';

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
    value: String(Number(sp[key].toFixed(dp))),   // the number alone, for a column that already says the unit
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

/** The farm or site a paddock or silo sits on, if it has been said (a contract has none). */
export function endPlace(leg, { fields = [], storages = [] } = {}) {
  if (!leg) return '';
  const src = leg.type === 'field' ? fields.find((f) => f.id === leg.id) : leg.type === 'silo' && leg.id !== '__transit__' ? storages.find((s) => s.id === leg.id) : null;
  return String(src?.property || '').trim();
}
const placesOf = (legs, ctx) => [...new Set((legs || []).map((l) => endPlace(l, ctx)).filter(Boolean))].join(', ');

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/** A filter as a list: the list if there is one, else the single value if there is one, else nothing (so no filter). */
const asList = (many, one) => (Array.isArray(many) ? many : many ? [many] : one ? [one] : []).filter((v) => String(v ?? '').trim() !== '');

/**
 * What the paddock, storage and contract filters leave of a load. A load shared between several ends (a truck filled from four
 * paddocks, a load split across two silos or two contracts) counts, for the ones chosen, only the tonnes that belong to them: the same
 * tonnes the paddock's production and the silo's stock hold. Its gross and tare are the whole truck's, so they are left out of a cut load.
 * A load with no tonnes recorded against its ends cannot be split, so it stays whole.
 * @param {object} m the movement
 * @param {{fieldIds?: string[], storageIds?: string[], storageDir?: string, saleIds?: string[]}} f the filters, as lists
 * @returns {{tons: number, part: boolean}}
 */
export function loadShare(m, { fieldIds = [], storageIds = [], storageDir = '', saleIds = [] } = {}) {
  const whole = Number(m.tons) || 0;
  // the tonnes at the ends chosen on one side of the load, or null when that filter does not cut it
  const at = (legs, type, ids) => {
    const list = (legs || []).filter((l) => l.type === type && !(type === 'silo' && l.id === '__transit__'));
    const mine = list.filter((l) => ids.includes(l.id));
    if (!mine.length || mine.length === list.length || !list.some((l) => Number(l.tons) > 0)) return null;
    return mine.reduce((t, l) => t + (Number(l.tons) || 0), 0);
  };
  const parts = [];
  if (fieldIds.length) parts.push(at(m.froms, 'field', fieldIds));
  if (saleIds.length) parts.push(at(m.tos, 'sale', saleIds));
  if (storageIds.length) {
    const sides = storageDir === 'in' ? [m.tos] : storageDir === 'out' ? [m.froms] : [m.froms, m.tos];
    const found = sides.map((legs) => at(legs, 'silo', storageIds)).filter((v) => v !== null);
    parts.push(found.length ? Math.max(...found) : null);
  }
  const cut = parts.filter((v) => v !== null);
  if (!cut.length) return { tons: whole, part: false };
  const tons = Math.min(...cut);
  return tons < whole - 0.005 ? { tons, part: true } : { tons: whole, part: false };
}

/**
 * The loads for the report, oldest first (date, then time, then ticket). `from` and `to` are inclusive dates. Every other filter takes
 * one value or a list, and a load stays when it matches ANY value in a list (so two trucks give both trucks' loads); the filters
 * together all have to match (a paddock AND a truck). Ignoring capitals for grade, truck and driver.
 *   commodityId(s)  the load's commodity            saleId(s)    loads going to a contract
 *   fieldId(s)      loads that came from a paddock  storageId(s) loads into or out of a silo
 *   storageDir      'in' (loads into storage), 'out' (loads out of storage) or '' for both; with no silo ticked it means any silo
 *   grade(s)  truck(es)  driver(s)  what was written on the load
 */
export function loadReportRows(movements, ctx, opts = {}) {
  const { from = '', to = '' } = opts;
  const commodities = ctx.commodities || [];
  const com = asList(opts.commodityIds, opts.commodityId);
  const sales = asList(opts.saleIds, opts.saleId);
  const flds = asList(opts.fieldIds, opts.fieldId);
  const stos = asList(opts.storageIds, opts.storageId);
  const dir = opts.storageDir === 'in' || opts.storageDir === 'out' ? opts.storageDir : '';   // '' = in or out
  const grd = asList(opts.grades, opts.grade);
  const trk = asList(opts.trucks, opts.truck);
  const drv = asList(opts.drivers, opts.driver);
  const anyOf = (list, test) => !list.length || list.some(test);
  return (movements || [])
    .filter((m) => (!from || (m.date || '') >= from) && (!to || (m.date || '') <= to))
    .filter((m) => anyOf(com, (id) => m.commodityId === id))
    .filter((m) => anyOf(sales, (id) => (m.tos || []).some((t) => t.type === 'sale' && t.id === id)))
    .filter((m) => anyOf(flds, (id) => (m.froms || []).some((l) => l.type === 'field' && l.id === id)))
    .filter((m) => {
      const legs = dir === 'in' ? (m.tos || []) : dir === 'out' ? (m.froms || []) : [...(m.froms || []), ...(m.tos || [])];
      const silos = legs.filter((l) => l.type === 'silo' && l.id !== '__transit__');
      if (!stos.length) return !dir || silos.length > 0;   // a direction on its own: any load into (or out of) any silo
      return stos.some((id) => silos.some((l) => l.id === id));
    })
    .filter((m) => anyOf(grd, (g) => same(m.grade, g)))
    .filter((m) => anyOf(trk, (g) => same(m.truckRego, g)))
    .filter((m) => anyOf(drv, (g) => same(m.driver, g)))
    .map((m) => ({ m, cut: loadShare(m, { fieldIds: flds, storageIds: stos, storageDir: dir, saleIds: sales }) }))
    .map(({ m, cut }) => ({
      id: m.id,
      date: m.date || '',
      time: cleanTime(m.loadTime),
      ticketNo: m.ticketNo ?? '',
      truck: m.truckRego || '',
      company: m.truckCompany || '',
      // the driver's signature, for the ticket: whether it still matches the load, the signature itself, and when
      signed: ({ signed: 'Yes', changed: 'Changed' })[signState(m)] || '',
      signature: cleanDriverSignature(m.driverSignature),
      signedAt: signedWhen(cleanDriverSignature(m.driverSignature)),
      driver: m.driver || '',
      driverPhone: String(m.driverPhone || '').trim(),
      commodity: commodities.find((c) => c.id === m.commodityId)?.name || '',
      goingTo: (m.tos || []).map((t) => endName(t, ctx)).filter(Boolean).join(', '),
      // where the contract delivers to
      // what was typed on the load, else where its contract delivers to
      destination: String(m.destination || '').trim() || [...new Set((m.tos || []).filter((t) => t.type === 'sale').map((t) => siteOf((ctx.sales || []).find((s) => s.id === t.id))).filter(Boolean))].join(', '),
      notes: String(m.notes || '').trim(),
      grade: String(m.grade || '').trim(),
      quality: testedOn(m),
      from: (m.froms || []).map((f) => endName(f, ctx)).filter(Boolean).join(', '),
      // the farm or site it came from (once for several), and where it went, when said
      fromPlace: placesOf(m.froms, ctx),
      goingPlace: placesOf(m.tos, ctx),
      // each place it came from with the tonnes taken from it, for a load drawn from more than one
      fromLegs: (m.froms || []).map((f) => ({ name: endName(f, ctx), place: endPlace(f, ctx), tons: Number(f.tons) || 0 })).filter((l) => l.name),
      tons: cut.tons,                                  // the net load, or the part of it from the paddocks chosen
      part: cut.part,                                  // a load shared with other paddocks, cut down to the chosen ones
      loadTons: Number(m.tons) || 0,                   // the whole load
      gross: cut.part || m.grossWeight === null || m.grossWeight === undefined || m.grossWeight === '' ? null : Number(m.grossWeight),
      tare: cut.part || m.tareWeight === null || m.tareWeight === undefined || m.tareWeight === '' ? null : Number(m.tareWeight),
      final: m.weightStatus === 'final',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || (Number(a.ticketNo) || 0) - (Number(b.ticketNo) || 0));
}

/**
 * What there is to narrow the loads by: the paddocks and silos that loads touched, and the grades, trucks and drivers written on them,
 * each once (capitals ignored), in order. Used to fill the drop-downs, so only things that are on a load are offered.
 */
export function loadFilterChoices(movements, ctx = {}) {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const fieldIds = new Set(); const storageIds = new Set();
  const grades = new Map(); const trucks = new Map(); const drivers = new Map();
  const seen = (map, v) => { const s = String(v ?? '').trim(); if (s && !map.has(s.toLowerCase())) map.set(s.toLowerCase(), s); };
  for (const m of movements || []) {
    for (const l of m.froms || []) if (l.type === 'field') fieldIds.add(l.id);
    for (const l of [...(m.froms || []), ...(m.tos || [])]) if (l.type === 'silo' && l.id !== '__transit__') storageIds.add(l.id);
    seen(grades, m.grade); seen(trucks, m.truckRego); seen(drivers, m.driver);
  }
  const named = (ids, list) => [...ids].map((id) => ({ id, name: list.find((x) => x.id === id)?.name })).filter((x) => x.name).sort(byName);
  const words = (map) => [...map.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  // grades in the order Settings lists them, not A to Z
  const gradeWords = [...grades.values()].sort(gradeSorter(ctx.commodities || []));
  return { fields: named(fieldIds, ctx.fields || []), storages: named(storageIds, ctx.storages || []), grades: gradeWords, trucks: words(trucks), drivers: words(drivers) };
}

/** "Storage Silo 1", "Storage out of Silo 1", "Loads into storage": what the storage filter says; '' when it is not used. */
function storageText(opts, ctx) {
  const dir = opts.storageDir === 'in' || opts.storageDir === 'out' ? opts.storageDir : '';
  const names = asList(opts.storageIds, opts.storageId).map((id) => (ctx.storages || []).find((x) => x.id === id)?.name).filter(Boolean).join(', ');
  if (!names) return dir === 'in' ? 'Loads into storage' : dir === 'out' ? 'Loads out of storage' : '';
  return `Storage ${dir === 'in' ? 'into ' : dir === 'out' ? 'out of ' : ''}${names}`;
}

/** The narrowing in words, for under the heading of the PDF and the line in the sheet: "Paddock North, South · Truck ABC123"; '' when nothing is chosen. */
export function filterText(opts = {}, ctx = {}) {
  const names = (list, find) => list.map((v) => find(v)).filter(Boolean).join(', ');
  const part = (label, text) => (text ? `${label} ${text}` : '');
  return [
    part('Commodity', names(asList(opts.commodityIds, opts.commodityId), (id) => (ctx.commodities || []).find((x) => x.id === id)?.name)),
    part('Contract', names(asList(opts.saleIds, opts.saleId), (id) => { const s = (ctx.sales || []).find((x) => x.id === id); return s ? [s.buyer, s.contractNo ? `#${s.contractNo}` : ''].filter(Boolean).join(' ') || 'Contract' : ''; })),
    part('Paddock', names(asList(opts.fieldIds, opts.fieldId), (id) => (ctx.fields || []).find((x) => x.id === id)?.name)),
    storageText(opts, ctx),
    part('Grade', asList(opts.grades, opts.grade).join(', ')),
    part('Truck', asList(opts.trucks, opts.truck).join(', ')),
    part('Driver', asList(opts.drivers, opts.driver).join(', ')),
  ].filter(Boolean).join(' · ');
}

export function loadReportTotals(rows) {
  const sum = (k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return { loads: rows.length, tons: sum('tons'), gross: sum('gross'), tare: sum('tare') };
}

/**
 * The quick date ranges for the buttons above the date boxes: [{ key, label, from, to }], working from today's date ('YYYY-MM-DD').
 * Weeks run Monday to Sunday. "All dates" has no start or end.
 */
export function datePresets(today) {
  const [y, m, d] = String(today).split('-').map(Number);
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const at = (yy, mm, dd) => new Date(yy, mm, dd);
  const day = at(y, m - 1, d);
  const back = (day.getDay() + 6) % 7;                 // days since Monday
  const monday = at(y, m - 1, d - back);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: iso(at(y, m - 1, d - 1)), to: iso(at(y, m - 1, d - 1)) },
    { key: 'week', label: 'This week', from: iso(monday), to: iso(at(y, m - 1, d - back + 6)) },
    { key: 'lastweek', label: 'Last week', from: iso(at(y, m - 1, d - back - 7)), to: iso(at(y, m - 1, d - back - 1)) },
    { key: 'month', label: 'This month', from: iso(at(y, m - 1, 1)), to: iso(at(y, m, 0)) },
    { key: 'lastmonth', label: 'Last month', from: iso(at(y, m - 2, 1)), to: iso(at(y, m - 1, 0)) },
    { key: 'all', label: 'All dates', from: '', to: '' },
  ];
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

/** The short two-line heads of the quality columns: the name, then its unit. */
const QUALITY_HEAD = {
  proteinPct: ['Protein', '%'], moisturePct: ['Moist.', '%'], screeningsPct: ['Screen.', '%'], testWeightKgHl: ['Test wt', 'kg/hL'],
  fallingNumber: ['Falling', 'no. (s)'], oilPct: ['Oil', '%'], ffaPct: ['FFA', '%'], retentionPct: ['Retent.', '%'],
};

/** Which quality measurements any of the loads has, in the usual order: a column is made for each of these and no others. */
export function qualityKeys(rows) {
  const have = new Set();
  for (const r of rows || []) for (const q of r.quality || []) have.add(q.key);
  return SPECS.map((x) => x.key).filter((k) => have.has(k));
}

/**
 * The columns, left to right, with their widths; the going-to column takes up the slack. Each quality measurement in `quality`
 * (keys from qualityKeys) is a narrow column of its own after the net weight, so a tested load is still one line. When the page
 * would get too crowded for the going-to column, the gross and tare columns are dropped (the net stays), then the destination and from columns are narrowed.
 */
export function reportColumns({ showOrigin = true, showCommodity = true, showDestination = false, showGrossTare = true, showGrade = false, showCompany = false, quality = [] } = {}) {
  const MIN_GOING = 70;
  const build = (withGrossTare) => [
    { key: 'date', head: 'Date', w: 56 },
    { key: 'time', head: 'Time', w: 34 },
    { key: 'ticketNo', head: 'Ticket', w: 50 },
    { key: 'truck', head: 'Truck', w: 58 },
    ...(showCompany ? [{ key: 'company', head: 'Transport company', w: 72 }] : []),
    { key: 'driver', head: 'Driver', w: 66 },
    ...(showCommodity ? [{ key: 'commodity', head: 'Commodity', w: 52 }] : []),
    ...(showGrade ? [{ key: 'grade', head: 'Grade', w: 36 }] : []),
    { key: 'goingTo', head: 'Contract / going to', w: 0 },
    ...(showDestination ? [{ key: 'destination', head: 'Destination', w: 90 }] : []),
    ...(withGrossTare ? [{ key: 'gross', head: 'Gross (t)', w: 48, right: true }, { key: 'tare', head: 'Tare (t)', w: 46, right: true }] : []),
    { key: 'net', head: 'Net (t)', w: 64, right: true },
    ...quality.filter((k) => QUALITY_HEAD[k]).map((k) => ({ key: `q:${k}`, head: QUALITY_HEAD[k][0], head2: QUALITY_HEAD[k][1], w: 34, right: true })),
    ...(showOrigin ? [{ key: 'from', head: 'From', w: 104 }] : []),
  ];
  const slack = (cs) => PAGE.width - 2 * MARGIN - cs.reduce((t, c) => t + c.w, 0);
  let cols = build(showGrossTare);
  if (showGrossTare && slack(cols) < MIN_GOING) cols = build(false);
  if (slack(cols) < MIN_GOING) for (const c of cols) { if (c.key === 'destination') c.w = 70; if (c.key === 'company') c.w = 58; if (c.key === 'from') c.w = 80; }   // still crowded: the two long text columns get narrower
  cols.find((c) => c.key === 'goingTo').w = Math.max(40, slack(cols));
  let x = MARGIN;
  for (const c of cols) { c.x = x; x += c.w; }
  return cols;
}

const FLEX = new Set(['truck', 'company', 'driver', 'commodity', 'grade', 'goingTo', 'destination', 'from']);   // the columns that hold words: their width follows what is in them
const SHRINK = ['goingTo', 'destination', 'from', 'company'];                                                    // the long ones, narrowed first when the page is full

/**
 * Sizes the word columns to what is in them: each is as wide as its widest entry (or its heading), so nothing is cut off, and the
 * page's spare width is shared out in proportion rather than all going to one column. When the page is too full the long columns
 * (going to, destination, from, company) give way first, and only they are cut with "...". The date, time, ticket and weights keep their widths.
 * @param {object[]} cols  from reportColumns
 * @param {object[]} rows  loadReportRows
 * @param {(col: object, row: object) => string} cellOf  what a column writes for a row
 */
export function fitColumns(cols, rows, cellOf) {
  const avail = PAGE.width - 2 * MARGIN;
  const PAD = 10;
  const need = new Map();
  for (const c of cols) {
    if (!FLEX.has(c.key)) continue;
    need.set(c.key, Math.ceil(Math.max(textWidth(c.head, 8.5, true), ...rows.map((r) => textWidth(String(cellOf(c, r) ?? ''), 9, false)))) + PAD);
  }
  const fixed = cols.filter((c) => !FLEX.has(c.key)).reduce((t, c) => t + c.w, 0);
  const wanted = [...need.values()].reduce((t, v) => t + v, 0);
  let widths = new Map(need);
  if (fixed + wanted <= avail) {
    const slack = avail - fixed - wanted;
    for (const [k, v] of need) widths.set(k, v + slack * (v / wanted));
  } else {
    let over = fixed + wanted - avail;
    const room = (k) => Math.max(0, widths.get(k) - 60);
    for (let pass = 0; pass < 4 && over > 0.5; pass += 1) {
      const give = SHRINK.filter((k) => widths.has(k) && room(k) > 0);
      const total = give.reduce((t, k) => t + room(k), 0);
      if (!total) break;
      const cut = Math.min(over, total);
      for (const k of give) widths.set(k, widths.get(k) - cut * (room(k) / total));
      over -= cut;
    }
    if (over > 0.5) {   // still too full: every word column gives up a share
      const all = [...widths.values()].reduce((t, v) => t + v, 0);
      const scale = Math.max(0.5, (all - over) / all);
      for (const [k, v] of widths) widths.set(k, v * scale);
    }
  }
  let x = MARGIN;
  for (const c of cols) {
    if (widths.has(c.key)) c.w = widths.get(c.key);
    c.x = x;
    x += c.w;
  }
  return cols;
}

/** The report as a landscape A4 PDF, as many pages as the loads need. */
export function buildLoadReportPdf(rows, { title = 'Load report', business = '', ngr = '', from = '', to = '', showOrigin = true, showDestination = true, showQuality = true, madeAt = '', filters = '' } = {}) {
  const pdf = new Pdf({ width: PAGE.width, height: PAGE.height });
  const cols = reportColumns({ showOrigin, showCommodity: new Set(rows.map((r) => r.commodity).filter(Boolean)).size > 0, showDestination: showDestination && rows.some((r) => r.destination), showGrossTare: rows.some((r) => r.gross !== null || r.tare !== null), showGrade: rows.some((r) => r.grade), showCompany: rows.some((r) => r.company), quality: showQuality ? qualityKeys(rows) : [] });
  const totals = loadReportTotals(rows);
  const HEAD_H = cols.some((c) => c.head2) ? 26 : 18;
  const ROW = 17; const BOTTOM = PAGE.height - 40;
  const cell = (c, r) => {
    if (c.key === 'date') return dmy(r.date);
    if (c.key === 'net') return r.tons ? `${plain(r.tons)} ${r.final ? 'final' : 'est'}` : '';
    if (c.key === 'gross' || c.key === 'tare') return r[c.key] === null ? '' : plain(r[c.key]);
    if (c.key === 'ticketNo') return r.ticketNo === '' ? '' : `#${r.ticketNo}`;
    if (c.key.startsWith('q:')) return (r.quality || []).find((q) => `q:${q.key}` === c.key)?.value ?? '';
    return r[c.key] || '';
  };
  fitColumns(cols, rows, cell);

  const header = (page) => {
    pdf.text(MARGIN, 30, title.toUpperCase(), { size: 18, bold: true });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - MARGIN, top: 10, maxW: 100, maxH: 40 });   // the farm's logo, if it has one
    pdf.text(rx, 36, `${totals.loads} load${totals.loads === 1 ? '' : 's'}, ${plain(totals.tons)} t`, { size: 11, bold: true, align: 'right' });
    pdf.text(MARGIN, 56, [business, ngr ? `NGR ${ngr}` : '', rangeText(from, to), filters].filter(Boolean).join('   ·   '), { size: 9.5, gray: 0.2 });
    let y = 80;
    pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, HEAD_H, { stroke: null, fill: 0.88 });
    for (const c of cols) {
      const x = c.right ? c.x + c.w - 4 : c.x + 4; const align = c.right ? 'right' : 'left';
      if (c.head2) { pdf.text(x, y + 4, c.head, { size: 7.5, bold: true, align }); pdf.text(x, y + 14, c.head2, { size: 7, gray: 0.35, align }); }
      else pdf.text(x, y + (HEAD_H - 18) / 2 + 5, c.head, { size: 8.5, bold: true, align });
    }
    y += HEAD_H;
    if (page > 1) pdf.text(PAGE.width - MARGIN, 56, `page ${page}`, { size: 8, gray: 0.4, align: 'right' });
    return y;
  };

  let page = 1; let y = header(page); let n = 0;
  for (const r of rows) {
    const rowH = ROW;   // one line per load: what was tested is in the columns
    if (y + rowH > BOTTOM) { pdf.addPage(); page += 1; y = header(page); n = 0; }
    if (n % 2) pdf.rect(MARGIN, y, PAGE.width - 2 * MARGIN, rowH, { stroke: null, fill: 0.96 });
    for (const c of cols) {
      const s = clipText(cell(c, r), c.w - 8, 9, false);
      pdf.text(c.right ? c.x + c.w - 4 : c.x + 4, y + 4.5, s, { size: 9, align: c.right ? 'right' : 'left' });
    }
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
  if (rows.some((r) => r.part)) pdf.text(MARGIN, PAGE.height - 32, 'A load shared with other paddocks, silos or contracts shows only the tonnes that belong to the one chosen.', { size: 7.5, gray: 0.4 });
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
  if (row.company) {
    // three across when there is a trucking company: the company, then the truck and the driver
    const third = (CW - 2 * GAP) / 3;
    card(L, y, third, 56, 'TRANSPORT COMPANY', row.company, { size: 13 });
    card(L + third + GAP, y, third, 56, 'TRUCK', row.truck, { size: 13 });
    card(L + 2 * (third + GAP), y, third, 56, 'DRIVER', row.driver, { size: 13 });
    if (row.driverPhone) pdf.text(L + 2 * (third + GAP) + 12, y + 43, clipText(row.driverPhone, third - 24, 10, true), { size: 10, bold: true, gray: GREEN });
  } else {
    card(L, y, half, 56, 'TRUCK', row.truck);
    card(L + half + GAP, y, half, 56, 'DRIVER', row.driver);
    if (row.driverPhone) pdf.text(L + half + GAP + 12, y + 43, clipText(row.driverPhone, half - 24, 10, true), { size: 10, bold: true, gray: GREEN });
  }
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
        pdf.text(L + 12, ty, clipText(l.place ? `${l.name} · ${l.place}` : l.name, fromW - 24 - textWidth(tons, 11, true) - 8, 11, true), { size: 11, bold: true });
      });
    } else {
      card(L, y, fromW, routeH, 'FROM', row.from);
      // the farm or site, under the name
      if (row.fromPlace) pdf.text(L + 12, y + 50, clipText(row.fromPlace, fromW - 24, 11, true), { size: 11, bold: true, gray: GREEN });
    }
    const ay = y + routeH / 2;
    pdf.line(L + fromW + 6, ay, L + fromW + 26, ay, { width: 2, gray: GREEN });
    pdf.polyline([[L + fromW + 20, ay - 6], [L + fromW + 27, ay], [L + fromW + 20, ay + 6]], { width: 2, gray: GREEN });
  }
  pdf.rect(toX, y, toW, routeH, { stroke: null, fill: CARD });
  pdf.text(toX + 12, y + 10, 'GOING TO', { size: 7.5, bold: true, gray: DIM });
  pdf.text(toX + 12, y + 26, clipText(row.goingTo || '-', toW - 24, 15, true), { size: 15, bold: true });
  if (!(showDestination && row.destination) && row.goingPlace) {
    pdf.text(toX + 12, y + 50, clipText(row.goingPlace, toW - 24, 11, true), { size: 11, bold: true, gray: GREEN });
  }
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
    const boxH = row.signature ? Math.max(60, Math.min(168, 794 - 86 - y - 4)) : 168;   // a signature below it needs room
    pdf.rect(L, y, CW, boxH, { stroke: 0.7, fill: null, lineWidth: 0.8 });
    for (let ly = y + 36; ly < y + boxH - 6; ly += 26) pdf.line(L + 10, ly, R - 10, ly, { width: 0.4, gray: 0.8 });
    if (row.notes) {
      let ny = y + 22;
      for (const line of wrapText(row.notes, CW - 24, 11).slice(0, 5)) { pdf.text(L + 12, ny, line, { size: 11 }); ny += 26; }
    }
    y += boxH + 10;
  }

  // the driver's signature, last before the foot
  if (row.signature) {
    const bh = 80; const sy = Math.min(y, 794 - bh);
    pdf.rect(L, sy, CW, bh, { stroke: null, fill: CARD });
    pdf.text(L + 12, sy + 10, 'DRIVER SIGNED', { size: 7.5, bold: true, gray: DIM });
    const sw = 150;
    for (const s of strokesInBox(row.signature.strokes, L + 12, sy + 22, sw, sw / ASPECT)) {
      if (s.length === 1) s.push([s[0][0] + 0.2, s[0][1]]);
      pdf.polyline(s, { width: 1.3, gray: 0.1 });
    }
    const tx = L + 12 + sw + 22;
    pdf.text(tx, sy + 24, clipText(row.signature.name || row.driver || '-', R - tx - 12, 13, true), { size: 13, bold: true });
    pdf.text(tx, sy + 42, row.signedAt, { size: 10 });
    pdf.text(tx, sy + 58, SIGN_WORDS, { size: 8, gray: 0.4 });
    if (row.signed === 'Changed') pdf.text(tx, sy + 70, 'The load was changed after it was signed', { size: 8, bold: true });
  }

  // foot
  pdf.line(L, 800, R, 800, { width: 0.5, gray: 0.8 });
  pdf.text(L, 809, `Made in Commodity Mate${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  return pdf.bytes();
}
