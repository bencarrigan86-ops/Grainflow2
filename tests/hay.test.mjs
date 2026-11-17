// Run with:
//   node tests/hay.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BALE_TYPES, cleanHay, hasHay, isHay, balesToTons, describeBaleSetting, cleanBaled, hasHayLoad, baledTotals, avgBaleKg, describeBales } from '../docs/js/hay.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('a hay commodity has a bale type and an average bale weight; a grain commodity has neither', () => {
  assert.deepEqual(BALE_TYPES.map((b) => b.value), ['round', 'large', 'small']);
  assert.deepEqual(cleanHay({ baleType: 'round', baleKg: '500' }), { baleType: 'round', baleKg: 500 });
  assert.deepEqual(cleanHay({ baleType: 'cube', baleKg: 20 }), { baleType: '', baleKg: 20 }, 'an unknown kind of bale is dropped');
  assert.equal(cleanHay(null), null);
  assert.equal(hasHay({ baleType: 'small', baleKg: 0 }), true);
  assert.equal(hasHay({ baleType: '', baleKg: 0 }), false);
  assert.equal(isHay({ name: 'Lucerne', hay: { baleType: 'round', baleKg: 500 } }), true);
  assert.equal(isHay({ name: 'Wheat' }), false);
  assert.equal(describeBaleSetting({ baleType: 'round', baleKg: 500 }), 'Round bales, about 500 kg');
});

check('bales are counted as well as tonnes: 120 bales at 520 kg is 62.4 tonnes', () => {
  assert.equal(balesToTons(120, 520), 62.4);
  assert.equal(describeBales(120, 62400), '120 bales, 62.4 t');
  assert.equal(describeBales(1, 0), '1 bale');
  assert.equal(describeBales(0, 100), '');
});

check('bales baled on a paddock: baled, moved off and still in the field', () => {
  const field = { id: 'f1', balesBaled: [
    { id: 'a', date: '2026-10-01', label: 'Cut 1', bales: 100, kg: 52000 },
    { id: 'b', date: '2026-11-01', label: 'Cut 2', bales: 60, kg: 31200 },
    { id: 'x', bales: 0 },
  ] };
  assert.equal(cleanBaled(field.balesBaled).length, 2, 'an entry with no bales is not kept');
  const none = baledTotals(field, []);
  assert.deepEqual([none.baled, none.moved, none.inField], [160, 0, 160]);
  const carted = { id: 'm1', froms: [{ type: 'field', id: 'f1', tons: 41.6 }], tos: [{ type: 'silo', id: 'shed', tons: 41.6 }], hay: { bales: 80, kg: 41600 } };
  const other = { id: 'm2', froms: [{ type: 'field', id: 'f2', tons: 9 }], tos: [], hay: { bales: 30, kg: 15000 } };
  assert.equal(hasHayLoad(carted), true);
  assert.equal(hasHayLoad({ froms: [] }), false);
  const t = baledTotals(field, [carted, other]);
  assert.deepEqual([t.baled, t.moved, t.inField, t.movedKg], [160, 80, 80, 41600], 'only loads off this paddock count');
  assert.equal(t.kg, 83200); assert.equal(t.inFieldKg, 41600);
  assert.equal(baledTotals({ id: 'f1', balesBaled: [{ bales: 10, kg: 5000 }] }, [carted]).inField, 0, 'never below nothing in the field');
});

check('a paddock\'s bale weight is what was baled on it, otherwise the commodity setting', () => {
  const com = { hay: { baleType: 'round', baleKg: 500 } };
  assert.equal(avgBaleKg({ id: 'f' }, com), 500);
  assert.equal(avgBaleKg({ id: 'f', balesBaled: [{ bales: 100, kg: 52000 }] }, com), 520);
  assert.equal(avgBaleKg({ id: 'f' }, {}), 0);
});

check('hay settings and bales baled go to the server and back; a grain commodity and a paddock without any send no column', () => {
  const st = (c, f) => ({ currentYear: '2026', years: { 2026: { sales: [], storages: [], movements: [], commodities: [c], fields: [f] } }, businessDetails: {} });
  const com = { id: 'c1', name: 'Lucerne', unit: 't', hay: { baleType: 'round', baleKg: 500 } };
  const fld = { id: 'f1', name: 'Lucerne 1', areaHa: 20, commodityId: 'c1', yieldTHa: 0, yieldMode: 'estimate', balesBaled: [{ id: 'a', date: '2026-10-01', label: 'Cut 1', bales: 100, kg: 52000 }] };
  const rows = stateToRows(st(com, fld), 'farm1');
  assert.deepEqual(rows.commodities[0].hay, { baleType: 'round', baleKg: 500 });
  assert.deepEqual(rows.fields[0].bales_baled, fld.balesBaled);
  const back = rowsToState(rows).years[2026];
  assert.deepEqual(back.commodities[0].hay, { baleType: 'round', baleKg: 500 });
  assert.deepEqual(back.fields[0].balesBaled, fld.balesBaled);
  const plain = stateToRows(st({ id: 'c2', name: 'Wheat', unit: 't' }, { id: 'f2', name: 'W1', areaHa: 5, commodityId: 'c2', yieldTHa: 3, yieldMode: 'estimate' }), 'farm1');
  assert.ok(!('hay' in plain.commodities[0]) && !('bales_baled' in plain.fields[0]));
  const cleared = stateToRows(st({ ...com, hay: null, __hasHay: true }, { ...fld, balesBaled: [], __hasBalesBaled: true }), 'farm1');
  assert.equal(cleared.commodities[0].hay, null, 'turning hay off still reaches the server');
  assert.deepEqual(cleared.fields[0].bales_baled, [], 'deleting the last entry still reaches the server');
});

check('the commodity sheet sets a type up as hay, and the paddock sheet logs bales baled', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("label: 'Baled hay'") && s.includes("label: 'Bale weight (kg)'") && s.includes('cleanHay('));
  const p = read('docs/js/views/production.js');
  assert.ok(p.includes('id="log-baled"') && p.includes('openBalesBaledSheet(existing.id') && p.includes('baledTotals(existing, movements)') && p.includes('in field'));
  const v = read('docs/js/views/balesbaled.js');
  assert.ok(v.includes('db.upsertField({ id: f.id, balesBaled: cleanBaled(list) })') && v.includes('Math.round(n * baleKg)'));
  assert.ok(read('docs/js/storage.js').includes('__hasBalesBaled = true') && read('docs/js/storage.js').includes('__hasHay = true'));
  assert.ok(read('supabase/migrations/20261201000000_hay.sql').includes('add column if not exists bales_baled jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists bales_baled jsonb') && read('supabase/paste-into-sql-editor.sql').includes('commodities add column if not exists hay jsonb'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
