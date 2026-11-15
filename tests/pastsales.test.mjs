// Run with:
//   node tests/pastsales.test.mjs
//
// Past sales from the farm's own contract register: reading the CSV, what each season would get, what is stored, and the
// position those contracts give a past season.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePastSales, planPastSales, salesRecords } from '../docs/js/pastsales.js';
import { saleEconomics, position } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0;
const makeId = () => `id${++n}`;

const CSV = [
  'Season,Date,Buyer,Contract No,Commodity,Grade,Tonnes,Price,Freight,Premium / Discount,Levies,Delivered,Delivery from,Delivery to,Destination,Broker,Contract type,Our ref,Notes',
  '2024,2/7/2024,Viterra,4554678,Chickpeas (Desi),CP 1,550,1000,-25,,9.945,550,2024-12-01,2025-01-31,Gundy,Knight,Forward,1,',
  '2024,26/9/2024,Agridirect,ADAG25267,Chickpeas,CP 1,1012.42,1045,-75,-5.61,9.894,1012,,,Brisbane,Direct,Forward,4,CPKM -$100',
  '2024,1/10/2024,Max Grains,P011363,Wheat,APW,1000,295,25,,2.754,1000,,,Gundy,Knight,Forward,2,',
  '2022,5/3/2023,Graincorp,G1,Wheat Org,APW,200,400,0,0,0,0,,,Gundy,,Cash,9,',
  '',
].join('\r\n');

console.log('\n=== reading the file ===');
check('contracts are read with their price terms, and a freight of either sign is the same cost', () => {
  const { rows, errors, warnings } = parsePastSales(CSV);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(rows.length, 4);
  const a = rows[0];
  assert.equal(a.season, '2024'); assert.equal(a.buyer, 'Viterra'); assert.equal(a.contractNo, '4554678');
  assert.equal(a.date, '2024-07-02'); assert.equal(a.tons, 550); assert.equal(a.price, 1000);
  assert.equal(a.freight, 25); assert.equal(rows[2].freight, 25, 'a freight of 25 and of -25 are the same cost');
  assert.equal(a.tonsDelivered, 550); assert.equal(a.deliveryStart, '2024-12-01'); assert.equal(a.deliveryEnd, '2025-01-31');
  assert.equal(a.location, 'Gundy'); assert.equal(a.broker, 'Knight'); assert.equal(a.contractType, 'Forward'); assert.equal(a.ourRef, '1');
});
check('levies in dollars a tonne become the percentage of the price after freight, and the premium keeps its sign', () => {
  const { rows } = parsePastSales(CSV);
  assert.ok(Math.abs(rows[0].leviesPct - 9.945 / 975) < 1e-6);
  assert.equal(rows[1].premiumDiscount, -5.61);
  // the workbook's own ex-farm prices come out of the app's arithmetic
  assert.ok(Math.abs(saleEconomics({ ...rows[0], id: 'a' }).priceExFarm - 965.055) < 0.001);
  assert.ok(Math.abs(saleEconomics({ ...rows[1], id: 'b' }).priceExFarm - 954.496) < 0.001);
});
check('a levies percentage heading is read as a percentage', () => {
  const { rows } = parsePastSales('Season,Commodity,Tonnes,Price,Levies (%)\n2023,Wheat,100,300,1.02');
  assert.equal(rows[0].leviesPct, 0.0102);
});
check('other heading names, semicolons and dollar signs work', () => {
  const { rows, errors } = parsePastSales('Year;Crop;Tons;Price ($/t);Contract Number\n2021;Barley;"1,200";$280.50;C-1');
  assert.deepEqual(errors, []);
  assert.equal(rows[0].tons, 1200); assert.equal(rows[0].price, 280.5); assert.equal(rows[0].contractNo, 'C-1');
});
check('a missing heading, a row without tonnes or a price, and a date that cannot be read are said plainly', () => {
  assert.match(parsePastSales('Season,Commodity,Tonnes\n2024,Wheat,10').errors[0], /Price/);
  const r = parsePastSales('Season,Commodity,Tonnes,Price,Buyer,Date\n2024,Wheat,0,300,Acme,\n2024,Wheat,10,,Acme,\n2024,Wheat,10,300,Acme,sometime');
  assert.equal(r.rows.length, 1);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Acme needs the tonnes/);
  assert.match(r.errors[1], /Acme needs a price/);
  assert.equal(r.rows[0].date, '');
  assert.match(r.warnings[0], /sometime/);
});

