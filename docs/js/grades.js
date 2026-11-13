// Grades and their receival standards.
//
// A commodity's grades, for a dropdown wherever a grade is chosen, and the standard behind each one for the
// reference page. The lists below are fixed and come from the published receival standards named on each
// one. A farm can add grades of its own to any commodity (stored on the commodity, see mapping.js); those
// join the dropdown but have no standard to show.
//
// Pure: no screen and no storage, so it can be tested.

export const OTHER_GRADE = '__other__';

// Each standard is a table with the grades across and one parameter per row. A value is text exactly as it is
// published ("No limit", "—", "9.0–12.0"), because that is how a person reads it off the page.
export const STANDARDS = [
  {
    key: 'wheat',
    match: /wheat/i,
    title: 'Wheat',
    source: 'GrainCorp 2026/27',
    grades: [
      { code: 'APH1', star: true }, { code: 'APH2' }, { code: 'H1' }, { code: 'H2' }, { code: 'AUH2' },
      { code: 'APW1' }, { code: 'ASW1' }, { code: 'AGP1' }, { code: 'SFW1' }, { code: 'FED1' },
    ],
    params: [
      { label: 'Protein min %',       values: ['14.0', '13.0', '13.0', '11.5', '11.5', '10.5', 'No limit', 'No limit', 'No limit', 'No limit'] },
      { label: 'Moisture max %',      values: ['12.5', '12.5', '12.5', '12.5', '12.5', '12.5', '12.5', '12.5', '12.5', '12.5'] },
      { label: 'Test wt min kg/hl',   values: ['76', '76', '76', '76', '71', '76', '76', '68', '70', '62'] },
      { label: 'Screenings max %',    values: ['5.0', '5.0', '5.0', '5.0', '10.0', '5.0', '5.0', '10.0', '10.0', '15.0'] },
      { label: 'Unmillable max %',    values: ['0.6', '0.6', '0.6', '0.6', '1.2', '0.6', '0.6', '1.2', '1.2', '2.6'] },
      { label: 'Falling No. min (s)', values: ['350', '350', '300', '300', '250', '300', '300', '250', 'No limit', 'No limit'] },
      { label: 'Black point max %',   values: ['—', '5', '5', '5', '15', '5', '5', '15', '15', '50'] },
    ],
    notes: ['* APH1 is marked with an asterisk in the published table.'],
  },
  {
    key: 'barley',
    match: /barley/i,
    title: 'Barley',
    source: 'GrainCorp 2026/27',
    grades: [{ code: 'Malt 1' }, { code: 'Malt 2' }, { code: 'Malt 3' }, { code: 'BAR1' }, { code: 'BAR2' }],
    params: [
      { label: 'Protein %',                values: ['9.0–12.0', '9.0–12.0', '9.0–12.8', 'No limit', 'No limit'] },
      { label: 'Moisture max %',           values: ['12.5', '12.5', '12.5', '12.5', '12.5'] },
      { label: 'Test wt min kg/hl',        values: ['65.0', '65.0', '65.0', '62.5', '60.0'] },
      { label: 'Retention min % (2.5mm)',  values: ['70', '62', '58', 'No limit', 'No limit'] },
      { label: 'Screenings max % (2.2mm)', values: ['7.0', '10.0', 'No limit', '15.0', '25.0'] },
      { label: 'Germination min %',        values: ['95', '95', '95', 'No limit', 'No limit'] },
      { label: 'Falling No. min (s)',      values: ['300', '300', '300', 'N/A', 'N/A'] },
      { label: 'Varietal purity min %',    values: ['95', '95', '95', '—', '—'] },
      { label: 'Sprouted',                 values: ['NIL', 'NIL', 'NIL', 'NIL', '5%'] },
      { label: 'Small foreign seeds max %', values: ['0.6', '0.6', '0.6', '1.2', '2.0'] },
    ],
    notes: [],
  },
  {
    key: 'chickpeas',
    match: /chick\s?pea|chkp/i,
    title: 'Desi chickpeas',
    source: 'GTA 2026/27, farmer dressed receival',
    grades: [
      { code: 'CHKP', label: 'No.1 (CHKP)' },
      { code: 'CHK2', label: 'No.2 (CHK2)' },
      { code: 'No.3', label: 'No.3 (ex-"M" off-grade)' },
    ],
    params: [
      { label: 'Purity min %',                            values: ['97', '97', '97'] },
      { label: 'Moisture max %',                          values: ['14', '14', '14'] },
      { label: 'Defective max %',                         values: ['6', '10', '15'] },
      { label: 'Poor colour max % (within defective)',    values: ['2', '5', 'No separate limit'] },
      { label: 'Fungal/Ascochyta max % (within poor colour)', values: ['1', '1', 'No separate limit'] },
      { label: 'Severely damaged max (grains per 200g)',  values: ['1', '10', '15'] },
      { label: 'Foreign material max %',                  values: ['3', '3', '3'] },
      { label: 'Field peas max % (within foreign material)', values: ['2', '2', '2'] },
      { label: 'Unmillable max %',                        values: ['0.5', '0.5', '0.5'] },
      { label: 'Soil max %',                              values: ['0.3', '0.3', '0.3'] },
      { label: 'Snails max (per 200g)',                   values: ['1', '1', '1'] },
      { label: 'Field insects max (per 200g)',            values: ['15', '15', '15'] },
    ],
    notes: [],
  },
  {
    key: 'faba',
    match: /faba/i,
    title: 'Faba beans',
    source: 'GTA 2026/27, farmer dressed receival',
    grades: [
      { code: 'Canning' },
      { code: 'FAB1', label: 'No.1 (FAB1)' },
      { code: 'FAB2', label: 'No.2 (FAB2)' },
      { code: 'No.3', label: 'No.3 (off-grade)' },
    ],
    params: [
      { label: 'Purity min %',                          values: ['97', '97', '97', '97'] },
      { label: 'Moisture max %',                        values: ['14', '14', '14', '14'] },
      { label: 'Total defective max %',                 values: ['2', '6', '10', '20'] },
      { label: 'Poor colour max % (within defective)',  values: ['1', '3*', '7', 'No separate limit'] },
      { label: 'Severely damaged max (per 400g)',       values: ['1', '1', '1', 'See note below'] },
      { label: 'Sizing',                                values: ['90% retained on 8mm screen', '—', '—', '—'] },
      { label: 'Foreign material max %',                values: ['3', '3', '3', '3'] },
      { label: 'Unmillable max %',                      values: ['0.5', '0.5', '0.5', '0.5'] },
      { label: 'Soil max %',                            values: ['0.3', '0.3', '0.3', '0.3'] },
      { label: 'Snails max (per 400g)',                 values: ['2', '2', '2', '2'] },
      { label: 'Field insects max (per 400g)',          values: ['30', '30', '30', '30'] },
    ],
    notes: ['* and "See note below" are marked in the published table; check the full standard for the notes.'],
  },
  {
    key: 'sorghum',
    match: /sorghum/i,
    title: 'Sorghum',
    source: 'GTA 2026/27',
    intro: 'GrainCorp has not published its 2026/27 sorghum chart yet. Sorghum runs on a different season: its current season is the 12-month period starting 1 January 2027. These figures come from the GTA standards, which GrainCorp\'s SOR and SOR2 grades follow.',
    grades: [
      { code: 'SOR', label: 'SOR (Sorghum No.1)' },
      { code: 'SOR2', label: 'SOR2 (Sorghum No.2)' },
    ],
    params: [
      { label: 'Moisture max %',                          values: ['13.5', '13.5'] },
      { label: 'Test weight min kg/hl',                   values: ['71.0', '62.0'] },
      { label: 'Screenings max % (2.0mm slotted)',        values: ['11.0', '25.0'] },
      { label: 'Foreign material max %',                  values: ['2.0', '4.0'] },
      { label: 'Total defective max %',                   values: ['5.0', '25.0'] },
      { label: 'Field fungi max %',                       values: ['3.0', '10.0'] },
      { label: 'Sprouted max % (separate from defective)', values: ['3.0', '10.0'] },
      { label: 'Severely damaged/heat damaged max %',     values: ['0.5', '1.0'] },
      { label: 'Mould max %',                             values: ['0.05', '0.1'] },
      { label: 'Sorghum ergot max %',                     values: ['0.3', '0.3'] },
      { label: 'Small foreign seeds max %',               values: ['1.6', '1.6'] },
      { label: 'Johnson/Columbus grass max (per half litre)', values: ['10 (own limit)', 'Within the Type 7(a) limit of 50'] },
      { label: 'Protein',                                 values: ['No limit', 'No limit'] },
    ],
    notes: [],
  },
  {
    key: 'canola',
    match: /canola|rapeseed/i,
    title: 'Canola',
    source: 'GrainCorp 2026/27',
    intro: 'Canola grades work differently from cereals and pulses. There is one receival grade, split by GM status, and oil and quality are dealt with through price adjustments in the contract rather than by downgrading the load.',
    grades: [
      { code: 'CAN', label: 'CAN (non-GM, AOF CSO1)' },
      { code: 'CANG', label: 'CANG (all varieties incl. GM, AOF CSO1a)' },
    ],
    params: [
      { label: 'Moisture max %',                       values: ['8.0', '8.0'] },
      { label: 'Test weight min kg/hl',                values: ['62', '62'] },
      { label: 'Impurities max %',                     values: ['3.0', '3.0'] },
      { label: 'Oil / protein',                        values: ['No receival limit', 'No receival limit'] },
      { label: 'Sand/soil max %',                      values: ['0.1', '0.1'] },
      { label: 'Sclerotes max %',                      values: ['0.5', '0.5'] },
      { label: 'Heat damaged max (per 1,000 seeds)',   values: ['1', '1'] },
      { label: 'Damaged (disease/weather) max',        values: ['3% (30 seeds)', '3% (30 seeds)'] },
      { label: 'Broken/split incl. insect damage max', values: ['7%', '7%'] },
      { label: 'Sprouted max',                         values: ['5%', '5%'] },
      { label: 'Green seed max (per 100-seed ruler)',  values: ['2', '2'] },
      { label: 'Ryegrass ergot max',                   values: ['0.5 cm', '0.5 cm'] },
      { label: 'Snails max (above 3.0mm screen, per 2.5L)', values: ['1', '1'] },
    ],
    notes: [
      'Oil: 42.0% is the base level, with a 1.5% premium or deduction for each 1% above or below 42%.',
      'Free fatty acid (FFA): 1.0% is the base level, with a 2% deduction for each 1% over, and loads are rejectable above 2.5%.',
      'Caveat on those terms: the AOF document they come from is the 2022 seasonal standard. The 42% / 1.5:1 basis has held for years, but the full 2026/27 AOF manual is members-only, so it could not be confirmed for this season.',
      'Seasonal grade: in wet years, AOF has added seasonal grades CSO1(S) and CSO1a(S). Both accept mould at 40 seeds per 1,000, compared with 5 per 1,000 for the benchmark CSO1 and CSO1a grades. This plays the same role as No.3 in the pulses.',
      'ISCC is a certification layered on top of CAN/CANG, not a separate grade. The premium is paid for the sustainability declaration, not for the quality spec.',
    ],
  },
];

