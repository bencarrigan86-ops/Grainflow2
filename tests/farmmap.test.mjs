// Run with:
//   node tests/farmmap.test.mjs
//
// The farm map: reading a shapefile and a zip of one, the area of an outline, matching outlines to paddocks by name,
// and laying the map out. The shapefiles here are built in the test, so no one's real paddocks are in the repository.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  parseDbf, parseShp, readBoundaries, unzipFiles, simplifyRing, simplifyRings, ringsAreaHa, normName, matchBoundaries, mapLayout, PALETTE, NO_CROP,
} from '../docs/js/farmmap.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// --- building files to read ---------------------------------------------------------------------------------

/** A .shp of polygon records; each record is a list of rings. */
function makeShp(records, type = 5) {
  const recs = records.map((rings, i) => {
    const pts = rings.flat();
    const len = 44 + rings.length * 4 + pts.length * 16;
    const b = Buffer.alloc(8 + len);
    b.writeInt32BE(i + 1, 0); b.writeInt32BE(len / 2, 4);
    b.writeInt32LE(type, 8);
    b.writeInt32LE(rings.length, 8 + 36); b.writeInt32LE(pts.length, 8 + 40);
    let at = 0;
    rings.forEach((r, k) => { b.writeInt32LE(at, 8 + 44 + k * 4); at += r.length; });
    pts.forEach(([x, y], k) => { b.writeDoubleLE(x, 8 + 44 + rings.length * 4 + k * 16); b.writeDoubleLE(y, 8 + 44 + rings.length * 4 + k * 16 + 8); });
    return b;
  });
  const head = Buffer.alloc(100);
  head.writeInt32BE(9994, 0);
  head.writeInt32BE((100 + recs.reduce((s, r) => s + r.length, 0)) / 2, 24);
  head.writeInt32LE(1000, 28); head.writeInt32LE(type, 32);
  return new Uint8Array(Buffer.concat([head, ...recs]));
}

/** A .dbf with text columns. */
function makeDbf(cols, rows) {
  const recLen = 1 + cols.reduce((s, c) => s + c.len, 0);
  const headLen = 32 + cols.length * 32 + 1;
  const b = Buffer.alloc(headLen + rows.length * recLen + 1, 0x20);
  b[0] = 3; b.writeUInt32LE(rows.length, 4); b.writeUInt16LE(headLen, 8); b.writeUInt16LE(recLen, 10);
  cols.forEach((c, i) => { const o = 32 + i * 32; b.fill(0, o, o + 32); b.write(c.name, o, 'latin1'); b[o + 11] = 'C'.charCodeAt(0); b[o + 16] = c.len; });
  b[32 + cols.length * 32] = 0x0d;
  rows.forEach((r, i) => {
    let p = headLen + i * recLen; b[p] = 0x20; p += 1;
    cols.forEach((c) => { b.fill(0x20, p, p + c.len); b.write(String(r[c.name] ?? ''), p, 'utf8'); p += c.len; });
  });
  return new Uint8Array(b);
}

/** A zip of files, deflated or stored. */
function makeZip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, data, stored] of files) {
    const nameB = Buffer.from(name);
    const comp = stored ? Buffer.from(data) : deflateRawSync(Buffer.from(data));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(stored ? 0 : 8, 10);
    cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameB.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameB, comp); central.push(cen, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

// a square 0.01 degrees on a side near the border of NSW and Queensland, wound clockwise as shapefiles do
const square = (x, y, d) => [[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]];
const hole = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];   // the other way round
const LAT = -28.7;
const NAMES = [{ name: 'FIELD_NAME', len: 20 }, { name: 'FARM_NAME', len: 20 }];

console.log('=== reading the files ===');

