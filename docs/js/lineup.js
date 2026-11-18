// Lining paddock names up across seasons.
//
// Records kept before the app, or kept while paddocks were named differently, put the same ground under different names
// from one season to the next, so the rotation and yield history shows it as separate paddocks. This reads a list of
// "old name, new name" rules from a CSV and works out what each season's paddocks become:
//
//   - one old name to one new name renames the paddock;
//   - one old name to several new names splits it, the area going to each by the share given (or by the area each new
//     paddock has now, when no shares are given);
//   - several old names to one new name joins them, the areas and tonnes adding up and the loads carted from any of them
//     now saying they came from the joined paddock.
//
// A paddock that has loads is never split: which half a load came from is not something to guess. Pure: the save is
// db.applyLineup().
//
// Columns (the heading names below, in any order; other columns are ignored):
//   Old name, New name   required
//   Farm                 optional: the farm the new paddock is on (set on the paddock when given)
//   Share (%)            optional: for a split, the part of the old paddock this new one takes
//   Seasons              optional: "2020-2024" or "2020, 2022" (default: every season except the current one)

import { parseCsv, detectDelimiter } from './loadimport.js?v=393';
import { mergeFieldRecords, repointLoads } from './merge.js?v=393';

const ALIASES = {
  from: ['old name', 'old', 'old paddock', 'from'],
  to: ['new name', 'new', 'new paddock', 'to', 'paddock now'],
  farm: ['farm', 'new farm', 'property'],
  share: ['share (%)', 'share', 'split (%)', 'split'],
  seasons: ['seasons', 'season', 'years'],
};

const clean = (v) => String(v ?? '').trim();
const collapse = (v) => clean(v).replace(/\s+/g, ' ');
export const nameKey = (s) => collapse(s).toLowerCase();
const round = (n, dp) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };

/** @returns {{rules: {line: number, from: string, to: string, farm: string, share: number|null, seasons: string}[], errors: string[]}} */
export function parseLineup(text) {
  const table = parseCsv(text, detectDelimiter(text));
  if (table.length < 2) return { rules: [], errors: ['The file has no rows.'] };
  const head = table[0].map((h) => clean(h).toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
  if (col.from < 0 || col.to < 0) return { rules: [], errors: ['The first row needs the headings Old name and New name.'] };
  const rules = [];
  const errors = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '');
    const from = collapse(get('from'));
    const to = collapse(get('to'));
    if (!from && !to) return;
    if (!from || !to) { errors.push(`Row ${line}: needs both an old name and a new name.`); return; }
    const raw = clean(get('share')).replace('%', '');
    const share = raw === '' ? null : Number(raw);
    if (share !== null && (!Number.isFinite(share) || share <= 0 || share > 100)) { errors.push(`Row ${line}: ${from} has a share that is not between 0 and 100.`); return; }
    rules.push({ line, from, to, farm: collapse(get('farm')), share, seasons: clean(get('seasons')) });
  });
  return { rules, errors };
}

/** The season labels a scope names ("2020-2024", "2020, 2022"), or null for the default. */
export function scopeLabels(text, labels) {
  const t = clean(text);
  if (!t) return null;
  const out = new Set();
  for (const part of t.split(/[;,]/).map(clean).filter(Boolean)) {
    const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(part);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])];
      labels.filter((l) => /^\d{4}$/.test(l) && Number(l) >= lo && Number(l) <= hi).forEach((l) => out.add(l));
    } else {
      labels.filter((l) => nameKey(l) === nameKey(part)).forEach((l) => out.add(l));
    }
  }
  return out;
}

/**
 * The rules, grouped by old name (and scope): what each old paddock becomes.
 * @param {ReturnType<typeof parseLineup>['rules']} rules
 * @param {{name: string, areaHa: number}[]} nowFields  the paddocks the farm has now, for the default split
 * @returns {{groups: object[], errors: string[]}}
 */
export function lineupGroups(rules, nowFields = []) {
  const by = new Map();
  for (const r of rules) {
    const k = `${nameKey(r.from)}|${r.seasons.toLowerCase()}`;
    if (!by.has(k)) by.set(k, { from: r.from, seasons: r.seasons, targets: [] });
    const g = by.get(k);
    if (!g.targets.some((t) => nameKey(t.name) === nameKey(r.to))) g.targets.push({ name: r.to, farm: r.farm, share: r.share });
  }
  const errors = [];
  const areaNow = new Map(nowFields.map((f) => [nameKey(f.name), Number(f.areaHa) || 0]));
  const groups = [...by.values()].map((g) => {
    if (g.targets.length > 1) {
      const given = g.targets.filter((t) => t.share !== null).length;
      if (given && given !== g.targets.length) errors.push(`${g.from}: give a share for every new name it splits into, or for none.`);
      let shares;
      if (given === g.targets.length) {
        const sum = g.targets.reduce((a, t) => a + t.share, 0);
        if (Math.abs(sum - 100) > 0.6) errors.push(`${g.from}: the shares add up to ${round(sum, 1)}%, not 100%.`);
        shares = g.targets.map((t) => t.share / sum);
      } else {
        const areas = g.targets.map((t) => areaNow.get(nameKey(t.name)) || 0);
        const tot = areas.reduce((a, b) => a + b, 0);
        shares = tot > 0 && areas.every((a) => a > 0) ? areas.map((a) => a / tot) : g.targets.map(() => 1 / g.targets.length);
      }
      g.targets.forEach((t, i) => { t.fraction = shares[i]; });
    } else g.targets[0].fraction = 1;
    return g;
  });
  return { groups, errors };
}

