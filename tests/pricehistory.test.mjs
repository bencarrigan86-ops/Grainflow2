// Run with:
//   node tests/pricehistory.test.mjs
//
// Price history: one price a commodity a week, with optional grade spreads (protein spreads on wheat). The history builds itself when a
// commodity's MTM price is changed, a week can be set for every commodity at once, and it travels with the commodity to the server.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  weekStart, cleanHistory, hasHistory, recordPrice, latestSpreads, latestEntry, mergedSeries, seriesByCommodity, weekRows, changeOver, chartPoints,
  canSetPrices, WHEAT_GRADES, isWheat,
} from '../docs/js/pricehistory.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('a week is the Monday it starts on, whatever day of it the date is', () => {
  assert.equal(weekStart('2026-11-16'), '2026-11-16');   // Monday
  assert.equal(weekStart('2026-11-18'), '2026-11-16');   // Wednesday
  assert.equal(weekStart('2026-11-22'), '2026-11-16');   // Sunday
  assert.equal(weekStart('2026-11-23'), '2026-11-23');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');   // across the year
  assert.equal(weekStart('not a date'), '');
  assert.equal(weekStart(''), '');
});

check('the saved list is one entry a week, oldest first, with bad rows left out', () => {
  const list = cleanHistory([
    { week: '2026-11-18', price: 330 },
    { week: '2026-11-09', price: 320.456 },
    { week: '2026-11-16', price: 335 },   // the same week as the first: the later one wins
    { week: '', price: 1 }, { week: '2026-11-02', price: 'abc' }, { week: '2026-10-26', price: -5 }, null,
  ]);
  assert.deepEqual(list.map((e) => [e.week, e.price]), [['2026-11-09', 320.46], ['2026-11-16', 335]]);
  assert.equal(hasHistory(list), true);
  assert.equal(hasHistory([]), false);
  assert.equal(hasHistory(undefined), false);
});

check('recording a price sets that week, and replaces it if the week is already there', () => {
  let l = recordPrice([], { date: '2026-11-17', price: 330 });
  assert.deepEqual(l, [{ week: '2026-11-16', price: 330 }]);
  l = recordPrice(l, { date: '2026-11-19', price: 335, spreads: [{ grade: 'H1', adjust: 40 }] });
  assert.equal(l.length, 1);
  assert.deepEqual(l[0], { week: '2026-11-16', price: 335, spreads: [{ grade: 'H1', adjust: 40 }] });
  l = recordPrice(l, { date: '2026-11-23', price: 340 });
  assert.deepEqual(l.map((e) => e.week), ['2026-11-16', '2026-11-23']);
  assert.deepEqual(recordPrice(l, { date: 'x', price: 5 }), l, 'a bad date changes nothing');
  assert.deepEqual(recordPrice(l, { date: '2026-11-30', price: -1 }), l, 'a bad price changes nothing');
});

check('spreads carry over from the latest week that had any', () => {
  const l = cleanHistory([
    { week: '2026-11-02', price: 320, spreads: [{ grade: 'H1', adjust: 35 }] },
    { week: '2026-11-09', price: 325, spreads: [{ grade: 'H1', adjust: 40 }, { grade: 'ASW1', adjust: -15 }] },
    { week: '2026-11-16', price: 330 },
  ]);
  assert.deepEqual(latestSpreads(l), [{ grade: 'H1', adjust: 40 }, { grade: 'ASW1', adjust: -15 }]);
  assert.deepEqual(latestSpreads([]), []);
  assert.equal(latestEntry(l).price, 330);
  // blank grades and repeats are dropped, a missing number is zero
  assert.deepEqual(cleanHistory([{ week: '2026-11-16', price: 1, spreads: [{ grade: ' ', adjust: 5 }, { grade: 'H1' }, { grade: 'h1', adjust: 9 }] }])[0].spreads, [{ grade: 'H1', adjust: 0 }]);
});

check('a commodity in several seasons is one series, by name, with the later season winning a shared week', () => {
  const years = [
    { commodities: [{ name: 'Wheat', priceHistory: [{ week: '2025-11-17', price: 300 }, { week: '2026-06-29', price: 310 }] }, { name: 'Barley' }] },
    { commodities: [{ name: 'wheat', priceHistory: [{ week: '2026-06-29', price: 312 }, { week: '2026-11-16', price: 335 }] }, { name: 'Canola', priceHistory: [{ week: '2026-11-16', price: 690 }] }] },
  ];
  const by = seriesByCommodity(years);
  assert.deepEqual(by.map((x) => x.name), ['Wheat', 'Canola'], 'a commodity with no history is not listed');
  assert.deepEqual(by[0].series.map((e) => [e.week, e.price]), [['2025-11-17', 300], ['2026-06-29', 312], ['2026-11-16', 335]]);
  assert.equal(mergedSeries([]).length, 0);
});

check('the table is newest first with the change from the week before', () => {
  const rows = weekRows([{ week: '2026-11-02', price: 326 }, { week: '2026-11-09', price: 322 }, { week: '2026-11-16', price: 335 }], 8);
  assert.deepEqual(rows.map((r) => [r.week, r.price, r.change]), [['2026-11-16', 335, 13], ['2026-11-09', 322, -4], ['2026-11-02', 326, null]]);
  assert.equal(weekRows(rows, 2).length, 2);
});

