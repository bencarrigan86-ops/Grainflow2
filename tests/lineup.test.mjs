// Run with:
//   node tests/lineup.test.mjs
//
// Lining paddock names up across seasons: reading the list, renaming, splitting, joining, and what is left alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLineup, lineupGroups, lineupSeason, planLineup, scopeLabels, copyOutlines, groupsForSeason } from '../docs/js/lineup.js';
import { rotationGrid } from '../docs/js/fieldhistory.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0;
const makeId = () => `new${++n}`;
const fld = (id, name, ha, extra = {}) => ({ id, name, areaHa: ha, commodityId: 'w', yieldTHa: 3, yieldMode: 'recorded', ...extra });
const load = (id, fieldId) => ({ id, froms: [{ type: 'field', id: fieldId, tons: 10 }], tos: [] });

console.log('\n=== reading the list ===');
check('rows are read with farm, share and seasons, and other heading names work', () => {
  const { rules, errors } = parseLineup('Old name,New name,Farm,Share (%),Seasons\nSR13,S13/14,,,\nSR20,S20-21,Mylora,40,2020-2024\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(rules[1], { line: 3, from: 'SR20', to: 'S20-21', farm: 'Mylora', share: 40, seasons: '2020-2024' });
  assert.equal(parseLineup('from;to\nA;B').rules.length, 1);
});
check('a missing heading, half a row and a share that is not a percentage are said plainly', () => {
  assert.match(parseLineup('Old name\nA').errors[0], /Old name and New name/);
  const r = parseLineup('Old name,New name,Share (%)\nA,,\nB,C,150');
  assert.equal(r.rules.length, 0);
  assert.equal(r.errors.length, 2);
});
check('seasons: a range, a list, or nothing', () => {
  const labels = ['2019', '2020', '2021', '2022', '2025', 'Sample'];
  assert.deepEqual([...scopeLabels('2020-2022', labels)], ['2020', '2021', '2022']);
  assert.deepEqual([...scopeLabels('2019, 2025', labels)], ['2019', '2025']);
  assert.equal(scopeLabels('', labels), null);
});
check('shares: given ones must add up, and without them the split follows the areas the new paddocks have now', () => {
  const now = [{ name: 'A3-4', areaHa: 200 }, { name: 'A4', areaHa: 50 }];
  const { groups, errors } = lineupGroups(parseLineup('Old name,New name\nA3/4,A3-4\nA3/4,A4').rules, now);
  assert.deepEqual(errors, []);
  assert.deepEqual(groups[0].targets.map((t) => Math.round(t.fraction * 100)), [80, 20]);
  assert.match(lineupGroups(parseLineup('Old name,New name,Share (%)\nX,A,60\nX,B,60').rules).errors[0], /add up to 120%/);
  assert.match(lineupGroups(parseLineup('Old name,New name,Share (%)\nX,A,60\nX,B,').rules).errors[0], /every new name/);
});

console.log('\n=== what a season becomes ===');
const groupsOf = (csv, now = []) => lineupGroups(parseLineup(csv).rules, now).groups;
check('one old name to one new name renames the paddock, keeping its record, and sets the farm when given', () => {
  const s = { fields: [fld('a', 'SR5/6', 140, { property: 'Sunnyridge' }), fld('b', 'Other', 10)], movements: [] };
  const r = lineupSeason(s, groupsOf('Old name,New name,Farm\nsr5/6,S5/6,Mylora'), makeId);
  assert.deepEqual(r.fields.map((f) => f.name), ['S5/6', 'Other']);
  assert.equal(r.fields[0].id, 'a'); assert.equal(r.fields[0].property, 'Mylora');
  assert.deepEqual(r.touched, ['a']);
  assert.equal(s.fields[0].name, 'SR5/6', 'what was passed in is not changed');
});
check('one old name to several splits the hectares, and they still add up', () => {
  const s = { fields: [fld('a', 'A3/4', 230)], movements: [] };
  const r = lineupSeason(s, groupsOf('Old name,New name\nA3/4,A3-4\nA3/4,A4', [{ name: 'A3-4', areaHa: 203.18 }, { name: 'A4', areaHa: 31.01 }]), makeId);
  assert.deepEqual(r.fields.map((f) => f.name), ['A3-4', 'A4']);
  assert.equal(Math.round((r.fields[0].areaHa + r.fields[1].areaHa) * 100) / 100, 230);
  assert.equal(r.fields[0].id, 'a'); assert.notEqual(r.fields[1].id, 'a');
  assert.equal(r.fields[1].boundary, null);
});
check('several old names to one joins them: area and tonnes add up, loads follow, the other record goes', () => {
  const s = { fields: [fld('a', 'SR13', 166, { yieldTHa: 2 }), fld('b', 'SR14', 102, { yieldTHa: 3 })], movements: [load('m1', 'b')] };
  const r = lineupSeason(s, groupsOf('Old name,New name\nSR13,S13/14\nSR14,S13/14'), makeId);
  assert.equal(r.fields.length, 1);
  assert.equal(r.fields[0].name, 'S13/14'); assert.equal(r.fields[0].id, 'a');
  assert.equal(r.fields[0].areaHa, 268);
  assert.ok(Math.abs(r.fields[0].areaHa * r.fields[0].yieldTHa - (166 * 2 + 102 * 3)) < 0.01);
  assert.deepEqual(r.removed.map((x) => [x.dropId, x.keepId]), [['b', 'a']]);
  assert.equal(r.movements[0].froms[0].id, 'a'); assert.deepEqual(r.movementsTouched, ['m1']);
  assert.equal(r.joined[0].mixed, false);
});
check('a paddock with loads is never split: it stays whole under the first new name, and is said to', () => {
  const s = { fields: [fld('a', 'SR1-3', 204)], movements: [load('m1', 'a')] };
  const r = lineupSeason(s, groupsOf('Old name,New name\nSR1-3,S1-3\nSR1-3,S 1a'), makeId);
  assert.deepEqual(r.fields.map((f) => [f.name, f.areaHa]), [['S1-3', 204]]);
  assert.match(r.skipped[0].why, /kept whole as S1-3/);
  assert.equal(r.split.length, 0);
});
check('joining onto a paddock already there merges them, and two crops are flagged', () => {
  const s = { fields: [fld('a', 'B3', 104.8, { commodityId: 'c' }), fld('b', 'B3A', 91, { commodityId: 'f' })], movements: [] };
  const r = lineupSeason(s, groupsOf('Old name,New name\nB3A,B3'), makeId);
  assert.equal(r.fields.length, 1);
  assert.equal(r.fields[0].areaHa, 195.8); assert.equal(r.fields[0].commodityId, 'c');
  assert.equal(r.joined[0].mixed, true);
});
check('running the list again changes nothing, including for a paddock that was split and keeps its old name', () => {
  const groups = groupsOf('Old name,New name\nA1,A1\nA1,A1a\nSR5,S5', [{ name: 'A1', areaHa: 90 }, { name: 'A1a', areaHa: 10 }]);
  const once = lineupSeason({ fields: [fld('a', 'A1', 100), fld('b', 'SR5', 50)], movements: [] }, groups, makeId);
  assert.deepEqual(once.fields.map((f) => [f.name, f.areaHa]), [['A1', 90], ['A1a', 10], ['S5', 50]]);
  const twice = lineupSeason({ fields: once.fields, movements: [] }, groups, makeId);
  assert.deepEqual(twice.fields.map((f) => [f.name, f.areaHa]), [['A1', 90], ['A1a', 10], ['S5', 50]]);
  assert.equal(twice.renamed.length + twice.split.length + twice.joined.length, 0);
});

console.log('\n=== across seasons ===');
const seasons = [
  { label: '2022', fields: [fld('a22', 'SR5/6', 140), fld('x22', 'A1', 100)], movements: [], commodities: [] },
  { label: '2025', fields: [fld('a25', 'SR5/6', 140), fld('x25', 'A1', 100)], movements: [load('m', 'x25')], commodities: [] },
  { label: '2026', fields: [fld('a26', 'S5/6', 142), fld('x26', 'A1', 90), fld('y26', 'A1a', 10)], movements: [], commodities: [] },
];
const RULES = 'Old name,New name,Seasons\nSR5/6,S5/6,\nA1,A1,2020-2025\nA1,A1a,2020-2025\n';
check('the current season is left alone unless a rule names it, and the preview says what each season would do', () => {
  const plan = planLineup(parseLineup(RULES).rules, seasons, '2026', seasons[2].fields);
  assert.deepEqual(plan.seasons.map((s) => s.label), ['2022', '2025']);
  assert.equal(plan.seasons[0].renamed.length, 1); assert.equal(plan.seasons[0].split.length, 1);
  assert.match(plan.seasons[1].skipped[0].why, /loads/);
  assert.deepEqual(plan.unused, []); assert.deepEqual(plan.notNow, []);
  assert.deepEqual(groupsForSeason(plan.groups, '2026', seasons.map((s) => s.label), '2026').map((g) => g.from), []);
});
check('the names to line up are named when they are not found, or are not paddocks now', () => {
  const plan = planLineup(parseLineup('Old name,New name\nNowhere,S5/6\nSR5/6,Mystery').rules, seasons, '2026', seasons[2].fields);
  assert.deepEqual(plan.unused, ['Nowhere']);
  assert.deepEqual(plan.notNow, ['Mystery']);
});
check('after lining up, the rotation history shows the paddock once across the seasons', () => {
  const groups = lineupGroups(parseLineup(RULES).rules, seasons[2].fields).groups;
  const years = {};
  for (const s of seasons) years[s.label] = { commodities: [{ id: 'w', name: 'Wheat' }], movements: [], fields: lineupSeason(s, groupsForSeason(groups, s.label, ['2022', '2025', '2026'], '2026'), makeId).fields };
  const grid = rotationGrid(years);
  const row = grid.rows.find((r) => r.name === 'S5/6');
  assert.deepEqual(Object.keys(row.cells), ['2022', '2025', '2026']);
  assert.equal(grid.rows.some((r) => r.name === 'SR5/6'), false);
});

console.log('\n=== the farm map for earlier seasons ===');
check('a paddock takes the outline and farm of the same-named paddock now, only where it has none', () => {
  const now = [fld('n1', 'S5/6', 142, { boundary: [[1, 2]], property: 'Sunnyridge' }), fld('n2', 'S7/8', 100)];
  const r = copyOutlines([fld('a', 'S5/6', 140), fld('b', 'S7/8', 100), fld('c', 'S5/6', 1, { boundary: [[9, 9]] }), fld('d', 'Gone', 5)], now);
  assert.deepEqual(r.touched, ['a']);
  assert.deepEqual(r.fields[0].boundary, [[1, 2]]); assert.equal(r.fields[0].property, 'Sunnyridge');
  assert.deepEqual(r.fields[2].boundary, [[9, 9]], 'an outline already there is kept');
});

console.log('\n=== the screen ===');
check('Settings offers it, and the db sends what it changed', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes('id="line-up"') && s.includes('openLineupSheet()'));
  const v = read('docs/js/views/lineup.js');
  assert.ok(v.includes('planLineup(') && v.includes('db.applyLineup(') && v.includes('db.copyMapToOtherSeasons('));
  const st = read('docs/js/storage.js');
  assert.ok(/applyLineup\(rules\)[\s\S]*?touch\('field', id\)[\s\S]*?tombstone\('fields', x\.dropId\)[\s\S]*?persist\(\)/.test(st));
  assert.ok(/copyMapToOtherSeasons\(\)[\s\S]*?label === data\.currentYear\) continue/.test(st));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
