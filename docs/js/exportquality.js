// The grade and the measurements, as columns in a CSV export.
//
// Movements are one load each, so each row carries that load's own grade and
// measurements. Fields and storages hold many loads, so each row carries the
// weighted average of what is in them: every measurement averaged by tonnes over
// only the loads that have it (a load with no protein recorded is left out of the
// protein figure, not counted as zero), and the grade as the mix it is made of,
// "APH1 60% · AUH2 40%", or just the grade when it is all one.
//
// Pure. The averaging is the same the outload predictor uses (outload.js).

import { SPECS, specOf, summarise } from './outload.js';
import { gradeMix, mixText, hasGrades } from './silolayers.js';

const dpOf = Object.fromEntries(SPECS.map((s) => [s.key, s.dp]));
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

// What each measurement is called in a column heading, in the order they appear.
const HEADINGS = {
  proteinPct: 'Protein (%)',
  moisturePct: 'Moisture (%)',
  screeningsPct: 'Screenings (%)',
  testWeightKgHl: 'Test weight (kg/hL)',
  fallingNumber: 'Falling number (s)',
  oilPct: 'Oil (%)',
};

/** One load's own grade and measurements; anything not recorded is blank, never zero. */
export function loadQuality(rec) {
  const sp = specOf(rec);
  const out = { grade: sp.grade };
  for (const { key } of SPECS) out[key] = sp[key];
  return out;
}

/**
 * The weighted average of several stretches of grain.
 *
 * @param {{tons: number, spec: object}[]} parts  each stretch's tonnes and its quality (specOf shape)
 * @returns the same shape as loadQuality: a grade (or mix of grades) and one figure per measurement,
 *          rounded as the screens round them, null where no part of the grain has it
 */
export function averageQuality(parts) {
  const taken = (parts || [])
    .map((p) => ({ tons: Number(p.tons) || 0, layer: { spec: p.spec || {} } }))
    .filter((t) => t.tons > 1e-9);
  const s = summarise(taken);
  const layers = taken.map((t) => ({ tons: t.tons, spec: t.layer.spec }));
  const out = { grade: hasGrades(layers) ? mixText(gradeMix(layers), 99) : '' };
  for (const { key } of SPECS) {
    const avg = s.specs[key]?.avg;
    out[key] = avg === undefined ? null : round(avg, dpOf[key]);
  }
  return out;
}

/**
 * The CSV columns for a row's quality: Grade, then each measurement.
 *
 * @param {(row: object) => object} qualityOf  loadQuality(row) for a single load, or an average for a store of many
 */
export function qualityColumns(qualityOf) {
  const cell = (v) => (v === null || v === undefined ? '' : v);
  return [
    { label: 'Grade', get: (row) => qualityOf(row).grade },
    ...SPECS.map(({ key }) => ({ label: HEADINGS[key], get: (row) => cell(qualityOf(row)[key]) })),
  ];
}

/** What a field's grain is, on average: the loads that left it, weighted by the tonnes taken from it. */
export function fieldQuality(field, movements) {
  const parts = [];
  for (const m of movements || []) {
    const tons = (m.froms || []).filter((l) => l.type === 'field' && l.id === field.id).reduce((a, l) => a + (Number(l.tons) || 0), 0);
    if (tons > 0) parts.push({ tons, spec: specOf(m) });
  }
  return averageQuality(parts);
}
