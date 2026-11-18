// The Yield report as a PDF: for each commodity, every paddock's area, how its yield was reached, the yield in t/ha and the
// tonnes, with a total, and the whole farm at the end. The figures come from fertfigures.js (yieldFigures), the same ones the
// screen uses. Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=414';

/** The yield table's columns: heading, share of the width, how a paddock's cell is written, and whether it is left-aligned. */
export const YIELD_COLUMNS = [
  { head: 'Field', w: 0.34, left: true, cell: (r) => r.name },
  { head: 'Area (ha)', w: 0.16, cell: (r) => fixed(r.area, 1) },
  { head: 'Yield from', w: 0.18, cell: (r) => r.mode || '' },
  { head: 'Yield t/ha', w: 0.16, cell: (r) => fixed(r.yieldTHa, 2) },
  { head: 'Tonnes', w: 0.16, cell: (r) => fixed(r.tons, 1) },
];

/**
 * @param {{name: string, rows: object[], total: object}[]} figures  yieldFigures() for each commodity
 * @param {{business?: string, season?: string, today?: string}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function yieldPdf(figures = [], { business = '', season = '', today = '' } = {}) {
  const report = createReport({
    title: 'Yield', business, season, today,
    footerNote: 'Yield is the tonnes over the area; Actual is from the load tickets, Recorded from a figure entered, Estimate from the paddock\'s estimated yield.',
  });
  if (!figures.length) { report.message('Nothing to report yet: add a paddock in Production.'); return report.bytes(); }

  figures.forEach((fig) => {
    report.heading(`${fig.name}   ${fixed(fig.total.tons, 1)} t`);
    report.table(YIELD_COLUMNS, fig.rows, { total: fig.total, name: fig.name });
  });

  // the whole farm, from the same figures
  const area = figures.reduce((a, f) => a + f.total.area, 0);
  const tons = figures.reduce((a, f) => a + f.total.tons, 0);
  report.heading('Whole farm', { need: 80 });
  report.pair('Area', `${fixed(area, 1)} ha`);
  report.pair('Yield', `${fixed(area > 0 ? tons / area : 0, 2)} t/ha`);
  report.pair('Tonnes', `${fixed(tons, 1)} t`, { bold: true });
  return report.bytes();
}
