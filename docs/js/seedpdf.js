// The Seed report as a PDF: for each commodity, every paddock's variety, area, seed rate and the tonnes needed, with the
// buffer on top. Portrait A4 in the same style as the Position and Fert pages. The figures come from fertfigures.js
// (seedFigures), the same ones the screen uses. Pure: it builds bytes.

import { Pdf, wrapText } from './pdf.js?v=421';
import { drawBrandLogo } from './brand.js?v=421';
import { seedSummary } from './fertfigures.js?v=421';

const PAGE = { width: 595.28, height: 841.89 };
const M = 36;
const GREY = 0.4;
const GREEN = [0.18, 0.49, 0.196];
const BAND = [0.93, 0.96, 0.93];
const TOTAL = [0.82, 0.9, 0.83];
const BODY = 9;
const HEAD = 7.5;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fixed = (v, dp = 0) => num(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** The seed table's columns: heading, share of the width, how a paddock's cell is written, and whether it is left-aligned. */
export const seedColumns = (bufferPct = 5) => [
  { head: 'Field', w: 0.26, left: true, cell: (r) => r.name },
  { head: 'Variety', w: 0.24, left: true, cell: (r) => r.variety || '-' },
  { head: 'Area (ha)', w: 0.12, cell: (r) => fixed(r.area, 1) },
  { head: 'Rate kg/ha', w: 0.12, cell: (r) => fixed(r.rate, 0) },
  { head: 'Required t', w: 0.13, cell: (r) => fixed(r.requiredT, 2) },
  { head: `+${fixed(bufferPct, 0)}% t`, w: 0.13, cell: (r) => fixed(r.bufferedT, 2) },
];

/**
 * @param {{name: string, rows: object[], total: object}[]} figures  seedFigures() for each commodity
 * @param {{business?: string, season?: string, today?: string, bufferPct?: number}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function seedPdf(figures = [], { business = '', season = '', today = '', bufferPct = 5 } = {}) {
  const columns = seedColumns(bufferPct);
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 44;
  let page = 1;
  let y = 0;

  const footer = () => {
    pdf.text(M, PAGE.height - 24, `Made in Commodity Mate. Required is the rate over the area; the last column adds ${fixed(bufferPct, 0)}% for spillage and calibration.`, { size: 7.5, gray: GREY });
    pdf.text(PAGE.width - M, PAGE.height - 24, `page ${page}`, { size: 7.5, gray: GREY, align: 'right' });
  };
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, 'SEED', { size: 20, bold: true, gray: 1 });
    if (season) pdf.text(rx, 20, season, { size: 12, bold: true, align: 'right', gray: 1 });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 44, who, { size: 9.5, gray: 0.92 });
    return 90;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  y = header();

  if (!figures.length) {
    pdf.text(M, y, 'Nothing to report yet: add a paddock with a seed rate in Production.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  const widths = columns.map((c) => c.w * W);
  const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
  const put = (i, str, opts = {}) => {
    const c = columns[i];
    if (c.left) pdf.text(M + edges[i] + 5, y, wrapText(String(str ?? ''), widths[i] - 10, BODY, !!opts.bold)[0] || '', { size: BODY, ...opts });
    else pdf.text(M + edges[i] + widths[i] / 2, y, String(str), { size: BODY, align: 'center', ...opts });
  };
  const headRow = () => {
    pdf.rect(M, y - 5, W, 19, { stroke: null, fill: GREEN });
    columns.forEach((c, i) => put(i, c.head, { bold: true, size: HEAD, gray: 1 }));
    y += 20;
  };

  // each commodity with its varieties under it, as the seed is ordered; left out when it would only repeat the tables below
  const bought = seedSummary(figures);
  if (bought.length > 1 || bought.some((c) => c.varieties.length > 1)) {
    const sumCols = [
      { head: 'Commodity / variety', w: 0.4, left: true },
      { head: 'Area (ha)', w: 0.15 }, { head: 'Rate kg/ha', w: 0.15 }, { head: 'Required t', w: 0.15 }, { head: `+${fixed(bufferPct, 0)}% t`, w: 0.15 },
    ];
    const sw = sumCols.map((c) => c.w * W);
    const se = sw.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
    const cell = (i, str, opts = {}) => (sumCols[i].left
      ? pdf.text(M + se[i] + 5 + (opts.indent || 0), y, wrapText(String(str ?? ''), sw[i] - 10 - (opts.indent || 0), BODY, !!opts.bold)[0] || '', { size: BODY, ...opts })
      : pdf.text(M + se[i] + sw[i] / 2, y, String(str), { size: BODY, align: 'center', ...opts }));
    const sumHead = () => {
      pdf.rect(M, y - 5, W, 19, { stroke: null, fill: GREEN });
      sumCols.forEach((c, i) => cell(i, c.head, { bold: true, size: HEAD, gray: 1 }));
      y += 20;
    };
    ensure(22 + 20 + 18 * 3);
    pdf.text(M, y, 'By commodity and variety', { size: 13, bold: true, gray: GREEN });
    pdf.line(M, y + 18, M + W, y + 18, { width: 1, gray: GREEN });
    y += 30;
    sumHead();
    bought.forEach((c) => {
      if (y + 20 * 2 > BOTTOM) { newPage(); sumHead(); }
      pdf.rect(M, y - 5, W, 18, { stroke: null, fill: TOTAL });
      [c.name, fixed(c.total.area, 1), fixed(c.total.rate, 0), fixed(c.total.requiredT, 2), fixed(c.total.bufferedT, 2)].forEach((str, i) => cell(i, str, { bold: true }));
      y += 18;
      c.varieties.forEach((v, n) => {
        if (y + 20 > BOTTOM) { newPage(); sumHead(); }
        if (n % 2 === 1) pdf.rect(M, y - 5, W, 18, { stroke: null, fill: BAND });
        [v.variety, fixed(v.area, 1), fixed(v.rate, 0), fixed(v.requiredT, 2), fixed(v.bufferedT, 2)].forEach((str, i) => cell(i, str, i === 0 ? { indent: 14 } : {}));
        y += 18;
      });
    });
    y += 22;
  }

  figures.forEach((fig) => {
    ensure(22 + 20 + 18 * 2 + 24);
    pdf.text(M, y, fig.name, { size: 13, bold: true, gray: GREEN });
    pdf.line(M, y + 18, M + W, y + 18, { width: 1, gray: GREEN });
    y += 30;
    headRow();
    fig.rows.forEach((r, n) => {
      if (y + 20 > BOTTOM) { newPage(); pdf.text(M, y, `${fig.name} (continued)`, { size: 11, bold: true, gray: GREEN }); y += 22; headRow(); }
      if (n % 2 === 1) pdf.rect(M, y - 5, W, 18, { stroke: null, fill: BAND });
      columns.forEach((c, i) => put(i, c.cell(r), i === 0 ? { bold: true } : {}));
      y += 18;
    });
    ensure(26);
    pdf.rect(M, y - 5, W, 19, { stroke: null, fill: TOTAL });
    pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: GREEN });
    columns.forEach((c, i) => put(i, i === 0 ? 'Total' : (c.left ? '' : c.cell(fig.total)), { bold: true }));
    y += 38;
  });

  footer();
  return pdf.bytes();
}
