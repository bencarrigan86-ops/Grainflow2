// Run with:
//   node tests/stocklocation.test.mjs
//
// Stock by location: what each silo, bunker and off-farm site holds, by commodity and grade, and the farm total.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchStorages, sortStorages, sortGroupLabel, SORTS } from '../docs/js/storagefilter.js';
import { loadFilterChoices } from '../docs/js/loadreport.js';
import { gradeSorter } from '../docs/js/grades.js';
import { filterHoldings } from '../docs/js/offfarm.js';
import { gradeComparer } from '../docs/js/grades.js';
import { stockMatrix, matrixSheet, stockByLocation, stockByGrade, narrowed, stockRows, stockPdf, STOCK_COLUMNS } from '../docs/js/stocklocation.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const commodities = [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }, { id: 'c', name: 'Chickpeas' }];
const storages = [
  { id: 's1', name: 'Silo A', kind: 'silo', commodityId: 'w', capacity: 1500, openingStock: 0 },
  { id: 's2', name: 'Silo B', kind: 'silo', commodityId: 'b', capacity: 1000, openingStock: 0 },
  { id: 'o1', name: 'Goondiwindi East', offFarm: { operator: 'GrainCorp', opening: [{ commodityId: 'w', grade: 'APW1', tons: 40 }, { commodityId: 'w', grade: 'H2', tons: 50 }] } },
  { id: 'o2', name: 'Empty site', offFarm: { operator: 'X', opening: [] } },
  { id: 'g1', name: 'Gin yard', kind: 'tally', commodityId: 'w', unitLabel: 'modules', openingStock: 40 },
  { id: 'e1', name: 'Silo C', kind: 'silo', commodityId: 'w', capacity: 100, openingStock: 0 },
];
const load = (id, to, tons, grade, date) => ({ id, date, grade, commodityId: 'w', froms: [], tos: [{ type: 'silo', id: to, tons }] });
const movements = [
  load('m1', 's1', 300, 'APW1', '2026-11-01'),
  load('m2', 's1', 200, 'H2', '2026-11-02'),
  load('m3', 'o1', 10, 'APW1', '2026-11-03'),
  { ...load('m4', 's2', 120, '', '2026-11-04'), commodityId: 'b' },
  { ...load('m5', 's2', 30, 'No.1 Chickpea', '2026-11-05'), commodityId: 'c' },
];
const report = stockByLocation({ storages, movements, commodities });

check('each location lists its commodity and, under it, each grade; a location holding nothing is left out', () => {
  assert.deepEqual(report.locations.map((l) => l.name), ['Silo A', 'Silo B', 'Goondiwindi East']);
  const a = report.locations[0];
  assert.equal(a.tons, 500);
  assert.deepEqual(a.commodities[0].grades, [{ grade: 'H2', tons: 200 }, { grade: 'APW1', tons: 300 }]);
});
check('off-farm holdings count the opening stock and loads in, by grade, with the operator named', () => {
  const o = report.locations[2];
  assert.equal(o.kind, 'off');
  assert.equal(o.operator, 'GrainCorp');
  assert.deepEqual(o.commodities[0].grades, [{ grade: 'H2', tons: 50 }, { grade: 'APW1', tons: 50 }]);
  assert.equal(o.tons, 100);
});
check('a store that counts modules or bales, not tonnes, is left out', () => {
  assert.ok(!report.locations.some((l) => l.name === 'Gin yard'));
});
check('a load with no grade is kept as its own line, last', () => {
  assert.deepEqual(report.locations[1].commodities[0].grades, [{ grade: '', tons: 120 }]);
});
check('the whole farm is totalled by commodity and grade across every location', () => {
  const wheat = report.total.commodities.find((c) => c.name === 'Wheat');
  assert.deepEqual(wheat.grades, [{ grade: 'H2', tons: 250 }, { grade: 'APW1', tons: 350 }]);
  assert.equal(wheat.tons, 600);
  assert.equal(report.total.tons, 750);
  assert.deepEqual(report.total.commodities.map((c) => c.name), ["Barley", "Chickpeas", "Wheat"]);
});
check('narrowing to off farm or on farm works the totals out again', () => {
  const off = narrowed(report, 'off', { commodities });
  assert.deepEqual(off.locations.map((l) => l.name), ['Goondiwindi East']);
  assert.equal(off.total.tons, 100);
  const farm = narrowed(report, 'farm', { commodities });
  assert.equal(farm.total.tons, 650);
  assert.equal(narrowed(report, 'all', { commodities }), report);
});
check('the spreadsheet has a row for each location, commodity and grade', () => {
  const rows = stockRows(report);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], { location: 'Silo A', runBy: '', where: 'On farm', commodity: 'Wheat', grade: 'H2', tons: 200 });
  assert.equal(rows.find((r) => r.location === 'Silo B').grade, 'No grade');
  assert.deepEqual(STOCK_COLUMNS.map((c) => c.label), ['Location', 'On or off farm', 'Run by', 'Commodity', 'Grade', 'Tonnes']);
});
check('the PDF builds, and says so when nothing is held', () => {
  assert.ok(stockPdf({ report, business: 'Farm', today: '19-11-2026' }).length > 1000);
  assert.ok(stockPdf({ report: { locations: [], total: { tons: 0, commodities: [] } } }).length > 500);
});
check('the report is on the Reports hub and the off-farm card splits by commodity and grade', () => {
  assert.ok(read('docs/js/reportshub.js').includes("tile('stock', 'Stock by location', 'sheet'"));
  assert.ok(read('docs/js/views/reports.js').includes('stock: () => openStockByLocationSheet()'));
  assert.ok(read('docs/js/views/offfarm.js').includes('class="of-commodity"') && read('docs/js/views/offfarm.js').includes('class="of-grade"'));
});