/**
 * What one season's paddocks become. Works on copies: nothing passed in is changed.
 * @param {{fields: object[], movements?: object[]}} season
 * @param {object[]} groups  from lineupGroups()
 * @param {() => string} makeId
 * @returns {{fields: object[], movements: object[], renamed: object[], split: object[], joined: object[], skipped: object[],
 *            removed: {dropId: string, keepId: string, agronomyId?: string}[], touched: string[], movementsTouched: string[]}}
 */
export function lineupSeason(season, groups, makeId) {
  const out = { fields: [], movements: season.movements || [], renamed: [], split: [], joined: [], skipped: [], removed: [], touched: [], movementsTouched: [] };
  const byFrom = new Map(groups.map((g) => [nameKey(g.from), g]));
  const loadsOn = (id) => (season.movements || []).some((m) => (m.froms || []).some((l) => l.type === 'field' && l.id === id));
  const changed = new Set();      // ids of paddocks this pass renamed or made

  for (const original of season.fields || []) {
    const f = { ...original };
    const g = byFrom.get(nameKey(f.name));
    if (!g) { out.fields.push(f); continue; }
    const setFarm = (rec, t) => { if (t.farm) { rec.property = t.farm; rec.__hasProperty = true; } };
    if (g.targets.length === 1) {
      const t = g.targets[0];
      if (f.name === t.name && !t.farm) { out.fields.push(f); continue; }
      out.renamed.push({ from: f.name, to: t.name });
      f.name = t.name;
      setFarm(f, t);
      changed.add(f.id);
      out.fields.push(f);
      continue;
    }
    // already split (the other new names are paddocks of this season): running the list twice must not split again
    const others = g.targets.filter((t) => nameKey(t.name) !== nameKey(f.name));
    if (others.some((t) => (season.fields || []).some((x) => nameKey(x.name) === nameKey(t.name)))) { out.fields.push(f); continue; }
    if (loadsOn(f.id)) {
      // which part a load came from is not something to guess, so the paddock stays whole under the first new name
      const first = g.targets[0];
      out.skipped.push({ name: f.name, why: `it has loads, so it is kept whole as ${first.name}` });
      if (f.name !== first.name || first.farm) {
        out.renamed.push({ from: f.name, to: first.name });
        f.name = first.name;
        setFarm(f, first);
        changed.add(f.id);
      }
      out.fields.push(f);
      continue;
    }
    const area = Number(f.areaHa) || 0;
    let left = round(area, 2);
    const parts = g.targets.map((t, i) => {
      const last = i === g.targets.length - 1;
      const ha = last ? round(left, 2) : round(area * t.fraction, 2);
      left = round(left - ha, 2);
      const rec = i === 0 ? { ...f } : { ...f, id: makeId(), boundary: null, __agronomyId: undefined, __hasBoundary: undefined, harvestDone: false };
      rec.name = t.name;
      rec.areaHa = ha;
      setFarm(rec, t);
      changed.add(rec.id);
      return rec;
    });
    out.split.push({ from: f.name, to: g.targets.map((t) => t.name), seasonArea: area });
    out.fields.push(...parts);
  }

  // Paddocks that now share a name (two old names joined, or one folded into a paddock already there) become one.
  const groupsByName = new Map();
  for (const f of out.fields) {
    const k = nameKey(f.name);
    if (!groupsByName.has(k)) groupsByName.set(k, []);
    groupsByName.get(k).push(f);
  }
  const drop = new Set();
  let movements = out.movements;
  const swap = new Map();
  for (const list of groupsByName.values()) {
    if (list.length < 2 || !list.some((f) => changed.has(f.id))) continue;
    const keep = [...list].sort((a, b) => (Number(b.areaHa) || 0) - (Number(a.areaHa) || 0))[0];
    let merged = keep;
    const names = [];
    for (const d of list) {
      if (d === keep) continue;
      merged = mergeFieldRecords(merged, d, keep.name);
      drop.add(d.id);
      names.push(d);
      out.removed.push({ dropId: d.id, keepId: keep.id, agronomyId: d.__agronomyId });
      const r = repointLoads(movements, d.id, keep.id);
      movements = r.movements;
      r.changed.forEach((id) => { if (!out.movementsTouched.includes(id)) out.movementsTouched.push(id); });
    }
    swap.set(keep.id, merged);
    changed.add(keep.id);
    out.joined.push({
      name: keep.name, count: list.length, areaHa: round(merged.areaHa, 2),
      mixed: new Set(list.map((f) => f.commodityId)).size > 1,
    });
  }
  out.fields = out.fields.filter((f) => !drop.has(f.id)).map((f) => swap.get(f.id) || f);
  out.movements = movements;
  out.touched = out.fields.filter((f) => changed.has(f.id)).map((f) => f.id);
  return out;
}

