// Stock by location: the tonnes held in each silo, bunker and off-farm site, split by commodity and then by grade, with the
// totals for the whole farm. Pure: the figures come from the same places the Storage screen uses (the layers in a silo, the
// holdings of an off-farm site), so the report cannot disagree with it.

import { layersForStorage } from './outload.js?v=507';
import { holdings, isOffFarm, commodityOfLoad } from './offfarm.js?v=507';
import { isTransit } from './transit.js?v=507';
import { createReport, fixed } from './reportpdf.js?v=507';
import { gradeComparer } from './grades.js?v=507';

const EPS = 0.0005;
const round3 = (n) => Math.round(n * 1000) / 1000;
const NO_GRADE = 'No grade';
/** A store that counts something other than tonnes (modules at the gin yard, bales in the shed) is not part of a tonnes report. */
const isCounted = (s) => s.kind === 'tally' && String(s.unitLabel ?? 't').trim().toLowerCase() !== 't';
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/** Commodities by name, a commodity with no name last; grades A to Z with "No grade" last. */
function groupLines(lines, byId) {
  const byCommodity = new Map();
  for (const l of lines) {
    const id = l.commodityId || '';
    if (!byCommodity.has(id)) byCommodity.set(id, new Map());
    const grades = byCommodity.get(id);
    const g = String(l.grade ?? '').trim();
    const key = g.toLowerCase();
    if (!grades.has(key)) grades.set(key, { grade: g, tons: 0 });
    grades.get(key).tons += l.tons;
  }
  return [...byCommodity.entries()].map(([commodityId, grades]) => {
    const c = byId.get(commodityId);
    // grades in the order Settings lists them for this commodity
    const byGrade = gradeComparer(c?.name, c?.customGrades);
    const list = [...grades.values()].map((g) => ({ ...g, tons: round3(g.tons) })).filter((g) => Math.abs(g.tons) > EPS)
      .sort((a, b) => byGrade(a.grade, b.grade));
    return { commodityId, customGrades: c?.customGrades || [], name: c?.name || 'No commodity', tons: round3(list.reduce((a, g) => a + g.tons, 0)), grades: list };
  }).filter((c) => c.grades.length)
    .sort((a, b) => (a.commodityId === '') - (b.commodityId === '') || natural(a.name, b.name));
}

/**
 * Every location that holds something, then the whole farm.
 * @param {{storages: object[], movements: object[], commodities: object[], fields?: object[], sales?: object[]}} d
 * @returns {{locations: {id: string, name: string, kind: 'farm'|'off', operator: string, tons: number, commodities: object[]}[], total: {tons: number, commodities: object[]}}}
 */
export function stockByLocation({ storages = [], movements = [], commodities = [], fields = [], sales = [] } = {}) {
  const names = new Map(commodities.map((c) => [c.id, c]));
  const ctx = { fields, storages, sales };
  const byId = new Map(movements.map((m) => [m.id, m]));
  const locations = [];
  const everything = [];
  for (const s of storages) {
    if (isTransit(s) || isCounted(s)) continue;
    const off = isOffFarm(s);
    const lines = off
      ? holdings(s, movements, ctx)
      // a silo or bunker can have held more than one commodity (a shed shared by barley and chickpeas), so each layer is its own load's
      : layersForStorage(s, movements).layers.filter((l) => l.tons > EPS).map((l) => ({ commodityId: (l.source === 'load' && byId.get(l.id) ? commodityOfLoad(byId.get(l.id), ctx) : '') || s.commodityId || '', grade: String(l.spec?.grade ?? '').trim(), tons: l.tons }));
    const groups = groupLines(lines, names);
    if (!groups.length) continue;
    everything.push(...lines);
    locations.push({ id: s.id, name: s.name || 'Unnamed', kind: off ? 'off' : 'farm', operator: off ? (s.offFarm?.operator || '') : '', property: off ? '' : String(s.property ?? '').trim(), tons: round3(groups.reduce((a, c) => a + c.tons, 0)), commodities: groups });
  }
  // on farm first, by farm or site (silos with none last), then off farm; each in name order
  locations.sort((a, b) => (a.kind === 'off') - (b.kind === 'off') || (!a.property - !b.property) || natural(a.property, b.property) || natural(a.name, b.name));
  const all = groupLines(everything, names);
  return { locations, total: { tons: round3(all.reduce((a, c) => a + c.tons, 0)), commodities: all } };
}

