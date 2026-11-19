import assert from 'node:assert/strict';
import fs from 'node:fs';
import { walkSteps, seasonLabel, businessPatch, commodityRecord, fieldRecord, storageRecord, saleRecord, loadRecord, invoiceable } from '../docs/js/setupwalk.js?v=437';

let failed = 0;
function check(name, fn) { try { fn(); console.log('  PASS  ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } }

check('the walk starts at the first step the farm has not done, and an empty farm starts at the first', () => {
  const empty = walkSteps('owner', { business: {}, commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [] });
  assert.equal(empty.first, 0);
  assert.equal(empty.steps.length, 8);
  assert.equal(empty.steps[1].id, 'season');
  const some = walkSteps('owner', { business: { entityName: 'A', abn: '1' }, commodities: [{}], fields: [{}], storages: [], sales: [], movements: [], invoices: [] });
  assert.equal(some.steps[some.first].id, 'storage');
  assert.ok(some.first > 1, 'Continue setup does not ask for the season again');
});

check('the season is asked once, after the business, and a blank or unchanged label is left alone', () => {
  assert.equal(seasonLabel('  2026/27 ', '2026'), '2026/27');
  assert.equal(seasonLabel('2026', '2026'), null);
  assert.equal(seasonLabel('', '2026'), null);
  assert.equal(walkSteps('bookkeeper', { business: {}, commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [] }).steps.some((s) => s.id === 'season'), false);
});

check('a bookkeeper walks only the contract and invoice steps', () => {
  const w = walkSteps('bookkeeper', { business: {}, commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [] });
  assert.deepEqual(w.steps.map((s) => s.id), ['contract', 'invoice']);
});

check('a finished farm starts past the last step', () => {
  const full = { business: { entityName: 'A', abn: '1' }, commodities: [{}], fields: [{}], storages: [{}], sales: [{}], movements: [{}], invoices: [{}] };
  const w = walkSteps('owner', full);
  assert.equal(w.first, w.steps.length);
});

check('business details keep only what was typed', () => {
  assert.deepEqual(businessPatch({ entityName: ' Smith Pty Ltd ', abn: '', ngr: '123' }), { entityName: 'Smith Pty Ltd', ngr: '123' });
});

check('a commodity needs a name; cotton is in bales', () => {
  assert.equal(commodityRecord({ name: '  ' }), null);
  assert.deepEqual(commodityRecord({ name: 'Cotton', unit: 'bale' }), { name: 'Cotton', unit: 'bale' });
  assert.equal(commodityRecord({ name: 'Lupins', unit: 'x' }).unit, 't');
});

check('a paddock needs a name; hectares are numbers and the crop is optional', () => {
  assert.equal(fieldRecord({ name: '' }), null);
  const f = fieldRecord({ name: 'North', areaHa: '120.5', commodityId: '' });
  assert.equal(f.areaHa, 120.5);
  assert.equal(f.commodityId, null);
});

check('a silo or bunker keeps its kind, capacity and what is in it', () => {
  const s = storageRecord({ name: 'Silo 1', kind: 'bunker', volumeM3: '260', commodityId: 'c1', openingStock: '50' });
  assert.deepEqual(s, { kind: 'bunker', name: 'Silo 1', volumeM3: 260, commodityId: 'c1', openingStock: 50 });
  assert.equal(storageRecord({ name: 'S', kind: 'weird' }).kind, 'silo');
});

check('a contract needs a buyer, a commodity and tonnes', () => {
  assert.equal(saleRecord({ buyer: '', commodityId: 'c', tons: 10 }), null);
  assert.equal(saleRecord({ buyer: 'B', commodityId: '', tons: 10 }), null);
  assert.equal(saleRecord({ buyer: 'B', commodityId: 'c', tons: 0 }), null);
  const s = saleRecord({ buyer: 'B', commodityId: 'c', tons: 100, price: 450, date: '2026-11-18' });
  assert.equal(s.price, 450);
  assert.equal(s.tonsDelivered, 0);
});

check('a load takes its commodity from the paddock, or from where it goes', () => {
  const data = { fields: [{ id: 'f1', commodityId: 'wheat' }], storages: [{ id: 's1', commodityId: null }], sales: [{ id: 'k1', commodityId: 'barley' }] };
  const fromField = loadRecord({ date: 'd', tons: 20, from: { type: 'field', id: 'f1' }, to: { type: 'silo', id: 's1' }, data });
  assert.equal(fromField.commodityId, 'wheat');
  assert.equal(fromField.froms[0].tons, 20);
  const toSale = loadRecord({ date: 'd', tons: 20, from: { type: 'silo', id: 's1' }, to: { type: 'sale', id: 'k1' }, data });
  assert.equal(toSale.commodityId, 'barley');
  assert.equal(loadRecord({ date: 'd', tons: 0, from: { type: 'field', id: 'f1' }, to: { type: 'silo', id: 's1' }, data }), null);
});

check('only contracts with loads delivered and no invoice are offered for the first invoice', () => {
  const data = {
    sales: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    movements: [{ tos: [{ type: 'sale', id: 'a', tons: 10 }] }, { tos: [{ type: 'sale', id: 'b', tons: 5 }] }],
    invoices: [{ saleId: 'b' }],
  };
  assert.deepEqual(invoiceable(data).map((s) => s.id), ['a']);
});

check('the walk-through is wired: Position starts it, it ends with seasons and a way to Position', () => {
  const pos = fs.readFileSync('docs/js/views/position.js', 'utf8');
  assert.ok(pos.includes('id="start-walk"') && pos.includes('openSetupWalk'));
  const view = fs.readFileSync('docs/js/views/setupwalk.js', 'utf8');
  assert.ok(view.includes('id="sw-help"') && view.includes('id="sw-map"') && view.includes('id="sw-import"') && view.includes('openLoadImportSheet') && view.includes('openMapSheet'));
  const help = fs.readFileSync('docs/js/views/help.js', 'utf8');
  assert.ok(help.includes('id="help-walk"') && help.includes('openSetupWalk'));
  assert.ok(view.includes('Skip for now') && view.includes('Tap it to switch to an earlier season') && view.includes("You\u2019re set up"));
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
