// The Fert report as a PDF: the urea table for each commodity, then the starter fertiliser, laid out landscape on one page
// style with the Position page. Nitrogen columns are amber and urea-equivalent columns green, as on the screen.
// The figures come from fertfigures.js (ureaFigures, starterFigures), the same ones the screen uses. Pure: it builds bytes.

import { Pdf, wrapText } from './pdf.js?v=367';
import { drawBrandLogo } from './brand.js?v=367';
import { ureaSummary, starterSummary } from './fertfigures.js?v=367';

const PAGE = { width: 841.89, height: 595.28 };
const M = 36;
const GREY = 0.4;
const GREEN = [0.18, 0.49, 0.196];
const AMBER = [0.66, 0.35, 0.04];
const SLATE = [0.32, 0.38, 0.42];
const TINT = { n: [0.98, 0.93, 0.86], u: [0.91, 0.95, 0.91] };
const TINT_DEEP = { n: [0.96, 0.89, 0.79], u: [0.85, 0.92, 0.85] };
const BAND = [0.94, 0.95, 0.96];
const TOTAL = [0.84, 0.86, 0.88];
const LINE = [0.78, 0.86, 0.78];
const BODY = 8.5;
const HEAD = 7;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fixed = (v, dp = 0) => num(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const yieldText = (v) => (num(v) > 0 ? fixed(v, 2) : '-');

/** The urea table's columns: heading (name, unit), kind ('n' nitrogen, 'u' urea equivalent, '' neither), share of the width, cell. */
export const UREA_COLUMNS = [
  { head: ['Field', ''], kind: '', w: 0.15, cell: (r) => r.name },
  { head: ['Area', 'ha'], kind: '', w: 0.075, cell: (r) => fixed(r.area, 1) },
  { head: ['Soil N', 'kg/ha'], kind: 'n', w: 0.07, cell: (r) => fixed(r.soilN, 0) },
  { head: ['Soil equiv', 'kg/ha'], kind: 'u', w: 0.075, cell: (r) => fixed(r.soilEquiv, 0) },
  { head: ['Target', 't/ha'], kind: '', w: 0.065, cell: (r) => yieldText(r.targetYield) },
  { head: ['Req', 'kg/ha'], kind: 'u', w: 0.07, cell: (r) => fixed(r.req, 0) },
  { head: ['App', 'kg/ha'], kind: 'u', w: 0.07, cell: (r) => fixed(r.app, 0) },
  { head: ['Left', 'kg/ha'], kind: 'u', w: 0.07, cell: (r) => fixed(r.left, 0) },
  { head: ['Req', 't'], kind: 'u', w: 0.07, cell: (r) => fixed(r.reqT, 2) },
  { head: ['App', 't'], kind: 'u', w: 0.07, cell: (r) => fixed(r.appT, 2) },
  { head: ['Left', 't'], kind: 'u', w: 0.07, cell: (r) => fixed(r.leftT, 2) },
  { head: ['N avail', 'kg/ha'], kind: 'n', w: 0.07, cell: (r) => fixed(r.nAvail, 0) },
  { head: ['Max', 't/ha'], kind: '', w: 0.075, cell: (r) => yieldText(r.maxYield) },
];

/** The starter table's columns: the same, with no nitrogen. */
export const STARTER_COLUMNS = [
  { head: ['Field', ''], kind: '', w: 0.2, cell: (r) => r.name },
  { head: ['Area', 'ha'], kind: '', w: 0.12, cell: (r) => fixed(r.area, 1) },
  { head: ['Req', 'kg/ha'], kind: '', w: 0.11, cell: (r) => fixed(r.req, 0) },
  { head: ['App', 'kg/ha'], kind: '', w: 0.11, cell: (r) => fixed(r.app, 0) },
  { head: ['Left', 'kg/ha'], kind: '', w: 0.11, cell: (r) => fixed(r.left, 0) },
  { head: ['Req', 't'], kind: '', w: 0.11, cell: (r) => fixed(r.reqT, 2) },
  { head: ['App', 't'], kind: '', w: 0.12, cell: (r) => fixed(r.appT, 2) },
  { head: ['Left', 't'], kind: '', w: 0.12, cell: (r) => fixed(r.leftT, 2) },
];

/** A commodity with no starter fertiliser required or applied has nothing to report in that section. */
export const hasStarter = (fig) => fig.rows.some((r) => num(r.req) || num(r.app));

/**
 * @param {{urea: object[], starter: object[]}} data  ureaFigures() and starterFigures() for each commodity
 * @param {{business?: string, season?: string, today?: string, ureaNPct?: number}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function fertPdf({ urea = [], starter = [], summary = false } = {}, { business = '', season = '', today = '', ureaNPct = 46 } = {}) {
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 40;
  let page = 1;
  let y = 0;

  const footer = () => pdf.text(M, PAGE.height - 22,
    'Made in Commodity Mate. Urea figures are kg of urea; soil equiv is the soil nitrogen as urea. Left is required less applied.', { size: 7.5, gray: GREY });
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, 'FERTILISER', { size: 20, bold: true, gray: 1 });
    if (season) pdf.text(rx, 20, season, { size: 12, bold: true, align: 'right', gray: 1 });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 44, who, { size: 9.5, gray: 0.92 });
    if (page > 1) pdf.text(rx, 46, `page ${page}`, { size: 8, gray: 0.85, align: 'right' });
    return 88;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  y = header();

  if (!urea.length && !starter.length) {
    pdf.text(M, y, 'Nothing to report yet: add a paddock with a fertiliser rate in Production.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  // the key: which colour is nitrogen and which is urea equivalent
  if (urea.length) {
    pdf.rect(M, y, 10, 10, { stroke: null, fill: AMBER });
    pdf.text(M + 16, y + 1, 'Nitrogen (N)', { size: 8.5, bold: true });
    pdf.rect(M + 100, y, 10, 10, { stroke: null, fill: GREEN });
    pdf.text(M + 116, y + 1, `Urea equivalent (N ÷ ${ureaNPct / 100})`, { size: 8.5, bold: true });
    y += 22;
  }

  const section = (title, figures, columns) => {
    if (!figures.length) return;
    ensure(30 + 40);
    pdf.text(M, y, title, { size: 13, bold: true, gray: GREEN });
    pdf.line(M, y + 18, M + W, y + 18, { width: 1, gray: GREEN });
    y += 30;
    const widths = columns.map((c) => c.w * W);
    const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
    const mid = (i) => M + edges[i] + widths[i] / 2;
    const fit = (str, i) => wrapText(String(str ?? ''), widths[i] - 8, BODY, true)[0] || '';
    const headFill = (c) => (c.kind === 'n' ? AMBER : c.kind === 'u' ? GREEN : SLATE);

    const headRow = () => {
      columns.forEach((c, i) => pdf.rect(M + edges[i], y - 5, widths[i], 24, { stroke: null, fill: headFill(c) }));
      columns.forEach((c, i) => {
        const [name, unit] = c.head;
        if (i === 0) pdf.text(M + 5, y + 2, name, { size: HEAD + 0.5, bold: true, gray: 1 });
        else {
          pdf.text(mid(i), y - 1, name, { size: HEAD, bold: true, align: 'center', gray: 1 });
          if (unit) pdf.text(mid(i), y + 8, unit, { size: HEAD, align: 'center', gray: 0.93 });
        }
      });
      y += 25;
    };
    const rowFill = (c, n, total) => {
      if (c.kind) return (total || n % 2 === 1) ? TINT_DEEP[c.kind] : TINT[c.kind];
      return total ? TOTAL : (n % 2 === 1 ? BAND : null);
    };
    const drawRow = (r, n, total) => {
      const h = total ? 19 : 17;
      columns.forEach((c, i) => {
        const fill = rowFill(c, n, total);
        if (fill) pdf.rect(M + edges[i], y - 5, widths[i], h, { stroke: null, fill });
      });
      if (total) pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: SLATE });
      columns.forEach((c, i) => {
        if (i === 0) pdf.text(M + 5, y, total ? 'Total' : fit(c.cell(r), 0), { size: BODY, bold: true });
        else pdf.text(mid(i), y, c.cell(r), { size: BODY, align: 'center', bold: total });
      });
      y += h + 1;
    };

    figures.forEach((fig) => {
      ensure(22 + 25 + 17 * 2 + 20);
      pdf.text(M, y, fig.name, { size: 10.5, bold: true });
      y += 18;
      headRow();
      fig.rows.forEach((r, n) => {
        if (y + 19 > BOTTOM) { newPage(); pdf.text(M, y, `${fig.name} (continued)`, { size: 10.5, bold: true }); y += 18; headRow(); }
        drawRow(r, n, false);
      });
      ensure(22);
      drawRow(fig.total, 0, true);
      y += 16;
    });
  };

  const asCommodity = (cols) => cols.map((c, i) => (i === 0 ? { ...c, head: ['Commodity', ''] } : c));
  // with more than one commodity, the whole farm first: a row for each and a total, then each commodity's paddocks
  if (summary && urea.length > 1) section('Urea: all commodities', [ureaSummary(urea)], asCommodity(UREA_COLUMNS));
  section('Urea', urea, UREA_COLUMNS);
  const withStarter = starter.filter(hasStarter);
  if (withStarter.length) {
    if (urea.length) y += 6;
    if (summary && withStarter.length > 1) section('Starter fertiliser: all commodities', [starterSummary(withStarter)], asCommodity(STARTER_COLUMNS));
    section('Starter fertiliser', withStarter, STARTER_COLUMNS);
  }

  footer();
  return pdf.bytes();
}
