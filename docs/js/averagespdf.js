// Averages by commodity as a PDF: each crop's average yield and price over the seasons picked, with the season-by-season
// figures under it. Same numbers as the screen (seasonAverages() is passed in), laid out portrait, one block per crop in the
// same green as the Position page. Pure: it builds bytes and touches nothing else.

import { Pdf } from './pdf.js?v=447';
import { drawBrandLogo } from './brand.js?v=447';

const PAGE = { width: 595.28, height: 841.89 };
const M = 36;
const GREY = 0.4;
const GREEN = [0.18, 0.49, 0.196];
const BAND = [0.93, 0.96, 0.93];
const TOTAL = [0.82, 0.9, 0.83];
const LINE = [0.78, 0.86, 0.78];
const BODY = 9;
const HEAD = 7.5;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const group = (n, dp = 0) => Math.abs(num(n)).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const dollars = (v) => `${num(v) < 0 ? '-' : ''}$${group(v, 0)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The season table's columns: heading, share of the width, and how a season's cell and the all-seasons cell are written. */
export const AVERAGES_PDF_COLUMNS = [
  { label: 'Season', w: 0.16, cell: (s, l) => l, total: () => 'All seasons' },
  { label: 'Area (ha)', w: 0.13, cell: (s) => (s.ha ? group(s.ha, 0) : '-'), total: (t) => (t.ha ? group(t.ha, 0) : '-') },
  { label: 'Produced (t)', w: 0.15, cell: (s) => (s.tons ? group(s.tons, 0) : '-'), total: (t) => (t.tons ? group(t.tons, 0) : '-') },
  { label: 'Yield t/ha', w: 0.15, cell: (s) => (s.yieldTHa ? `${group(s.yieldTHa, 2)}${s.est ? ' est' : ''}` : '-'), total: (t) => (t.yieldTHa ? `${group(t.yieldTHa, 2)}${t.est ? ' est' : ''}` : '-') },
  { label: 'Sold (t)', w: 0.13, cell: (s) => (s.soldTons ? group(s.soldTons, 0) : '-'), total: (t) => (t.soldTons ? group(t.soldTons, 0) : '-') },
  { label: 'Contract $/t', w: 0.14, cell: (s) => (s.soldTons ? dollars(s.contractPrice) : '-'), total: (t) => (t.soldTons ? dollars(t.contractPrice) : '-') },
  { label: 'Net $/t', w: 0.14, cell: (s) => (s.soldTons ? dollars(s.netPrice) : '-'), total: (t) => (t.soldTons ? dollars(t.netPrice) : '-') },
];

/**
 * @param {{labels: string[], commodities: object[]}} result  seasonAverages()
 * @param {{business?: string, today?: string}} [opts]  today is written as it should read (dd-mm-yyyy)
 * @returns {Uint8Array} the PDF
 */
export function averagesPdf(result = { labels: [], commodities: [] }, { business = '', today = '' } = {}) {
  const labels = result.labels || [];
  const commodities = result.commodities || [];
  const pdf = new Pdf(PAGE);
  const W = PAGE.width - M * 2;
  const BOTTOM = PAGE.height - 44;
  let page = 1;
  let y = 0;

  const span = labels.length ? `${labels[0]}${labels.length > 1 ? ` to ${labels[labels.length - 1]}` : ''}` : '';
  const footer = () => {
    pdf.text(M, PAGE.height - 24, 'Made in Commodity Mate. Yield is total tonnes over total hectares; price is weighted by tonnes sold.', { size: 7.5, gray: GREY });
    pdf.text(PAGE.width - M, PAGE.height - 24, `page ${page}`, { size: 7.5, gray: GREY, align: 'right' });
  };
  const header = () => {
    pdf.rect(0, 0, PAGE.width, 68, { stroke: null, fill: GREEN });
    const rx = drawBrandLogo(pdf, { right: PAGE.width - M, top: 11, tile: true });   // the farm's logo, if it has one
    pdf.text(M, 16, 'AVERAGES', { size: 20, bold: true, gray: 1 });
    pdf.text(rx, 20, span, { size: 12, bold: true, align: 'right', gray: 1 });
    const who = [business, today ? `Printed ${today}` : ''].filter(Boolean).join('   ·   ');
    if (who) pdf.text(M, 44, who, { size: 9.5, gray: 0.92 });
    pdf.text(M, 76, 'By commodity', { size: 8, gray: GREY });
    return 96;
  };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = header(); };
  const ensure = (h) => { if (y + h > BOTTOM) newPage(); };
  y = header();

  if (!commodities.length) {
    pdf.text(M, y, 'Nothing grown or sold in the seasons picked.', { size: 10, gray: GREY });
    footer();
    return pdf.bytes();
  }

  const widths = AVERAGES_PDF_COLUMNS.map((c) => c.w * W);
  const edges = widths.reduce((a, w, i) => { a.push(a[i] + w); return a; }, [0]);
  const cell = (i, str, opts = {}) => {
    const left = M + edges[i];
    if (i === 0) pdf.text(left + 5, y, String(str), { size: BODY, ...opts });
    else pdf.text(left + widths[i] / 2, y, String(str), { size: BODY, align: 'center', ...opts });
  };
  const headRow = () => {
    pdf.rect(M, y - 5, W, 19, { stroke: null, fill: GREEN });
    AVERAGES_PDF_COLUMNS.forEach((c, i) => cell(i, c.label, { bold: true, size: HEAD, gray: 1 }));
    y += 20;
  };

  let anyEstimate = false;
  commodities.forEach((c) => {
    const t = c.total;
    const seasons = labels.filter((l) => c.seasons[l]);
    if (t.est) anyEstimate = true;
    // the crop's heading and its two figures stay together with the table's head and first row
    ensure(28 + 62 + 20 + 18 * 2);
    pdf.text(M, y, c.name, { size: 13, bold: true, gray: GREEN });
    pdf.line(M, y + 18, M + W, y + 18, { width: 1, gray: GREEN });
    y += 28;

    const tileW = (W - 10) / 2;
    const tiles = [
      ['Average yield', t.yieldTHa ? `${group(t.yieldTHa, 2)} t/ha${t.est ? ' est' : ''}` : 'none yet',
        `${plural(t.seasonsGrown, 'season')} grown  ·  ${group(t.ha, 0)} ha  ·  ${group(t.tons, 0)} t`],
      ['Average price', t.soldTons ? `${dollars(t.contractPrice)}/t` : 'no sales',
        t.soldTons ? `net ${dollars(t.netPrice)}/t after freight and levies  ·  ${group(t.soldTons, 0)} t sold  ·  ${dollars(t.soldValue)}` : 'nothing sold in these seasons'],
    ];
    tiles.forEach(([label, value, note], i) => {
      const x = M + i * (tileW + 10);
      pdf.rect(x, y, tileW, 52, { stroke: LINE, fill: BAND, lineWidth: 0.6 });
      pdf.rect(x, y, 4, 52, { stroke: null, fill: GREEN });
      pdf.text(x + 14, y + 8, label.toUpperCase(), { size: 7.5, bold: true, gray: GREEN });
      pdf.text(x + 14, y + 20, value, { size: 14, bold: true });
      pdf.text(x + 14, y + 40, note, { size: 6.8, gray: GREY });
    });
    y += 66;

    headRow();
    seasons.forEach((l, n) => {
      if (y + 20 > BOTTOM) { newPage(); headRow(); }
      if (n % 2 === 1) pdf.rect(M, y - 5, W, 18, { stroke: null, fill: BAND });
      AVERAGES_PDF_COLUMNS.forEach((col, i) => cell(i, col.cell(c.seasons[l], l), i === 0 ? { bold: true } : {}));
      y += 18;
    });
    ensure(26);
    pdf.rect(M, y - 5, W, 19, { stroke: null, fill: TOTAL });
    pdf.line(M, y - 5, M + W, y - 5, { width: 1.2, gray: GREEN });
    AVERAGES_PDF_COLUMNS.forEach((col, i) => cell(i, col.total(t), { bold: true }));
    y += 36;
  });

  // what the figures mean, once, at the end
  const notes = [
    'Yield is total tonnes over total hectares, so bigger paddocks count for more. Seasons with no tonnes are left out.',
    'Price is weighted by tonnes sold. Contract is the price on the contract; net is what is left per tonne after freight and levies.',
  ];
  if (anyEstimate) notes.unshift('"est" means at least one season in that average is a forecast yield, not a recorded one.');
  ensure(notes.length * 13 + 4);
  notes.forEach((n) => { pdf.text(M, y, n, { size: 8, gray: GREY }); y += 13; });

  footer();
  return pdf.bytes();
}