/**
 * The same stock the other way round: each commodity, then each grade, then the locations that hold it. Grades are sold separately,
 * so a site holding two of them is listed under both, each with its own tonnes (never filed under whichever has the most).
 * @returns {{commodityId: string, name: string, tons: number, grades: {grade: string, tons: number, sites: {id: string, name: string, kind: string, operator: string, tons: number}[]}[]}[]}
 */
export function stockByGrade(report) {
  const by = new Map();
  for (const l of report.locations) {
    for (const c of l.commodities) {
      if (!by.has(c.commodityId)) by.set(c.commodityId, { commodityId: c.commodityId, name: c.name, customGrades: c.customGrades, grades: new Map() });
      const grades = by.get(c.commodityId).grades;
      for (const g of c.grades) {
        const key = String(g.grade).trim().toLowerCase();
        if (!grades.has(key)) grades.set(key, { grade: g.grade, tons: 0, sites: [] });
        const e = grades.get(key);
        e.tons += g.tons;
        e.sites.push({ id: l.id, name: l.name, kind: l.kind, operator: l.operator, tons: g.tons });
      }
    }
  }
  return [...by.values()].map((c) => {
    const grades = [...c.grades.values()]
      .map((g) => ({ ...g, tons: round3(g.tons), sites: g.sites.sort((a, b) => b.tons - a.tons || natural(a.name, b.name)) }))
      .sort((a, b) => gradeComparer(c.name, c.customGrades)(a.grade, b.grade));
    return { commodityId: c.commodityId, name: c.name, tons: round3(grades.reduce((a, g) => a + g.tons, 0)), grades };
  }).sort((a, b) => (a.commodityId === '') - (b.commodityId === '') || natural(a.name, b.name));
}

/**
 * The report laid out the way you walk the farm: on farm or off farm, then the property (the "Farm / site" a silo is on; off farm, the
 * site holding it), then each commodity, each grade, and last the silos holding that grade with their own tonnes. A farm with silos on
 * one unnamed property skips the property step (its label is ''); an off-farm site has no silos to list.
 * @returns {{kind: 'farm'|'off', label: string, tons: number, properties: {label: string, tons: number, commodities: {commodityId: string, name: string, tons: number, grades: {grade: string, tons: number, silos: {name: string, tons: number}[]}[]}[]}[]}[]}
 */
export function stockTree(report) {
  const names = new Map();
  for (const l of report.locations) for (const c of l.commodities) names.set(c.commodityId, { name: c.name, customGrades: c.customGrades });
  const same = (x, y) => String(x ?? '').trim().toLowerCase() === String(y ?? '').trim().toLowerCase();
  const property = (label, locs, withSilos) => {
    const lines = locs.flatMap((l) => l.commodities.flatMap((c) => c.grades.map((g) => ({ commodityId: c.commodityId, grade: g.grade, tons: g.tons, site: l.name }))));
    const commodities = groupLines(lines, names).map((c) => ({
      ...c,
      grades: c.grades.map((g) => {
        const sums = new Map();
        if (withSilos) for (const x of lines) if (x.commodityId === c.commodityId && same(x.grade, g.grade)) sums.set(x.site, (sums.get(x.site) || 0) + x.tons);
        return { ...g, silos: [...sums].map(([name, tons]) => ({ name, tons: round3(tons) })).sort((p, q) => natural(p.name, q.name)) };
      }),
    }));
    return { label, tons: round3(commodities.reduce((acc, c) => acc + c.tons, 0)), commodities };
  };
  const out = [];
  const farm = report.locations.filter((l) => l.kind !== 'off');
  if (farm.length) {
    const labels = [...new Set(farm.map((l) => l.property || ''))];   // already in order: named first, blank last
    const onlyBlank = labels.length === 1 && labels[0] === '';
    const properties = labels.map((p) => property(onlyBlank ? '' : p || 'No farm / site', farm.filter((l) => (l.property || '') === p), true));
    out.push({ kind: 'farm', label: 'On farm', tons: round3(properties.reduce((acc, p) => acc + p.tons, 0)), properties });
  }
  const off = report.locations.filter((l) => l.kind === 'off');
  if (off.length) {
    const properties = off.map((l) => property(l.name + (l.operator ? ' (' + l.operator + ')' : ''), [l], false));
    out.push({ kind: 'off', label: 'Off farm', tons: round3(properties.reduce((acc, p) => acc + p.tons, 0)), properties });
  }
  return out;
}

