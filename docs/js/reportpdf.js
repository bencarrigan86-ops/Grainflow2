// The page the Yield and Harvest report PDFs are laid out on: portrait A4 in the same style as the Position, Fert and Seed
// pages (a green band with the title and season, a section heading with a rule, a green table head, banded rows, a shaded
// total row, a footer with the page number). The reports say what goes on it; this does the laying out, and runs a long
// table on to the next page with its heading and table head repeated. Pure: it builds bytes.

import { Pdf, wrapText } from './pdf.js?v=423';
import { drawBrandLogo } from './brand.js?v=423';

const PAGE = { width: 595.28, height: 841.89 };
const M = 36;
const GREY = 0.4;
const GREEN = [0.18, 0.49, 0.196];
const BAND = [0.93, 0.96, 0.93];
const TOTAL = [0.82, 0.9, 0.83];
const BODY = 9;
const HEAD = 7.5;

export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const fixed = (v, dp = 0) => num(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * @param {{title: string, business?: string, season?: string, today?: string, footerNote?: string}} opts
 */
export function createReport({ title, business = '', season = '', today = '', footerNote = '' }) {
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 44;
  let page = 1;
  let y = 0;

  const footer = () => {
    pdf.text(M, PAGE.height - 24, `Made in Commodity Mate.${footerNote ? ` ${footerNote}` : ''}`, { size: 7.5, gray: GREY });
    pdf.text(PAGE.width - M, PAGE.height - 24, `page ${page}`, { size: 7.5, gray: GREY, align: 'right' });
  };
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, title.toUpperCase(), { size: 20, bold: true, gray: 1 });
    if (season) pdf.text(rx, 20, season, { size: 12, bold: true, align: 'right', gray: 1 });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 44, who, { size: 9.5, gray: 0.92 });
    return 90;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  y = header();

  /** A section heading with a rule under it. */
  const heading = (text, { need = 60 } = {}) => {
    ensure(need);
    pdf.text(M, y, text, { size: 13, bold: true, gray: GREEN });
    pdf.line(M, y + 18, M + W, y + 18, { width: 1, gray: GREEN });
    y += 30;
  };

  /** A label on the left and its value on the right, on one line. */
  const pair = (label, value, { bold = false } = {}) => {
    ensure(18);
    pdf.text(M + 4, y, label, { size: BODY + 1, bold, gray: bold ? 0 : 0.2 });
    pdf.text(M + W - 4, y, String(value), { size: BODY + 1, bold, align: 'right' });
    y += 17;
  };

  /** A line of small grey text, wrapped to the page. */
  const note = (text) => {
    const lines = wrapText(String(text), W - 8, 8.5, false);
    ensure(lines.length * 12 + 6);
    lines.forEach((l) => { pdf.text(M + 4, y, l, { size: 8.5, gray: GREY }); y += 12; });
    y += 4;
  };

  const gap = (n = 10) => { y += n; };

  /**
   * A table: columns are {head, w (share of the width), left (left-aligned), cell(row)}. `total`, when given, is a row
   * shaded and ruled at the foot; its first cell reads "Total".
   */
  const table = (columns, rows, { total = null, name = '' } = {}) => {
    const widths = columns.map((c) => c.w * W);
    const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
    const put = (i, str, opts = {}) => {
      const c = columns[i];
      if (c.left) pdf.text(M + edges[i] + 5, y, wrapText(String(str ?? ''), widths[i] - 10, BODY, !!opts.bold)[0] || '', { size: BODY, ...opts });
      else pdf.text(M + edges[i] + widths[i] / 2, y, String(str ?? ''), { size: BODY, align: 'center', ...opts });
    };
    const headRow = () => {
      pdf.rect(M, y - 5, W, 19, { stroke: null, fill: GREEN });
      columns.forEach((c, i) => put(i, c.head, { bold: true, size: HEAD, gray: 1 }));
      y += 20;
    };
    ensure(20 + 18 * 2 + (total ? 24 : 0));
    headRow();
    rows.forEach((r, n) => {
      if (y + 20 > BOTTOM) {
        newPage();
        if (name) { pdf.text(M, y, `${name} (continued)`, { size: 11, bold: true, gray: GREEN }); y += 22; }
        headRow();
      }
      if (n % 2 === 1) pdf.rect(M, y - 5, W, 18, { stroke: null, fill: BAND });
      columns.forEach((c, i) => put(i, c.cell(r), i === 0 ? { bold: true } : {}));
      y += 18;
    });
    if (total) {
      ensure(26);
      pdf.rect(M, y - 5, W, 19, { stroke: null, fill: TOTAL });
      pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: GREEN });
      columns.forEach((c, i) => put(i, i === 0 ? 'Total' : (c.left ? '' : c.cell(total)), { bold: true }));
      y += 24;
    }
    y += 12;
  };

  /** A page that says there is nothing to report. */
  const message = (text) => { pdf.text(M, y, text, { size: 10, gray: GREY }); y += 20; };

  const bytes = () => { footer(); return pdf.bytes(); };

  return { heading, pair, note, gap, table, message, bytes, ensure, width: W };
}
