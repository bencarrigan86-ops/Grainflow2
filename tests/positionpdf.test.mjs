// Run with:
//   node tests/positionpdf.test.mjs
//
// The Position screen as a PDF: it is a real PDF, every commodity is on it with the figures the screen shows, the
// whole-farm lines follow, and an empty farm and a loss are handled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positionPdf, POSITION_COLUMNS, DEFAULT_COLUMNS, COLUMN_PRESETS, layoutFor, blendedPrice } from '../docs/js/positionpdf.js';
import { textWidth } from '../docs/js/pdf.js';
import { positionRows, positionTotals, farmProfitLoss } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const commodities = [
  { id: 'w', name: 'Wheat', mtmPrice: 400, grossMarginCost: 100000 },
  { id: 'c', name: 'Canola', mtmPrice: 800, grossMarginCost: 50000 },
];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', yieldTHa: 4, yieldMode: 'estimate' },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'c', yieldTHa: 2, yieldMode: 'estimate' },
];
const sales = [{ id: 's1', commodityId: 'w', tons: 500, price: 420, freight: 0, leviesPct: 0, tonsDelivered: 0 }];
const overheads = { finance: 30000, wages: 20000 };

const build = (over = {}) => {
  const rows = positionRows(commodities, fields, sales, []);
  const totals = positionTotals(rows);
  const cost = { total: 0, brokerage: 0, freight: 0, storage: 0, other: 0, ...over.cost };
  const pl = farmProfitLoss(totals.grossMargin, over.overheads ?? overheads, totals.openingValue, cost.total);
  return { rows, totals, overheads: over.overheads ?? overheads, pl, cost };
};
const text = (bytes) => Buffer.from(bytes).toString('latin1');

check('it is a PDF, landscape A4', () => {
  const s = text(positionPdf(build(), { business: 'Test Farm', season: 'Sample 2026', today: '16/11/2026' }));
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 841.89 595.28]'), 'not landscape');
});

check('the title, the farm, the season and the day are on it', () => {
  const s = text(positionPdf(build(), { business: 'Test Farm', season: 'Sample 2026', today: '16/11/2026' }));
  for (const w of ['POSITION', 'Test Farm', 'Sample 2026', 'Printed 16/11/2026']) assert.ok(s.includes(`(${w}`) || s.includes(w), `missing ${w}`);
});

