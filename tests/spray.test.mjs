// Run with:
//   node tests/spray.test.mjs
//
// Spray requests: what goes on the contractor's form and where, the totals, the map page, and that a request is saved
// with the farm.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nextSprayNo, sprayDefaults, sprayRows, sprayTotals, sprayProblems, amountText, aircairOps, standardOps, fitText,
  sprayMapPlan, niceLength, AIRCAIR_LAYOUT, AIRCAIR_ROWS, CHECKLIST, plain, sprayTitle,
} from '../docs/js/spray.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { selectDirtyRows, KINDS } from '../docs/js/dirty.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const pads = (n, ha = 100) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `Paddock ${i + 1}`, areaHa: ha + i, crop: 'Wheat', farm: i % 2 ? 'Brolga' : 'Aralu' }));
const job = (o = {}) => ({
  ...sprayDefaults({ business: { entityName: 'Carrigan Farming', address: '1 Mill Rd\nWagga NSW', phone: '0400 000 000', contactName: 'Ben' }, paddocks: pads(2), today: '2026-11-15', jobs: [] }),
  contractor: 'Aircair', dateRequired: '2026-11-20', chemicals: [{ name: 'Glyphosate', rate: '1.2', unit: 'L' }], waterRate: '50', ...o,
});

console.log('\n=== the request ===');

check('job numbers count up from the highest used', () => {
  assert.equal(nextSprayNo([]), 'SJ-001');
  assert.equal(nextSprayNo([{ jobNo: 'SJ-001' }, { jobNo: 'SJ-007' }, { jobNo: 'SJ-003' }]), 'SJ-008');
});
check('a new request starts from what the farm knows: its own details, the farms and crops of the paddocks', () => {
  const j = sprayDefaults({ business: { entityName: 'Carrigan Farming', address: 'Wagga', phone: '0400', contactName: 'Ben' }, paddocks: pads(3), today: '2026-11-15', jobs: [] });
  assert.equal(j.tradingName, 'Carrigan Farming');
  assert.equal(j.property, 'Aralu, Brolga');
  assert.equal(j.crop, 'Wheat');
  assert.equal(j.contacts[0].name, 'Ben');
  assert.equal(j.status, 'draft');
  assert.equal(j.paddocks.length, 3);
});
check('the checklist is never answered for the farmer', () => {
  const j = sprayDefaults({ paddocks: pads(1), jobs: [] });
  assert.ok(CHECKLIST.length === 8);
  assert.ok(CHECKLIST.every((q) => j.checklist[q.key] === ''));
});
check('the last request to a contractor seeds the next one', () => {
  const j = sprayDefaults({ paddocks: pads(1), jobs: [], previous: { contractor: 'Aircair', contractorEmail: 'a@b.c', form: 'aircair', chemicalSuppliedBy: 'Us', contacts: [{ name: 'X', phone: '1', uhf: '' }] } });
  assert.equal(j.contractor, 'Aircair'); assert.equal(j.form, 'aircair'); assert.equal(j.chemicalSuppliedBy, 'Us'); assert.equal(j.contacts[0].name, 'X');
});

console.log('\n=== rates, amounts and totals ===');

check('amounts are the area times the rate, tidied into litres and kilos', () => {
  assert.equal(amountText(1500, 'mL'), '1.5 L');
  assert.equal(amountText(2500, 'g'), '2.5 kg');
  assert.equal(amountText(150.42, 'L'), '150.42 L');
});
check('a row for each paddock and product, with the water on the first row of each paddock', () => {
  const j = job({ chemicals: [{ name: 'A', rate: '1', unit: 'L' }, { name: 'B', rate: '500', unit: 'mL' }, { name: '', rate: '', unit: 'L' }] });
  const rows = sprayRows(j);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].amount, '100 L'); assert.equal(rows[0].spray, '5,000 L');
  assert.equal(rows[1].chemical, 'B'); assert.equal(rows[1].amount, '50 L'); assert.equal(rows[1].spray, '');
});
check('with no product yet there is still a row for each paddock', () => {
  assert.equal(sprayRows(job({ chemicals: [{ name: '', rate: '', unit: 'L' }] })).length, 2);
});
check('totals: hectares, what to mix of each product, and the water', () => {
  const t = sprayTotals(job());
  assert.equal(t.ha, 201); assert.equal(t.paddocks, 2);
  assert.equal(t.chemicals[0].text, '241.2 L');
  assert.equal(t.waterL, 10050);
});
check('what is missing is said before it goes', () => {
  assert.ok(sprayProblems(sprayDefaults({ paddocks: [], jobs: [] })).length >= 4);
  assert.deepEqual(sprayProblems(job()), []);
  assert.ok(sprayProblems(job({ chemicals: [{ name: 'A', rate: '', unit: 'L' }] })).some((p) => p.includes('rate')));
  assert.ok(sprayProblems(job({ form: 'aircair', tradingName: '' })).some((p) => p.includes('trading name')));
});
check('the title names the job, the contractor and the property', () => {
  assert.equal(sprayTitle(job({ jobNo: 'SJ-002' })), 'SJ-002 · Aircair · Aralu, Brolga');
});

