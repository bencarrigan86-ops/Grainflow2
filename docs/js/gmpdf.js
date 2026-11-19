// The Gross margin report as a PDF: for each crop, every paddock's area, yield, the crop's price, and revenue, cost and gross margin
// per hectare, with a total, and the whole farm at the end. The figures come from grossmargin.js (gmReport), the same ones the
// screen uses; a paddock with a cost of its own is marked with a star. Pure: it builds bytes.

import { createReport, fixed } from './reportpdf.js?v=418';

const money = (v) => `${v < 0 ? '-' : ''}$${fixed(Math.abs(v), 0)}`;

/** The table's columns: heading, share of the width, how a paddock's cell is written, and whether it is left-aligned. */
export const GM_COLUMNS = [
  { head: 'Field', w: 0.25, left: true, cell: (r) => r.name },
  { head: 'Area (ha)', w: 0.11, cell: (r) => fixed(r.area, 0) },
  { head: 'Yield t/ha', w: 0.12, cell: (r) => fixed(r.yieldTHa, 2) },
  { head: 'Price $/t', w: 0.12, cell: (r) => fixed(r.price, 0) },
  { head: 'Revenue /ha', w: 0.14, cell: (r) => fixed(r.revenueHa, 0) },
  { head: 'Cost /ha', w: 0.12, cell: (r) => `${fixed(r.costHa, 0)}${r.costIsOverride ? '*' : ''}` },
  { head: 'GM /ha', w: 0.14, cell: (r) => fixed(r.gmHa, 0) },
];

/**
 * @param {{groups: object[], total: object}} report  gmReport()
 * @param {{business?: string, season?: string, today?: string}} [opts]
 * @returns {Uint8Array} the PDF
 */
export function gmPdf({ groups = [], total = {} } = {}, { business = '', season = '', today = '' } = {}) {
  const report = createReport({
    title: 'Gross margin', business, season, today,
    footerNote: 'Price is the crop\'s blended price (sold and unsold). Cost is the crop\'s gross margin cost over its area; * a cost entered for that paddock.',
  });
  if (!groups.length) { report.message('Nothing to report yet: add a paddock in Production.'); return report.bytes(); }

  groups.forEach((g) => {
    report.heading(`${g.name}   ${money(g.total.gm)} gross margin`);
    report.table(GM_COLUMNS, g.fields, { total: { ...g.total, price: g.price }, name: g.name });
  });

  report.heading('Whole farm', { need: 110 });
  report.pair('Area', `${fixed(total.area, 0)} ha`);
  report.pair('Revenue', `${money(total.revenue)}   (${fixed(total.revenueHa, 0)} /ha)`);
  report.pair('Cost', `${money(total.cost)}   (${fixed(total.costHa, 0)} /ha)`);
  report.pair('Gross margin', `${money(total.gm)}   (${fixed(total.gmHa, 0)} /ha)`, { bold: true });
  return report.bytes();
}
