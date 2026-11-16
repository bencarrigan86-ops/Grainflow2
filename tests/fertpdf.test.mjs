// Run with:
//   node tests/fertpdf.test.mjs
//
// The Fert report as a PDF: a real landscape PDF with each commodity's urea table and the starter fertiliser, figures that
// are the screen's own (fertfigures.js), nitrogen and urea-equivalent columns coloured, and the screen wired to share it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fertPdf, UREA_COLUMNS, STARTER_COLUMNS, hasStarter } from '../docs/js/fertpdf.js';
import { ureaFigures, starterFigures } from '../docs/js/fertfigures.js';
import { groupFieldsByCommodity, fieldUrea, soilNUreaEquivalent } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const commodities = [
  { id: 'w', name: 'Wheat', nPerTonne: 40, targetYieldTHa: 4 },
  { id: 'c', name: 'Canola', nPerTonne: 60, targetYieldTHa: 2 },
];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', soilTestNKgHa: 46, ureaRequiredKgHa: 200, ureaAppliedKgHa: 100, starterRequiredKgHa: 50, starterAppliedKgHa: 20 },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'w', soilTestNKgHa: 23, ureaRequiredKgHa: 150, ureaAppliedKgHa: 0, starterRequiredKgHa: 50, starterAppliedKgHa: 0 },
  { id: 'f3', name: 'Back', areaHa: 50, commodityId: 'c', soilTestNKgHa: 0, ureaRequiredKgHa: 120, ureaAppliedKgHa: 120 },
];
const groups = groupFieldsByCommodity(commodities, fields, []);
const data = () => ({
  urea: groups.map((g) => ureaFigures(g, commodities.find((c) => c.id === g.id))),
  starter: groups.map((g) => starterFigures(g)),
});
const build = (d = data(), o = { business: 'Test Farm', season: '2026', today: '16-11-2026' }) => text(fertPdf(d, o));

check('the figures: per paddock, and the total row weighted by area', () => {
  const wheat = ureaFigures(groups.find((g) => g.name === 'Wheat'), commodities[0]);
  const north = wheat.rows.find((r) => r.name === 'North');
  assert.equal(north.soilEquiv, soilNUreaEquivalent(46));
  assert.equal(north.req, 200); assert.equal(north.app, 100);
  assert.equal(north.reqT, fieldUrea(fields[0]).requiredTons);
  assert.equal(north.left, 100);
  assert.equal(wheat.total.area, 300);
  assert.equal(wheat.total.reqT, 40 + 15);                         // 200 ha x 200 kg + 100 ha x 150 kg
  assert.ok(Math.abs(wheat.total.req - (55 * 1000) / 300) < 1e-9, 'total req kg/ha is not tonnes over area');
  assert.equal(wheat.total.soilN, (46 + 23) / 2, 'soil N is a plain mean, as on the screen');
});

check('the starter figures: required, applied, left', () => {
  const w = starterFigures(groups.find((g) => g.name === 'Wheat'));
  assert.equal(w.total.reqT, 15);                                   // 300 ha x 50 kg
  assert.equal(w.total.appT, 4);
  assert.equal(w.total.leftT, 11);
  assert.equal(w.rows.find((r) => r.name === 'North').left, 30);
});

check('it is a PDF, landscape A4, with the title, farm, season and day', () => {
  const s = build();
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 841.89 595.28]'), 'not landscape');
  for (const w of ['FERTILISER', 'Test Farm', '(2026)', 'Printed 16-11-2026']) assert.ok(s.includes(w), `missing ${w}`);
});

check('each commodity has its table and every paddock is on it with its figures', () => {
  const s = build();
  for (const w of ['(Urea)', '(Wheat)', '(Canola)', '(North)', '(South)', '(Back)', '(Total)', '(200)', '(40.00)', '(15.00)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('the headings carry their units on a second line, and nitrogen and urea equivalent are coloured, with a key', () => {
  const s = build();
  assert.ok(s.includes('(Soil N)') && s.includes('(Soil equiv)') && s.includes('(kg/ha)'));
  assert.ok(s.includes('0.66 0.35 0.04 rg'), 'no amber for nitrogen');
  assert.ok(s.includes('0.18 0.49 0.2 rg'), 'no green for urea equivalent');
  assert.ok(s.includes('(Nitrogen \\(N\\))') && s.includes('Urea equivalent \\(N'), 'no key');
  const kinds = UREA_COLUMNS.map((c) => c.kind || '-').join('');
  assert.equal(kinds, '--nu-uuuuuun-', kinds);
});

check('the urea columns are the screen\'s 13, in its order, and add up to the page width', () => {
  assert.equal(UREA_COLUMNS.length, 13);
  assert.deepEqual(UREA_COLUMNS.map((c) => c.head[0]), ['Field', 'Area', 'Soil N', 'Soil equiv', 'Target', 'Req', 'App', 'Left', 'Req', 'App', 'Left', 'N avail', 'Max']);
  assert.ok(Math.abs(UREA_COLUMNS.reduce((a, c) => a + c.w, 0) - 1) < 0.0005, 'urea columns do not add up');
  assert.ok(Math.abs(STARTER_COLUMNS.reduce((a, c) => a + c.w, 0) - 1) < 0.0005, 'starter columns do not add up');
});

check('starter fertiliser is on the page only for the commodities that have some', () => {
  const d = data();
  assert.ok(hasStarter(d.starter.find((f) => f.name === 'Wheat')) && !hasStarter(d.starter.find((f) => f.name === 'Canola')));
  const s = build(d);
  assert.ok(s.includes('(Starter fertiliser)'));
  assert.equal((s.match(/\(Canola\)/g) || []).length, 1, 'canola has a starter table with nothing in it');
  const none = build({ urea: d.urea, starter: d.starter.filter((f) => f.name === 'Canola') });
  assert.ok(!none.includes('(Starter fertiliser)'), 'an empty starter section is shown');
});

check('nothing planned gives a page that says so', () => {
  const s = build({ urea: [], starter: [] });
  assert.ok(s.startsWith('%PDF-1.4') && s.includes('Nothing to report yet'));
});

check('a long list runs on to more pages, each with the heading band and the table head again', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, name: `Paddock ${i}`, areaHa: 100, commodityId: 'w', soilTestNKgHa: 30, ureaRequiredKgHa: 100, ureaAppliedKgHa: 10 }));
  const g = groupFieldsByCommodity(commodities, many, []);
  const s = build({ urea: g.map((x) => ureaFigures(x, commodities[0])), starter: [] });
  const pages = (s.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 3, `only ${pages} pages`);
  assert.equal((s.match(/\(FERTILISER\)/g) || []).length, pages, 'a page has no heading band');
  assert.ok((s.match(/\(Soil equiv\)/g) || []).length >= pages, 'a page has no table head');
  assert.ok(s.includes('(Wheat \\(continued\\))'), 'a table that runs on is not marked');
});

check('the screen shares its tables\' own figures, and offers the PDF', () => {
  const v = read('docs/js/views/reports.js');
  assert.ok(v.includes('ureaFigures(g, commodity)') && v.includes('starterFigures(g)'), 'the tables do not use the shared figures');
  assert.ok(v.includes('id="fert-pdf"') && v.includes('fertPdf(') && v.includes('sharePdf(') && v.includes('downloadFile('), 'the PDF button is not wired');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