/** The standard for a commodity, found by its name ("Wheat", "Durum wheat", "Chickpeas"), or null. */
export function standardFor(commodityName) {
  const name = String(commodityName ?? '');
  return STANDARDS.find((s) => s.match.test(name)) || null;
}

const norm = (g) => String(g ?? '').trim().toLowerCase();

/** A farm's own grades as saved: trimmed, no blanks, no repeats (ignoring case), a sensible length. */
export function cleanCustomGrades(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const g = String(raw ?? '').trim().slice(0, 40);
    if (!g || seen.has(norm(g))) continue;
    seen.add(norm(g));
    out.push(g);
  }
  return out;
}

/**
 * Every grade offered for a commodity: the published ones, then the farm's own that are not already there.
 * @returns {{code: string, label: string, own: boolean}[]}
 */
export function gradesFor(commodityName, custom = []) {
  const std = standardFor(commodityName);
  const list = (std?.grades || []).map((g) => ({ code: g.code, label: g.label || g.code, own: false }));
  const have = new Set(list.map((g) => norm(g.code)));
  for (const g of cleanCustomGrades(custom)) {
    if (!have.has(norm(g))) { list.push({ code: g, label: `${g} (yours)`, own: true }); have.add(norm(g)); }
  }
  return list;
}

/**
 * The options for a grade dropdown. A grade already on the record that is not on the list stays selectable, so
 * opening an old contract never loses what it says, and "Other" lets a one-off grade be typed in.
 */
export function gradeOptions(commodityName, custom = [], current = '') {
  const list = gradesFor(commodityName, custom);
  const opts = [{ value: '', label: 'No grade' }, ...list.map((g) => ({ value: g.code, label: g.label }))];
  const cur = String(current ?? '').trim();
  if (cur && !list.some((g) => norm(g.code) === norm(cur))) opts.push({ value: cur, label: `${cur} (not on the list)` });
  opts.push({ value: OTHER_GRADE, label: 'Other (type it in)' });
  return opts;
}

/** Every grade code across the given commodities, for a suggestion list where the commodity is not known. */
export function allGradeCodes(commodities = []) {
  const seen = new Set();
  const out = [];
  const add = (g) => { if (g && !seen.has(norm(g))) { seen.add(norm(g)); out.push(g); } };
  for (const c of commodities) gradesFor(c.name, c.customGrades).forEach((g) => add(g.code));
  return out;
}