check('the Storage filter narrows the off-farm sites by commodity tab and by typed words (location, operator, commodity or grade)', () => {
  const loc = storages.find((x) => x.id === 'o1');
  const rows = [{ commodityId: 'w', grade: 'APW1', tons: 50 }, { commodityId: 'w', grade: 'H2', tons: 50 }, { commodityId: 'b', grade: 'BAR1', tons: 30 }];
  const f = (o) => filterHoldings(rows, loc, commodities, o).map((r) => r.grade);
  assert.deepEqual(f({}), ['APW1', 'H2', 'BAR1']);
  assert.deepEqual(f({ commodityId: 'b' }), ['BAR1']);
  assert.deepEqual(f({ query: 'apw1' }), ['APW1']);
  assert.deepEqual(f({ query: 'wheat h2' }), ['H2']);
  assert.deepEqual(f({ query: 'graincorp' }), ['APW1', 'H2', 'BAR1'], 'a word that matches the location keeps all of its rows');
  assert.deepEqual(f({ query: 'goondiwindi barley' }), ['BAR1']);
  assert.deepEqual(f({ query: 'nothing' }), []);
  const src = read('docs/js/views/storage.js');
  assert.ok(src.includes("paintOffFarmCard(offBox, { query: searchText, commodityId: tab && tab !== NO_COMMODITY ? tab : '' })"));
});
check('searching Storage by a grade finds a silo that holds some of it among its layers', () => {
  const silos = [{ id: 'a', name: 'Silo A', commodityId: 'w', grade: 'H2', __mix: [{ key: 'h2', grade: 'H2', tons: 400 }, { key: 'apw1', grade: 'APW1', tons: 100 }] }, { id: 'b', name: 'Silo B', commodityId: 'w', grade: 'H2', __mix: [{ key: 'h2', grade: 'H2', tons: 200 }] }];
  assert.deepEqual(searchStorages(silos, commodities, 'apw1').map((x) => x.id), ['a']);
  assert.deepEqual(searchStorages(silos, commodities, 'h2').map((x) => x.id), ['a', 'b']);
});

check('by grade: a site holding two grades is under both, each with its own tonnes, never filed under the bigger one', () => {
  const g = stockByGrade(report);
  const wheat = g.find((c) => c.name === 'Wheat');
  assert.deepEqual(wheat.grades.map((x) => x.grade), ['H2', 'APW1']);
  const apw = wheat.grades.find((x) => x.grade === 'APW1');
  assert.deepEqual(apw.sites.map((x) => [x.name, x.tons]), [['Silo A', 300], ['Goondiwindi East', 50]]);
  assert.equal(apw.tons, 350);
  const h2 = wheat.grades.find((x) => x.grade === 'H2');
  assert.deepEqual(h2.sites.map((x) => [x.name, x.tons]), [['Silo A', 200], ['Goondiwindi East', 50]]);
  assert.equal(wheat.tons, 600);
  assert.deepEqual(g.map((c) => c.name), ['Barley', 'Chickpeas', 'Wheat']);
});
check('by grade: the PDF builds, and the sheet has the By grade switch', () => {
  assert.ok(stockPdf({ report, business: 'Farm', today: '19-11-2026', group: 'grade' }).length > 1000);
  const v = read('docs/js/views/stocklocation.js');
  assert.ok(v.includes("['grade', 'By grade']") && v.includes('stockByGrade(report)') && v.includes('group, rowTotals })'));
});