console.log("\n=== Aircair's form ===");

const A = AIRCAIR_LAYOUT;
const texts = (ops) => ops.filter((o) => o.t === 'text');
check('their table holds twelve rows', () => assert.equal(AIRCAIR_ROWS, 12));
check('every written line sits on the page, inside its box, and the page 1 rows are where they were measured', () => {
  const { pages } = aircairOps(job({ form: 'aircair', otherInstructions: 'Wind under 15 km/h, keep clear of the dam on the north boundary and the house on Mill Road. Gate code 1234.', poNumber: 'PO-1', uhf: '23' }));
  for (const o of texts(pages[0])) { assert.ok(o.x >= 20 && o.x <= 570 && o.y >= 190 && o.y <= 760, `${o.text} at ${o.x},${o.y}`); }
  const trading = texts(pages[0]).find((o) => o.text === 'Carrigan Farming');
  assert.deepEqual([trading.x, trading.y], [A.tradingName.x, A.tradingName.y]);
  assert.ok(texts(pages[0]).some((o) => o.text === '20-11-2026' && o.x === A.dateRequired.x), 'date as written on paperwork');
});
check('a long address runs on to the blank lines under it', () => {
  const addr = 'Hillview, 123 Mill Road, Wagga Wagga, New South Wales, Australia, a very long address that goes on and on and on and on and on';
  const { pages } = aircairOps(job({ form: 'aircair', address: addr }));
  const ys = new Set(texts(pages[0]).filter((o) => o.y >= 215 && o.y <= 250).map((o) => o.y));
  assert.ok(ys.size >= 2, [...ys].join());
});
check('text too wide for its box is made smaller, then cut', () => {
  const f = fitText('A very long product name that cannot possibly fit in this box', 90, 9);
  assert.ok(f.size < 9 || f.text.endsWith('...'));
  assert.equal(fitText('Short', 200, 9).size, 9);
  assert.ok(fitText('x'.repeat(200), 50, 9).text.endsWith('...'));
});
check('more rows than the table holds: the last row points to the attached list', () => {
  const many = job({ form: 'aircair', paddocks: pads(14) });
  const { pages, overflow } = aircairOps(many);
  assert.equal(sprayRows(many).length, 14);
  assert.equal(overflow, 2);
  assert.ok(texts(pages[0]).some((o) => o.text.startsWith('+ 3 more')), 'the last row says how many are on the list');
  assert.equal(aircairOps(job({ form: 'aircair' })).overflow, 0);
});
check('the checklist: a cross in Yes or No, nothing for what is not answered', () => {
  const { pages } = aircairOps(job({ form: 'aircair', checklist: { q1: 'yes', q2: 'no', q3: '', qI: 'no', qII: '', qIII: '', qIV: 'yes', q4: 'yes' } }));
  const crosses = pages[1].filter((o) => o.t === 'cross');
  assert.equal(crosses.length, 5);
  const q1 = crosses.find((c) => c.cy > A.checkRows.q1[0] && c.cy < A.checkRows.q1[1]);
  assert.ok(q1.cx > A.yn.yes[0] && q1.cx < A.yn.yes[1], 'yes is in the Y column');
  const q2 = crosses.find((c) => c.cy > A.checkRows.q2[0] && c.cy < A.checkRows.q2[1]);
  assert.ok(q2.cx > A.yn.no[0], 'no is in the N column');
  const q4 = crosses.find((c) => c.cy > A.checkRows.q4[0] && c.cy < A.checkRows.q4[1]);
  assert.ok(q4.cx > A.q4Cols.yes[0] && q4.cx < A.q4Cols.yes[1], 'the airstrip question has its own columns');
});
check('neighbours, the printed name and the date go on page 2', () => {
  const { pages } = aircairOps(job({ form: 'aircair', signedBy: 'Ben Carrigan', neighbours: [{ name: 'J Smith', phone: '0411', contacted: 'yes' }, { name: '', phone: '', contacted: '' }, { name: '', phone: '', contacted: '' }], today: '2026-11-15' }));
  const t = texts(pages[1]);
  assert.ok(t.some((o) => o.text === 'J Smith' && o.y < 440));
  assert.ok(t.some((o) => o.text === 'Yes'));
  assert.ok(t.some((o) => o.text === 'Ben Carrigan' && o.y === A.signedName.y));
  assert.deepEqual(['15', '11', '2026'].map((s) => t.some((o) => o.text === s)), [true, true, true]);
});
check('the form is in the repository', () => {
  assert.ok(existsSync(join(ROOT, 'docs/forms/aircair-spray-request.pdf')));
  assert.ok(read('docs/js/spraypdf.js').includes('./forms/aircair-spray-request.pdf'));
});