await check('a shapefile gives rings per record, and its table gives the names', () => {
  const shp = makeShp([[square(149.8, LAT, 0.01)], [square(149.82, LAT, 0.01), hole(149.822, LAT + 0.002, 0.002)]]);
  const rings = parseShp(shp);
  assert.equal(rings.length, 2);
  assert.equal(rings[0].length, 1);
  assert.equal(rings[1].length, 2, 'a paddock with a hole has two rings');
  assert.deepEqual(rings[0][0][1], [149.8, LAT + 0.01]);
  const rows = parseDbf(makeDbf(NAMES, [{ FIELD_NAME: 'A 1', FARM_NAME: 'Aralu' }, { FIELD_NAME: 'A 3-4', FARM_NAME: 'Aralu' }]));
  assert.deepEqual(rows, [{ FIELD_NAME: 'A 1', FARM_NAME: 'Aralu' }, { FIELD_NAME: 'A 3-4', FARM_NAME: 'Aralu' }]);
});
await check('the paddock name is taken from FIELD_NAME, and the property from FARM_NAME', () => {
  const { features, nameKey } = readBoundaries(makeShp([[square(149.8, LAT, 0.01)], [square(149.82, LAT, 0.01)]]), makeDbf(NAMES, [{ FIELD_NAME: 'A 1', FARM_NAME: 'Aralu' }, { FIELD_NAME: 'B 2', FARM_NAME: 'Bunya' }]));
  assert.equal(nameKey, 'FIELD_NAME');
  assert.deepEqual(features.map((f) => [f.name, f.farm]), [['A 1', 'Aralu'], ['B 2', 'Bunya']]);
});
await check('a table with other column names falls back to NAME, then the first column', () => {
  const one = readBoundaries(makeShp([[square(149.8, LAT, 0.01)]]), makeDbf([{ name: 'Id', len: 4 }, { name: 'NAME', len: 10 }], [{ Id: '1', NAME: 'Home' }]));
  assert.equal(one.features[0].name, 'Home');
  const two = readBoundaries(makeShp([[square(149.8, LAT, 0.01)]]), makeDbf([{ name: 'Label', len: 10 }], [{ Label: 'Back' }]));
  assert.equal(two.features[0].name, 'Back');
});
await check('lines and points are refused, and so is something that is not a shapefile', () => {
  assert.throws(() => parseShp(makeShp([[[[0, 0], [1, 1], [2, 2], [3, 3]]]], 3)), /lines or points/);
  assert.throws(() => parseShp(new Uint8Array(200)), /not a shapefile/);
});
await check('a zip is opened, whether its files are deflated or stored', async () => {
  const shp = makeShp([[square(149.8, LAT, 0.01)]]);
  const dbf = makeDbf(NAMES, [{ FIELD_NAME: 'A 1', FARM_NAME: 'Aralu' }]);
  const files = await unzipFiles(makeZip([['boundaries.shp', shp], ['boundaries.dbf', dbf, true], ['notes/', new Uint8Array(0), true]]));
  assert.deepEqual(Object.keys(files).sort(), ['boundaries.dbf', 'boundaries.shp']);
  assert.deepEqual(files['boundaries.shp'], shp);
  assert.deepEqual(files['boundaries.dbf'], dbf);
  await assert.rejects(() => unzipFiles(new Uint8Array(100)), /zip/);
});

console.log('\n=== shapes ===');

await check('the area of an outline is in hectares, and a hole comes off', () => {
  // 0.01 degrees at 28.7 S is about 977 m by 1106 m
  const whole = ringsAreaHa([square(149.8, LAT, 0.01)]);
  assert.ok(Math.abs(whole - 108.0) < 0.8, `got ${whole}`);
  const holed = ringsAreaHa([square(149.8, LAT, 0.01), hole(149.802, LAT + 0.002, 0.002)]);
  assert.ok(Math.abs((whole - holed) - whole * 0.04) < 0.3, `a fifth of a side is a twenty-fifth of the area, got ${whole - holed}`);
  assert.equal(ringsAreaHa([]), 0);
});
await check('thinning an outline drops points that add nothing and keeps the area', () => {
  const dense = [];
  for (let i = 0; i <= 100; i += 1) dense.push([149.8 + i * 0.0001, LAT]);       // a straight edge of 101 points
  const ring = [...dense, [149.81, LAT + 0.01], [149.8, LAT + 0.01], [149.8, LAT]];
  const thin = simplifyRing(ring);
  assert.ok(thin.length <= 6, `kept ${thin.length}`);
  assert.deepEqual(thin[0], thin[thin.length - 1], 'still closed');
  assert.ok(Math.abs(ringsAreaHa([thin]) - ringsAreaHa([ring])) / ringsAreaHa([ring]) < 0.001);
  assert.equal(simplifyRings([square(149.8, LAT, 0.01)]).length, 1);
});
await check('a paddock outline keeps its corners to about a metre, rounded to six places', () => {
  const r = simplifyRing([[149.80000041, -28.70000049], [149.8, -28.69], [149.81, -28.69], [149.81, -28.7], [149.80000041, -28.70000049]]);
  assert.deepEqual(r[0], [149.8, -28.7]);
});

console.log('\n=== matching to paddocks ===');

await check('names match without regard to case, spaces or punctuation', () => {
  assert.equal(normName('A 3-4'), normName('a 3 4'));
  assert.equal(normName(' Home Block '), 'homeblock');
  assert.notEqual(normName('A 1'), normName('A 1a'));
});
await check('outlines are matched to paddocks, the rest listed, each paddock used once', () => {
  const features = [{ name: 'A 1' }, { name: 'A 3-4' }, { name: 'Home' }, { name: 'A 1' }];
  const fields = [{ id: 'f1', name: 'a 1' }, { id: 'f2', name: 'A 3 4' }, { id: 'f3', name: 'Back paddock' }];
  const r = matchBoundaries(features, fields);
  assert.deepEqual(r.matched.map((m) => [m.feature.name, m.field.id]), [['A 1', 'f1'], ['A 3-4', 'f2']]);
  assert.deepEqual(r.unmatched.map((f) => f.name), ['Home', 'A 1']);
  assert.deepEqual(r.unusedFields.map((f) => f.id), ['f3']);
});