check('grades are in the order Settings lists them for the commodity: published order, the farm\'s own, then the rest, no grade last', () => {
  const wheat = gradeComparer('Wheat', ['Mill Special']);
  const sorted = ['', 'ASW1', 'Zebra', 'Mill Special', 'APW1', 'H2', 'APH1', 'AUH2', 'APH2', 'H1', 'Aardvark'].sort(wheat);
  assert.deepEqual(sorted, ['APH1', 'APH2', 'H1', 'H2', 'AUH2', 'APW1', 'ASW1', 'Mill Special', 'Aardvark', 'Zebra', '']);
  assert.deepEqual(['bar2', 'Malt 1', 'BAR1', 'Malt 2'].sort(gradeComparer('Barley')), ['Malt 1', 'Malt 2', 'BAR1', 'bar2']);
  const stock = stockByLocation({ storages: [{ id: 'o', name: 'Site', offFarm: { operator: 'X', opening: [{ commodityId: 'w', grade: 'APW1', tons: 5 }, { commodityId: 'w', grade: 'APH1', tons: 5 }, { commodityId: 'w', grade: 'H2', tons: 5 }] } }], movements: [], commodities: [{ id: 'w', name: 'Wheat' }] });
  assert.deepEqual(stock.locations[0].commodities[0].grades.map((g) => g.grade), ['APH1', 'H2', 'APW1']);
  assert.ok(read('docs/js/views/offfarm.js').includes('gradeComparer('), 'the Storage off-farm card sorts the same way');
});

check('Storage sorted by grade, and the load report\'s grade list, follow the order Settings lists the grades in', () => {
  const silos = [{ id: '1', name: 'Silo 1', grade: 'ASW1' }, { id: '2', name: 'Silo 2', grade: 'H2' }, { id: '3', name: 'Silo 3', grade: '' }, { id: '4', name: 'Silo 4', grade: 'APH1' }, { id: '5', name: 'Silo 5', grade: 'APW1' }];
  assert.deepEqual(sortStorages(silos, 'grade', () => ({}), commodities).map((x) => x.id), ['4', '2', '5', '1', '3']);
  const mv = (grade) => ({ grade, froms: [], tos: [] });
  const choices = loadFilterChoices([mv('H2'), mv('ASW1'), mv('APH1'), mv('APW1'), mv('h2')], { commodities });
  assert.deepEqual(choices.grades, ['APH1', 'H2', 'APW1', 'ASW1']);
  assert.deepEqual(['Z9', 'H2', 'BAR1', 'APH1'].sort(gradeSorter([{ name: 'Wheat' }, { name: 'Barley' }])), ['APH1', 'H2', 'BAR1', 'Z9']);
});

