// The rotation and yield history as a file: a CSV for Excel and a PDF to print or send (landscape or portrait).
//
// Both are made from the grid fieldhistory.js already builds for the screen (every paddock against every season, and
// each crop's yield by season), so what is exported is what is shown. A role that is not shown yields is not given them
// here either: `showYield` false leaves out every tonnage and yield and the crop table. Pure: it builds text and bytes.

import { toCSV } from './csv.js?v=377';
import { Pdf, wrapText, textWidth } from './pdf.js?v=377';
import { drawBrandLogo } from './brand.js?v=377';
import { PALETTE } from './farmmap.js?v=377';
import { cropYields } from './fieldhistory.js?v=377';

const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };

/** The farm's hectares by crop and season, with an "All crops" row of the hectares added up (no yield: crops are not mixed). */
export function areaSummary(grid) {
  const rows = cropYields(grid);
  const total = { crop: 'All crops', total: true, bySeason: {} };
  for (const s of grid.seasons) {
    const ha = rows.reduce((a, r) => a + (r.bySeason[s]?.areaHa || 0), 0);
    if (ha > 0) total.bySeason[s] = { areaHa: ha, tons: 0, yieldTHa: 0 };
  }
  return rows.length ? [...rows, total] : [];
}

/**
 * The CSV: one row per paddock with, for each season, the crop, the hectares and (when yields are shown) the tonnes and
 * t/ha; then a blank line and the farm's yield by crop and season.
 */
export function rotationCsv(grid, { showYield = true } = {}) {
  const seasons = grid.seasons;
  const columns = [
    { label: 'Farm', get: (r) => r.property || '' },
    { label: 'Paddock', get: (r) => r.name },
  ];
  for (const s of seasons) {
    columns.push({ label: `${s} crop`, get: (r) => r.cells[s]?.crop || (r.cells[s] ? 'No crop' : '') });
    columns.push({ label: `${s} area (ha)`, get: (r) => (r.cells[s] ? round(r.cells[s].areaHa) : '') });
    if (showYield) {
      columns.push({ label: `${s} tonnes`, get: (r) => (r.cells[s] && r.cells[s].tons > 0 ? round(r.cells[s].tons) : '') });
      columns.push({ label: `${s} yield (t/ha)`, get: (r) => (r.cells[s] && r.cells[s].tons > 0 ? round(r.cells[s].yieldTHa) : '') });
    }
  }
  columns.push({ label: 'Same crop as the season before', get: (r) => r.repeats.map(([, b]) => b).join('; ') });
  let text = toCSV(grid.rows, columns);

  const yields = areaSummary(grid);
  if (yields.length) {
    const ycols = [{ label: showYield ? 'Crop (farm area and yield)' : 'Crop (farm area)', get: (y) => y.crop }];
    for (const s of seasons) {
      ycols.push({ label: `${s} area (ha)`, get: (y) => (y.bySeason[s] ? round(y.bySeason[s].areaHa) : '') });
      if (showYield) {
        ycols.push({ label: `${s} tonnes`, get: (y) => (y.bySeason[s] && y.bySeason[s].tons > 0 ? round(y.bySeason[s].tons) : '') });
        ycols.push({ label: `${s} yield (t/ha)`, get: (y) => (y.bySeason[s] && y.bySeason[s].tons > 0 ? round(y.bySeason[s].yieldTHa) : '') });
      }
    }
    text += `\r\n\r\n${toCSV(yields, ycols)}`;
  }
  return text;
}

// ---------------------------------------------------------------------------------------------------------------
// PDF, laid out like the load report: an upper case title with a summary on the right, a grey line of who it is for,
// a shaded header band, banded rows, and "Made in Commodity Mate" at the foot. Landscape or portrait A4.

const SIZES = { landscape: { width: 841.89, height: 595.28 }, portrait: { width: 595.28, height: 841.89 } };
const M = 36;
const SEASON_W = 72;
const ROW_H = 26;
const BAND_H = 18;
const nameWidth = (o) => (o === 'portrait' ? 118 : 130);

export const ORIENTATIONS = [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }];
export const orientationOf = (v) => (v === 'portrait' ? 'portrait' : 'landscape');

