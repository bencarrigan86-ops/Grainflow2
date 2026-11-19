// A receiving site's delivery file, matched back to the loads that went there.
//
// A truck delivering to a third-party site (GrainCorp or similar) quotes an outload number (outloadno.js). The site keeps it on its
// ticket, and its delivery file comes back with the weighed weight and the quality for each truck. This reads that file, matches each
// row to a load by the number, checks the match against the truck, date and commodity, and works out what to change on the load.
//
// Every site lays its file out differently, so the person says which column is which. That layout is saved by the farm (the
// owner saves it) and recognised the next time by the column headings. The reading and the rules are here, pure; the screen that
// drives them is views/importdeliveries.js. Nothing here touches the farm.

import { parseCsv, detectDelimiter, parseDate } from './loadimport.js?v=437';
import { normHeader, looksLikeKilograms } from './loadmap.js?v=437';
import { normaliseOutloadNo } from './outloadno.js?v=437';
import { appendNote } from './carryover.js?v=437';

/** What a delivery file can give us. `synonyms` are headings sites tend to use (spacing, case and punctuation ignored). */
export const DELIVERY_FIELDS = [
  { key: 'outloadNo', label: 'Ticket number (the number the driver quoted)', kind: 'text', required: true,
    synonyms: ['paddock', 'outloadno', 'outloadnumber', 'outload', 'loadno', 'loadnumber', 'ourref', 'ourreference', 'growerref', 'growerreference', 'reference', 'ref', 'consignment'] },
  { key: 'netTons', label: 'Net weight', kind: 'weight',
    synonyms: ['nettonnesmt', 'nettonnes', 'netweight', 'net', 'netwt', 'nett', 'netkg', 'netmt', 'nettons', 'tonnes', 'tons', 'weight'] },
  { key: 'grossTons', label: 'Gross weight', kind: 'weight', synonyms: ['grossweight', 'gross', 'grosskg', 'grosstonnes', 'grosswt', 'grossmt'] },
  { key: 'tareTons', label: 'Tare weight', kind: 'weight', synonyms: ['tareweight', 'tare', 'tarekg', 'taretonnes', 'tarewt', 'taremt'] },
  { key: 'date', label: 'Date received', kind: 'date',
    synonyms: ['receiveddate', 'datereceived', 'receivedate', 'deliverydate', 'date', 'ticketdate', 'weighdate'] },
  { key: 'grade', label: 'Grade', kind: 'text', synonyms: ['grade', 'receivedgrade', 'gradename', 'class'] },
  { key: 'commodity', label: 'Commodity (to check it is the right grain)', kind: 'text', synonyms: ['commodity', 'crop', 'grain', 'product'] },
  { key: 'rego', label: 'Truck rego (to check it is the right truck)', kind: 'text', synonyms: ['truckrego', 'rego', 'registration', 'truck', 'vehicle'] },
  { key: 'theirTicket', label: 'Delivery number', kind: 'text', synonyms: ['ticket', 'ticketno', 'ticketnumber', 'weighbridgeticket', 'deliveryticket', 'docketno'] },
  { key: 'status', label: 'Status (to leave out rejected loads)', kind: 'text', synonyms: ['status', 'ticketstatus', 'state'] },
  { key: 'moisturePct', label: 'Moisture (%)', kind: 'pct', synonyms: ['moisture', 'moisturepct', 'mogr', 'moist', 'mc'] },
  { key: 'proteinPct', label: 'Protein (%)', kind: 'pct', synonyms: ['protein', 'proteinpct', 'prgr', 'prot'] },
  { key: 'screeningsPct', label: 'Screenings (%)', kind: 'pct', synonyms: ['screenings', 'screeningspct', 'scrnimpu', 'scrn', 'screen', 'impurities'] },
  { key: 'testWeightKgHl', label: 'Test weight (kg/hL)', kind: 'pct', synonyms: ['testweight', 'twtkghl', 'twt', 'tw', 'hlw'] },
  { key: 'fallingNumber', label: 'Falling number (seconds)', kind: 'pct', synonyms: ['fallingnumber', 'falls', 'fall', 'fn'] },
  { key: 'oilPct', label: 'Oil (%)', kind: 'pct', synonyms: ['oil', 'oilpct', 'coil'] },
  { key: 'ffaPct', label: 'Free fatty acid (%)', kind: 'pct', synonyms: ['ffa', 'freefattyacid', 'ffapct'] },
  { key: 'retentionPct', label: 'Retention (%)', kind: 'pct', synonyms: ['ret', 'retention', 'retentionpct'] },
];