/** The same report, narrowed to on-farm or off-farm locations ('all' keeps everything), with the totals worked out again for what is left. */
export function narrowed(report, kind, d, commodityIds = []) {
  const want = new Set(commodityIds || []);
  const byKind = kind === 'farm' || kind === 'off';
  if (!byKind && !want.size) return report;
  // a location keeps only the picked commodities (when some are picked); one with none left drops out
  const locations = report.locations.filter((l) => !byKind || l.kind === kind).map((l) => {
    if (!want.size) return l;
    const commodities = l.commodities.filter((c) => want.has(c.commodityId));
    return { ...l, commodities, tons: round3(commodities.reduce((a, c) => a + c.tons, 0)) };
  }).filter((l) => l.commodities.length);
  const names = new Map((d.commodities || []).map((c) => [c.id, c]));
  const lines = locations.flatMap((l) => l.commodities.flatMap((c) => c.grades.map((g) => ({ commodityId: c.commodityId, grade: g.grade, tons: g.tons }))));
  const all = groupLines(lines, names);
  return { locations, total: { tons: round3(all.reduce((a, c) => a + c.tons, 0)), commodities: all } };
}

/**
 * The grid: a row for each location (on farm first, then off farm), a column for each commodity and grade, the tonnes in the cells,
 * and the totals along the bottom. Columns with nothing in them are left out. `commodityIds` narrows it to those commodities.
 * @returns {{columns: {key: string, commodityId: string, commodity: string, grade: string}[], groups: {commodityId: string, commodity: string, span: number}[],
 *   rows: {id: string, name: string, kind: string, operator: string, cells: Record<string, number>, total: number}[], totals: Record<string, number>, grand: number}}
 */
export function stockMatrix(report, { commodityIds = [] } = {}) {
  const want = new Set(commodityIds || []);
  const columns = [];
  for (const c of report.total.commodities) {
    if (want.size && !want.has(c.commodityId)) continue;
    for (const g of c.grades) columns.push({ key: `${c.commodityId}|${String(g.grade).trim().toLowerCase()}`, commodityId: c.commodityId, commodity: c.name, grade: g.grade });
  }
  const keys = new Set(columns.map((c) => c.key));
  const groups = [];
  for (const c of columns) {
    const last = groups[groups.length - 1];
    if (last && last.commodityId === c.commodityId) last.span += 1;
    else groups.push({ commodityId: c.commodityId, commodity: c.commodity, span: 1 });
  }
  const totals = {};
  const rows = [];
  for (const l of report.locations) {
    const cells = {};
    let total = 0;
    for (const c of l.commodities) {
      for (const g of c.grades) {
        const key = `${c.commodityId}|${String(g.grade).trim().toLowerCase()}`;
        if (!keys.has(key)) continue;
        cells[key] = round3((cells[key] || 0) + g.tons);
        totals[key] = round3((totals[key] || 0) + g.tons);
        total += g.tons;
      }
    }
    if (Object.keys(cells).length) rows.push({ id: l.id, name: l.name, kind: l.kind, operator: l.operator, cells, total: round3(total) });
  }
  return { columns, groups, rows, totals, grand: round3(Object.values(totals).reduce((a, v) => a + v, 0)) };
}

