// A spray request as a PDF: either Aircair's own form (their scanned pages written over) or our own, then the map.
//
// What goes where is worked out in spray.js (plain data, tested in node). This file draws it with pdf-lib, which is
// loaded only when a request is actually made, so nothing is downloaded until then. The service worker keeps esm.sh
// answers in its vendor cache, so a request can be made again offline once it has been made once.

import {
  AIRCAIR_LAYOUT, CHECKLIST, aircairOps, standardOps, sprayMapPlan, mapPageText, sprayRows, sprayTotals, plain, fitText, A4,
} from './spray.js?v=269';
import { wrapText } from './pdf.js?v=269';
import { ASPECT, strokesInBox } from './signature.js?v=269';
import { NO_FARM, farmGroups } from './farmmap.js?v=269';
import { dmy } from './fmt.js?v=269';

const PDF_LIB = 'https://esm.sh/pdf-lib@1.17.1';
const AIRCAIR_URL = './forms/aircair-spray-request.pdf';

let libPromise = null;
const loadLib = () => (libPromise ||= import(/* @vite-ignore */ PDF_LIB).catch((e) => { libPromise = null; throw e; }));

const INK = [0.05, 0.12, 0.45];          // blue pen: so what was written reads as written on the form
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/**
 * Builds the PDF for a request.
 * @param job     the request (see sprayDefaults)
 * @param layout  mapLayout() of the farm's paddocks, or null when no map has been loaded
 * @param opts    { signature: strokes[] | null } the saved signature to put on Aircair's form
 * @returns {Promise<Uint8Array>}
 */
export async function buildSprayPdf(job, layout, { signature = null } = {}) {
  const lib = await loadLib();
  const { PDFDocument, StandardFonts, rgb } = lib;

  let doc; let pageSize = [A4.w, A4.h];
  const aircair = job.form === 'aircair';
  if (aircair) {
    const res = await fetch(AIRCAIR_URL);
    if (!res.ok) throw new Error("Aircair's form could not be loaded. Check the connection and try again.");
    doc = await PDFDocument.load(await res.arrayBuffer());
  } else {
    doc = await PDFDocument.create();
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(...INK);
  const black = rgb(0, 0, 0);
  const encodable = (s) => String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

  const text = (page, x, yTop, s, { size = 9, isBold = false, color = black, align = 'left' } = {}) => {
    const t = encodable(s);
    if (!t) return;
    const f = isBold ? bold : font;
    const H = page.getHeight();
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: H - yTop, size, font: f, color });
  };

  if (aircair) {
    const pages = doc.getPages();
    const { pages: ops, overflow } = aircairOps(job);
    ops.forEach((list, pi) => {
      const page = pages[pi]; if (!page) return;
      for (const o of list) {
        if (o.t === 'band') page.drawRectangle({ x: o.x0, y: page.getHeight() - o.y1, width: o.x1 - o.x0, height: o.y1 - o.y0, color: rgb(0.62, 0.8, 0.62), opacity: 0.4, blendMode: lib.BlendMode.Multiply });
        else if (o.t === 'text') text(page, o.x, o.y, o.text, { size: o.size, isBold: o.bold, color: ink });
        else if (o.t === 'cross') drawCross(page, o.cx, page.getHeight() - o.cy, 5.5, ink);
      }
    });
    if (signature?.length && pages[1]) drawSignature(pages[1], signature, AIRCAIR_LAYOUT.signature, ink);
    if (overflow) addRowsPage(doc, job, text, rgb);
  } else {
    const page = doc.addPage(pageSize);
    const { ops } = standardOps(job);
    for (const o of ops) {
      if (o.t === 'text') text(page, o.x, o.y, o.text, { size: o.size, isBold: o.bold, align: o.align, color: o.gray ? rgb(o.gray, o.gray, o.gray + 0.02) : black });
      else if (o.t === 'line') page.drawLine({ start: { x: o.x1, y: page.getHeight() - o.y1 }, end: { x: o.x2, y: page.getHeight() - o.y2 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.6) });
      else if (o.t === 'rect') page.drawRectangle({ x: o.x, y: page.getHeight() - o.y - o.h, width: o.w, height: o.h, color: o.tint ? rgb(...o.tint) : rgb(o.fill, o.fill, o.fill) });
    }
    await checklistPage(doc, job, text);
  }

  if (layout?.items?.length) await addMapPage(doc, lib, job, layout, text);
  return doc.save();
}