check('the grid has a row for each location, a column for each commodity and grade, and totals along the bottom', () => {
  const m = stockMatrix(report);
  assert.deepEqual(m.columns.map((c) => `${c.commodity} ${c.grade || 'No grade'}`), ['Barley No grade', 'Chickpeas No.1 Chickpea', 'Wheat H2', 'Wheat APW1']);
  assert.deepEqual(m.groups.map((g) => [g.commodity, g.span]), [['Barley', 1], ['Chickpeas', 1], ['Wheat', 2]]);
  assert.deepEqual(m.rows.map((r) => r.name), ['Silo A', 'Silo B', 'Goondiwindi East'], 'on farm first, then off farm');
  const wheatH2 = m.columns.find((c) => c.grade === 'H2').key;
  const apw = m.columns.find((c) => c.grade === 'APW1').key;
  assert.equal(m.rows[0].cells[apw], 300);
  assert.equal(m.rows[2].cells[wheatH2], 50);
  assert.equal(m.totals[wheatH2], 250);
  assert.equal(m.totals[apw], 350);
  assert.equal(m.grand, 750);
  assert.equal(m.rows[0].total, 500);
});
check('the commodity filter narrows every view: grid columns, location cards and totals', () => {
  const only = narrowed(report, 'all', { commodities }, ['w']);
  assert.deepEqual(only.locations.map((l) => l.name), ['Silo A', 'Goondiwindi East'], 'a location with none of it drops out');
  assert.equal(only.total.tons, 600);
  const m = stockMatrix(only);
  assert.deepEqual(m.columns.map((c) => c.grade), ['H2', 'APW1']);
  const off = narrowed(report, 'off', { commodities }, ['w']);
  assert.deepEqual(off.locations.map((l) => l.name), ['Goondiwindi East']);
  assert.equal(narrowed(report, 'all', { commodities }, []), report, 'no filter hands back the same report');
  assert.deepEqual(stockMatrix(report, { commodityIds: ['b'] }).columns.map((c) => c.commodity), ['Barley']);
});
check('the grid goes to Excel with a column for each commodity and grade, and to a PDF', () => {
  const sheet = matrixSheet(stockMatrix(report), { rowTotals: true });
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Location', 'On or off farm', 'Barley No grade', 'Chickpeas No.1 Chickpea', 'Wheat H2', 'Wheat APW1', 'Total']);
  assert.equal(sheet.rows[sheet.rows.length - 1].name, 'Total');
  assert.equal(sheet.columns[4].get(sheet.rows[0]), 200);
  assert.equal(sheet.columns[2].get(sheet.rows[0]), '', 'an empty cell is blank');
  assert.ok(stockPdf({ report, business: 'Farm', today: '19-11-2026', group: 'table', rowTotals: true }).length > 1000);
  const many = stockByLocation({ storages: [{ id: 's', name: 'Silo 1', kind: 'silo', commodityId: 'w' }], movements: ['H2', 'APW1', 'ASW1', 'APH1', 'H1'].flatMap((g, n) => [{ id: 'a' + n, date: '2026-11-0' + (n + 1), grade: g, commodityId: 'w', froms: [], tos: [{ type: 'silo', id: 's', tons: 10 }] }, { id: 'b' + n, date: '2026-11-1' + n, grade: g, commodityId: 'b', froms: [], tos: [{ type: 'silo', id: 's', tons: 5 }] }]), commodities });
  assert.ok(stockPdf({ report: many, group: 'table' }).length > 1000, 'more than eight columns: a table for each commodity');
  const v = read('docs/js/views/stocklocation.js');
  assert.ok(v.includes("['table', 'Grid']") && v.includes('gridHtml(stockMatrix(report), rowTotals)') && v.includes('id="sl-chips"') && v.includes('sl-rowtotals'));
});

check('the + on Storage offers Off farm too (owner and manager), opening the same form as Add a location', () => {
  const v = read('docs/js/views/storage.js');
  assert.ok(v.includes("import { paintOffFarmCard, openOffFarmSheet } from './offfarm.js"));
  assert.ok(v.includes('<button data-goto="offfarm">Off farm</button>') && v.includes("['owner', 'manager'].includes(db.getRole()) ? '<button data-goto=\"offfarm\""));
  assert.equal(v.split("if (btn.dataset.goto === 'offfarm') { closeSheet(); openOffFarmSheet(null); return; }").length - 1, 2, 'both the silo and the tally forms');
  assert.equal(v.split('offFarmChoice()').length - 1, 3, 'the silo form, the tally form and the function itself');
});

check('Storage can sort by Location: silos grouped under their farm or site, number order, none last', () => {
  assert.ok(SORTS.some((x) => x.id === 'location' && x.label === 'Location'));
  const silos = [{ id: 'a', name: 'Silo 2', property: 'Home' }, { id: 'b', name: 'Silo 1', property: 'Back block' }, { id: 'c', name: 'Silo 10' }, { id: 'd', name: 'Silo 1', property: 'Home' }];
  const sorted = sortStorages(silos, 'location');
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'd', 'a', 'c']);
  assert.equal(sortGroupLabel(silos[0], 'location'), 'Home');
  assert.equal(sortGroupLabel(silos[2], 'location'), 'No farm / site');
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures ? 1 : 0);