/** The quality readings, and the name each is saved under on a load. */
export const QUALITY_KEYS = ['moisturePct', 'proteinPct', 'screeningsPct', 'testWeightKgHl', 'fallingNumber', 'oilPct', 'ffaPct', 'retentionPct'];

const round3 = (n) => Math.round(n * 1000) / 1000;
const DAY = 86400000;

// --- reading the file ----------------------------------------------------------

/**
 * @param {string} text
 * @param {{headerRow?: number}} [opts]  which row (counting from 0) holds the headings, for a file with lines above the table
 * @returns {{headers: string[], rows: string[][], headerRow: number}}
 */
export function readTable(text, { headerRow = 0 } = {}) {
  const grid = parseCsv(text, detectDelimiter(text));
  const at = Math.min(Math.max(0, Number(headerRow) || 0), Math.max(0, grid.length - 1));
  return { headers: (grid[at] || []).map((h) => String(h ?? '').trim()), rows: grid.slice(at + 1), headerRow: at };
}

/** Best guess at which heading is which, from the names alone. A heading is used for one thing only. @returns {Object<string,string>} key -> heading */
export function guessMapping(headers) {
  const norm = headers.map(normHeader);
  const taken = new Set();
  const found = {};
  for (const f of DELIVERY_FIELDS) {
    for (const syn of f.synonyms) {
      const i = norm.findIndex((n, idx) => n === syn && !taken.has(idx));
      if (i >= 0) { found[f.key] = headers[i]; taken.add(i); break; }
    }
  }
  for (const f of DELIVERY_FIELDS) {
    if (found[f.key]) continue;
    for (const syn of f.synonyms.filter((x) => x.length >= 6)) {
      const i = norm.findIndex((n, idx) => n.includes(syn) && !taken.has(idx));
      if (i >= 0) { found[f.key] = headers[i]; taken.add(i); break; }
    }
  }
  return found;
}

/** What is still needed before a file can be read: the outload number, and a net weight (or gross and tare to work it out from). */
export function mappingProblems(mapping, headers) {
  const has = (k) => !!mapping?.[k] && headers.includes(mapping[k]);
  const out = [];
  if (!has('outloadNo')) out.push('Say which column holds the ticket number.');
  if (!has('netTons') && !(has('grossTons') && has('tareTons'))) out.push('Say which column holds the net weight (or the gross and the tare).');
  return out;
}