function drawCross(page, cx, cy, r, color) {
  const o = { thickness: 1.6, color };
  page.drawLine({ start: { x: cx - r, y: cy - r }, end: { x: cx + r, y: cy + r }, ...o });
  page.drawLine({ start: { x: cx - r, y: cy + r }, end: { x: cx + r, y: cy - r }, ...o });
}

/** The saved signature as ink strokes sitting on the signature line (strokes are runs of [x, y], 0 to 1). */
function drawSignature(page, strokes, box, color) {
  const H = page.getHeight();
  const w = 130; const h = w / ASPECT;
  for (const run of strokesInBox(strokes, box.x, box.y - h + 4, w, h)) {
    const pts = run.length === 1 ? [run[0], [run[0][0] + 0.2, run[0][1]]] : run;
    for (let i = 1; i < pts.length; i += 1) {
      page.drawLine({
        start: { x: pts[i - 1][0], y: H - pts[i - 1][1] }, end: { x: pts[i][0], y: H - pts[i][1] },
        thickness: 1.1, color,
      });
    }
  }
}

/** Our form's checklist page, if any of it was answered (Aircair's own form has these questions printed on it). */
async function checklistPage(doc, job, text) {
  const answered = CHECKLIST.filter((q) => job.checklist?.[q.key]);
  const nb = (job.neighbours || []).filter((n) => String(n.name || '').trim());
  if (!answered.length && !nb.length) return;
  const page = doc.addPage([A4.w, A4.h]);
  let y = 60;
  text(page, 40, y, 'SPRAY CHECKLIST', { size: 16, isBold: true });
  y += 28;
  for (const q of answered) {
    const lines = wrapText(q.text, 400, 10);
    lines.forEach((l, i) => text(page, 40, y + i * 12.5, l, { size: 10 }));
    text(page, A4.w - 40, y, job.checklist[q.key] === 'yes' ? 'Yes' : 'No', { size: 10, isBold: true, align: 'right' });
    y += lines.length * 12.5 + 8;
  }
  if (nb.length) {
    y += 8;
    text(page, 40, y, 'NEIGHBOURS', { size: 8, isBold: true });
    y += 14;
    for (const n of nb) { text(page, 40, y, `${n.name}${n.phone ? `   ${n.phone}` : ''}${n.contacted === 'yes' ? '   (contacted)' : ''}`, { size: 10 }); y += 14; }
  }
}

/** When there are more rows than Aircair's table holds: the whole list, on one more page. */
function addRowsPage(doc, job, text, rgb) {
  const page = doc.addPage([A4.w, A4.h]);
  text(page, 40, 56, `${job.jobNo || 'Spray request'}: paddocks and rates`, { size: 14, isBold: true });
  let y = 84;
  const cols = [[40, 'Field'], [190, 'Ha'], [235, 'Chemical'], [380, 'Rate/ha'], [450, 'Amount'], [510, 'Spray vol']];
  cols.forEach(([x, l]) => text(page, x, y, l, { size: 9, isBold: true }));
  y += 15;
  const rows = sprayRows(job);
  let p = page;
  for (const r of rows) {
    if (y > 800) { p = doc.addPage([A4.w, A4.h]); y = 56; }
    if (r.g % 2) p.drawRectangle({ x: 40, y: A4.h - y - 4, width: A4.w - 80, height: 13.5, color: rgb(0.86, 0.93, 0.86) });
    text(p, 40, y, fitText(r.field, 145, 9).text, { size: 9 }); text(p, 190, y, r.ha ? plain(r.ha, 1) : '', { size: 9 });
    text(p, 235, y, fitText(r.chemical, 140, 9).text, { size: 9 }); text(p, 380, y, r.rate, { size: 9 });
    text(p, 450, y, r.amount, { size: 9 }); text(p, 510, y, r.spray, { size: 9 });
    y += 14;
  }
  const t = sprayTotals(job);
  text(p, 40, y + 6, `Total ${plain(t.ha, 1)} ha`, { size: 9, isBold: true });
}