/** '#2e7d32' as a light tint for a cell's background: [r, g, b] each 0 to 1, 80% of the way to white. */
export function tintOf(hex, amount = 0.2) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return 0.94;
  return [1, 2, 3].map((i) => 1 - amount * (1 - parseInt(m[i], 16) / 255));
}

const fit = (str, width, size, bold = false) => {
  const [first = ''] = wrapText(String(str ?? ''), width, size, bold);
  return first;
};

/** The seasons split into groups that fit across a page. */
export function seasonGroups(seasons, perPage) {
  const out = [];
  for (let i = 0; i < seasons.length; i += perPage) out.push(seasons.slice(i, i + perPage));
  return out.length ? out : [[]];
}

/** How many season columns fit across a page. */
export const seasonsPerPage = (orientation = 'landscape') => {
  const o = orientationOf(orientation);
  return Math.floor((SIZES[o].width - M * 2 - nameWidth(o)) / SEASON_W);
};

/**
 * @param {object} grid rotationGrid()'s result
 * @param {{orientation?: 'landscape'|'portrait', showYield?: boolean, business?: string, ngr?: string, today?: string, madeAt?: string}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function rotationPdf(grid, { orientation = 'landscape', showYield = true, business = '', ngr = '', today = '', madeAt = '' } = {}) {
  const o = orientationOf(orientation);
  const PAGE = SIZES[o];
  const NAME_W = nameWidth(o);
  const pdf = new Pdf(PAGE);
  const tint = (crop) => { const i = (grid.allCrops || grid.crops).indexOf(crop); return i < 0 ? null : tintOf(PALETTE[i % PALETTE.length]); };
  const yields = areaSummary(grid);
  const SUM_H = showYield ? 26 : 18;
  const groups = seasonGroups(grid.seasons, seasonsPerPage(o));
  const BOTTOM = PAGE.height - 40;
  const hasFarms = grid.rows.some((r) => r.property);
  const summary = `${grid.rows.length} paddock${grid.rows.length === 1 ? '' : 's'}, ${grid.seasons.length} season${grid.seasons.length === 1 ? '' : 's'}`;
  const who = [business, ngr ? `NGR ${ngr}` : '', today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');

  let page = 0;
  const footer = () => pdf.text(M, PAGE.height - 22, `Made in Commodity Mate${madeAt ? ` ${madeAt}` : ''}`, { size: 7.5, gray: 0.5 });
  // a page's title block; returns the y the content starts at
  const header = (seasonsNote) => {
    page += 1;
    pdf.text(M, 30, 'ROTATION AND YIELD HISTORY', { size: 18, bold: true });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 10, maxW: 100, maxH: 40 });   // the farm's logo, if it has one
    pdf.text(rx, 36, summary, { size: 11, bold: true, align: 'right' });
    if (who) pdf.text(M, 56, who, { size: 9.5, gray: 0.2 });
    if (page > 1 || seasonsNote) pdf.text(PAGE.width - M, 56, [seasonsNote, page > 1 ? `page ${page}` : ''].filter(Boolean).join('   '), { size: 8, gray: 0.4, align: 'right' });
    return 74;
  };
  const nextPage = (seasonsNote) => { footer(); pdf.addPage(); return header(seasonsNote); };

  groups.forEach((seasons, gi) => {
    const note = groups.length > 1 ? `seasons ${gi + 1} of ${groups.length}` : '';
    let y = gi === 0 ? header(note) : nextPage(note);
    const tableW = NAME_W + seasons.length * SEASON_W;

    // crop colours
    let lx = M;
    for (const c of grid.crops) {
      const w = textWidth(c, 8);
      if (lx + 14 + w > PAGE.width - M) { lx = M; y += 13; }
      pdf.rect(lx, y, 10, 9, { fill: tint(c) || 0.9, stroke: 0.6, lineWidth: 0.4 });
      pdf.text(lx + 14, y + 1, c, { size: 8 });
      lx += 14 + w + 14;
    }
    y += 22;

    const band = (yy, label) => {
      pdf.rect(M, yy, tableW, BAND_H, { stroke: null, fill: 0.88 });
      pdf.text(M + 4, yy + 5, label, { size: 8.5, bold: true });
      seasons.forEach((s, i) => pdf.text(M + NAME_W + i * SEASON_W + SEASON_W / 2, yy + 5, s, { size: 8.5, bold: true, align: 'center' }));
      return yy + BAND_H;
    };
    y = band(y, 'Paddock');

    let lastFarm = null;
    let n = 0;
    for (const r of grid.rows) {
      const needFarm = hasFarms && r.property !== lastFarm;
      if (y + ROW_H + (needFarm ? 16 : 0) > BOTTOM) { y = band(nextPage(note), 'Paddock'); n = 0; }
      if (needFarm) {
        pdf.text(M + 4, y + 5, r.property || 'No farm name', { size: 8, bold: true, gray: 0.3 });
        y += 16; n = 0;
      }
      lastFarm = r.property;
      if (n % 2) pdf.rect(M, y, tableW, ROW_H, { stroke: null, fill: 0.96 });
      pdf.text(M + 4, y + 9, fit(r.name, NAME_W - 8, 9), { size: 9 });
      seasons.forEach((s, i) => {
        const x = M + NAME_W + i * SEASON_W;
        const c = r.cells[s];
        if (!c) { pdf.text(x + SEASON_W / 2, y + 9, '-', { size: 9, align: 'center', gray: 0.5 }); return; }
        const repeat = r.repeats.some(([, b]) => b === s);
        pdf.rect(x + 1, y + 1, SEASON_W - 2, ROW_H - 2, { fill: tint(c.crop), stroke: repeat ? [0.85, 0.45, 0] : null, lineWidth: 1.5 });
        pdf.text(x + 5, y + 4.5, fit(c.crop || 'No crop', SEASON_W - 10, 8, true), { size: 8, bold: true });
        if (showYield && c.tons > 0) pdf.text(x + 5, y + 15, `${round(c.yieldTHa)} t/ha${c.actual ? '' : ' est'}`, { size: 7.5, gray: 0.3 });
      });
      y += ROW_H; n += 1;
    }
    pdf.line(M, y + 1, M + tableW, y + 1, { width: 0.8 });
    y += 10;

    // the farm's yield by crop
    if (yields.length) {
      const need = 30 + BAND_H + yields.length * SUM_H;
      if (y + need > BOTTOM) y = nextPage(note); else y += 12;
      pdf.text(M, y, showYield ? 'Area and yield by crop across the farm (ha, t/ha)' : 'Area by crop across the farm (ha)', { size: 10, bold: true });
      y += 16;
      y = band(y, 'Crop');
      yields.forEach((yd, k) => {
        if (y + SUM_H > BOTTOM) { y = band(nextPage(note), 'Crop'); }
        if (yd.total) pdf.line(M, y, M + tableW, y, { width: 0.5 });
        if (k % 2) pdf.rect(M, y, tableW, SUM_H, { stroke: null, fill: 0.96 });
        const ty = y + (SUM_H - 9) / 2 - 1;
        pdf.text(M + 4, ty, fit(yd.crop, NAME_W - 8, 9, yd.total), { size: 9, bold: !!yd.total });
        seasons.forEach((s, i) => {
          const b = yd.bySeason[s];
          const cx = M + NAME_W + i * SEASON_W + SEASON_W / 2;
          if (!b) { pdf.text(cx, ty, '-', { size: 9, align: 'center', gray: 0.5 }); return; }
          const hasYield = showYield && b.tons > 0;
          pdf.text(cx, hasYield ? y + 4.5 : ty, `${round(b.areaHa, 1)} ha`, { size: 9, bold: !!yd.total, align: 'center' });
          if (hasYield) pdf.text(cx, y + 15, `${round(b.yieldTHa)} t/ha`, { size: 7.5, gray: 0.3, align: 'center' });
        });
        y += SUM_H;
      });
      pdf.line(M, y + 1, M + tableW, y + 1, { width: 0.8 });
      y += 10;
    }

    // how to read it
    const readMe = `${showYield ? 'Yield is tonnes per hectare: actual loads once a paddock is on actual, otherwise the estimate (est). ' : ''}Hectares are the paddock areas added up by crop. An orange outline is the same crop as the season before.`;
    pdf.paragraph(M, Math.min(y + 4, PAGE.height - 56), readMe, PAGE.width - M * 2, { size: 8, gray: 0.4, lineHeight: 10 });
  });
  footer();
  return pdf.bytes();
}
