// A paddock across the seasons: what was grown on it each year, and what it yielded.
//
// Each season holds its own copy of the paddocks, so the same paddock is found in every year by its name. For each
// season it was in, the crop, the area, the tonnes (the actual loads once the paddock is on actual, otherwise the
// estimate) and the yield. This is the rotation question: what went where, and how did it do. Pure.

import { fieldTons } from './derived.js?v=279';

const key = (name) => String(name || '').trim().toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {string} name the paddock's name
 * @param {Object<string, {fields?: object[], movements?: object[], commodities?: object[]}>} years season label -> that season's data
 * @returns {{year: string, crop: string, areaHa: number, tons: number, yieldTHa: number, actual: boolean}[]} oldest season first
 */
export function fieldHistory(name, years) {
  const k = key(name);
  if (!k) return [];
  const rows = [];
  for (const [year, y] of Object.entries(years || {})) {
    const f = (y?.fields || []).find((x) => key(x.name) === k);
    if (!f) continue;
    const crop = (y.commodities || []).find((c) => c.id === f.commodityId)?.name || '';
    const areaHa = num(f.areaHa);
    const tons = fieldTons(f, y.movements || []);
    rows.push({ year, crop, areaHa, tons, yieldTHa: areaHa > 0 ? tons / areaHa : 0, actual: f.yieldMode === 'actual' });
  }
  return rows.sort((a, b) => String(a.year).localeCompare(String(b.year), undefined, { numeric: true }));
}

/** "Wheat, then canola, then barley": the crops in order, a season with no crop left out. */
export function rotationText(rows) {
  const crops = rows.map((r) => r.crop).filter(Boolean);
  if (!crops.length) return '';
  return crops.map((c, i) => (i === 0 ? c : c.charAt(0).toLowerCase() + c.slice(1))).join(', then ');
}

/** The same crop two seasons in a row, as the seasons: [['2025', '2026'], ...]. */
export function repeatCrops(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].crop && rows[i].crop === rows[i - 1].crop) out.push([rows[i - 1].year, rows[i].year]);
  }
  return out;
}

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Every paddock against every season, for the rotation report: one row per paddock (found in each season by its name),
 * one cell per season it was in. The crops grown and the seasons are listed so the screen can colour and label them.
 * @returns {{seasons: string[], crops: string[],
 *            rows: {name: string, property: string, cells: Object<string, {crop: string, areaHa: number, tons: number, yieldTHa: number, actual: boolean}>, repeats: string[][]}[]}}
 */
export function rotationGrid(years) {
  const seasons = Object.keys(years || {}).sort(natural);
  const byName = new Map();
  for (const year of seasons) {
    const y = years[year] || {};
    for (const f of y.fields || []) {
      const k = key(f.name);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, { name: String(f.name).trim(), property: '', cells: {} });
      const row = byName.get(k);
      if (f.property) row.property = String(f.property).trim();   // the latest season's farm name wins
      const crop = (y.commodities || []).find((c) => c.id === f.commodityId)?.name || '';
      const areaHa = num(f.areaHa);
      const tons = fieldTons(f, y.movements || []);
      row.cells[year] = { crop, areaHa, tons, yieldTHa: areaHa > 0 ? tons / areaHa : 0, actual: f.yieldMode === 'actual' };
    }
  }
  const rows = [...byName.values()].sort((a, b) => natural(a.property, b.property) || natural(a.name, b.name));
  for (const r of rows) r.repeats = repeatCrops(seasons.filter((s) => r.cells[s]).map((s) => ({ year: s, crop: r.cells[s].crop })));
  const crops = [...new Set(rows.flatMap((r) => Object.values(r.cells).map((c) => c.crop)).filter(Boolean))].sort(natural);
  return { seasons, crops, rows };
}

/**
 * Each crop's yield by season across the whole farm, weighted by area (total tonnes over total hectares).
 * @returns {{crop: string, bySeason: Object<string, {areaHa: number, tons: number, yieldTHa: number}>}[]}
 */
export function cropYields(grid) {
  return grid.crops.map((crop) => {
    const bySeason = {};
    for (const s of grid.seasons) {
      const cells = grid.rows.map((r) => r.cells[s]).filter((c) => c && c.crop === crop);
      if (!cells.length) continue;
      const areaHa = cells.reduce((a, c) => a + c.areaHa, 0);
      const tons = cells.reduce((a, c) => a + c.tons, 0);
      bySeason[s] = { areaHa, tons, yieldTHa: areaHa > 0 ? tons / areaHa : 0 };
    }
    return { crop, bySeason };
  });
}
