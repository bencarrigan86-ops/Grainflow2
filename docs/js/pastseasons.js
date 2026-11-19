// Past seasons from the farm's own records.
//
// A farm that kept records before it used the app has, for each season, a table of paddocks with a crop, an area and a
// yield. This reads that table from a CSV (one row per paddock per season) and plans the seasons it makes, so the
// rotation and yield history reaches back as far as the records do.
//
// Columns (the heading names below, in any order; other columns are ignored):
//   Season, Paddock, Commodity, Ha            required
//   Farm, Variety, Notes                      optional
//   Yield (t/ha) or Tonnes                    the yield, or the tonnes it came to
//   Yield is                                  "Actual" for a yield recorded at harvest, "Estimate" for a forecast
//
// Paddocks are married to the paddocks the farm has now, by name, so a paddock lines up across the years under its
// current name. A name with no match is kept as written (a paddock that has since been sold or renamed). Pure.

import { parseCsv, detectDelimiter, nameKey } from './loadimport.js?v=430';

const ALIASES = {
  season: ['season', 'year', 'crop year'],
  farm: ['farm', 'property'],
  paddock: ['paddock', 'field', 'field name', 'paddock name'],
  commodity: ['commodity', 'crop'],
  variety: ['variety'],
  ha: ['ha', 'area', 'area (ha)', 'hectares'],
  yieldTHa: ['yield (t/ha)', 'yield', 'yield t/ha', 'yield (t/ha)'],
  tons: ['tonnes', 'tons', 'total tonnes', 'total tons'],
  yieldIs: ['yield is', 'yield type', 'yield basis'],
  notes: ['notes', 'comments'],
};

const clean = (v) => String(v ?? '').trim();
const collapse = (v) => clean(v).replace(/\s+/g, ' ');
const numberOrNull = (v) => {
  const t = clean(v).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const round = (n, dp) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };

/**
 * @param {string} text the CSV
 * @returns {{rows: {line: number, season: string, farm: string, paddock: string, commodity: string, variety: string, areaHa: number,
 *            yieldTHa: number, recorded: boolean, notes: string}[], errors: string[]}}
 */
export function parsePastSeasons(text) {
  const table = parseCsv(text, detectDelimiter(text));
  const errors = [];
  if (table.length < 2) return { rows: [], errors: ['The file has no rows.'] };
  const head = table[0].map((h) => clean(h).toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
  const missing = ['season', 'paddock', 'commodity', 'ha'].filter((k) => col[k] < 0);
  if (missing.length) {
    const label = { season: 'Season', paddock: 'Paddock', commodity: 'Commodity', ha: 'Ha' };
    return { rows: [], errors: [`The first row needs these headings: ${missing.map((k) => label[k]).join(', ')}.`] };
  }
  if (col.yieldTHa < 0 && col.tons < 0) return { rows: [], errors: ['The first row needs a Yield (t/ha) or a Tonnes heading.'] };

  const rows = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '');
    const season = collapse(get('season'));
    const paddock = collapse(get('paddock'));
    const commodity = collapse(get('commodity'));
    if (!season && !paddock && !commodity) return;
    if (!season || !paddock || !commodity) { errors.push(`Row ${line}: needs a season, a paddock and a commodity.`); return; }
    if (season.length > 20) { errors.push(`Row ${line}: "${season}" is not a season name.`); return; }
    const ha = numberOrNull(get('ha'));
    if (ha === null || Number.isNaN(ha) || ha < 0) { errors.push(`Row ${line}: ${paddock} needs an area in hectares.`); return; }
    let yieldTHa = numberOrNull(get('yieldTHa'));
    if (yieldTHa === null) {
      const tons = numberOrNull(get('tons'));
      yieldTHa = tons !== null && !Number.isNaN(tons) && ha > 0 ? tons / ha : 0;
    }
    if (Number.isNaN(yieldTHa) || yieldTHa < 0) { errors.push(`Row ${line}: ${paddock} has a yield that is not a number.`); return; }
    const is = clean(get('yieldIs')).toLowerCase();
    rows.push({
      line, season, farm: collapse(get('farm')), paddock, commodity, variety: collapse(get('variety')),
      areaHa: round(ha, 2), yieldTHa: round(yieldTHa, 3),
      recorded: /^(actual|recorded|harvest)/.test(is),
      notes: clean(get('notes')),
    });
  });
  return { rows, errors };
}

/** A name with the case and spacing taken out, for an exact match. */
const exactKey = (s) => collapse(s).toLowerCase();

/**
 * Which of the farm's paddocks a name means: the same name (ignoring case and spacing), else the same name with leading
 * zeros and spaces ignored when that points at exactly one paddock. Anything else is no match: guessing between two is
 * how history ends up under the wrong paddock.
 */
export function matchPaddock(name, paddockNames) {
  const exact = paddockNames.filter((p) => exactKey(p) === exactKey(name));
  if (exact.length === 1) return { name: exact[0], how: 'name' };
  if (exact.length > 1) return null;
  const k = nameKey(name);
  const loose = paddockNames.filter((p) => nameKey(p) === k);
  return loose.length === 1 ? { name: loose[0], how: 'close' } : null;
}