/** The map page: the paddocks to spray in red among the farm's others, with north, a scale bar and the list. */
async function addMapPage(doc, lib, job, layout, text) {
  const { rgb } = lib;
  const black = rgb(0, 0, 0);
  const page = doc.addPage([A4.w, A4.h]);
  const H = A4.h;
  const head = mapPageText(job);
  let y = 50;
  text(page, 40, y, head.title, { size: 18, isBold: true, color: rgb(0, 0, 0) });
  text(page, A4.w - 40, y, head.total, { size: 11, isBold: true, align: 'right', color: rgb(0, 0, 0) });
  y += 16;
  for (const l of head.lines) { text(page, 40, y, fitText(l, A4.w - 80, 9.5).text, { size: 9.5, color: rgb(0.2, 0.2, 0.2) }); y += 13; }

  const box = { x: 40, y: y + 6, w: A4.w - 80, h: 470 };
  const plan = sprayMapPlan({ items: layout.items, selectedIds: (job.paddocks || []).map((p) => p.id), box });

  drawMapBox(page, lib, plan, box, text);

  // the list under the map: paddock, area, and the date
  let ty = box.y + box.h + 22;
  text(page, 40, ty, 'Paddocks to spray', { size: 9, isBold: true, color: black });
  ty += 13;
  const paddocks = job.paddocks || [];
  const perCol = 8; const colW = (A4.w - 80) / 3;
  paddocks.slice(0, perCol * 3).forEach((p, i) => {
    const cx = 40 + Math.floor(i / perCol) * colW; const cy = ty + (i % perCol) * 12;
    if (i % 2) page.drawRectangle({ x: cx - 3, y: H - cy - 3, width: colW - 8, height: 11.5, color: rgb(0.86, 0.93, 0.86) });
    text(page, cx, cy, fitText(p.name, colW - 52, 8.5).text, { size: 8.5, color: black });
    text(page, cx + colW - 16, cy, plain(p.areaHa, 1), { size: 8.5, align: 'right', color: black });
  });
  if (paddocks.length > perCol * 3) text(page, 40, ty + perCol * 12 + 2, `+ ${paddocks.length - perCol * 3} more (all are listed on the form)`, { size: 8, color: rgb(0.4, 0.4, 0.4) });
  text(page, 40, 826, `Made in Grainflow ${dmy(job.today)}`, { size: 7.5, color: rgb(0.5, 0.5, 0.5) });
}

/**
 * The map itself inside its frame: paddocks, their names, north and a scale bar. With `tint` every paddock is filled with
 * its own colour (the farm map); without it the paddocks to spray are red among grey ones (a spray request).
 */