/** The groups that apply to one season: those naming it in their Seasons column, else every season but the current one. */
export function groupsForSeason(groups, label, labels, currentLabel) {
  return groups.filter((g) => {
    const scope = scopeLabels(g.seasons, labels);
    return scope ? scope.has(label) : label !== currentLabel;
  });
}

/**
 * Give a season's paddocks the outline (and farm) of the paddock of the same name in the season in use, where they have
 * none. Works on copies.
 * @returns {{fields: object[], touched: string[]}}
 */
export function copyOutlines(fields, nowFields) {
  const now = new Map(nowFields.filter((f) => f.boundary).map((f) => [nameKey(f.name), f]));
  const touched = [];
  const out = (fields || []).map((f) => {
    if (f.boundary) return f;
    const n = now.get(nameKey(f.name));
    if (!n) return f;
    touched.push(f.id);
    return { ...f, boundary: n.boundary, __hasBoundary: true, ...(!f.property && n.property ? { property: n.property, __hasProperty: true } : {}) };
  });
  return { fields: out, touched };
}

/**
 * Why the farm map can or cannot be copied to the other seasons, for the card that offers it.
 * @param {{label: string, fields: object[]}[]} seasons
 * @param {string} currentLabel   the season in view: the map is copied from it
 * @param {object[]} nowFields    its paddocks
 * @returns {{withOutline: number, copyable: number, alreadyHave: number, noMatch: {label: string, name: string}[]}}
 *   copyable: paddocks that would get an outline now; alreadyHave: paddocks elsewhere that have one;
 *   noMatch: paddocks elsewhere with none and no outlined paddock of that name in the season in view
 */
export function mapCopyReport(seasons, currentLabel, nowFields = []) {
  const withOutline = nowFields.filter((f) => f.boundary).length;
  let copyable = 0;
  let alreadyHave = 0;
  const noMatch = [];
  const has = new Set(nowFields.filter((f) => f.boundary).map((f) => nameKey(f.name)));
  for (const s of seasons) {
    if (s.label === currentLabel) continue;
    for (const f of s.fields || []) {
      if (f.boundary) alreadyHave += 1;
      else if (has.has(nameKey(f.name))) copyable += 1;
      else noMatch.push({ label: s.label, name: f.name });
    }
  }
  return { withOutline, copyable, alreadyHave, noMatch };
}

/**
 * What the rules would do, season by season: the same work as applying them, on copies.
 * @param {ReturnType<typeof parseLineup>['rules']} rules
 * @param {{label: string, fields: object[], movements?: object[]}[]} seasons
 * @param {string} currentLabel   the season in use now: left alone unless a rule names it
 * @param {object[]} nowFields    the paddocks the farm has now
 */
export function planLineup(rules, seasons, currentLabel, nowFields = []) {
  const { groups, errors } = lineupGroups(rules, nowFields);
  const labels = seasons.map((s) => s.label);
  let n = 0;
  const makeId = () => `plan${++n}`;
  const bySeason = [];
  const usedGroups = new Set();
  for (const s of seasons) {
    const applies = groupsForSeason(groups, s.label, labels, currentLabel);
    const r = lineupSeason(s, applies, makeId);
    for (const g of applies) {
      if ((s.fields || []).some((f) => nameKey(f.name) === nameKey(g.from))) usedGroups.add(g);
    }
    if (r.renamed.length || r.split.length || r.joined.length || r.skipped.length) bySeason.push({ label: s.label, ...r, fieldsBefore: s.fields.length, fieldsAfter: r.fields.length });
  }
  const nowKeys = new Set(nowFields.map((f) => nameKey(f.name)));
  return {
    groups, errors, seasons: bySeason,
    unused: groups.filter((g) => !usedGroups.has(g)).map((g) => g.from),
    notNow: [...new Set(groups.flatMap((g) => g.targets.map((t) => t.name)).filter((n2) => !nowKeys.has(nameKey(n2))))],
  };
}