/**
 * Plan the seasons: what each one holds, which already exist (and so are left alone) and which names found a paddock.
 * @param {ReturnType<typeof parsePastSeasons>['rows']} rows
 * @param {{seasons?: string[], paddocks?: string[]}} farm  the seasons the farm has, and the paddock names it has now
 */
export function planPastSeasons(rows, { seasons = [], paddocks = [] } = {}) {
  const have = new Set(seasons.map((s) => exactKey(s)));
  const bySeason = new Map();
  for (const r of rows) {
    const k = exactKey(r.season);
    if (!bySeason.has(k)) bySeason.set(k, { label: r.season, rows: [] });
    bySeason.get(k).rows.push(r);
  }

  const out = [];
  const unmatched = new Map();    // name as written -> the seasons it is in
  for (const s of [...bySeason.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))) {
    // one paddock once: rows that land on the same paddock are added together
    const byName = new Map();
    for (const r of s.rows) {
      const m = paddocks.length ? matchPaddock(r.paddock, paddocks) : null;
      const name = m ? m.name : r.paddock;
      const key = exactKey(name);
      if (!m) { if (!unmatched.has(r.paddock)) unmatched.set(r.paddock, []); unmatched.get(r.paddock).push(s.label); }
      const cur = byName.get(key) || { name, matched: !!m, how: m?.how || '', parts: [] };
      cur.parts.push(r);
      byName.set(key, cur);
    }
    const fields = [...byName.values()].map((p) => {
      const area = p.parts.reduce((a, r) => a + r.areaHa, 0);
      const tons = p.parts.reduce((a, r) => a + r.areaHa * r.yieldTHa, 0);
      // when a paddock's rows disagree about the crop, the crop on the most hectares stands for it
      const byCrop = new Map();
      for (const r of p.parts) byCrop.set(exactKey(r.commodity), { commodity: r.commodity, ha: (byCrop.get(exactKey(r.commodity))?.ha || 0) + r.areaHa, variety: r.variety });
      const main = [...byCrop.values()].sort((a, b) => b.ha - a.ha)[0];
      const first = p.parts.find((r) => exactKey(r.commodity) === exactKey(main.commodity)) || p.parts[0];
      return {
        name: p.name, matched: p.matched, how: p.how, farm: first.farm || p.parts.find((r) => r.farm)?.farm || '',
        commodity: main.commodity, variety: first.variety, areaHa: round(area, 2),
        yieldTHa: area > 0 ? round(tons / area, 3) : 0, recorded: p.parts.every((r) => r.recorded),
        mixed: byCrop.size > 1,
      };
    });
    out.push({
      label: s.label, exists: have.has(exactKey(s.label)), fields,
      ha: round(fields.reduce((a, f) => a + f.areaHa, 0), 1),
      tons: round(fields.reduce((a, f) => a + f.areaHa * f.yieldTHa, 0), 0),
      matched: fields.filter((f) => f.matched).length,
    });
  }
  return { seasons: out, unmatched: [...unmatched].map(([name, years]) => ({ name, seasons: [...new Set(years)] })) };
}

/**
 * The properties a crop starts with: the farm's own crop of the same name (or "Wheat Org" takes Wheat's), else the defaults.
 */
export function commodityProps(name, farmCommodities, defaults = []) {
  const k = exactKey(name);
  const own = farmCommodities.find((c) => exactKey(c.name) === k)
    || farmCommodities.find((c) => k.startsWith(exactKey(c.name)))
    || defaults.find((c) => exactKey(c.name) === k);
  return own ? { angleOfRepose: own.angleOfRepose ?? 0, testWeight: own.testWeight ?? 0, nPerTonne: own.nPerTonne ?? 0 } : { angleOfRepose: 0, testWeight: 0, nPerTonne: 0 };
}

/**
 * The records to store for one planned season: its commodities (the farm's own where the name is the same, so their
 * properties come across) and its paddocks.
 * @param {object} season    one of planPastSeasons().seasons
 * @param {object[]} farmCommodities  the farm's commodities now, for their properties
 * @param {() => string} makeId
 * @param {{name: string, angleOfRepose: number, testWeight: number, nPerTonne: number}[]} [defaults]
 */
export function seasonRecords(season, farmCommodities, makeId, defaults = []) {
  const commodities = [];
  const idOf = new Map();
  const propsFor = (name) => commodityProps(name, farmCommodities, defaults);
  const idFor = (name) => {
    const k = exactKey(name);
    if (!idOf.has(k)) {
      const id = makeId();
      idOf.set(k, id);
      commodities.push({ id, name, ...propsFor(name), mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 });
    }
    return idOf.get(k);
  };
  const fields = season.fields.map((f) => ({
    id: makeId(), name: f.name, areaHa: f.areaHa, commodityId: idFor(f.commodity),
    yieldTHa: f.yieldTHa, yieldMode: f.recorded ? 'recorded' : 'estimate',
    ureaRequiredKgHa: 0, ureaAppliedKgHa: 0, seedVariety: f.variety || '', seedRateKgHa: 0,
    ...(f.farm ? { property: f.farm, __hasProperty: true } : {}),
  }));
  return { commodities, fields };
}