console.log('\n=== the map ===');

await check('paddocks are laid out north up in one viewBox, one path each, with their middle and area', () => {
  const a = square(149.8, LAT, 0.01); const b = square(149.82, LAT, 0.01);
  const m = mapLayout([{ id: 'a', name: 'A', color: PALETTE[0], rings: [a] }, { id: 'b', name: 'B', rings: [b, hole(149.822, LAT + 0.002, 0.002)] }]);
  assert.equal(m.items.length, 2);
  assert.ok(m.viewBox.w > 2000 && m.viewBox.h > 1000, `${m.viewBox.w} x ${m.viewBox.h}`);
  for (const i of m.items) {
    assert.ok(i.d.startsWith('M') && i.d.endsWith('Z'));
    assert.ok(i.cx > 0 && i.cx < m.viewBox.w && i.cy > 0 && i.cy < m.viewBox.h, 'the middle is on the map');
  }
  assert.equal(m.items[1].d.split('M').length - 1, 2, 'a hole is a second sub-path');
  assert.equal(m.items[1].color, NO_CROP, 'no colour given: grey');
  assert.ok(m.items[1].cx > m.items[0].cx, 'the paddock further east is further right');
  assert.ok(Math.abs(m.items[0].areaHa - 108) < 1);
  assert.equal(mapLayout([]), null);
});

console.log('\n=== saved with the paddock ===');

await check('the outline is stored once a paddock has one, comes back, and clearing reaches the server', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const state = (fields) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [], storages: [], fields, sales: [], movements: [], overheads: {}, invoices: [] } } });
  const field = (extra) => ({ id: '22222222-2222-2222-2222-222222222222', name: 'A 1', areaHa: 108, commodityId: null, yieldTHa: 0, yieldMode: 'estimate', ...extra });
  const ring = [square(149.8, LAT, 0.01)];
  assert.ok(!('boundary' in stateToRows(state([field({})]), FARM).fields[0]), 'not sent until a paddock is mapped');
  assert.deepEqual(stateToRows(state([field({ boundary: ring })]), FARM).fields[0].boundary, ring);
  assert.deepEqual(rowsToState(stateToRows(state([field({ boundary: ring })]), FARM)).years[2026].fields[0].boundary, ring);
  assert.equal(stateToRows(state([field({ boundary: null, __hasBoundary: true })]), FARM).fields[0].boundary, null);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
await check('Production has the Farm map link, which opens the map with a way to open a paddock', () => {
  const p = read('docs/js/views/production.js');
  for (const t of ['id="open-map"', 'openMapSheet({ onOpenField: openFieldSheet })', 'export function openFieldSheet']) assert.ok(p.includes(t), t);
});
await check('the import replaces the typed area with the one from the outline, and can add unmatched paddocks', () => {
  const v = read('docs/js/views/farmmap.js');
  for (const t of ['ringsAreaHa(m.feature.rings)', 'applyFieldBoundaries', 'fm-add', 'unzipFiles', 'clearFieldBoundaries']) assert.ok(v.includes(t), t);
  const s = read('docs/js/storage.js');
  assert.ok(s.includes('applyFieldBoundaries') && s.includes('clearFieldBoundaries'));
  assert.ok(s.includes('boundary: f.boundary, __hasBoundary: true'), 'a new season keeps the outlines');
});
await check('each matched paddock can keep its typed area instead of taking the map area', () => {
  const v = read('docs/js/views/farmmap.js');
  for (const t of ['fm-use', 'fm-all', 'fm-after', "useBoxes[n]?.checked === false ? 0 : i.areaHa"]) assert.ok(v.includes(t), t);
  // storage leaves the typed area alone when the area passed is 0
  assert.ok(read('docs/js/storage.js').includes('m.areaHa > 0 ? { areaHa: m.areaHa }'));
});
await check('the file chooser puts no filter on the picker, so OneDrive and other locations are listed', () => {
  const v = read('docs/js/views/farmmap.js');
  const tag = v.match(/<input type="file" id="fm-files"[^>]*>/)[0];
  assert.ok(!/accept=/.test(tag), tag);
  assert.ok(tag.includes('multiple'));
});
await check('the column is in the paste-in file', () => {
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists boundary jsonb'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
