// Run with:
//   node tests/grossmargin.test.mjs
//
// The Gross margin report: price is the crop's blended price, cost is the crop's cost over its area unless a paddock has its own,
// and the paddock's own cost is saved with the paddock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gmReport, costOverride, cropCostPerHa } from '../docs/js/grossmargin.js';
import { setFarmSwitches, canSeePrices } from '../docs/js/nav.js';
import { hubGroups } from '../docs/js/reportshub.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Wheat: two paddocks of 100 ha and 300 ha, 400 t grown (all on a yield of 1 and 3 t/ha), $200,000 of cost, sold 200 t at $500, the rest unsold at MTM $400
const commodities = [{ id: 'w', name: 'Wheat', mtmPrice: 400, openingStock: 0, retainedSeed: 0, grossMarginCost: 160000 }];
const fields = [
  { id: 'f1', name: 'North', areaHa: 100, commodityId: 'w', yieldTHa: 1, yieldMode: 'estimate' },
  { id: 'f2', name: 'South', areaHa: 300, commodityId: 'w', yieldTHa: 3, yieldMode: 'estimate' },
];
const sales = [{ id: 's1', commodityId: 'w', tons: 200, price: 500, tonsDelivered: 0, freight: 0, leviesPct: 0, premiumDiscount: 0, ginning: 0 }];

const report = (fs = fields) => gmReport(commodities, fs, sales, []);

check('price is the crop\'s total value over its tonnes, the same on every paddock', () => {
  const g = report().groups[0];
  assert.equal(g.fields.length, 2);
  assert.equal(g.fields[0].price, g.fields[1].price);
  assert.ok(g.price > 400 && g.price <= 500, `blended price ${g.price} sits between the MTM and the contract price`);
});

check('revenue per hectare is yield times price, and the cost is the crop\'s over its area', () => {
  const g = report().groups[0];
  const [n, s] = g.fields;
  assert.equal(g.defaultCostHa, 400);          // 160000 / 400 ha
  assert.equal(n.costHa, 400); assert.equal(s.costHa, 400);
  assert.ok(Math.abs(n.revenueHa - n.yieldTHa * g.price) < 1e-9);
  assert.ok(Math.abs(s.gmHa - (s.revenueHa - 400)) < 1e-9);
  assert.equal(n.costIsOverride, false);
});

check('a paddock\'s own cost replaces the crop\'s for that paddock only, and the group total is area-weighted', () => {
  const g = report([{ ...fields[0], gmCostHa: 250 }, fields[1]]).groups[0];
  assert.equal(g.fields[0].costHa, 250); assert.equal(g.fields[0].costIsOverride, true);
  assert.equal(g.fields[1].costHa, 400); assert.equal(g.fields[1].costIsOverride, false);
  assert.ok(Math.abs(g.total.costHa - (250 * 100 + 400 * 300) / 400) < 1e-9);
  assert.ok(Math.abs(g.total.gm - (g.total.revenue - g.total.cost)) < 1e-6);
});

check('an empty or unusable override is no override; zero is a real one', () => {
  for (const bad of [null, undefined, '', 'abc', -5]) assert.equal(costOverride({ gmCostHa: bad }), null, String(bad));
  assert.equal(costOverride({ gmCostHa: 0 }), 0);
  assert.equal(costOverride({ gmCostHa: '120' }), 120);
});

check('a crop with no tonnes or no area gives zeroes, not NaN', () => {
  const g = gmReport([{ id: 'w', name: 'Wheat', mtmPrice: 0, grossMarginCost: 0 }], [{ id: 'f', name: 'A', areaHa: 10, commodityId: 'w' }], [], []).groups[0];
  for (const v of [g.price, g.fields[0].yieldTHa, g.fields[0].gmHa, g.total.gmHa]) assert.ok(Number.isFinite(v));
});

check('only those shown prices get the tile and the report', () => {
  setFarmSwitches({});
  assert.equal(canSeePrices('owner'), true); assert.equal(canSeePrices('bookkeeper'), true);
  for (const r of ['manager', 'farm_worker', 'driver', 'advisor']) assert.equal(canSeePrices(r), false, r);
  setFarmSwitches({ managerSeesPrices: true });
  assert.equal(canSeePrices('manager'), true);
  setFarmSwitches({ advisorSeesPrices: true });
  assert.equal(canSeePrices('advisor'), false, 'an advisor needs loads on too');
  setFarmSwitches({ advisorSeesPrices: true, advisorSeesLoads: true });
  assert.equal(canSeePrices('advisor'), true);
  setFarmSwitches({});
  const ids = (role) => hubGroups({ mode: 'full', role, can: () => true }).flatMap((g) => g.tiles).map((t) => t.id);
  assert.ok(ids('owner').includes('gm') && ids('bookkeeper').includes('gm'));
  assert.ok(!ids('manager').includes('gm'), 'a manager without prices has no gross margin report');
});

check('the paddock\'s own cost is saved with the paddock, only once there is one, and comes back', () => {
  const FARM = '99999999-9999-9999-9999-999999999999';
  const st = (f) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [], fields: [f], sales: [], invoices: [], overheads: {}, storages: [], movements: [] } } });
  const base = { id: 'f1', name: 'North', areaHa: 100, commodityId: null, yieldTHa: 0, yieldMode: 'estimate' };
  assert.ok(!('gm_cost_ha' in stateToRows(st(base), FARM).fields[0]), 'a paddock with none sends no column, so it saves before the database has it');
  const rows = stateToRows(st({ ...base, gmCostHa: 250 }), FARM);
  assert.equal(rows.fields[0].gm_cost_ha, 250);
  assert.equal(rowsToState(rows).years['2026'].fields[0].gmCostHa, 250);
  assert.equal(stateToRows(st({ ...base, gmCostHa: null, __hasGmCostHa: true }), FARM).fields[0].gm_cost_ha, null, 'clearing it reaches the server');
});

check('the report is a tile, drawn on the Reports screen, with the cost box and the column in the paste-in file', () => {
  const rp = read('docs/js/views/reports.js');
  assert.ok(rp.includes("view === 'gm'") && rp.includes('function paintGm(') && rp.includes('gmCostHa'));
  assert.ok(read('docs/js/reportshub.js').includes("tile('gm', 'Gross margin', 'view')"));
  assert.ok(read('docs/js/storage.js').includes('merged.__hasGmCostHa = true'));
  const sql = read('supabase/migrations/20261211000000_field_gm_cost.sql');
  assert.ok(sql.includes('add column if not exists gm_cost_ha numeric'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists gm_cost_ha numeric'));
});

check('the paddock sheet has the cost box: the crop\'s cost per hectare shown faintly, your own figure saved with the paddock', () => {
  assert.equal(cropCostPerHa(commodities[0], fields), 400);                // 160000 over 400 ha
  assert.equal(cropCostPerHa(commodities[0], fields, 100), 320);           // a paddock not yet saved counts with the rest
  assert.equal(cropCostPerHa(null, fields), 0);
  assert.equal(cropCostPerHa({ id: 'x', grossMarginCost: 500 }, fields), 0, 'no paddocks, no area, no figure');
  const pr = read('docs/js/views/production.js');
  assert.ok(pr.includes("id: 'gmCostHa'") && pr.includes('cropCostPerHa(') && pr.includes('gmCostHa: String(getVal(root'), 'the box is on the sheet and saved');
  assert.ok(pr.includes("canSetCost = ['owner', 'manager']"), 'only those who can change a paddock');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