function drawMapBox(page, lib, plan, box, text, { tint = false, names = true, areas = true } = {}) {
  const { rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = lib;
  const H = A4.h;
  // frame and a light ground
  page.drawRectangle({ x: box.x, y: H - box.y - box.h, width: box.w, height: box.h, color: rgb(0.97, 0.97, 0.95), borderColor: rgb(0.45, 0.45, 0.45), borderWidth: 0.8 });

  // everything inside the frame is clipped to it
  page.pushOperators(pushGraphicsState(), rectangle(box.x, H - box.y - box.h, box.w, box.h), clip(), endPath());
  const place = { x: box.x - plan.vx0 * plan.s, y: H - box.y + plan.vy0 * plan.s, scale: plan.s };
  for (const pass of [false, true]) {
    for (const p of plan.draw.filter((d) => d.selected === pass)) {
      page.drawSvgPath(p.d, {
        ...place,
        color: tint ? rgb(...hex(p.color)) : pass ? rgb(...hex('#d8362b')) : rgb(0.86, 0.87, 0.84),
        opacity: tint ? 0.6 : pass ? 0.55 : 1,
        borderColor: pass && !tint ? rgb(...hex('#8c1d15')) : rgb(0.45, 0.47, 0.43),
        borderWidth: pass && !tint ? 1.1 : 0.5,
      });
    }
  }
  page.pushOperators(popGraphicsState());

  // names: the paddocks to spray always, in bold with the area; the others small and grey
  const black = rgb(0, 0, 0);
  for (const l of plan.labels) {
    if (l.selected) {
      if (names) text(page, l.x, l.y - 1, fitText(l.name, 110, l.size, { bold: true, min: 4 }).text, { size: l.size, isBold: true, align: 'center', color: black });
      // the area sits under the name, or alone when the names are off
      if (areas && l.size >= 6) text(page, l.x, names ? l.y + l.size : l.y + l.size * 0.35, `${plain(l.areaHa, 1)} ha`, { size: l.size * 0.85, align: 'center', color: black });
    } else if (names) {
      text(page, l.x, l.y + 2, fitText(l.name, 70, l.size, { min: 4 }).text, { size: l.size, align: 'center', color: rgb(0.4, 0.42, 0.4) });
    }
  }

  // north arrow
  const n = plan.north;
  const nx = n.x; const ny = H - n.y;
  page.drawLine({ start: { x: nx, y: ny - n.len }, end: { x: nx, y: ny }, thickness: 1.4, color: black });
  page.drawLine({ start: { x: nx, y: ny }, end: { x: nx - 4.5, y: ny - 9 }, thickness: 1.4, color: black });
  page.drawLine({ start: { x: nx, y: ny }, end: { x: nx + 4.5, y: ny - 9 }, thickness: 1.4, color: black });
  text(page, nx, n.y - 6, 'N', { size: 11, isBold: true, align: 'center', color: black });

  // scale bar
  const sb = plan.scaleBar;
  const by = H - sb.y;
  page.drawLine({ start: { x: sb.x, y: by }, end: { x: sb.x + sb.widthPt, y: by }, thickness: 1.6, color: black });
  page.drawLine({ start: { x: sb.x, y: by - 3 }, end: { x: sb.x, y: by + 3 }, thickness: 1.2, color: black });
  page.drawLine({ start: { x: sb.x + sb.widthPt, y: by - 3 }, end: { x: sb.x + sb.widthPt, y: by + 3 }, thickness: 1.2, color: black });
  text(page, sb.x + sb.widthPt / 2, sb.y - 5, sb.label, { size: 8, align: 'center', color: black });

}

/**
 * The farm map as a one page PDF to send to people: every paddock coloured by what is growing in it, named with its
 * area, the farms labelled, north and a scale. `legend` is [{name, color}], `hiddenFarms` the farms switched off.
 * @returns {Promise<Uint8Array>}
 */
export async function buildFarmMapPdf(layout, { title = 'Farm map', subtitle = '', legend = [], hiddenFarms = [], date = '', view = null, showNames = true, showAreas = true, showFarmNames = true, showTotals = true } = {}) {
  const lib = await loadLib();
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const page = doc.addPage([A4.w, A4.h]);
  const text = (pg, x, yTop, s, { size = 9, isBold = false, color = black, align = 'left' } = {}) => {
    const t = String(s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
    if (!t) return;
    const f = isBold ? bold : font;
    const w = f.widthOfTextAtSize(t, size);
    pg.drawText(t, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: A4.h - yTop, size, font: f, color });
  };
  const off = new Set(hiddenFarms);
  const items = layout.items.filter((i) => !off.has(i.farm || NO_FARM));
  // with a view (what is on the screen) only the paddocks in it are counted and drawn
  const inside = (i) => !view || (i.bbox[2] >= view.x && i.bbox[0] <= view.x + view.w && i.bbox[3] >= view.y && i.bbox[1] <= view.y + view.h);
  const shown = items.filter(inside).length ? items.filter(inside) : (items.length ? items : layout.items);
  const ha = shown.reduce((s, i) => s + i.areaHa, 0);
  text(page, 40, 50, title.toUpperCase(), { size: 18, isBold: true });
  if (showTotals) text(page, A4.w - 40, 50, `${shown.length} paddock${shown.length === 1 ? '' : 's'}, ${plain(ha, 0)} ha`, { size: 11, isBold: true, align: 'right' });
  if (subtitle) text(page, 40, 66, fitText(subtitle, A4.w - 80, 9.5).text, { size: 9.5, color: rgb(0.2, 0.2, 0.2) });

  const box = { x: 40, y: 80, w: A4.w - 80, h: 640 };
  const plan = sprayMapPlan({ items: shown, selectedIds: [], box, margin: 0.06, minSpanM: 600, named: true, view });
  drawMapBox(page, lib, plan, box, text, { tint: true, names: showNames, areas: showAreas });
  // farm names, over the paddocks
  for (const g of showFarmNames ? farmGroups(shown, []) : []) {
    if (g.name === NO_FARM) continue;
    const x = box.x + (g.cx - plan.vx0) * plan.s; const y = box.y + (g.cy - plan.vy0) * plan.s;
    if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) continue;
    text(page, x, y - 14, g.name.toUpperCase(), { size: 11, isBold: true, align: 'center' });
  }
  let lx = 40; const ly = box.y + box.h + 22;
  for (const l of legend) {
    const w = font.widthOfTextAtSize(String(l.name), 9) + 24;
    if (lx + w > A4.w - 40) break;
    page.drawRectangle({ x: lx, y: A4.h - ly - 1, width: 9, height: 9, color: rgb(...hex(l.color)), opacity: 0.7, borderColor: rgb(0.45, 0.47, 0.43), borderWidth: 0.5 });
    text(page, lx + 14, ly + 7, l.name, { size: 9 });
    lx += w + 8;
  }
  text(page, 40, 826, `Made in Grainflow ${dmy(date)}`, { size: 7.5, color: rgb(0.5, 0.5, 0.5) });
  return doc.save();
}