console.log('\n=== what each season would get ===');
const seasons = [
  { label: '2024', commodities: [{ id: 'w', name: 'Wheat' }, { id: 'c', name: 'Chickpeas' }], salesCount: 0 },
  { label: '2023', commodities: [{ id: 'w', name: 'Wheat' }], salesCount: 3 },
];
check('a season the farm has, with no contracts, is ready; crops are matched to the season\'s own by name', () => {
  const plan = planPastSales(parsePastSales(CSV).rows, seasons);
  const p = plan.find((x) => x.label === '2024');
  assert.equal(p.ready, true); assert.equal(p.contracts, 3); assert.equal(p.tons, 2562);
  assert.deepEqual(p.added, [], '"Chickpeas (Desi)" is the season\'s Chickpeas');
  assert.equal(p.items[0].commodityName, 'Chickpeas');
  assert.equal(p.delivered, 2562);
  const expected = 550 * 965.055 + 1012.42 * 954.496 + 1000 * (295 - 25 - (270 * 2.754 / 270));
  assert.ok(Math.abs(p.value - Math.round(expected)) <= 1, `${p.value} vs ${Math.round(expected)}`);
});
check('a season that is not in the app, or that already has contracts, is not ready, and nothing is guessed', () => {
  const plan = planPastSales(parsePastSales(CSV).rows, seasons);
  const missing = plan.find((x) => x.label === '2022');
  assert.equal(missing.exists, false); assert.equal(missing.ready, false);
  const has = planPastSales(parsePastSales('Season,Commodity,Tonnes,Price\n2023,Wheat,10,300').rows, seasons)[0];
  assert.equal(has.exists, true); assert.equal(has.hasSales, true); assert.equal(has.ready, false);
});
check('a crop the season has no paddocks of is added once, however many contracts name it', () => {
  const rows = parsePastSales('Season,Commodity,Tonnes,Price\n2024,Cotton,10,600\n2024,cotton,20,600').rows;
  const plan = planPastSales(rows, seasons)[0];
  assert.deepEqual(plan.added, ['Cotton']);
  const rec = salesRecords(plan, seasons[0].commodities, makeId, () => ({ angleOfRepose: 1 }));
  assert.equal(rec.commodities.length, 1);
  assert.equal(rec.commodities[0].angleOfRepose, 1);
  assert.equal(rec.sales[0].commodityId, rec.sales[1].commodityId);
});

console.log('\n=== what is stored, and the position it gives ===');
check('each contract is stored with the figures the app\'s own contract screen keeps', () => {
  const plan = planPastSales(parsePastSales(CSV).rows, seasons).find((x) => x.label === '2024');
  const rec = salesRecords(plan, seasons[0].commodities, makeId);
  assert.equal(rec.sales.length, 3);
  const s = rec.sales[0];
  assert.deepEqual(
    ['id', 'date', 'commodityId', 'grade', 'buyer', 'contractNo', 'ourRef', 'location', 'deliveryStart', 'deliveryEnd', 'tons', 'tonsDelivered', 'price', 'freight', 'premiumDiscount', 'leviesPct', 'broker', 'contractType', 'freightPaidBy']
      .filter((k) => !(k in s)), []);
  assert.equal(s.commodityId, 'c'); assert.equal(rec.sales[2].commodityId, 'w');
  assert.equal(new Set(rec.sales.map((x) => x.id)).size, 3);
});
check('with the paddocks and the contracts in, the season has a position: grown, sold, unsold', () => {
  const plan = planPastSales(parsePastSales(CSV).rows, seasons).find((x) => x.label === '2024');
  const { sales } = salesRecords(plan, seasons[0].commodities, makeId);
  const commodities = [{ id: 'w', name: 'Wheat', mtmPrice: 300 }, { id: 'c', name: 'Chickpeas', mtmPrice: 900 }];
  const fields = [
    { id: 'f1', name: 'A', areaHa: 500, commodityId: 'w', yieldTHa: 3, yieldMode: 'recorded' },
    { id: 'f2', name: 'B', areaHa: 1000, commodityId: 'c', yieldTHa: 2, yieldMode: 'recorded' },
  ];
  const rows = position(commodities, fields, sales, []);
  const wheat = rows.find((r) => r.commodity.id === 'w');
  const chick = rows.find((r) => r.commodity.id === 'c');
  assert.equal(wheat.productionTons, 1500); assert.equal(wheat.soldTons, 1000); assert.equal(wheat.unsoldTons, 500);
  assert.equal(chick.productionTons, 2000); assert.ok(Math.abs(chick.soldTons - 1562.42) < 0.001);
  assert.ok(Math.abs(chick.unsoldTons - 437.58) < 0.001);
  assert.ok(chick.soldValue > 1.4e6 && chick.soldValue < 1.6e6);
});

console.log('\n=== the screen ===');
check('Settings offers the import, the sheet only fills seasons that are ready, and the db never doubles or overwrites', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes('id="import-past-sales"') && s.includes('openPastSalesSheet()'));
  const v = read('docs/js/views/pastsales.js');
  assert.ok(v.includes('planPastSales(') && v.includes('p.ready') && v.includes('db.addPastSales('));
  const st = read('docs/js/storage.js');
  assert.ok(/addPastSales\(year, \{ sales, commodities = \[\] \}\) \{[\s\S]*?if \(!y \|\| \(y\.sales \|\| \[\]\)\.length\) return false;/.test(st));
  assert.ok(!/addPastSales[\s\S]{0,500}data\.currentYear = /.test(st), 'the current season does not change');
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
