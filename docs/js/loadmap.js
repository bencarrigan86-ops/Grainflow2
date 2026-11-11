// Matching a truck-loads file's own columns to what the importer needs.
//
// The importer was first written for one weighbridge platform's export. Anyone
// else's file calls the same things by other names — "Load Date", "Paddock",
// "Net kg" — so the person says, once, which heading is which. That choice is
// remembered, and asked about again only when the file stops fitting it: a
// heading it relied on has gone, or a needed one was never matched.
//
// Pure: it decides and returns. Reading and writing the remembered choices is
// done through a `store` with getItem/setItem (localStorage in the app, a plain
// object in the tests).

import { PLATFORM_SETUP, parseCsv, detectDelimiter } from './loadimport.js';

/**
 * What the importer can use from a file. `key` is the name the importer reads by;
 * `synonyms` are headings other systems tend to use, compared with spacing,
 * case and punctuation ignored.
 */
export const FIELD_SPECS = [
  { key: 'date', label: 'Date of the load', required: true,
    synonyms: ['date', 'loaddate', 'pickupdate', 'deliverydate', 'movementdate', 'ticketdate', 'dateout', 'harvestdate', 'cartdate'] },
  { key: 'field', label: 'Paddock (where it came from)', required: true,
    synonyms: ['paddock', 'field', 'fieldname', 'paddockname', 'pickupstorage', 'from', 'source', 'origin', 'pickuplocation', 'fromlocation', 'block'] },
  { key: 'silo', label: 'Silo or storage (where it went)', required: true,
    synonyms: ['silo', 'storage', 'siloname', 'deliverystorage', 'to', 'destination', 'deliverylocation', 'tolocation', 'bin', 'delivertostorage'] },
  { key: 'commodity', label: 'Commodity', required: true,
    synonyms: ['commodity', 'crop', 'grain', 'product', 'commodityname', 'cropname'] },
  { key: 'deliveryTons', label: 'Weight delivered', required: true,
    synonyms: ['deliverednetweight', 'netweight', 'net', 'netwt', 'nett', 'netkg', 'nettonnes', 'nettons', 'tonnes', 'tonne', 'tons', 'ton', 'weight', 'wt', 'deliveredweight', 'deliverytonnes', 'qty', 'quantity', 'inweight', 'weightt', 'weightkg'] },
  { key: 'ref', label: 'Load number (a unique id)', required: false,
    synonyms: ['movementno', 'movementnumber', 'ticketno', 'ticketnumber', 'ticket', 'loadno', 'loadnumber', 'docket', 'docketno', 'docketnumber', 'reference', 'ref', 'id', 'consignment', 'consignmentno'] },
  { key: 'pickupTons', label: 'Weight out of the paddock (for the weight check)', required: false,
    synonyms: ['pickupnetweight', 'outweight', 'outloadweight', 'weightout', 'grossweight', 'pickupweight', 'fieldweight', 'outnet'] },
  { key: 'rego', label: 'Truck', required: false,
    synonyms: ['rego', 'truck', 'registration', 'truckrego', 'pickuprego', 'vehicle', 'plate', 'trucknumber'] },
  { key: 'grade', label: 'Grade', required: false,
    synonyms: ['grade', 'pickupgrade', 'deliverygrade', 'class', 'quality', 'gradename'] },
  { key: 'status', label: 'Status (to leave out loads that are not finished)', required: false,
    synonyms: ['status', 'state', 'loadstatus', 'ticketstatus'] },
  { key: 'time', label: 'Time (to put loads in order)', required: false,
    synonyms: ['time', 'deliverytime', 'pickuptime', 'timeout', 'timein'] },
  { key: 'moisturePct', label: 'Moisture (%)', required: false, synonyms: ['moisture', 'moisturepct', 'moist', 'mc', 'mogr'] },
  { key: 'proteinPct', label: 'Protein (%)', required: false, synonyms: ['protein', 'proteinpct', 'prot', 'prgr'] },
  { key: 'testWeightKgHl', label: 'Test weight (kg/hL)', required: false, synonyms: ['testweight', 'tw', 'twt', 'bushelweight', 'hlw'] },
  { key: 'screeningsPct', label: 'Screenings (%)', required: false, synonyms: ['screenings', 'screeningspct', 'scrn', 'screen'] },
  { key: 'fallingNumber', label: 'Falling number (seconds)', required: false, synonyms: ['fallingnumber', 'fn', 'fall', 'hagberg'] },
];
export const REQUIRED_KEYS = FIELD_SPECS.filter((f) => f.required).map((f) => f.key);

/** A heading with case, spacing and punctuation ignored: "Net Weight (kg)" -> "netweightkg". */
export const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** What a heading says about its unit: "Net kg" and "Weight (kg)" are kilograms. */
export const looksLikeKilograms = (header) => /(^|[^a-z])kgs?($|[^a-z])|kilo/i.test(String(header ?? ''));

/**
 * Best guess at which heading is which, from the names alone. A heading is used
 * for one thing only; the exact matches are settled first, so a loose match
 * never takes a heading a better match wanted.
 *
 * @returns {Object<string,string>} key -> heading, for the keys it found
 */
