// Run with:
//   node tests/salesort.test.mjs
//
// The order of the contracts on the Sales tab.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sortSales, SALE_SORTS, DEFAULT_SALE_SORT, isSaleSort, readSaleSort, searchSales } from '../docs/js/salesort.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const sales = [
  { id: 'a', buyer: 'Northbound', date: '2026-09-01', tons: 500, price: 400, deliveryEnd: '2027-02-28' },
  { id: 'b', buyer: 'archer Grain', date: '2026-11-05', tons: 300, price: 500, deliveryStart: '2026-12-01', deliveryEnd: '2026-12-20' },
  { id: 'c', buyer: 'Riverina', date: '2026-10-10', tons: 1000, price: 300 },
  { id: 'd', buyer: '', date: '2026-11-20', tons: 100, price: 450, deliveryStart: '2027-01-10' },
];
// 'a' has had 450 t trucked to it, so has 50 t to go
const movements = [{ id: 'm1', date: '2026-11-10', tons: 450, froms: [], tos: [{ type: 'sale', id: 'a', tons: 450 }] }];
const ids = (s) => sortSales(sales, s, movements).map((x) => x.id).join('');

check('newest first is how it has always been', () => {
  assert.equal(ids('newest'), 'dbca');
  assert.equal(ids(undefined), 'dbca', 'and what an unknown choice falls back to');
});

check('delivery due soonest: the end of the window, else the start; none last', () => {
  assert.equal(ids('delivery'), 'bdac');   // b Dec 2026, d Jan 2027 (start), a Feb 2027, c has no dates
});

check('most tonnes to go, counting what has been trucked', () => {
  assert.equal(ids('togo'), 'cbda', 'c 1000, b 300, d 100, a 50');
});

check('buyer A to Z ignores case and puts a contract with no buyer last', () => {
  assert.equal(ids('buyer'), 'bacd');
});

check('biggest value first', () => {
  // a 500 t x 400 = 200,000; b 300 x 500 = 150,000; c 1000 x 300 = 300,000; d 100 x 450 = 45,000
  assert.equal(ids('value'), 'cabd');
});

check('sorting never changes the list it is given', () => {
  const before = sales.map((s) => s.id).join('');
  sortSales(sales, 'buyer', movements);
  assert.equal(sales.map((s) => s.id).join(''), before);
});

check('the choices are named, the first is the default, and a bad remembered value is ignored', () => {
  assert.equal(SALE_SORTS[0].value, DEFAULT_SALE_SORT);
  assert.ok(SALE_SORTS.every((s) => s.label && isSaleSort(s.value)));
  assert.equal(isSaleSort('nonsense'), false);
  assert.equal(readSaleSort(), DEFAULT_SALE_SORT, 'with nothing stored (or no storage at all)');
});

check('the Sales tab has the picker, sorts within each commodity and the paid list, and remembers the choice', () => {
  const v = read('docs/js/views/sales.js');
  assert.ok(v.includes('id="sale-sort"') && v.includes('Sort contracts by'));
  assert.ok(v.includes('groupSalesByCommodity(commodities, found, movements, saleSort)') && v.includes('searchSales(activeSales(sales), commodities, saleSearch)'));
  assert.ok(v.includes('sortSales(sales.filter((s) => s.commodityId === c.id), sort, movements)'));
  assert.ok(v.includes('sortSales(list, readSaleSort(), movements)'));
  assert.ok(v.includes('saveSaleSort(e.target.value)'));
});

check('the Sales tab has a search box beside the sort, like Storage, that redraws only the list so the cursor stays', () => {
  const v = read('docs/js/views/sales.js');
  assert.ok(v.includes('<div class="mv-searchrow">') && v.includes('id="sale-search"') && v.includes('class="storage-sort"'));
  assert.ok(v.includes("root.querySelector('#sale-search')?.addEventListener('input'") && v.includes("list.innerHTML = contractsHtml();") && v.includes('wireRows(list);'));
  assert.ok(v.indexOf('id="sale-search"') < v.indexOf('id="sale-sort"'), 'search first, then the sort');
});
check('searching finds a contract by any word of its buyer, number, commodity, grade, place or notes; every word must match', () => {
  const commodities = [{ id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }];
  const sales = [
    { id: '1', buyer: 'GrainCorp', contractNo: 'GC-1001', commodityId: 'w', grade: 'APW1', location: 'Dubbo' },
    { id: '2', buyer: 'Louis Dreyfus', contractNo: 'LD77', commodityId: 'c', grade: 'CAN1', notes: 'Ex farm' },
    { id: '3', buyer: 'Emerald', ourRef: 'EG9', commodityId: 'w', grade: 'H2' },
  ];
  const ids = (t) => searchSales(sales, commodities, t).map((s) => s.id);
  assert.deepEqual(ids(''), ['1', '2', '3']);
  assert.deepEqual(ids('   '), ['1', '2', '3']);
  assert.deepEqual(ids('graincorp'), ['1']);
  assert.deepEqual(ids('gc-1001'), ['1']);
  assert.deepEqual(ids('wheat'), ['1', '3']);
  assert.deepEqual(ids('wheat apw'), ['1'], 'every word must match');
  assert.deepEqual(ids('CANOLA ex farm'), ['2']);
  assert.deepEqual(ids('dubbo'), ['1']);
  assert.deepEqual(ids('eg9'), ['3']);
  assert.deepEqual(ids('nothing like this'), []);
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
