// Bringing truck loads in from a weighbridge export.
//
// The file this was written against is the freight-movements CSV that a grain
// logistics platform exports: one row per load, with where it was picked up
// (a paddock), where it was delivered (a silo, bunker or shed), the weights at
// each end, the truck and the commodity. It is a long row — sixty-odd columns —
// and almost all of it is not for us.
//
// Everything here is pure: text in, plain objects out. The screen that drives
// it lives in views/importloads.js, and nothing in this file touches the farm.
// That is deliberate. Importing is the one operation in the app that can create
// hundreds of records at once, so the parts that decide what gets created are
// kept where they can be tested against awkward rows without a browser.
//
// Three things make this harder than it looks:
//
//   Names do not match. The export calls a paddock "A07" and the app calls it
//   "A7"; the export has "Kot02" and the app has "Kot 2"; a silo that is
//   "14 Silo (Sunmaster)" in one is "14 Silo (Lancer Seed)" in the other. So
//   matching is forgiving about case, spaces and leading zeros, and anything
//   it cannot match with certainty is put to the person to decide rather than
//   guessed — a load credited to the wrong paddock does not look wrong, it just
//   quietly moves a yield.
//
//   Loads may already be in. Re-importing a file, or one that overlaps the last,
//   must not double a season's tonnage. Each imported load carries the
//   platform's own movement number in its notes, and that is what is checked.
//
//   The two weights disagree. The outload weight is what left the paddock and
//   the delivered weight is what the silo's weighbridge saw. The tonnes
//   imported are always the delivered weight, and the outload weight is the
//   check on it: loads where the two differ, or where there is no outload
//   weight to compare, are held back and shown, not imported on trust.

// --- CSV ---------------------------------------------------------------------

/** RFC-4180: quoted cells, doubled quotes, CRLF or LF, a BOM at the front. */
/**
 * Which character separates the columns: a comma, a semicolon (what a spreadsheet
 * in many locales saves) or a tab. Judged on the first line outside quotes.
 */
export function detectDelimiter(text) {
  const first = String(text ?? '').replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] || '';
  let quoted = false;
  const count = { ',': 0, ';': 0, '\t': 0 };
  for (const c of first) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in count) count[c] += 1;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(text, delimiter = ',') {
  const src = String(text ?? '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

// --- names -------------------------------------------------------------------

/**
 * A key two spellings of the same place share: lower case, no spaces, and no
 * leading zeros inside a run of digits.
 *
 *   "A07"      -> "a7"        "A7"          -> "a7"
 *   "Kot02"    -> "kot2"      "Kot 2"       -> "kot2"
 *   "SR01-3"   -> "sr1-3"     "SR1-3"       -> "sr1-3"
 *   "06 Silo " -> "6silo"     "06 Silo"     -> "6silo"
 *
 * Hyphens and slashes are kept: "SR01-3" is the paddock group SR1-3, and
 * dropping the hyphen would make it "SR13", which is a different paddock.
 */
export function nameKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\d+/g, (d) => String(Number(d)))
    .replace(/\s+/g, '');
}

/** The first word-or-number of a name, for suggesting near misses: "14 Silo (X)" -> "14". */
function leadKey(name) {
  const m = /^\s*([a-z]*\s*\d+[a-z]?|[a-z]+)/i.exec(String(name ?? ''));
  return m ? nameKey(m[1]) : '';
}

/**
 * @param {string} name        as written in the file
 * @param {{id: string, name: string}[]} candidates   what the app already has
 * @returns {{id: string, name: string} | null}  only when exactly one candidate
 *   has the same key; two paddocks that normalise alike are ambiguous, and
 *   guessing between them is the failure this exists to avoid.
 */