check('the change over four weeks uses the entry that far back, or the one before when there is no such week', () => {
  const s = [{ week: '2026-10-19', price: 300 }, { week: '2026-10-26', price: 310 }, { week: '2026-11-02', price: 320 }, { week: '2026-11-09', price: 325 }, { week: '2026-11-16', price: 335 }];
  assert.deepEqual(changeOver(s, 4), { change: 35, weeks: 4 });
  assert.deepEqual(changeOver(s, 1), { change: 10, weeks: 1 });
  assert.deepEqual(changeOver([{ week: '2026-11-02', price: 320 }, { week: '2026-11-16', price: 335 }], 4), { change: 15, weeks: 2 });
  assert.equal(changeOver([{ week: '2026-11-16', price: 335 }], 4), null, 'one week has no change');
  assert.equal(changeOver([], 4), null);
});

check('the chart line runs oldest to newest across the width, higher prices higher up, and a flat run sits in the middle', () => {
  const pts = chartPoints([{ week: '2026-11-02', price: 300 }, { week: '2026-11-09', price: 350 }, { week: '2026-11-16', price: 325 }], { width: 220, height: 90, pad: 8 });
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 8);
  assert.equal(pts[2].x, 212);
  assert.ok(pts[1].y < pts[2].y && pts[2].y < pts[0].y, 'higher price, smaller y');
  assert.equal(pts[1].y, 8, 'the top of the range sits at the padding');
  assert.equal(pts[0].y, 82);
  const flat = chartPoints([{ week: '2026-11-02', price: 300 }, { week: '2026-11-09', price: 300 }]);
  assert.ok(flat.every((p) => p.y === 45));
  assert.deepEqual(chartPoints([]), []);
  assert.equal(chartPoints(Array.from({ length: 30 }, (_, i) => ({ week: weekStart(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`) || '2026-01-05', price: i + 1 })), { n: 12 }).length <= 12, true);
});

check('owners and managers set the prices; wheat is offered the usual grades', () => {
  assert.ok(canSetPrices('owner') && canSetPrices('manager'));
  for (const r of ['bookkeeper', 'farm_worker', 'driver', 'support', undefined]) assert.ok(!canSetPrices(r), String(r));
  assert.deepEqual(WHEAT_GRADES, ['H1', 'APW1', 'ASW1']);
  assert.ok(isWheat('Durum Wheat') && isWheat('wheat') && !isWheat('Barley'));
});

check('the history goes to the server on the commodity and comes back, and is left out until there is one', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const com = (extra) => ({ id: 'c1', name: 'Wheat', angleOfRepose: 0, testWeight: 0, nPerTonne: 0, mtmPrice: 335, openingStock: 0, retainedSeed: 0, grossMarginCost: 0, unit: 't', ...extra });
  const state = (c) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [c], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [] } } });
  assert.ok(!('price_history' in stateToRows(state(com({})), FARM).commodities[0]), 'a commodity with no history sends no such column, so saving works before the database has it');
  const history = [{ week: '2026-11-09', price: 330 }, { week: '2026-11-16', price: 335, spreads: [{ grade: 'H1', adjust: 40 }] }];
  const rows = stateToRows(state(com({ priceHistory: history })), FARM);
  assert.deepEqual(rows.commodities[0].price_history, history);
  assert.deepEqual(rowsToState(rows).years[2026].commodities[0].priceHistory, history);
  // clearing it after it was set reaches the server as nothing
  assert.equal(stateToRows(state(com({ priceHistory: [], __hasPriceHistory: true })), FARM).commodities[0].price_history, null);
});

check('the database keeps it on the commodity, in the migration and in the paste-everything script', () => {
  assert.ok(read('supabase/migrations/20261208000000_price_history.sql').includes('add column if not exists price_history jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('alter table commodities add column if not exists price_history jsonb'));
});

check('changing the MTM price records the week; setting a week sets every commodity and the latest week sets the MTM price', () => {
  const s = read('docs/js/storage.js');
  assert.ok(s.includes('commodity.mtmPrice !== undefined && Number(merged.mtmPrice) > 0 && Number(merged.mtmPrice) !== Number(before.mtmPrice)'));
  assert.ok(s.includes('recordPrice(merged.priceHistory, { date: todayLocal(), price: merged.mtmPrice, spreads: latestSpreads(merged.priceHistory) })'), 'spreads carry over');
  assert.ok(s.includes('setWeeklyPrices({ date, prices = [] } = {})') && s.includes('if (rows[rows.length - 1].week === week) com.mtmPrice = price;'), 'an older week does not change the MTM price');
  assert.ok(s.includes('com.__hasPriceHistory = true'));
});

check('Prices is a Full tile in Reports, set by owners and managers, and a week saves through the database layer', () => {
  assert.ok(read('docs/js/reportshub.js').includes("tile('prices', 'Prices', 'sheet')"));
  assert.ok(read('docs/js/views/reports.js').includes('prices: () => openPricesSheet()'));
  const v = read('docs/js/views/prices.js');
  assert.ok(v.includes('canSetPrices(db.getRole())') && v.includes('db.setWeeklyPrices({ date, prices })') && v.includes("Spreads by grade (optional)") && v.includes('+ Add a grade'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