console.log('\n=== our own form ===');

check('the form says who it is from and to, what goes on, and each paddock', () => {
  const { ops } = standardOps(job({ contractorEmail: 'a@b.c' }));
  const all = texts(ops).map((o) => o.text).join('|');
  for (const s of ['SPRAY REQUEST', 'Carrigan Farming', 'Aircair', 'a@b.c', 'Glyphosate', 'Paddock 1', 'Paddock 2', 'Total']) assert.ok(all.includes(s), s);
  assert.ok(texts(ops).every((o) => o.y < 842 && o.x >= 0));
});
check('a long list is cut where the page ends, and says how many are on the list', () => {
  const r = standardOps(job({ paddocks: pads(60) }));
  assert.ok(r.rowsShown < 60);
  assert.ok(texts(r.ops).some((o) => /more rows/.test(o.text)));
  assert.ok(texts(r.ops).every((o) => o.y <= 800));
});

console.log('\n=== the map page ===');

// two square paddocks 1 km apart, in metres
const sq = (id, x, y, w = 400) => ({ id, name: id, areaHa: (w * w) / 10000, d: `M${x} ${y}L${x + w} ${y}L${x + w} ${y + w}L${x} ${y + w}Z`, cx: x + w / 2, cy: y + w / 2, bbox: [x, y, x + w, y + w] });
const items = [sq('a', 0, 0), sq('b', 1400, 0), sq('c', 0, 1400), sq('far', 20000, 20000)];
const box = { x: 40, y: 100, w: 515, h: 470 };
check('the picture is fitted to the paddocks chosen, with room around them', () => {
  const plan = sprayMapPlan({ items, selectedIds: ['a', 'b'], box });
  assert.ok(plan.draw.find((d) => d.id === 'a').selected && plan.draw.find((d) => d.id === 'b').selected);
  assert.ok(!plan.draw.some((d) => d.id === 'far'), 'a paddock far away is left out');
  // both chosen paddocks are entirely inside the box
  for (const id of ['a', 'b']) {
    const it = items.find((i) => i.id === id);
    const x0 = box.x + (it.bbox[0] - plan.vx0) * plan.s; const x1 = box.x + (it.bbox[2] - plan.vx0) * plan.s;
    assert.ok(x0 >= box.x && x1 <= box.x + box.w, `${id} fits across`);
  }
});
check('the paddocks to spray are always named, the others only when they are big enough on the page', () => {
  const plan = sprayMapPlan({ items, selectedIds: ['a'], box });
  assert.ok(plan.labels.find((l) => l.id === 'a'));
  assert.ok(plan.labels.every((l) => l.x >= box.x && l.x <= box.x + box.w && l.y >= box.y && l.y <= box.y + box.h));
});
check('with nothing chosen the whole map is shown', () => {
  const plan = sprayMapPlan({ items: items.slice(0, 3), selectedIds: [], box });
  assert.equal(plan.draw.length, 3);
});
check('the scale bar is a round length that fits', () => {
  assert.equal(niceLength(730), 500); assert.equal(niceLength(2600), 2500); assert.equal(niceLength(10), 50);
  const plan = sprayMapPlan({ items, selectedIds: ['a', 'b'], box });
  assert.ok(plan.scaleBar.widthPt <= box.w * 0.35);
  assert.match(plan.scaleBar.label, /^(\d+ m|[\d.]+ km)$/);
});
check('plain numbers drop trailing zeros', () => {
  assert.equal(plain(12.5), '12.5'); assert.equal(plain(1250.456), '1,250.46'); assert.equal(plain(3), '3');
});

console.log('\n=== saved with the farm ===');