export function matchName(name, candidates) {
  const key = nameKey(name);
  if (!key) return null;
  const hits = candidates.filter((c) => nameKey(c.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Silos are known by their number. "14 Silo (Sunmaster)" in the export and
 * "14 Silo (Lancer Seed)" in the app are the same silo with a different note in
 * brackets — what is in the brackets is whatever the grain in it was last
 * called — so a name that starts with a number matches the one silo in the app
 * that starts with the same number.
 *
 * Only when that is unambiguous, and only for names that start with a digit:
 * "A05 Silo" is not silo 5.
 */
export function matchSiloByNumber(name, candidates) {
  const exact = matchName(name, candidates);
  if (exact) return exact;
  const lead = /^\s*(\d+)\b/.exec(String(name ?? ''));
  if (!lead) return null;
  const n = Number(lead[1]);
  const hits = candidates.filter((c) => {
    const m = /^\s*(\d+)\b/.exec(String(c.name ?? ''));
    return m && Number(m[1]) === n;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Near misses worth offering, best first: same leading token, nothing certain. */
export function suggestNames(name, candidates, limit = 3) {
  // "A07 | B03" is one load drawn from two paddocks. The file does not say how
  // much came from each, so each is offered and the person says which gets it.
  if (String(name).includes('|')) {
    const parts = String(name).split('|').map((x) => x.trim()).filter(Boolean);
    return parts.map((part) => matchName(part, candidates)).filter(Boolean).slice(0, limit);
  }
  const lead = leadKey(name);
  if (!lead) return [];
  return candidates.filter((c) => leadKey(c.name) === lead).slice(0, limit);
}

/**
 * "Chickpeas (Desi)" is Chickpeas. A commodity matches when one name's key
 * starts with the other's, so the export can be more specific than the app.
 */
export function matchCommodity(name, commodities) {
  const key = nameKey(name);
  if (!key) return null;
  const exact = commodities.filter((c) => nameKey(c.name) === key);
  if (exact.length === 1) return exact[0];
  const loose = commodities.filter((c) => {
    const ck = nameKey(c.name);
    return ck && (key.startsWith(ck) || ck.startsWith(key));
  });
  return loose.length === 1 ? loose[0] : null;
}

// --- the export --------------------------------------------------------------

// Columns by header, not by letter: a column added to the platform's export
// next year should not quietly shift every figure one place to the right. The
// letters the person gave (J for the paddock, AH for the silo) are the
// "Pickup Storage" and "Delivery Storage" headers, and are checked against them.
const COLUMN = {
  ref: 'Movement No',
  status: 'Status',
  commodity: 'Commodity',
  date: 'Pickup Date',
  time: 'Delivery Time',
  field: 'Pickup Storage',
  silo: 'Delivery Storage',
  rego: 'Pickup Rego',
  grade: 'Pickup Grade',
  season: 'Pickup Season',
  pickupTons: 'Pickup Net Weight',
  deliveryGrade: 'Delivery Grade',
  deliveryTons: 'Delivery Net Weight',
};
const REQUIRED = ['date', 'field', 'silo', 'commodity'];   // the weight is checked per load, and by the column-matching step

/**
 * How a file is read: which header holds which thing, in what order its dates
 * are written, what unit its weights are in, and which statuses mean a load
 * happened. The weighbridge export this was first built for is the default; any
 * other file brings its own, set in the column-matching step (loadmap.js).
 *
 * `columns` maps what the importer needs to the file's own heading. Quality
 * results can be their own columns (moisturePct, proteinPct, testWeightKgHl,
 * screeningsPct, fallingNumber) or, as in the platform's export, name/value pairs.
 */
export const PLATFORM_SETUP = {
  columns: { ...COLUMN },
  dateOrder: 'dmy',
  unit: 't',
  completed: ['Completed', 'Delivered'],
};

// The platform's quality results come as six name/value pairs ("Pickup SP1 name"
// / "Pickup SP1 value" … SP6). Which result sits in which pair depends on the
// commodity — chickpeas put moisture in SP2, wheat in SP1, falling number moves
// between SP5 and SP6 — so each is found by the code in its name, not by position.
// (For wheat and barley that is moisture in R, protein T, test weight V,
// screenings X, falling number AB.)
const SP_CODES = {
  MOGR: 'moisturePct',
  PRGR: 'proteinPct',
  TWT: 'testWeightKgHl',
  SCRN: 'screeningsPct',
  FALL: 'fallingNumber',
};
const SP_SLOTS = [1, 2, 3, 4, 5, 6];

/**
 * "28/10/2026" -> "2026-10-28". Day first, as the export writes it.
 *
 * Also accepts a two-digit year ("28/10/26"), which is what the same file looks
 * like once it has been opened and saved again in a spreadsheet, and an ISO date
 * ("2026-10-28"). Anything else is returned as null, never guessed at — a date
 * read the wrong way round (5/1 as May) would file a load in the wrong month.
 */
export function isoFromDmy(s) { return parseDate(s, 'dmy'); }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date in the order the file writes it — 'dmy' (28/10/2026), 'mdy' (10/28/2026) or
 * 'ymd' (2026/10/28). An ISO date (2026-10-28) is read the same whatever the order,
 * and so is a date with the month in words ("28 Oct 2026", "Oct 28, 2026"). A day
 * and month that are both 12 or under are ambiguous, which is why the order is the
 * person's to say and never guessed. Anything unreadable is null.
 */
export function parseDate(s, order = 'dmy') {
  const text = String(s ?? '').trim();
  let y; let month; let day;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (iso) {
    [, y, month, day] = iso.map(Number);
  } else {
    const words = /^(?:(\d{1,2})[ \-./]([A-Za-z]{3,9})[ \-./,]+(\d{2}|\d{4})|([A-Za-z]{3,9})[ \-./]+(\d{1,2}),?[ \-./]+(\d{2}|\d{4}))$/.exec(text);
    if (words) {
      const name = (words[2] || words[4]).slice(0, 3).toLowerCase();
      month = MONTHS.indexOf(name) + 1;
      day = Number(words[1] || words[5]);
      const yy = words[3] || words[6];
      y = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    } else {
      const m = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/.exec(text);
      if (!m) return null;
      const [a, b, c] = [m[1], m[2], m[3]];
      const year = (v) => (v.length === 2 ? 2000 + Number(v) : Number(v));
      if (order === 'ymd') { y = year(a); month = Number(b); day = Number(c); }
      else if (order === 'mdy') { month = Number(a); day = Number(b); y = year(c); }
      else { day = Number(a); month = Number(b); y = year(c); }
      if (order !== 'ymd' && a.length === 4) return null;
    }
  }
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31) || !(y >= 1900)) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const toNumber = (v) => {
  const n = Number(String(v ?? '').trim());
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Read the export into one plain object per load.
 *
 * Nothing is dropped silently. A row that cannot be used is kept with its
 * reasons in `problems`, so the screen can list it and the person can see that
 * 233 of 235 went in and which two did not.
 *
 * @returns {{loads: object[], missingColumns: string[], rows: number}}
 */
export function readFreightExport(text, setup = PLATFORM_SETUP) {
  const columns = setup.columns || {};
  const label = (k) => columns[k] || k;
  const table = parseCsv(text, detectDelimiter(text));
  if (table.length === 0) return { loads: [], missingColumns: REQUIRED.map(label), rows: 0 };
  const head = table[0].map((h) => h.trim());
  const lower = head.map((h) => h.toLowerCase());
  const indexOf = (name) => (name ? lower.indexOf(String(name).trim().toLowerCase()) : -1);
  const at = Object.fromEntries(Object.keys(columns).map((k) => [k, indexOf(columns[k])]));
  const missingColumns = REQUIRED.filter((k) => !(at[k] >= 0)).map(label);
  if (missingColumns.length) return { loads: [], missingColumns, rows: table.length - 1 };

  const order = setup.dateOrder || 'dmy';
  const factor = setup.unit === 'kg' ? 0.001 : 1;
  const weight = (v) => { const n = toNumber(v); return n === null ? null : Math.round(n * factor * 1000) / 1000; };
  const hasStatus = at.status >= 0;
  const finishedValues = new Set((setup.completed || COMPLETED).map((v) => String(v).trim().toLowerCase()));
  const checks = at.pickupTons >= 0;

  const cell = (r, k) => (at[k] >= 0 ? String(r[at[k]] ?? '').trim() : '');
  const spAt = SP_SLOTS.map((n) => [lower.indexOf(`pickup sp${n} name`), lower.indexOf(`pickup sp${n} value`)]);
  const DIRECT = ['moisturePct', 'proteinPct', 'testWeightKgHl', 'screeningsPct', 'fallingNumber'];
  const qualityOf = (r) => {
    const q = {};
    for (const [nameAt, valueAt] of spAt) {
      if (nameAt < 0 || valueAt < 0) continue;
      const key = SP_CODES[String(r[nameAt] ?? '').trim().toUpperCase()];
      const v = toNumber(r[valueAt]);
      if (key && v !== null) q[key] = v;
    }
    for (const key of DIRECT) {
      if (at[key] >= 0) { const v = toNumber(r[at[key]]); if (v !== null) q[key] = v; }
    }
    return q;
  };

  const loads = table.slice(1).map((r, i) => {
    const pickupTons = weight(cell(r, 'pickupTons'));
    const deliveryTons = weight(cell(r, 'deliveryTons'));
    const date = parseDate(cell(r, 'date'), order);
    const status = cell(r, 'status');
    const load = {
      line: i + 2,                       // as the person would count it in a spreadsheet
      ref: cell(r, 'ref'),
      status,
      finished: hasStatus ? finishedValues.has(status.toLowerCase()) : true,
      commodity: cell(r, 'commodity'),
      date,
      time: cell(r, 'time'),
      field: cell(r, 'field'),
      silo: cell(r, 'silo'),
      rego: cell(r, 'rego'),
      // The grade the load left the paddock as; the delivered grade if that is blank.
      grade: cell(r, 'grade') || cell(r, 'deliveryGrade'),
      season: cell(r, 'season'),
      pickupTons,
      deliveryTons,
      quality: qualityOf(r),
      problems: [],
    };
    if (!date) load.problems.push('no usable date');
    if (!load.field) load.problems.push('no paddock (where it came from)');
    if (!load.silo) load.problems.push('no silo or storage (where it went)');
    if (!load.commodity) load.problems.push('no commodity');
    if (!(deliveryTons > 0)) load.problems.push('no delivered weight');
    load.check = checks ? weightCheck(load) : 'ok';
    return load;
  });

  // A file with no load number: each load is given one worked out from what it
  // says, so importing the same file again recognises the loads it already has.
  // The same date, truck, weight, paddock and silo twice in a file are two loads,
  // told apart by the order they come in.
  const occurrence = new Map();
  for (const load of loads) {
    if (load.ref) continue;
    const key = [load.date, load.time, load.rego, load.deliveryTons, load.field, load.silo].join('|');
    const n = (occurrence.get(key) || 0) + 1;
    occurrence.set(key, n);
    load.ref = 'X' + fingerprint(n > 1 ? `${key}#${n}` : key);
    load.synthetic = true;
  }
  return { loads, missingColumns: [], rows: loads.length };
}

/** A short, steady fingerprint of some text (two 32-bit hashes, in hex). */
export function fingerprint(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0').slice(0, 4);
}

// --- turning loads into movements -------------------------------------------

/** The platform's movement number, as written into a movement's notes. */
export const REF_PREFIX = 'Import';
export const refNote = (load) => [load.synthetic ? '' : `${REF_PREFIX} ${load.ref}`, load.grade].filter(Boolean).join(' · ');
export function refFromNotes(notes) {
  const m = new RegExp(`${REF_PREFIX} (M[0-9A-Z]+)`).exec(String(notes ?? ''));
  return m ? m[1] : null;
}

/** Statuses that mean the load actually happened. Anything else is skipped and counted. */
export const COMPLETED = ['Completed', 'Delivered'];

/** Outload and delivered weights count as equal within this many tonnes (rounding on the scale). */
export const WEIGHT_TOLERANCE = 0.05;

/**
 * Does the weight at the paddock agree with the weight at the silo?
 *
 * The tonnes imported are always the delivered weight. The outload weight is
 * only a check on it — if a truck left a paddock with 22 t on and arrived with
 * 38 t, one of the two is wrong, and nothing about the row says which. Such
 * loads are held back for the person to look at rather than imported on trust.
 *
 *   'ok'         both recorded and equal
 *   'differs'    both recorded and not equal
 *   'unchecked'  no outload weight, so there is nothing to compare against
 */
export function weightCheck(load) {
  if (!(load.deliveryTons > 0)) return 'unchecked';
  if (!(load.pickupTons > 0)) return 'unchecked';
  return Math.abs(load.pickupTons - load.deliveryTons) <= WEIGHT_TOLERANCE ? 'ok' : 'differs';
}

/** Every distinct name in a column, with how many loads and how many tonnes. */
export function distinctNames(loads, key) {
  const by = new Map();
  for (const l of loads) {
    const name = l[key];
    if (!name) continue;
    const cur = by.get(name) || { name, loads: 0, tons: 0 };
    cur.loads += 1;
    cur.tons += l.deliveryTons > 0 ? l.deliveryTons : 0;
    by.set(name, cur);
  }
  return [...by.values()].sort((a, b) => b.tons - a.tons);
}

/**
 * Work out what to do with each name: which existing record it is, or that it
 * needs the person's say-so.
 *
 * @returns {{name, loads, tons, match: {id,name}|null, suggestions: {id,name}[]}[]}
 */
export function planNames(loads, key, candidates, { match = matchName } = {}) {
  return distinctNames(loads, key).map((d) => ({
    ...d,
    match: match(d.name, candidates),
    suggestions: suggestNames(d.name, candidates),
  }));
}

/**
 * A name in the file can stand for different records at different times: the
 * export says "SR Dam" throughout, and the app has SR Dam Sth and SR Dam Nth. A
 * mapping may therefore be a plain id, or { cutoff, before, from } — loads dated
 * before the cutoff go to `before`, loads on or after it go to `from`.
 */
export const targetOf = (mapping, date) => {
  if (mapping && typeof mapping === 'object') return String(date) >= mapping.cutoff ? mapping.from : mapping.before;
  return mapping;
};

/**
 * Where a split would naturally fall: the biggest gap between the days this name
 * has loads. SR Dam Sth was cut on the 6th and Nth on the 10th, and the cutoff
 * lands on the 10th. Null when every load is on one day.
 */
export function suggestCutoff(loads, key, name) {
  const days = [...new Set(loads.filter((l) => l[key] === name && l.date).map((l) => l.date))].sort();
  if (days.length < 2) return null;
  const dayNumber = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;
  let best = { gap: -1, at: days[1] };
  for (let i = 1; i < days.length; i++) {
    const gap = dayNumber(days[i]) - dayNumber(days[i - 1]);
    if (gap > best.gap) best = { gap, at: days[i] };
  }
  return best.at;
}

/**
 * @param {object[]} loads
 * @param {{
 *   fields: Record<string,string|null>,     name in file -> field id, or null to skip
 *   silos: Record<string,string|null>,      name in file -> storage id, or null to skip
 *   commodities: Record<string,string|null> name in file -> commodity id, or null for none
 * }} maps
 * @param {{existing?: object[], include?: Set<string>}} options
 *   `include` lists movement numbers the person has chosen to bring in even
 *   though their weights disagree or cannot be checked.
 * @returns {{
 *   movements: object[],            ready to hand to the app, in the order they should be numbered
 *   held: {load: object, why: string}[],      weight check failed, waiting for a decision
 *   skipped: {load: object, why: string}[],   cannot be imported at all
 *   duplicates: number,                       already in the app
 * }}
 */
export function buildMovements(loads, maps, { existing = [], include = new Set() } = {}) {
  const have = new Set(existing.map((m) => m.sourceRef || refFromNotes(m.notes)).filter(Boolean));
  const skipped = [];
  const held = [];
  const movements = [];
  let duplicates = 0;
  const seen = new Set();

  // Oldest first, so ticket numbers follow the order the loads happened in.
  const ordered = [...loads].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)) || a.line - b.line);

  for (const load of ordered) {
    if (load.problems.length) { skipped.push({ load, why: load.problems.join('; ') }); continue; }
    if (load.finished === false || (load.finished === undefined && !COMPLETED.includes(load.status))) { skipped.push({ load, why: `status is "${load.status || 'blank'}", not completed` }); continue; }
    if (have.has(load.ref) || seen.has(load.ref)) { duplicates += 1; continue; }
    const fieldId = targetOf(maps.fields?.[load.field], load.date);
    const siloId = targetOf(maps.silos?.[load.silo], load.date);
    if (!fieldId) { skipped.push({ load, why: `paddock "${load.field}" was set to be skipped` }); continue; }
    if (!siloId) { skipped.push({ load, why: `storage "${load.silo}" was set to be skipped` }); continue; }

    const check = load.check ?? weightCheck(load);
    if (check !== 'ok' && !include.has(load.ref)) {
      held.push({
        load,
        why: check === 'differs'
          ? `outload ${load.pickupTons} t, delivered ${load.deliveryTons} t`
          : 'no outload weight to check the delivered weight against',
      });
      continue;
    }

    seen.add(load.ref);
    movements.push({
      date: load.date,
      commodityId: maps.commodities?.[load.commodity] || undefined,
      froms: [{ type: 'field', id: fieldId, tons: load.deliveryTons }],
      tos: [{ type: 'silo', id: siloId, tons: load.deliveryTons }],
      truckRego: load.rego || '',
      driver: '',
      tons: load.deliveryTons,
      weightStatus: 'final',
      notes: refNote(load),
      sourceRef: load.ref,
      // What the platform recorded on the truck, so the storage can say what is in it
      // and the outload predictor has something to work from.
      ...(load.grade ? { grade: load.grade } : {}),
      ...(load.quality ?? {}),
    });
  }
  return { movements, held, skipped, duplicates };
}
