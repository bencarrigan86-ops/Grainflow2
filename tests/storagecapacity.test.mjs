// Run with:
//   node tests/storagecapacity.test.mjs
//
// A storage's volume times the test weight of what is in it is the most it holds. The commodity's test weight is used unless one is
// set on the storage, and a storage with no volume keeps the tonnes typed on it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { testWeightInUse, capacityInfo, capacityTons, capacityFor, capacityLine } = await import(`../docs/js/storagecapacity.js?v=${stamp}`);
const { siloSpace } = await import(`../docs/js/harvest.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

const wheat = { id: 'w', name: 'Wheat', testWeight: 0.82 };
const canola = { id: 'c', name: 'Canola', testWeight: 0.67 };

check('the commodity\'s test weight is used unless one is set on the storage', () => {
  assert.deepEqual(testWeightInUse({}, wheat), { value: 0.82, source: 'commodity' });
  assert.deepEqual(testWeightInUse({ testWeight: 0.8 }, wheat), { value: 0.8, source: 'storage' });
  assert.deepEqual(testWeightInUse({ testWeight: 0 }, wheat), { value: 0.82, source: 'commodity' }, 'zero is not a figure');
  assert.deepEqual(testWeightInUse({}, null), { value: 0, source: 'none' });
});

check('volume times test weight is the capacity, and it moves with the commodity', () => {
  near(capacityTons({ volumeM3: 300 }, wheat), 246);
  near(capacityTons({ volumeM3: 300 }, canola), 201);
  near(capacityTons({ volumeM3: 300, testWeight: 0.75 }, wheat), 225);
  assert.equal(capacityInfo({ volumeM3: 300 }, wheat).source, 'volume');
});

check('with no volume the typed tonnes are used, as before; a volume wins over them', () => {
  assert.equal(capacityTons({ capacityTons: 155 }, wheat), 155);
  assert.equal(capacityInfo({ capacityTons: 155 }, wheat).source, 'typed');
  near(capacityTons({ capacityTons: 155, volumeM3: 300 }, wheat), 246);
});

check('a volume with nothing in the storage falls back to the typed tonnes, or to none', () => {
  assert.equal(capacityTons({ volumeM3: 300, capacityTons: 200 }, null), 200);
  assert.equal(capacityTons({ volumeM3: 300 }, null), 0);
  assert.equal(capacityInfo({ volumeM3: 300 }, null).source, 'none');
  assert.equal(capacityTons({}, wheat), 0);
  assert.equal(capacityTons(null, null), 0);
});

check('capacityFor finds the commodity from the list', () => {
  near(capacityFor({ volumeM3: 100, commodityId: 'c' }, [wheat, canola]), 67);
  assert.equal(capacityFor({ volumeM3: 100, commodityId: 'gone' }, [wheat, canola]), 0);
});

check('the line under the volume says what it comes to, and what is missing', () => {
  const fmt = (n, dp = 0) => n.toFixed(dp);
  assert.equal(capacityLine({}, wheat, fmt), '');
  assert.equal(capacityLine({ volumeM3: 300 }, wheat, fmt), '300 m³ × 0.820 t/m³ (Wheat\'s test weight) = 246 t when full');
  assert.ok(/this storage's test weight/.test(capacityLine({ volumeM3: 300, testWeight: 0.8 }, wheat, fmt)));
  assert.ok(/Pick the commodity/.test(capacityLine({ volumeM3: 300 }, null, fmt)));
});

check('room in the silos follows the volume and what is in each silo', () => {
  const commodities = [wheat, canola];
  const storages = [
    { id: 'a', name: 'Silo A', kind: 'silo', volumeM3: 300, commodityId: 'w', openingStock: 100 },
    { id: 'b', name: 'Silo B', kind: 'silo', volumeM3: 300, commodityId: 'c', openingStock: 100 },
    { id: 'c', name: 'Silo C', kind: 'silo', capacityTons: 155, commodityId: 'w', openingStock: 55 },
  ];
  const r = siloSpace(storages, [], { commodities });
  const room = (id) => r.silos.find((s) => s.id === id).room;
  near(room('a'), 146);
  near(room('b'), 101);
  near(room('c'), 100);
  // without the commodity list a volume has nothing to go on and is left out, named so it can be fixed
  assert.equal(siloSpace(storages.slice(0, 1), []).notCounted.length, 1);
});

check('it is wired: the form, the list, the picture, the harvest room, the export, the new season, the SQL', () => {
  const v = read('docs/js/views/storage.js');
  assert.ok(v.includes("id: 's-volume'") && v.includes('volumeM3: getNum(root, \'s-volume\') || null'), 'a volume field, and it is saved');
  assert.ok(v.includes('id="s-tw-line"') && v.includes('tw.placeholder'), 'the test weight in use is drawn into the storage');
  assert.ok(v.includes('capacityInfo(s, c || assume)') && v.includes('formCapacity(root, existing).tons'), 'list and picture follow it');
  assert.ok(read('docs/js/views/reports.js').includes('siloSpace(storages, movements, { minRoom, commodities, assume, scenario, season: scope ? pick : null })'));
  assert.ok(read('docs/js/views/settingsexport.js').includes("label: 'Volume (m³)'"));
  assert.ok(read('docs/js/storage.js').includes('volumeM3: s.volumeM3'), 'carried into the next season');
  assert.ok(read('docs/js/storage.js').includes('merged.__hasVolume = true'));
  const sql = read('supabase/migrations/20261118900000_storage_volume.sql');
  assert.ok(sql.includes('add column if not exists volume_m3') && sql.includes('storages_volume_check'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists volume_m3'));
});

check('the load quality section on a ticket is a panel, and its closed header says what was recorded', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes('<details class="fold feature" id="lq-fold"'), 'the same panel the storage measurements use');
  assert.ok(mv.includes('id="lq-sub"') && mv.includes('paintLqSub'), 'the header follows what is typed');
  assert.ok(mv.includes('Not recorded yet'), 'and says so when nothing is recorded');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
