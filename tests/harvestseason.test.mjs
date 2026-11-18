// Run with:
//   node tests/harvestseason.test.mjs
//
// Harvest progress by season: winter crops and summer crops are cut months apart, so the report reads each apart as well as the whole
// farm. And empty silos with a volume but no commodity are worked out as a chosen commodity, on the storage tab and the harvest report.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { harvestSeasonOf, autoSeasonText } = await import(`../docs/js/harvestseason.js?v=${stamp}`);
const { harvestReport, siloSpace } = await import(`../docs/js/harvest.js?v=${stamp}`);
const { assumedCommodity, assumableCommodities, wantsCommodity } = await import(`../docs/js/storagecapacity.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

check('a commodity is winter, summer or other by its name, and a name that is both is not guessed', () => {
  for (const n of ['Wheat', 'Barley (Feed)', 'Canola', 'Chickpeas', 'Faba Beans', 'Field Peas', 'Lentils', 'Oats']) assert.equal(harvestSeasonOf(n), 'winter', n);
  for (const n of ['Sorghum', 'Cottonseed', 'Maize', 'Mungbeans', 'Sunflowers', 'Peanuts']) assert.equal(harvestSeasonOf(n), 'summer', n);
  for (const n of ['Hay', 'Safflower', '', null]) assert.equal(harvestSeasonOf(n), 'other', String(n));
  assert.equal(harvestSeasonOf('Fallow'), 'fallow', 'no crop to cut: in none of the seasons');
  assert.equal(harvestSeasonOf({ name: 'Sorghum' }), 'summer', 'a commodity record works too');
  assert.equal(harvestSeasonOf('Wheat and sorghum mix'), 'other');
});

check('the report reads the winter crops apart: 95% of the winter crops can be 80% of everything', () => {
  const commodities = [{ id: 'w', name: 'Wheat' }, { id: 's', name: 'Sorghum' }, { id: 'f', name: 'Fallow' }];
  const fields = [
    { id: 'f1', name: 'North', areaHa: 100, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 4, harvestDone: true },
    { id: 'f2', name: 'South', areaHa: 100, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 4 },
    { id: 'f3', name: 'East', areaHa: 100, commodityId: 's', yieldMode: 'estimate', yieldTHa: 6 },
    { id: 'f4', name: 'Rest', areaHa: 50, commodityId: 'f', yieldMode: 'estimate', yieldTHa: 0 },
  ];
  const movements = [
    { id: 'm1', froms: [{ type: 'field', id: 'f1', tons: 400 }], tons: 400 },
    { id: 'm2', froms: [{ type: 'field', id: 'f2', tons: 380 }], tons: 380 },
  ];
  const r = harvestReport(commodities, fields, movements);
  const winter = r.seasons.find((s) => s.key === 'winter');
  const summer = r.seasons.find((s) => s.key === 'summer');
  assert.deepEqual(r.seasons.map((s) => s.key), ['winter', 'summer'], 'fallow is in neither, and there is no "other" with nothing in it');
  assert.deepEqual(winter.names, ['Wheat']);
  near(winter.totals.pct, 780 / 800);
  assert.equal(summer.totals.pct, 0);
  assert.ok(winter.totals.pct > r.farm.pct, 'the winter crops are further on than the whole farm');
});

check('with crops in one season only there is nothing to split, and a commodity the list does not know is "other"', () => {
  const only = harvestReport([{ id: 'w', name: 'Wheat' }], [{ id: 'f1', name: 'A', areaHa: 10, commodityId: 'w', yieldTHa: 3 }], []);
  assert.equal(only.seasons.length, 1);
  const mixed = harvestReport([{ id: 'w', name: 'Wheat' }, { id: 'h', name: 'Hay' }], [
    { id: 'f1', name: 'A', areaHa: 10, commodityId: 'w', yieldTHa: 3 }, { id: 'f2', name: 'B', areaHa: 10, commodityId: 'h', yieldTHa: 3 }], []);
  assert.deepEqual(mixed.seasons.map((s) => s.key), ['winter', 'other']);
});

check('a season chosen on the commodity wins over its name; blank goes by the name', () => {
  assert.equal(harvestSeasonOf({ name: 'Safflower', harvestSeason: 'winter' }), 'winter');
  assert.equal(harvestSeasonOf({ name: 'Wheat', harvestSeason: 'summer' }), 'summer', 'a summer-sown wheat, say');
  assert.equal(harvestSeasonOf({ name: 'Wheat', harvestSeason: '' }), 'winter');
  assert.equal(harvestSeasonOf({ name: 'Wheat', harvestSeason: null }), 'winter');
  assert.equal(harvestSeasonOf({ name: 'Wheat', harvestSeason: 'nonsense' }), 'winter', 'only winter or summer count as a choice');
  assert.equal(autoSeasonText('Sorghum'), 'summer crop');
  assert.equal(autoSeasonText('Hay'), 'not sorted: shown as Other');
  assert.equal(autoSeasonText(''), 'from its name');
});

check('the report follows the choice made on a commodity', () => {
  const commodities = [{ id: 'h', name: 'Hay', harvestSeason: 'summer' }, { id: 'w', name: 'Wheat' }];
  const fields = [
    { id: 'f1', name: 'A', areaHa: 10, commodityId: 'h', yieldTHa: 3 },
    { id: 'f2', name: 'B', areaHa: 10, commodityId: 'w', yieldTHa: 3 },
  ];
  const r = harvestReport(commodities, fields, []);
  assert.deepEqual(r.seasons.map((s) => s.key), ['winter', 'summer']);
  assert.deepEqual(r.seasons.find((s) => s.key === 'summer').names, ['Hay']);
});

check('it is wired: the commodity form, the save, the new season, and the SQL', () => {
  const se = read('docs/js/views/settings.js');
  assert.ok(se.includes("id: 'harvestSeason'") && se.includes("harvestSeason: getVal(root, 'harvestSeason') || null"));
  assert.ok(se.includes('autoSeasonText(getVal(root, \'name\'))'), 'the automatic option says what it comes to');
  const stg = read('docs/js/storage.js');
  assert.ok(stg.includes('merged.__hasHarvestSeason = true') && stg.includes('harvestSeason: c.harvestSeason'), 'kept when going back to automatic; carried to the next season');
  const sql = read('supabase/migrations/20261118950000_harvest_season.sql');
  assert.ok(sql.includes('add column if not exists harvest_season') && sql.includes("in ('winter', 'summer')"));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists harvest_season'));
});

const wheat = { id: 'w', name: 'Wheat', testWeight: 0.82 };
const canola = { id: 'c', name: 'Canola', testWeight: 0.67 };

check('which commodity an empty silo is worked out as: the one picked, else the first with a test weight', () => {
  assert.equal(assumedCommodity([wheat, canola], 'Canola').name, 'Canola');
  assert.equal(assumedCommodity([wheat, canola], '').name, 'Wheat');
  assert.equal(assumedCommodity([wheat, canola], 'Gone').name, 'Wheat', 'a pick that is no longer there is not kept');
  assert.equal(assumedCommodity([{ id: 'x', name: 'Fallow', testWeight: 0 }], ''), null);
  assert.equal(wantsCommodity({ volumeM3: 300 }), true);
  assert.equal(wantsCommodity({ volumeM3: 300, commodityId: 'w' }), false);
  assert.equal(wantsCommodity({ volumeM3: 300, testWeight: 0.8 }), false, 'it has a test weight of its own');
  assert.equal(wantsCommodity({ capacityTons: 100 }), false, 'typed tonnes need no commodity');
});

check('an empty silo with a volume and no commodity is counted as the commodity chosen; without a choice it is named, not silently left out', () => {
  const storages = [
    { id: 'a', name: 'Silo A', kind: 'silo', volumeM3: 300 },
    { id: 'b', name: 'Silo B', kind: 'silo', volumeM3: 300, commodityId: 'c', openingStock: 0 },
    { id: 'c', name: 'Silo C', kind: 'silo', capacityTons: 155 },
  ];
  const as = siloSpace(storages, [], { commodities: [wheat, canola], assume: wheat });
  const row = (id) => as.silos.find((s) => s.id === id);
  near(row('a').room, 246); assert.equal(row('a').assumed, true);
  near(row('b').room, 201); assert.equal(row('b').assumed, false, 'it has a commodity of its own');
  assert.equal(row('c').assumed, false, 'typed tonnes need no commodity');
  assert.equal(as.needsCommodity, 1);
  assert.equal(as.assumeName, 'Wheat');
  const canolaOnes = siloSpace(storages, [], { commodities: [wheat, canola], assume: canola });
  near(canolaOnes.silos.find((s) => s.id === 'a').room, 201);
  const none = siloSpace(storages, [], { commodities: [wheat, canola] });
  assert.ok(none.notCounted.some((x) => /Silo A.*volume but no commodity/.test(x)), none.notCounted.join(' | '));
  assert.equal(none.needsCommodity, 1);
});

check('a silo already holding grain is not worked out as a guess: it needs its commodity set', () => {
  const storages = [{ id: 'a', name: 'Silo A', kind: 'silo', volumeM3: 300, openingStock: 50 }];
  const r = siloSpace(storages, [], { commodities: [wheat], assume: wheat });
  assert.equal(r.silos.length, 0);
  assert.ok(r.notCounted.some((x) => /no capacity set|volume but no commodity/.test(x)));
});

check('a what-if works every empty silo with a volume out as the crop picked, whatever it last held, and leaves the full ones alone', () => {
  const storages = [
    { id: 'a', name: 'Silo A', kind: 'silo', volumeM3: 300 },
    { id: 'b', name: 'Silo B', kind: 'silo', volumeM3: 300, commodityId: 'w', openingStock: 0 },
    { id: 'c', name: 'Silo C', kind: 'silo', volumeM3: 300, commodityId: 'w', testWeight: 0.5, openingStock: 0 },
    { id: 'd', name: 'Silo D', kind: 'silo', volumeM3: 300, commodityId: 'w', openingStock: 100 },
  ];
  const base = siloSpace(storages, [], { commodities: [wheat, canola], assume: wheat });
  const trial = siloSpace(storages, [], { commodities: [wheat, canola], assume: wheat, scenario: canola });
  const row = (r, id) => r.silos.find((s) => s.id === id);
  near(row(base, 'b').room, 246); assert.equal(row(base, 'b').assumed, false, 'as set: wheat, its own');
  for (const id of ['a', 'b', 'c']) { near(row(trial, id).room, 201); assert.equal(row(trial, id).assumed, true, id); }
  near(row(trial, 'd').room, 246 - 100, 'a silo holding grain is not an empty one, so it keeps its own crop');
  assert.equal(trial.assumeName, 'Canola');
  assert.equal(trial.emptyWithVolume, 3, 'the report offers the choice whenever an empty silo has a volume');
  assert.equal(base.emptyWithVolume, 3);
  assert.ok(trial.emptyRoom < base.emptyRoom, 'canola is lighter than wheat, so the same silos hold less');
});

check('it is wired: the harvest report, its PDF, and the storage tab', () => {
  const rp = read('docs/js/views/reports.js');
  assert.ok(rp.includes('siloSpace(storages, movements, { minRoom, commodities, assume, scenario, season: scope ? pick : null })') && rp.includes('id="space-as"'));
  assert.ok(rp.includes('saveSpaceAs(e.target.value, e.target.dataset.season)'), 'the pick is remembered');
  assert.equal(rp.split('${seasonBlock(').length - 1, 2, 'the season block is in both layouts');
  assert.equal(rp.split('${roomSummaryHtml({').length - 1, 2, 'so is the room summary, with the picker in it');
  assert.equal(rp.split('${spaceAsRow(space, assumeOptions, assume, pick, picked)').length - 1, 1);
  const pdf = read('docs/js/harvestpdf.js');
  assert.ok(pdf.includes('seasons.length > 1') && pdf.includes('space.assumeName'));
  const st = read('docs/js/views/storage.js');
  assert.ok(st.includes('id="storage-assume-sel"') && st.includes('assumedCommodity(commodities, loadSpaceAs())'));
  assert.ok(st.includes('t spare'), 'the row says how many tonnes are spare');
});

check('looking at one season: its own paddocks, and the room for its own crops (empty silos count in either)', () => {
  const sorghum = { id: 's', name: 'Sorghum', testWeight: 0.77 };
  const commodities = [wheat, canola, sorghum];
  const fields = [
    { id: 'f1', name: 'A', areaHa: 100, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 4 },
    { id: 'f2', name: 'B', areaHa: 100, commodityId: 's', yieldMode: 'estimate', yieldTHa: 6 },
  ];
  const r = harvestReport(commodities, fields, []);
  assert.deepEqual(r.seasons.find((s) => s.key === 'winter').ids, ['w']);
  assert.deepEqual(r.seasons.find((s) => s.key === 'summer').ids, ['s']);
  const storages = [
    { id: 'a', name: 'Wheat silo', kind: 'silo', capacityTons: 200, commodityId: 'w', openingStock: 150 },
    { id: 'b', name: 'Sorghum silo', kind: 'silo', capacityTons: 300, commodityId: 's', openingStock: 100 },
    { id: 'c', name: 'Empty silo', kind: 'silo', capacityTons: 120 },
    { id: 'd', name: 'Emptied sorghum silo', kind: 'silo', capacityTons: 80, commodityId: 's', openingStock: 0 },
  ];
  const room = (season) => siloSpace(storages, [], { commodities, season });
  const both = room(null);
  const winter = room('winter');
  const summer = room('summer');
  near(both.totalRoom, 50 + 200 + 120 + 80);
  near(winter.totalRoom, 50 + 120 + 80, 'the sorghum silo holding grain is not room for wheat');
  near(summer.totalRoom, 200 + 120 + 80, 'the wheat silo holding grain is not room for sorghum');
  assert.ok(!winter.silos.some((s) => s.id === 'b') && !summer.silos.some((s) => s.id === 'a'));
  assert.ok(winter.silos.some((s) => s.id === 'c') && summer.silos.some((s) => s.id === 'c'), 'an empty silo is counted in each season\'s view');
  assert.ok(winter.silos.some((s) => s.id === 'd'), 'a silo that held sorghum but is empty now takes wheat');
  // the plan: what is left to come against the room for it
  const w = r.seasons.find((s) => s.key === 'winter').totals;
  near(w.toComeT, 400);
  assert.equal(Math.round(winter.totalRoom - w.toComeT), 0 + (50 + 120 + 80) - 400);
});

check('the empty-silo commodity offered follows the season, and is remembered for each', () => {
  const sorghum = { id: 's', name: 'Sorghum', testWeight: 0.77 };
  const list = [wheat, canola, sorghum];
  assert.deepEqual(assumableCommodities(list, 'winter').map((c) => c.name), ['Wheat', 'Canola']);
  assert.deepEqual(assumableCommodities(list, 'summer').map((c) => c.name), ['Sorghum']);
  assert.equal(assumableCommodities(list, null).length, 3);
  assert.equal(assumedCommodity(list, '', 'summer').name, 'Sorghum', 'a summer view does not start on wheat');
  assert.equal(assumedCommodity(list, 'Sorghum', 'winter').name, 'Wheat', 'a pick from the other season is not kept');
  assert.deepEqual(assumableCommodities([wheat], 'summer').map((c) => c.name), ['Wheat'], 'with none of that season, all are offered rather than none');
});

check('it is wired: the selector, the figures it scopes, the PDF, and what is remembered', () => {
  const rp = read('docs/js/views/reports.js');
  assert.ok(rp.includes('data-hs="${o.key}"') && rp.includes('saveHarvestView(b.dataset.hs)'), 'a Winter / Summer / Both selector, remembered');
  assert.ok(rp.includes('const farm = scope ? scope.totals : all.farm;') && rp.includes("season: scope ? pick : null"), 'the figures and the room follow it');
  assert.equal(rp.split('${scopeNote}').length - 1, 2, 'both layouts say which silos are left out');
  assert.ok(rp.includes('seasons: scope ? [] : seasons, scopeLabel: scope ? scope.label'), 'the PDF follows it too');
  assert.ok(read('docs/js/harvestpdf.js').includes("report.heading(scopeLabel || 'Whole farm')"));
  const sp = read('docs/js/spacefor.js');
  assert.ok(sp.includes('grainflow.harvestView') && sp.includes('`${KEY}.${season}`'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