/** The grid as rows and columns for a spreadsheet: a column for each commodity and grade, a row for each location, then the total. */
export function matrixSheet(m, { rowTotals = false } = {}) {
  const columns = [
    { label: 'Location', get: (r) => r.name },
    { label: 'On or off farm', get: (r) => r.where },
    ...m.columns.map((c) => ({ label: `${c.commodity} ${c.grade || NO_GRADE}`, get: (r) => (r.cells[c.key] ?? '') })),
    ...(rowTotals ? [{ label: 'Total', get: (r) => r.total }] : []),
  ];
  const rows = [
    ...m.rows.map((r) => ({ name: r.operator ? `${r.name} (${r.operator})` : r.name, where: r.kind === 'off' ? 'Off farm' : 'On farm', cells: r.cells, total: r.total })),
    { name: 'Total', where: '', cells: m.totals, total: m.grand },
  ];
  return { columns, rows };
}

/** One row a location, commodity and grade, for a spreadsheet. */
export function stockRows(report) {
  const rows = [];
  for (const l of report.locations) {
    for (const c of l.commodities) for (const g of c.grades) rows.push({ location: l.name, runBy: l.operator, where: l.kind === 'off' ? 'Off farm' : 'On farm', commodity: c.name, grade: g.grade || NO_GRADE, tons: g.tons });
  }
  return rows;
}

export const STOCK_COLUMNS = [
  { label: 'Location', get: (r) => r.location },
  { label: 'On or off farm', get: (r) => r.where },
  { label: 'Run by', get: (r) => r.runBy },
  { label: 'Commodity', get: (r) => r.commodity },
  { label: 'Grade', get: (r) => r.grade },
  { label: 'Tonnes', get: (r) => r.tons },
];

const t1 = (v) => fixed(v, 1);