check('a request is stored in its own table, with the form as one json document, and comes back whole', () => {
  const j = job({ id: 'j1', jobNo: 'SJ-001', status: 'sent' });
  const state = { currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], freightOrders: [], inputStock: [], sprayJobs: [j] } } };
  const rows = stateToRows(state, '11111111-1111-1111-1111-111111111111');
  assert.equal(rows.spray_jobs.length, 1);
  const r = rows.spray_jobs[0];
  assert.equal(r.job_no, 'SJ-001'); assert.equal(r.contractor, 'Aircair'); assert.equal(r.status, 'sent'); assert.equal(r.date_required, '2026-11-20');
  assert.equal(r.body.waterRate, '50'); assert.equal(r.body.paddocks.length, 2);
  assert.ok(!('id' in r.body) && !('contractor' in r.body), 'the scalar columns are not repeated in the body');
  const got = rowsToState(rows).years[2026].sprayJobs[0];
  assert.equal(got.jobNo, 'SJ-001'); assert.equal(got.form, 'standard'); assert.equal(got.status, 'sent'); assert.equal(got.waterRate, '50'); assert.deepEqual(got.chemicals, j.chemicals);
});
check('only a request changed on this device is sent', () => {
  assert.ok(KINDS.includes('sprayjob'));
  const rows = { seasons: [{ id: 's', label: '2026' }], spray_jobs: [{ id: 'a', season_id: 's' }, { id: 'b', season_id: 's' }] };
  const out = selectDirtyRows(rows, { years: { 2026: { __seasonId: 's' } } }, [{ kind: 'sprayjob', id: 'b' }]);
  assert.deepEqual(out.spray_jobs.map((r) => r.id), ['b']);
});
check('the table is owner and manager only, and is on the delete function', () => {
  const sql = read('supabase/migrations/20261115100000_spray_jobs.sql');
  assert.ok(sql.includes('create table if not exists spray_jobs'));
  for (const verb of ['select', 'insert', 'update']) assert.ok(new RegExp(`create policy spray_jobs_${verb} on spray_jobs`).test(sql), verb);
  assert.ok(!sql.includes("'bookkeeper'") || sql.indexOf("'bookkeeper'") > sql.indexOf('soft_delete_row'), 'no bookkeeper or driver policy on the table');
  assert.ok(sql.includes("'input_stock', 'spray_jobs'"));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('create table if not exists spray_jobs'));
});
check('only owners and managers are given writes to it', () => {
  const s = read('docs/js/sync.js');
  const line = (role) => new RegExp(`${role}:[^\\n]*`).exec(s)?.[0] || '';
  assert.ok(!/spray_jobs/.test(line('bookkeeper')) && !/spray_jobs/.test(line('farm_worker')), 'not bookkeeper or farm worker');
  assert.ok(/spray_jobs/.test(s));
});
check('wired in: the Production button, picking on the map, and sending as a PDF', () => {
  const p = read('docs/js/views/production.js');
  for (const t of ['open-spray', 'openSprayJobsSheet', 'openSprayFormSheet', 'onSpray']) assert.ok(p.includes(t), t);
  const m = read('docs/js/views/farmmap.js');
  for (const t of ['pick', 'fm-pickdone', 'fm-spray', 'onSpray']) assert.ok(m.includes(t), t);
  const v = read('docs/js/views/spray.js');
  for (const t of ['buildSprayPdf', 'sharePdf', 'downloadFile', 'upsertSprayJob', 'deleteSprayJob', 'Pick on the map', 'sp-usesig']) assert.ok(v.includes(t), t);
  const s = read('docs/js/storage.js');
  for (const t of ['getSprayJobs', 'upsertSprayJob', 'deleteSprayJob']) assert.ok(s.includes(t), t);
});
check('the farm map can be sent as a PDF too, with every paddock named only where there is room', () => {
  const m = read('docs/js/views/farmmap.js');
  for (const t of ['fm-pdf', 'buildFarmMapPdf', 'sharePdf', 'readHidden()']) assert.ok(m.includes(t), t);
  assert.ok(read('docs/js/spraypdf.js').includes('export async function buildFarmMapPdf'));
  const crowded = Array.from({ length: 40 }, (_, i) => sq(`c${i}`, (i % 8) * 40, Math.floor(i / 8) * 40, 30));
  const plan = sprayMapPlan({ items: crowded, selectedIds: [], box, margin: 0.06, minSpanM: 600, named: true });
  assert.ok(plan.labels.length < 40, 'small paddocks on a crowded page are not all labelled');
  const tiny = sprayMapPlan({ items: crowded, selectedIds: ['c3'], box, margin: 0.06, minSpanM: 600, named: true });
  assert.ok(tiny.labels.some((l) => l.id === 'c3'), 'a chosen one always is');
});
check('the PDF library is only fetched when a request is made, from the vendor host the service worker caches', () => {
  const s = read('docs/js/spraypdf.js');
  assert.ok(s.includes('https://esm.sh/pdf-lib@1.17.1'));
  assert.ok(!/^import .*pdf-lib/m.test(s), 'not a static import');
  assert.ok(read('docs/sw.js').includes("'esm.sh'"));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
