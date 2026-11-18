// The top of a document the farm sends out (a tax invoice, an adjustment note, a confirmation of sale): the farm's name
// and ABN, the document's title and its reference line on a green band, with the farm's logo at the right when it has one.
// One place, so every document carries the same letterhead. Pure: takes the business details, returns HTML.

import { esc } from './fmt.js?v=370';

/** The farm's own name line: the entity, with its ABN, as it would be printed on letterhead. */
export function letterheadLine(business) {
  const name = String(business?.entityName || business?.farmName || '').trim();
  const abn = String(business?.abn || '').trim();
  return [name, abn ? `ABN ${abn}` : ''].filter(Boolean).join(' · ');
}

/**
 * @param {object} business  the business details (entityName, farmName, abn, logo, logoOff)
 * @param {{title: string, meta?: string[]}} doc  the document's title, and its reference line as spans of HTML
 */
export function docBandHTML(business, { title, meta = [] }) {
  const from = letterheadLine(business);
  return `
      <div class="doc-band">
        <div class="doc-band-main">
          ${from ? `<div class="doc-band-from">${esc(from)}</div>` : ''}
          <h2 class="title">${esc(title)}</h2>
          <div class="invoice-meta">${meta.join('')}</div>
        </div>
        ${business?.logo && !business?.logoOff ? `<div class="doc-band-logo"><img src="${esc(business.logo)}" alt="" /></div>` : ''}
      </div>`;
}