/** The report as a PDF: a table of commodity, grade and tonnes under each location, then the farm total. */
export function stockPdf({ report, business = '', today = '', scope = '', group = 'location', commodityIds = [], rowTotals = false } = {}) {
  // the grid is wide: on its own landscape pages once it has more than a handful of columns
  const matrix = group === 'table' && report && report.locations.length ? stockMatrix(report, { commodityIds }) : null;
  const pdf = createReport({ title: 'Stock by location', business, season: scope, today, footerNote: 'Tonnes held now, by silo, bunker and off-farm site.', landscape: !!matrix && matrix.columns.length > 6 });
  if (!report || !report.locations.length) { pdf.message('Nothing is held in storage yet.'); return pdf.bytes(); }
  if (group === 'table') {
    const m = matrix;
    const t0 = (v) => (v ? fixed(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1) : '');
    const place = (r) => `${r.name}${r.kind === 'off' ? ' (off farm)' : ''}`;
    // a page across holds about 22 columns; more than that and each commodity gets a table of its own
    const sets = m.columns.length <= 22 ? [m.columns] : m.groups.map((g) => m.columns.filter((c) => c.commodityId === g.commodityId));
    for (const cols of sets) {
      const one = sets.length > 1;
      const rows = m.rows.filter((r) => cols.some((c) => r.cells[c.key])).map((r) => ({ ...r, total: cols.reduce((a, c) => a + (r.cells[c.key] || 0), 0) }));
      const totals = Object.fromEntries(cols.map((c) => [c.key, m.totals[c.key] || 0]));
      const grand = cols.reduce((a, c) => a + (totals[c.key] || 0), 0);
      const lead = cols.length > 6 ? 0.2 : 0.28;
      const w = (1 - lead - (rowTotals ? 0.07 : 0)) / Math.max(1, cols.length);
      const spans = [];
      for (const c of cols) { const last = spans[spans.length - 1]; if (last && last.commodityId === c.commodityId) last.span += 1; else spans.push({ commodityId: c.commodityId, head: c.commodity, span: 1 }); }
      const columns = [
        { head: 'Location', w: lead, left: true, cell: (r) => place(r) },
        ...cols.map((c) => ({ head: c.grade || NO_GRADE, w, cell: (r) => t0(r.cells[c.key]) })),
        ...(rowTotals ? [{ head: 'Total', w: 0.07, cell: (r) => t0(r.total) }] : []),
      ];
      if (one) pdf.heading(cols[0].commodity);
      pdf.table(columns, rows, { total: { name: 'Total', kind: 'farm', cells: totals, total: grand }, name: one ? cols[0].commodity : 'Stock by location', columnLines: true, groups: spans, body: cols.length > 12 ? 7.5 : 9 });
    }
    return pdf.bytes();
  }
  if (group === 'grade') {
    const siteName = (s) => `${s.name}${s.operator ? ` (${s.operator})` : s.kind === 'off' ? ' (off farm)' : ''}`;
    const gradeColumns = [
      { head: 'Grade', w: 0.25, left: true, cell: (r) => r.grade },
      { head: 'Location', w: 0.5, left: true, cell: (r) => r.site },
      { head: 'Tonnes', w: 0.25, cell: (r) => t1(r.tons) },
    ];
    for (const c of stockByGrade(report)) {
      pdf.heading(c.name);
      const rows = c.grades.flatMap((g) => [
        ...g.sites.map((s, i) => ({ grade: i === 0 ? g.grade || NO_GRADE : '', site: siteName(s), tons: s.tons })),
        ...(g.sites.length > 1 ? [{ grade: '', site: `All ${g.grade || NO_GRADE}`, tons: g.tons }] : []),
      ]);
      pdf.table(gradeColumns, rows, { total: { grade: 'Total', site: '', tons: c.tons }, name: c.name });
      pdf.gap(6);
    }
    return pdf.bytes();
  }
  const lineRows = (commodities) => commodities.flatMap((c) => c.grades.map((g, i) => ({ commodity: i === 0 ? c.name : '', grade: g.grade || NO_GRADE, tons: g.tons })));
  const columns = [
    { head: 'Commodity', w: 0.4, left: true, cell: (r) => r.commodity },
    { head: 'Grade', w: 0.35, left: true, cell: (r) => r.grade },
    { head: 'Tonnes', w: 0.25, cell: (r) => t1(r.tons) },
  ];
  // on farm and off farm are a table each: property, commodity, grade, then the silos holding it
  const placeColumns = [
    { head: 'Property', w: 0.22, left: true, cell: (r) => r.property },
    { head: 'Commodity', w: 0.19, left: true, cell: (r) => r.commodity },
    { head: 'Grade', w: 0.16, left: true, cell: (r) => r.grade },
    { head: 'Silo', w: 0.23, left: true, cell: (r) => r.silo },
    { head: 'Tonnes', w: 0.2, cell: (r) => t1(r.tons) },
  ];
  for (const top of stockTree(report)) {
    pdf.heading(top.label);
    const rows = [];
    for (const p of top.properties) {
      let firstP = true;
      for (const c of p.commodities) {
        let firstC = true;
        for (const g of c.grades) {
          const leaves = g.silos.length ? g.silos : [{ name: '', tons: g.tons }];
          leaves.forEach((x, i) => {
            rows.push({ property: firstP ? p.label : '', commodity: firstC ? c.name : '', grade: i === 0 ? (g.grade || NO_GRADE) : '', silo: x.name, tons: x.tons });
            firstP = false; firstC = false;
          });
        }
      }
    }
    pdf.table(placeColumns, rows, { total: { property: 'Total', commodity: '', grade: '', silo: '', tons: top.tons }, name: top.label, columnLines: true });
    pdf.gap(6);
  }
  pdf.heading('All locations');
  pdf.table(columns, lineRows(report.total.commodities), { total: { commodity: 'Total', grade: '', tons: report.total.tons }, name: 'All locations' });
  return pdf.bytes();
}