export function guessColumns(headers) {
  const norm = headers.map(normHeader);
  const taken = new Set();
  const found = {};
  const claim = (key, index) => { found[key] = headers[index]; taken.add(index); };

  // exact synonym, in the order the synonyms are listed (the likelier first)
  for (const spec of FIELD_SPECS) {
    for (const syn of spec.synonyms) {
      const i = norm.findIndex((n, idx) => n === syn && !taken.has(idx));
      if (i >= 0) { claim(spec.key, i); break; }
    }
  }
  // then a heading that contains one of the longer synonyms ("Delivered Net Weight (t)")
  for (const spec of FIELD_SPECS) {
    if (found[spec.key]) continue;
    for (const syn of spec.synonyms.filter((x) => x.length >= 5)) {
      const i = norm.findIndex((n, idx) => n.includes(syn) && !taken.has(idx));
      if (i >= 0) { claim(spec.key, i); break; }
    }
  }
  return found;
}

/** The same set of headings in any order, in any case, hashes to the same signature. */
export function signature(headers) {
  const text = headers.map(normHeader).filter(Boolean).sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${headers.length}-${h.toString(16)}`;
}

const hasHeader = (headers, name) => {
  const want = String(name ?? '').trim().toLowerCase();
  return !!want && headers.some((h) => String(h).trim().toLowerCase() === want);
};

/** What is wrong with a setup for this file; empty when it can be used. */
export function setupProblems(setup, headers) {
  const problems = [];
  const columns = setup?.columns || {};
  for (const spec of FIELD_SPECS) {
    const header = columns[spec.key];
    if (!header) {
      if (spec.required) problems.push(`${spec.label} has not been matched to a column`);
    } else if (!hasHeader(headers, header)) {
      problems.push(`The column "${header}" (${spec.label}) is not in this file`);
    }
  }
  return problems;
}

/** The platform's own export, recognised by its headings. */
export const platformFits = (headers) => [...REQUIRED_KEYS, 'ref'].every((k) => hasHeader(headers, PLATFORM_SETUP.columns[k]));

const KEY = 'grainflow.loadImportSetups';

/** Remembered setups: one per set of headings, and the one used last. */
export function recallSetups(store) {
  try { return JSON.parse(store.getItem(KEY) || '{}'); } catch { return {}; }
}
export function rememberSetup(store, headers, setup) {
  const all = recallSetups(store);
  all.bySignature = { ...(all.bySignature || {}), [signature(headers)]: setup };
  all.last = setup;
  try { store.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: it just asks again */ }
}

/**
 * Which setup to read this file with, and whether the person has to confirm it.
 *
 * The person is asked only when there is nothing that fits: the first time a
 * file with these headings is seen, or when a remembered setup relied on a
 * heading that has gone. Otherwise the file just opens.
 *
 * @returns {{setup: object, source: 'saved'|'last'|'platform'|'guess', confirm: boolean, problems: string[]}}
 */
export function chooseSetup(headers, saved = {}) {
  const bySig = saved.bySignature?.[signature(headers)];
  if (bySig && setupProblems(bySig, headers).length === 0) return { setup: bySig, source: 'saved', confirm: false, problems: [] };
  if (saved.last && setupProblems(saved.last, headers).length === 0) return { setup: saved.last, source: 'last', confirm: false, problems: [] };
  if (platformFits(headers)) return { setup: PLATFORM_SETUP, source: 'platform', confirm: false, problems: [] };

  // Nothing fits: start from the nearest thing and ask. A remembered setup that has
  // partly broken keeps what still works, so a renamed column is one fix, not all of them.
  const guessed = guessColumns(headers);
  const base = bySig || saved.last;
  const columns = { ...guessed };
  if (base) {
    for (const [k, h] of Object.entries(base.columns || {})) if (hasHeader(headers, h)) columns[k] = h;
  }
  const kg = columns.deliveryTons && looksLikeKilograms(columns.deliveryTons);
  const setup = {
    columns,
    dateOrder: base?.dateOrder || 'dmy',
    unit: base?.unit || (kg ? 'kg' : 't'),
    completed: base?.completed || PLATFORM_SETUP.completed,
  };
  return { setup, source: 'guess', confirm: true, problems: base ? setupProblems(base, headers) : [] };
}

/** The headings of a file, and the first few rows, for the matching screen. */
export function peekFile(text) {
  const table = parseCsv(text, detectDelimiter(text));
  return { headers: (table[0] || []).map((h) => h.trim()), rows: table.slice(1) };
}

/** Distinct values of one column, most frequent first — the statuses to choose from. */
export function distinctOf(rows, headers, header, limit = 12) {
  const at = headers.findIndex((h) => h.trim().toLowerCase() === String(header ?? '').trim().toLowerCase());
  if (at < 0) return [];
  const counts = new Map();
  for (const r of rows) {
    const v = String(r[at] ?? '').trim();
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, n]) => ({ value, n }));
}

/** Statuses that most likely mean the load happened, offered as the starting choice. */
export const likelyFinished = (value) => /^(complete|completed|delivered|done|finished|final|closed|received|accepted)$/i.test(String(value).trim());