check('each commodity is a row, with its produced, sold and unsold tonnes and its values', () => {
  const data = build();
  const s = text(positionPdf(data));
  const wheat = data.rows.find((r) => r.commodity.name === 'Wheat');
  assert.equal(Math.round(wheat.productionTons), 800);
  for (const w of ['(Wheat)', '(Canola)', '(800 t)', '(500 t)', '(300 t)', '(200 t)', '($210,000)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('the columns fit the page: their widths add up to the table width, no more', () => {
  const sum = POSITION_COLUMNS.reduce((a, c) => a + c.w, 0);
  assert.ok(Math.abs(sum - 1) < 0.0005, `columns add up to ${sum.toFixed(3)} of the width`);
});

check('every figure and heading fits its column, even on a farm forty times the size', () => {
  const rows = positionRows(commodities, fields, sales, []).map((r) => ({
    ...r, area: r.area * 40, productionTons: r.productionTons * 40, soldTons: r.soldTons * 40, unsoldTons: r.unsoldTons * 40,
    soldValue: r.soldValue * 40, unsoldValue: r.unsoldValue * 40, totalValue: r.totalValue * 40, grossMarginCost: r.grossMarginCost * 40,
    grossMargin: r.grossMargin * 40, commodity: { ...r.commodity, name: 'Chickpeas' },
  }));
  const totals = positionTotals(rows);
  const W = 841.89 - 72;
  for (const keys of [POSITION_COLUMNS.map((c) => c.key), DEFAULT_COLUMNS, ...COLUMN_PRESETS.map((p) => p.keys)]) {
    const { columns, body: BODY, head: HEAD, pad: PAD } = layoutFor(keys);
    columns.forEach((c) => {
      const heading = textWidth(c.label, HEAD, true);
      const body = Math.max(...[...rows.map((r) => c.cell(r)), c.total(totals)].map((s) => textWidth(String(s), BODY, true)));
      const room = c.w * W - PAD;
      assert.ok(heading <= room + 4 && body <= room, `${columns.length} columns, ${c.label}: needs ${Math.max(heading, body).toFixed(1)} of ${room.toFixed(1)}`);
    });
  }
});

check('headings and figures are centred in their columns, the commodity name on the left', () => {
  const s = text(positionPdf(build()));
  const W = 841.89 - 72;
  const { columns: shown, head: HEAD } = layoutFor();
  const edges = shown.reduce((a, c) => { a.push(a[a.length - 1] + c.w * W); return a; }, [36]);
  const items = [...s.matchAll(/\/F\d ([\d.]+) Tf ([\d.-]+) [\d.-]+ Td \((.*?)\) Tj/g)].map((m) => ({ size: +m[1], x: +m[2], t: m[3].replace(/\\/g, '') }));   // the file escapes ( and ) with a backslash
  const widthOf = (t, size) => textWidth(t, size, true);
  // the heading of every figure column: the middle of the text sits on the middle of the column
  shown.slice(1).forEach((c, k) => {
    const i = k + 1;
    const mid = (edges[i] + edges[i + 1]) / 2;
    const it = items.find((q) => q.t === c.label && q.size === HEAD);
    assert.ok(it, `no heading ${c.label}`);
    const centre = it.x + widthOf(it.t, HEAD) / 2;
    assert.ok(Math.abs(centre - mid) < 3, `${c.label} is ${Math.abs(centre - mid).toFixed(1)}pt off the middle of its column`);
  });
  const name = items.find((q) => q.t === 'Wheat');
  assert.ok(Math.abs(name.x - (edges[0] + 4)) < 0.5, 'the commodity name should stay on the left');
});

check('cost and cost per hectare sit just before the gross margin', () => {
  const labels = POSITION_COLUMNS.map((c) => c.label);
  const at = labels.indexOf('Gross margin');
  assert.deepEqual(labels.slice(at - 2, at), ['Cost', 'Cost $/ha']);
  const data = build();
  const wheat = data.rows.find((r) => r.commodity.name === 'Wheat');
  const costCol = POSITION_COLUMNS[at - 2];
  const perHa = POSITION_COLUMNS[at - 1];
  assert.equal(costCol.cell(wheat), '$100,000');
  assert.equal(perHa.cell(wheat), '$500');                       // 100,000 over 200 ha
  assert.equal(costCol.total(data.totals), '$150,000');
  assert.equal(perHa.total(data.totals), '$500');                // 150,000 over 300 ha
  const s = text(positionPdf(data));
  for (const w of ['(Cost)', '(Cost $/ha)', '($100,000)', '($500)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a commodity with no cost entered shows a dash, not a nought', () => {
  const free = { ...positionRows(commodities, fields, sales, [])[0], grossMarginCost: 0 };
  const at = POSITION_COLUMNS.findIndex((c) => c.label === 'Cost');
  assert.equal(POSITION_COLUMNS[at].cell(free), '-');
  assert.equal(POSITION_COLUMNS[at + 1].cell(free), '-');
  assert.equal(POSITION_COLUMNS[at + 1].cell({ ...free, grossMarginCost: 500, area: 0 }), '-', 'no hectares: no per-hectare cost');
});

check('it wears the app green, as the load ticket does: a band on top, a green table heading, tinted bands between', () => {
  const s = text(positionPdf(build()));
  assert.ok(s.includes('0.18 0.49 0.2 rg'), 'no green fill');
  const fills = [...s.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) => m[0]);
  const count = (c) => fills.filter((f) => f === c).length;
  assert.ok(count('0.18 0.49 0.2 rg') >= 3, 'the title band, the table heading and the tile edges should all be green');
  assert.ok(count('0.93 0.96 0.93 rg') >= 3, 'no banded rows');
  assert.ok(s.includes('0.82 0.9 0.83 rg'), 'the total row is not shaded');
});

check('every second commodity row is banded, starting with the second', () => {
  const more = [{ id: 'b', name: 'Barley', mtmPrice: 300, grossMarginCost: 1000 }, { id: 'p', name: 'Pulses', mtmPrice: 700, grossMarginCost: 1000 }];
  const cs = [...commodities, ...more];
  const fs = [...fields, { id: 'f3', name: 'East', areaHa: 50, commodityId: 'b', yieldTHa: 4, yieldMode: 'estimate' }, { id: 'f4', name: 'West', areaHa: 50, commodityId: 'p', yieldTHa: 1.5, yieldMode: 'estimate' }];
  const rows = positionRows(cs, fs, [], []);
  assert.equal(rows.length, 4);
  const totals = positionTotals(rows);
  const s = text(positionPdf({ rows, totals, overheads: {}, pl: farmProfitLoss(totals.grossMargin, {}, 0, 0), cost: {} }));
  // a banded row is one tint-filled rectangle spanning the table: two of four rows, and none for an empty list
  const wide = [...s.matchAll(/0\.93 0\.96 0\.93 rg\s+36 [\d.]+ 769\.89 18 re f/g)].length;
  assert.equal(wide, 2, `${wide} banded rows`);
});

check('the total row adds the commodities up', () => {
  const data = build();
  const total = POSITION_COLUMNS.map((c) => c.total(data.totals));
  assert.equal(total[0], 'Total');
  const at = (label) => POSITION_COLUMNS.findIndex((c) => c.label === label);
  assert.equal(total[at('Produced')], '1,000 t');
  assert.equal(total[at('Sold')], '500 t');
});

check('opening tonnes and value, and the average $/t of sold at contract and unsold at MTM, are columns', () => {
  const labels = POSITION_COLUMNS.map((c) => c.label);
  assert.deepEqual(labels.slice(3, 5), ['Opening', 'Opening value'], 'opening sits before produced');
  assert.equal(labels[labels.indexOf('MTM') + 1], 'Avg $/t');
  const col = (l) => POSITION_COLUMNS.find((c) => c.label === l);
  const rows = positionRows([{ id: 'w', name: 'Wheat', mtmPrice: 400, openingStock: 100, openingValue: 36000 }], [], [], []);
  assert.equal(col('Opening').cell(rows[0]), '100 t');
  assert.equal(col('Opening value').cell(rows[0]), '$36,000');
  assert.equal(col('Opening').total(positionTotals(rows)), '100 t');
  assert.equal(col('Opening value').total(positionTotals(rows)), '$36,000');
  assert.equal(col('Opening').cell({ opening: 0 }), '-');
  // 500 t sold at $420 and 300 t unsold at $400 MTM: (210,000 + 120,000) / 800 t = $412.50, shown to the dollar
  const wheat = positionRows(commodities, fields, sales, []).find((r) => r.commodity.name === 'Wheat');
  assert.equal(Math.round(blendedPrice(wheat) * 100) / 100, 412.5);
  assert.equal(col('Avg $/t').cell(wheat), '$413');
  assert.equal(col('Avg $/t').cell({ soldTons: 0, unsoldTons: 0 }), '-');
  const total = positionTotals(positionRows(commodities, fields, sales, []));
  assert.equal(blendedPrice(total), (total.soldValue + total.unsoldValue) / (total.soldTons + total.unsoldTons));
});

check('whole farm: gross margin, overheads and the profit follow the table', () => {
  const data = build();
  const s = text(positionPdf(data));
  for (const w of ['Whole farm', 'Gross margin', 'Overheads', 'Total overheads', '(Finance)', '(Wages)', '(Profit)']) assert.ok(s.includes(w), `missing ${w}`);
  assert.ok(data.pl.profitLoss > 0);
});

check('bills are listed only when there are some', () => {
  assert.ok(!text(positionPdf(build())).includes('Bills taken off profit'));
  const s = text(positionPdf(build({ cost: { total: 6000, brokerage: 4000, freight: 2000, storage: 0, other: 0 } })));
  for (const w of ['Bills taken off profit', '(Brokerage)', '(-$6,000)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a loss is called a loss, in the minus', () => {
  const data = build({ overheads: { finance: 900000 } });
  assert.ok(data.pl.profitLoss < 0);
  const s = text(positionPdf(data));
  assert.ok(s.includes('(Loss)') && !s.includes('(Profit)'));
});

check('each result line is green or red by its own sign: a loss made good by opening stock is red, then green', () => {
  const withOpening = [{ ...commodities[0], openingStock: 100, openingValue: 50000 }, commodities[1]];
  const rows = positionRows(withOpening, fields, sales, []);
  const totals = positionTotals(rows);
  // overheads set to leave a loss of 10,000 before the opening stock's 50,000 is counted
  const overheads2 = { finance: Math.round(totals.grossMargin) + 10000 };
  const pl = farmProfitLoss(totals.grossMargin, overheads2, totals.openingValue, 0);
  assert.ok(pl.profitLoss < 0 && pl.profitWithOpening > 0, `needs a loss that opening stock turns round: ${pl.profitLoss}, ${pl.profitWithOpening}`);
  const s = text(positionPdf({ rows, totals, overheads: overheads2, pl, cost: {} }));
  const red = [...s.matchAll(/0\.72 0\.18 0\.15 rg/g)].length;
  assert.equal(red, 2, `${red} red texts: the Loss label and figure only`);
});

check('the whole farm result and the overheads can each be left off, or both', () => {
  const data = build({ cost: { total: 6000, brokerage: 4000, freight: 2000, storage: 0, other: 0 } });
  const headings = (s) => [...s.matchAll(/\/F2 12 Tf ([\d.-]+) [\d.-]+ Td \((.*?)\) Tj/g)].map((m) => ({ x: +m[1], t: m[2] })).filter((h) => h.t);   // the season in the title band is also 12pt
  const all = headings(text(positionPdf(data)));
  assert.deepEqual(all.map((h) => h.t), ['Whole farm', 'Overheads', 'Bills taken off profit']);

  const noResult = text(positionPdf(data, { show: { result: false } }));
  assert.deepEqual(headings(noResult).map((h) => h.t), ['Overheads', 'Bills taken off profit']);
  assert.ok(!noResult.includes('(Loss)') && !noResult.includes('(Profit)') && noResult.includes('(Total overheads)'));
  assert.ok(headings(noResult)[0].x < 40, 'on its own, the overheads should take the left of the page');

  const noOver = text(positionPdf(data, { show: { overheads: false } }));
  assert.deepEqual(headings(noOver).map((h) => h.t), ['Whole farm']);
  assert.ok(!noOver.includes('Total overheads') && !noOver.includes('Bills taken off profit') && noOver.includes('(Profit)'));

  const neither = text(positionPdf(data, { show: { result: false, overheads: false } }));
  assert.ok(neither.startsWith('%PDF') && neither.includes('(Wheat)') && neither.includes('(Total)'), 'the table must stay');
  assert.deepEqual(headings(neither), []);
  assert.ok(neither.includes('Made in Commodity Mate'), 'the footer must stay');
});

check('the Position screen asks what goes at the bottom, and remembers the answer', () => {
  const v = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');
  assert.ok(v.includes("tick('pp-result'") && v.includes("tick('pp-over'") && v.includes("'grainflow.positionpdf'"), 'no ticks, or not remembered');
  assert.ok(/openPdfSheet\(\{ rows, totals, overheads, pl, cost \}\)/.test(v), 'the button does not open the sheet');
  assert.ok(v.includes('exportPdf(data, show)') && v.includes('positionPdf(data, {'), 'the choice does not reach the file');
});

check('opening stock adds its two lines and renames the value', () => {
  const withOpening = [{ ...commodities[0], openingStock: 100, openingValue: 30000 }, commodities[1]];
  const rows = positionRows(withOpening, fields, sales, []);
  const totals = positionTotals(rows);
  const pl = farmProfitLoss(totals.grossMargin, overheads, totals.openingValue, 0);
  const s = text(positionPdf({ rows, totals, overheads, pl, cost: {} }));
  for (const w of ['CURRENT CROP VALUE', '(Plus opening stock value)', '(Total including opening stock)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('an empty farm gets a page that says so, not a table of nothing', () => {
  const s = text(positionPdf({ rows: [], totals: positionTotals([]), overheads: {}, pl: farmProfitLoss(0, {}, 0, 0), cost: {} }));
  assert.ok(s.startsWith('%PDF') && s.includes('Nothing to report yet'));
  assert.ok(!s.includes('Whole farm'));
});

check('a long list of commodities runs onto a second page without losing any', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `Crop ${i}`, mtmPrice: 300, grossMarginCost: 1000 }));
  const fs2 = many.map((c, i) => ({ id: `f${i}`, name: `P${i}`, areaHa: 10, commodityId: c.id, yieldTHa: 3, yieldMode: 'estimate' }));
  const rows = positionRows(many, fs2, [], []);
  const totals = positionTotals(rows);
  const s = text(positionPdf({ rows, totals, overheads, pl: farmProfitLoss(totals.grossMargin, overheads, 0, 0), cost: {} }));
  assert.ok(/\/Count [2-9]/.test(s), 'still one page');
  assert.ok(s.includes('(Crop 0)') && s.includes('(Crop 39)'));
  assert.ok(s.includes('page 2'));
});

check('the Position screen offers it, and shares or downloads the file by device', () => {
  const v = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');
  assert.ok(v.includes('id="position-pdf"') && v.includes('positionPdf('), 'no button or no call');
  assert.ok(v.includes('canShareFiles()') && v.includes('downloadFile(') && v.includes('sharePdf('), 'not shared or downloaded');
  assert.ok(v.includes('rows.length ?'), 'offered with nothing to report');
});

check('which columns print is a choice: the standard set by default, the commodity always, widths fill the page, in the table own order', () => {
  const std = layoutFor();
  assert.deepEqual(std.columns.map((c) => c.key), DEFAULT_COLUMNS);
  assert.ok(!DEFAULT_COLUMNS.includes('opening') && !DEFAULT_COLUMNS.includes('avgAll'), 'the added columns are opt-in');
  for (const keys of [undefined, [], ['nonsense'], ['gross', 'sold'], POSITION_COLUMNS.map((c) => c.key), COLUMN_PRESETS[1].keys]) {
    const l = layoutFor(keys);
    assert.equal(l.columns[0].key, 'commodity', 'the commodity is always first');
    assert.ok(Math.abs(l.columns.reduce((a, c) => a + c.w, 0) - 1) < 1e-9, 'the widths fill the table');
  }
  assert.deepEqual(layoutFor(['grossMargin', 'sold']).columns.map((c) => c.key), ['commodity', 'sold', 'grossMargin'], 'table order, not the order asked for');
  assert.deepEqual(layoutFor(['nonsense']).columns.map((c) => c.key), DEFAULT_COLUMNS, 'nothing real chosen: the defaults');
  assert.ok(layoutFor(DEFAULT_COLUMNS).body > layoutFor(POSITION_COLUMNS.map((c) => c.key)).body, 'fewer columns, larger type');
  assert.equal(layoutFor(POSITION_COLUMNS.map((c) => c.key)).columns.length, 18);
});

check('the presets: Standard is the default set, Summary is short, Everything is all eighteen', () => {
  assert.deepEqual(COLUMN_PRESETS.map((p) => p.label), ['Standard', 'Summary', 'Everything']);
  assert.deepEqual(COLUMN_PRESETS[0].keys, DEFAULT_COLUMNS);
  assert.equal(COLUMN_PRESETS[2].keys.length, 18);
  assert.ok(COLUMN_PRESETS[1].keys.length < 10 && COLUMN_PRESETS[1].keys.includes('avgAll'));
  for (const p of COLUMN_PRESETS) for (const k of p.keys) assert.ok(POSITION_COLUMNS.some((c) => c.key === k), `${p.id} names a column that is not there: ${k}`);
});

check('the PDF prints only the columns chosen', () => {
  const data = build();
  const s = text(positionPdf(data, { show: { columns: ['sold', 'avgAll'], result: false, overheads: false } }));
  for (const w of ['(Commodity)', '(Sold)', '(Avg $/t)']) assert.ok(s.includes(w), `missing ${w}`);
  for (const w of ['(Cost)', '(Gross margin)', '(Produced)', '(Opening)']) assert.ok(!s.includes(w), `${w} should be off`);
  const everything = text(positionPdf(data, { show: { columns: POSITION_COLUMNS.map((c) => c.key), result: false, overheads: false } }));
  for (const w of ['(Opening)', '(Opening value)', '(Avg $/t)', '(Gross margin)']) assert.ok(everything.includes(w), `missing ${w}`);
  assert.ok(!text(positionPdf(data)).includes('(Opening value)'), 'by default the opening columns are not printed');
});

check('the sheet offers the presets and a tick for every column, remembers them, and sends them to the PDF', () => {
  const v = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');
  assert.ok(v.includes('COLUMN_PRESETS.map') && v.includes('POSITION_COLUMNS.map(colTick)'), 'presets and a tick for each column');
  assert.ok(v.includes('data-col') && v.includes("columns: columns.length > 1 ? columns : DEFAULT_COLUMNS"), 'the choice is read from the ticks');
  assert.ok(v.includes('saveShow(show)') && v.includes('columns: keys.length ? keys : DEFAULT_COLUMNS'), 'remembered on this device');
});

check('Position: the Produced tile shows opening stock and total tons when there is opening stock, and each crop tile shows its margin per hectare', () => {
  const v = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');
  assert.ok(v.includes('openingTons > 0') && v.includes('Total volume') && v.includes('Total produced'), 'total volume, less open stock, is the total produced, like the value tile');
  assert.ok(v.includes('openingTons + totals.productionTons') && v.includes('<span class="n">${tons(totals.productionTons, 0)}${andBales}</span>'), 'volume is opening plus produced; produced is the big figure');
  assert.ok(v.includes('r.grossMargin / r.area, 0)}/ha') && v.includes("label: 'Margin /ha'"), 'the crop tile has its margin, % and per hectare in the same columns as the figures above');
  assert.ok(!v.includes('class="dc-gm"') && !v.includes('class="dc-foot"'), 'and not beside the value or in a line of their own');
  const t = positionTotals(positionRows([{ id: 'w', name: 'Wheat', mtmPrice: 400, openingStock: 100, openingValue: 36000 }, { id: 'b', name: 'Barley', mtmPrice: 300, openingStock: 50 }], [], [], []));
  assert.equal(t.openingTons, 150);
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
