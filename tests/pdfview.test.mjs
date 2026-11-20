// Run with:
//   node tests/pdfview.test.mjs
//
// The preview: a PDF the app wrote is read back and drawn, page for page, as it was laid out. A recording stand-in for the
// canvas shows what was drawn and where.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pdf } from '../docs/js/pdf.js';
import { parsePdf, drawPage } from '../docs/js/pdfparse.js';
import { positionPdf } from '../docs/js/positionpdf.js';
import { positionRows, positionTotals, farmProfitLoss } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** A canvas context that writes down what it is asked to do. */
const recorder = () => {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'save' || k === 'restore' || k === 'beginPath' || k === 'setTransform') return (...a) => calls.push([k, ...a]);
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { calls.push(['set', k, v]); return true; },
  });
  return { ctx, calls };
};
const drawn = (calls, name) => calls.filter((c) => c[0] === name);

check('a PDF the app wrote reads back: the pages, their size and their drawing commands', () => {
  const pdf = new Pdf({ width: 400, height: 300 });
  pdf.text(20, 20, 'First page', { size: 12, bold: true });
  pdf.addPage();
  pdf.text(20, 20, 'Second page');
  const { pages, images } = parsePdf(pdf.bytes());
  assert.equal(pages.length, 2);
  assert.deepEqual([pages[0].width, pages[0].height], [400, 300]);
  assert.ok(pages[0].content.includes('(First page)') && pages[1].content.includes('(Second page)'));
  assert.equal(images.length, 0);
});

check('text is drawn where it was put, in its size, bold or not, in its colour', () => {
  const pdf = new Pdf({ width: 400, height: 300 });
  pdf.text(20, 30, 'Hello (world)', { size: 12, bold: true, gray: 0.5 });
  pdf.text(380, 60, 'Right', { size: 10, align: 'right' });
  const { ctx, calls } = recorder();
  drawPage(ctx, parsePdf(pdf.bytes()).pages[0], 2);
  const t = drawn(calls, 'fillText');
  assert.equal(t.length, 2);
  assert.equal(t[0][1], 'Hello (world)', 'brackets in the text come back as they were');
  assert.ok(Math.abs(t[0][2] - 20) < 0.01 && Math.abs(t[0][3] - (30 + 12 * 0.8)) < 0.02, `baseline ${t[0][3]}`);
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'font' && c[2] === 'bold 12px Helvetica, Arial, sans-serif'));
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgb(128,128,128)'), 'its gray');
  assert.ok(Math.abs(t[1][2] - (380 - 10 * 0.556 * 0)) > 0, 'right-aligned text starts left of its edge');
  assert.ok(calls.some((c) => c[0] === 'setTransform' && c[1] === 2 && c[4] === 2), 'drawn at the scale asked for');
});

check('typographic characters come back as themselves, not as the code they are stored as', () => {
  const pdf = new Pdf({ width: 400, height: 300 });
  pdf.text(10, 10, '“Wheat” — 5 t’s …');
  const { ctx, calls } = recorder();
  drawPage(ctx, parsePdf(pdf.bytes()).pages[0], 1);
  assert.equal(drawn(calls, 'fillText')[0][1], '“Wheat” — 5 t’s …');
});

check('boxes are filled and outlined, lines and tick boxes are stroked', () => {
  const pdf = new Pdf({ width: 400, height: 300 });
  pdf.rect(10, 10, 100, 20, { stroke: null, fill: [0.18, 0.49, 0.196] });
  pdf.rect(10, 50, 100, 20, { stroke: 0.5, fill: 0.9 });
  pdf.line(10, 100, 200, 100, { width: 2, gray: 0.2 });
  pdf.polyline([[10, 120], [50, 150], [90, 130]], { width: 1.5 });
  pdf.checkbox(10, 200, 9, true);
  const { ctx, calls } = recorder();
  drawPage(ctx, parsePdf(pdf.bytes()).pages[0], 1);
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgb(46,125,51)'), 'the green fill');
  assert.equal(drawn(calls, 'fill').length, 2, 'the green box and the tinted box (the white page is a fillRect)');
  assert.ok(drawn(calls, 'stroke').length >= 5, 'the outline, the line, the polyline and the tick box');
  assert.ok(drawn(calls, 'rect').some((c) => c[1] === 10 && c[2] === 10 && c[3] === 100 && c[4] === 20), 'a box is where it was put (the top left is turned to the canvas)');
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'lineWidth' && c[2] === 2));
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'lineCap' && c[2] === 'round'), 'ink has round ends');
  assert.equal(drawn(calls, 'fillRect')[0].slice(1).join(','), '0,0,400,300', 'a white page first');
});

