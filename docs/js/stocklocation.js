// Stock by location: the tonnes held in each silo, bunker and off-farm site, split by commodity and then by grade, with the
// totals for the whole farm. Pure: the figures come from the same places the Storage screen uses (the layers in a silo, the
// holdings of an off-farm site), so the report cannot disagree with it.

import { layersForStorage } from './outload.js?v=437';
import { holdings, isOffFarm, commodityOfLoad } from './offfarm.js?v=437';
import { isTransit } from './transit.js?v=437';
import { createReport, fixed } from './reportpdf.js?v=437';

const EPS = 0.0005;
const round3 = (n) => Math.round(n * 1000) / 1000;
const NO_GRADE = 'No grade';
/** A store that counts something other than tonnes (modules at the gin yard, bales in the shed) is not part of a tonnes report. */
const isCounted = (s) => s.kind === 'tally' && String(s.unitLabel ?? 't').trim().toLowerCase() !== 't';
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/** Commodities by name, a commodity with no name last; grades A to Z with "No grade" last. */
function groupLines(lines, names) {
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
    const list = [...grades.values()].map((g) => ({ ...g, tons: round3(g.tons) })).filter((g) => Math.abs(g.tons) > EPS)
      .sort((a, b) => (a.grade === '') - (b.grade === '') || natural(a.grade, b.grade));
    return { commodityId, name: names.get(commodityId) || 'No commodity', tons: round3(list.reduce((a, g) => a + g.tons, 0)), grades: list };
  }).filter((c) => c.grades.length)
    .sort((a, b) => (a.commodityId === '') - (b.commodityId === '') || natural(a.name, b.name));
}

/**
 * Every location that holds something, then the whole farm.
 * @param {{storages: object[], movements: object[], commodities: object[], fields?: object[], sales?: object[]}} d
 * @returns {{locations: {id: string, name: string, kind: 'farm'|'off', operator: string, tons: number, commodities: object[]}[], total: {tons: number, commodities: object[]}}}
 */
export function stockByLocation({ storages = [], movements = [], commodities = [], fields = [], sales = [] } = {}) {
  const names = new Map(commodities.map((c) => [c.id, c.name]));
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
    locations.push({ id: s.id, name: s.name || 'Unnamed', kind: off ? 'off' : 'farm', operator: off ? (s.offFarm?.operator || '') : '', tons: round3(groups.reduce((a, c) => a + c.tons, 0)), commodities: groups });
  }
  locations.sort((a, b) => (a.kind === 'off') - (b.kind === 'off') || natural(a.name, b.name));
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
      if (!by.has(c.commodityId)) by.set(c.commodityId, { commodityId: c.commodityId, name: c.name, grades: new Map() });
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
      .sort((a, b) => (a.grade === '') - (b.grade === '') || natural(a.grade, b.grade));
    return { commodityId: c.commodityId, name: c.name, tons: round3(grades.reduce((a, g) => a + g.tons, 0)), grades };
  }).sort((a, b) => (a.commodityId === '') - (b.commodityId === '') || natural(a.name, b.name));
}

/** The same report, narrowed to on-farm or off-farm locations ('all' keeps everything), with the totals worked out again for what is left. */
export function narrowed(report, kind, d) {
  if (kind !== 'farm' && kind !== 'off') return report;
  const locations = report.locations.filter((l) => l.kind === kind);
  const names = new Map((d.commodities || []).map((c) => [c.id, c.name]));
  const lines = locations.flatMap((l) => l.commodities.flatMap((c) => c.grades.map((g) => ({ commodityId: c.commodityId, grade: g.grade, tons: g.tons }))));
  const all = groupLines(lines, names);
  return { locations, total: { tons: round3(all.reduce((a, c) => a + c.tons, 0)), commodities: all } };
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
export function stockPdf({ report, business = '', today = '', scope = '', group = 'location' } = {}) {
  const pdf = createReport({ title: 'Stock by location', business, season: scope, today, footerNote: 'Tonnes held now, by silo, bunker and off-farm site.' });
  if (!report || !report.locations.length) { pdf.message('Nothing is held in storage yet.'); return pdf.bytes(); }
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
  for (const l of report.locations) {
    pdf.heading(`${l.name}${l.operator ? ` (${l.operator})` : l.kind === 'off' ? ' (off farm)' : ''}`);
    pdf.table(columns, lineRows(l.commodities), { total: { commodity: 'Total', grade: '', tons: l.tons }, name: l.name });
    pdf.gap(6);
  }
  pdf.heading('All locations');
  pdf.table(columns, lineRows(report.total.commodities), { total: { commodity: 'Total', grade: '', tons: report.total.tons }, name: 'All locations' });
  return pdf.bytes();
}