const cleanNumber = (raw) => {
  const s = String(raw ?? '').trim().replace(/,/g, '').replace(/%$/, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Excel turns a long number into 6.298E+11 and keeps only its first few digits: that is not the number any more. */
export const looksRounded = (s) => /^\d+(\.\d+)?e\+?\d+$/i.test(String(s ?? '').trim());

/**
 * The file's rows as plain objects, in the units and shapes the app uses.
 * @param {{headers: string[], rows: string[][]}} table
 * @param {Object<string,string>} mapping  key -> heading
 * @param {{units?: 'auto'|'t'|'kg', dateOrder?: 'dmy'|'mdy'|'ymd', headerRow?: number}} [opts]
 * @returns {{rows: object[], unit: 't'|'kg', warnings: string[]}}
 */
export function extractRows(table, mapping, { units = 'auto', dateOrder = 'dmy', headerRow = 0 } = {}) {
  const { headers, rows } = table;
  const at = (key) => (mapping?.[key] ? headers.indexOf(mapping[key]) : -1);
  const warnings = [];

  // the unit of the weights: said, or read from the heading, or (as a last resort) from a net weight no truck could be in tonnes
  let unit = units === 'kg' || units === 't' ? units : null;
  if (!unit) {
    const heads = ['netTons', 'grossTons', 'tareTons'].map((k) => mapping?.[k]).filter(Boolean);
    unit = heads.some(looksLikeKilograms) ? 'kg' : 't';
    if (unit === 't') {
      const big = rows.some((r) => (cleanNumber(r[at('netTons')]) ?? 0) > 300);
      if (big) { unit = 'kg'; warnings.push('The weights look like kilograms (some are over 300), so they were divided by 1,000. Check the weights below.'); }
    }
  }
  const tons = (v) => { const n = cleanNumber(v); return n === null ? null : round3(unit === 'kg' ? n / 1000 : n); };

  const out = rows.map((r, i) => {
    const get = (k) => (at(k) >= 0 ? String(r[at(k)] ?? '').trim() : '');
    const problems = [];
    let net = tons(get('netTons'));
    const gross = tons(get('grossTons'));
    const tare = tons(get('tareTons'));
    if (net === null && gross !== null && tare !== null) net = round3(gross - tare);
    const rawTicket = get('theirTicket');
    const rounded = looksRounded(rawTicket);
    if (rounded) problems.push('Delivery number has been rounded off (it reads like 6.298E+11), so it was not used.');
    const status = get('status');
    const quality = {};
    for (const key of QUALITY_KEYS) { const v = cleanNumber(get(key)); if (v !== null) quality[key] = v; }
    const dateText = get('date');
    return {
      n: headerRow + 2 + i,                       // the row number as a spreadsheet shows it
      outloadText: get('outloadNo'),
      outloadNo: normaliseOutloadNo(get('outloadNo')),
      date: dateText ? parseDate(dateText, dateOrder) : null,
      net, gross, tare,
      grade: get('grade'),
      commodity: get('commodity'),
      rego: get('rego'),
      theirTicket: rounded ? '' : rawTicket,
      status,
      quality,
      rejected: /block|reject|cancel|void/i.test(status) || (net !== null && net <= 0),
      problems,
    };
  }).filter((r) => r.outloadText || r.net !== null || r.rego);   // a row with nothing in it is not a delivery
  return { rows: out, unit, warnings };
}

// --- saved layouts -------------------------------------------------------------

/** A layout as it is saved: the name it was given, which heading is which, and how to read the units, dates and header row. */
export function makeFormat({ name, mapping, units = 'auto', dateOrder = 'dmy', headerRow = 0 }) {
  const clean = Object.fromEntries(Object.entries(mapping || {}).filter(([, v]) => v));
  return { name: String(name || 'Delivery file').trim() || 'Delivery file', mapping: clean, units, dateOrder, headerRow: Number(headerRow) || 0 };
}

/** Add a layout, or replace the one with the same name. */
export function saveFormat(formats, format) {
  const list = Array.isArray(formats) ? formats : [];
  const key = (f) => String(f?.name || '').trim().toLowerCase();
  return [...list.filter((f) => key(f) !== key(format)), format];
}

/** Take a layout out by name. */
export const removeFormat = (formats, name) => (Array.isArray(formats) ? formats : []).filter((f) => String(f?.name || '').trim().toLowerCase() !== String(name || '').trim().toLowerCase());

/**
 * The saved layout that fits these headings: nearly all of the headings it relies on are there, and the outload number is one
 * of them. The one that fits best wins.
 */
export function findFormat(formats, headers) {
  let best = null;
  let bestScore = 0;
  for (const f of Array.isArray(formats) ? formats : []) {
    const used = Object.values(f.mapping || {});
    if (!used.length || !f.mapping?.outloadNo || !headers.includes(f.mapping.outloadNo)) continue;
    const score = used.filter((h) => headers.includes(h)).length / used.length;
    if (score >= 0.8 && score > bestScore) { best = f; bestScore = score; }
  }
  return best;
}

// --- matching rows to loads ----------------------------------------------------

const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dayDiff = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / DAY : null);
const oneDigitOff = (a, b) => {
  if (!a || !b || a.length !== b.length || a === b) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false;
  return d === 1;
};

/**
 * Match each row to a load.
 *
 * kind: 'match' (safe to apply), 'same' (the load already says this), 'review' (a match, but something does not fit, or more than one
 * load could be it), 'unmatched' (no load carries the number), 'rejected' (the site refused it; nothing changes).
 *
 * @param {object[]} rows  extractRows().rows
 * @param {object[]} movements  the loads
 * @param {{commodities?: object[], seasonYY?: string, withinDays?: number}} [opts]
 * @returns {{row: object, kind: string, load: object|null, candidates: object[], reasons: string[]}[]}
 */
export function matchDeliveries(rows, movements, { commodities = [], seasonYY: yy = '', withinDays = 7 } = {}) {
  const loads = movements || [];
  // a load is known by its ticket number, and by the outload number it had before the two were one
  const numbersOf = (m) => [...new Set([normaliseOutloadNo(m.ticketNo), normaliseOutloadNo(m.outloadNo)].filter(Boolean))];
  const byNo = new Map();
  for (const m of loads) {
    for (const k of numbersOf(m)) {
      if (!byNo.has(k)) byNo.set(k, []);
      byNo.get(k).push(m);
    }
  }
  const commodityName = (m) => commodities.find((c) => c.id === m.commodityId)?.name || '';
  const claimed = new Map();   // load id -> the row that took it

  // what does not fit between a load and a row
  const concerns = (load, row) => {
    const out = [];
    if (row.rego && load.truckRego && keyOf(row.rego) !== keyOf(load.truckRego)) out.push(`The site has truck ${row.rego}, the load says ${load.truckRego}.`);
    const cn = commodityName(load);
    if (row.commodity && cn && keyOf(row.commodity) !== keyOf(cn) && !keyOf(row.commodity).includes(keyOf(cn)) && !keyOf(cn).includes(keyOf(row.commodity))) out.push(`The site has ${row.commodity}, the load is ${cn}.`);
    const dd = dayDiff(row.date, load.date);
    if (dd !== null && dd > withinDays) out.push(`The site received it ${Math.round(dd)} days from the load's date.`);
    return out;
  };

  // loads that could be a row that has no matching number: the same truck close in date, or a number one digit away
  const suggest = (row) => {
    const out = [];
    for (const m of loads) {
      if (claimed.has(m.id)) continue;
      const nums = numbersOf(m); const k = nums[0] || '';
      const sameTruck = row.rego && m.truckRego && keyOf(row.rego) === keyOf(m.truckRego);
      const dd = dayDiff(row.date, m.date);
      const close = dd !== null && dd <= 3;
      const near = nums.find((x) => oneDigitOff(x, row.outloadNo));
      if (near) out.push({ load: m, why: `Its number ${near} is one digit away from ${row.outloadNo}.`, score: 0 });
      else if (sameTruck && close) out.push({ load: m, why: `Same truck, ${Math.round(dd)} day${Math.round(dd) === 1 ? '' : 's'} apart${k ? ` (its number is ${k})` : ' (it has no ticket number)'}.`, score: 1 + dd });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 5).map((s) => ({ load: s.load, why: s.why }));
  };

  return rows.map((row) => {
    const item = { row, kind: 'unmatched', load: null, candidates: [], reasons: [] };
    if (row.rejected) { item.kind = 'rejected'; item.reasons = [/block|reject|cancel|void/i.test(row.status) ? `The site's status is ${row.status}.` : 'The site recorded no weight for it.']; return item; }
    if (!row.outloadNo) { item.reasons = ['No ticket number on this row.']; item.candidates = suggest(row); return item; }

    const holders = byNo.get(row.outloadNo) || [];
    if (holders.length === 0) {
      item.reasons = [`No load has the ticket number ${row.outloadNo}.`];
      const rowYY = row.outloadNo.slice(0, 2);
      if (yy && rowYY !== yy && row.outloadNo.length >= 6) item.reasons.push(`The number is from season ${rowYY}, and this season is ${yy}: switch season in Settings to import it.`);
      item.candidates = suggest(row);
      return item;
    }

    let pick = null;
    if (holders.length === 1) pick = holders[0];
    else {
      // more than one load has this number: the truck and the date tell them apart, or the person does
      const fits = holders.filter((m) => !claimed.has(m.id) && concerns(m, row).length === 0);
      if (fits.length === 1) pick = fits[0];
      else { item.kind = 'review'; item.reasons = [`${holders.length} loads have the number ${row.outloadNo}.`]; item.candidates = holders.map((m) => ({ load: m, why: '' })); return item; }
    }
    item.load = pick;
    item.reasons = concerns(pick, row);
    if (claimed.has(pick.id)) item.reasons.push(`Another row in this file (row ${claimed.get(pick.id)}) is already for this load.`);
    if (item.reasons.length) { item.kind = 'review'; item.candidates = [{ load: pick, why: '' }]; }
    else if (pick.weightStatus === 'final' && row.net !== null && Math.abs((Number(pick.tons) || 0) - row.net) < 0.005) item.kind = 'same';
    else item.kind = 'match';
    claimed.set(pick.id, row.n);
    return item;
  });
}

// --- what changes on a load ----------------------------------------------------

/**
 * Share a total out over a load's legs in proportion to what each was estimated at. The last leg takes the remainder, so the legs
 * add up to the total exactly. Legs that were all estimated at nothing share it equally.
 */
export function prorateLegs(legs, total) {
  const list = Array.isArray(legs) ? legs : [];
  if (!list.length) return list;
  const want = round3(Number(total) || 0);
  const sum = list.reduce((a, l) => a + (Number(l.tons) || 0), 0);
  let left = want;
  return list.map((l, i) => {
    let t;
    if (i === list.length - 1) t = left;
    else { t = sum > 0 ? round3((want * (Number(l.tons) || 0)) / sum) : round3(want / list.length); left = round3(left - t); }
    return { ...l, tons: t };
  });
}

const t1 = (n) => (Number(n) || 0).toFixed(2).replace(/\.?0+$/, '');

/**
 * The change to make to a load from a delivery row: the site's weight (final, shared out over the legs), the grade and readings it
 * gave, its ticket number, and a note of what we had estimated. Only what the file actually has is touched.
 * @returns {object} what to hand to db.upsertMovement (it carries the load's id)
 */
export function deliveryPatch(load, row, { today = '' } = {}) {
  const patch = { id: load.id, weightStatus: 'final' };
  if (row.net !== null) {
    patch.tons = row.net;
    patch.froms = prorateLegs(load.froms, row.net);
    patch.tos = prorateLegs(load.tos, row.net);
  }
  if (row.gross !== null) patch.grossWeight = row.gross;
  if (row.tare !== null) patch.tareWeight = row.tare;
  if (row.grade) patch.grade = row.grade;
  for (const key of QUALITY_KEYS) if (row.quality?.[key] !== undefined) patch[key] = row.quality[key];
  if (row.theirTicket) patch.externalTicketNo = row.theirTicket;
  const was = Number(load.tons) || 0;
  if (row.net !== null && (load.weightStatus !== 'final' || Math.abs(was - row.net) >= 0.005)) {
    patch.notes = appendNote(load.notes || '', `Site weight ${t1(row.net)} t, we had ${t1(was)} t${load.weightStatus === 'final' ? ' (final)' : ' (estimate)'}${today ? `. From the site's delivery file, ${today}` : ''}.`);
  }
  return patch;
}