check('a picture is drawn at its place and size, and left out if it could not be decoded', () => {
  const pdf = new Pdf({ width: 400, height: 300 });
  pdf.image({ data: 'JPEGBYTES', width: 8, height: 4, comps: 3 }, 50, 40, 80, 40);
  const parsed = parsePdf(pdf.bytes());
  assert.equal(parsed.images.length, 1);
  assert.deepEqual([parsed.images[0].width, parsed.images[0].height, parsed.images[0].comps], [8, 4, 3]);
  assert.equal(String.fromCharCode(...parsed.images[0].data), 'JPEGBYTES');
  const { ctx, calls } = recorder();
  drawPage(ctx, parsed.pages[0], 1, ['PICTURE']);
  const d = drawn(calls, 'drawImage')[0];
  assert.deepEqual(d.slice(1), ['PICTURE', 50, 40, 80, 40]);
  const none = recorder();
  drawPage(none.ctx, parsed.pages[0], 1, []);
  assert.equal(drawn(none.calls, 'drawImage').length, 0);
});

check('a real report reads back whole: the Position PDF has its heading, commodities and figures on the page', () => {
  const commodities = [{ id: 'w', name: 'Wheat', mtmPrice: 400, grossMarginCost: 100000 }];
  const fields = [{ id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', yieldTHa: 4, yieldMode: 'estimate' }];
  const rows = positionRows(commodities, fields, [], []);
  const totals = positionTotals(rows);
  const bytes = positionPdf({ rows, totals, overheads: {}, pl: farmProfitLoss(totals.grossMargin, {}, 0, 0), cost: {} }, { business: 'Test Farm', season: 'Sample 2026', today: '20/11/2026' });
  const { pages } = parsePdf(bytes);
  assert.equal(pages.length, 1);
  assert.deepEqual([Math.round(pages[0].width), Math.round(pages[0].height)], [842, 595], 'landscape');
  const { ctx, calls } = recorder();
  drawPage(ctx, pages[0], 1);
  const words = drawn(calls, 'fillText').map((c) => c[1]);
  for (const w of ['POSITION', 'Sample 2026', 'Wheat', '800 t', 'Gross margin']) assert.ok(words.some((x) => x.includes(w)), `missing ${w}`);
  assert.ok(words.some((x) => x.startsWith('Test Farm') && x.includes('Printed 20/11/2026')), 'the farm and the day');
});

check('a PDF from the other library (compressed pages) is not drawn: it has no pages, and the viewer offers to open it instead', () => {
  const foreign = new TextEncoder().encode(["%PDF-1.7","1 0 obj","<< /Type /Page /MediaBox [0 0 595 842] /Contents 2 0 R >>","endobj","2 0 obj","<< /Length 4 /Filter /FlateDecode >>","stream","xxxx","endstream","endobj",""].join(String.fromCharCode(10)));
  assert.equal(parsePdf(foreign).pages.length, 0);
  assert.equal(parsePdf(new Uint8Array(0)).pages.length, 0);
  const v = read('docs/js/pdfview.js');
  assert.ok(v.includes('openOutside(bytes') && v.includes('target="_blank"'), 'a link that opens it in the device viewer');
});

check('the preview is wired in: a viewer module that shows the pages and shares from the same sheet', () => {
  const v = read('docs/js/pdfview.js');
  assert.ok(v.includes('parsePdf(') && v.includes('drawPage(') && v.includes('createImageBitmap'), 'reads and draws the file');
  assert.ok(v.includes('sharePdf(') && v.includes('openOver('), 'shares from the preview, and returns to the sheet it came from');
  assert.ok(v.includes('data-zoom'), 'zoom, because a landscape report on a phone is small');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
