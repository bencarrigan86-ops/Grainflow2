// Import past sales (CSV): the farm's own contract register for earlier seasons, one row per contract.
//
// Choose the file, see what it would add to each season (contracts, tonnes, tonnes delivered, value, and any crops the
// season does not have yet), then import. A season that is not in the app yet, or that already has contracts, is left
// alone. With the paddocks imported first, the position for those seasons then reads: grown, sold, still unsold.

import { db, uid } from '../storage.js?v=325';
import { openSheet, closeSheet, toast } from '../ui.js?v=325';
import { esc, num, money } from '../fmt.js?v=325';
import { parsePastSales, planPastSales, salesRecords } from '../pastsales.js?v=325';
import { commodityProps } from '../pastseasons.js?v=325';

export function openPastSalesSheet() {
  openSheet('Import past sales', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:10px">Your own contract register for earlier seasons, as a CSV file with a row for each contract. The first row needs the headings
        <strong>Season</strong>, <strong>Commodity</strong>, <strong>Tonnes</strong> and <strong>Price</strong> (the delivered price, $/t).
        <strong>Date</strong>, <strong>Buyer</strong>, <strong>Contract No</strong>, <strong>Grade</strong>, <strong>Delivered</strong>, <strong>Freight</strong>,
        <strong>Premium / Discount</strong>, <strong>Levies</strong> and the delivery dates are optional.
        Import the season's paddocks first, so the position has what was grown beside what was sold.</div>
      <input type="file" id="ps-file" />
      <div id="ps-out" style="margin-top:12px"></div>`;
    const out = root.querySelector('#ps-out');

    root.querySelector('#ps-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const parsed = parsePastSales(await file.text());
      if (!parsed.rows.length) {
        out.innerHTML = `<div class="empty">${parsed.errors.map(esc).join('<br>') || 'Nothing to import.'}</div>`;
        return;
      }
      const seasons = db.getYears().map((label) => {
        const y = db.getYearData(label);
        return { label, commodities: y.commodities || [], salesCount: (y.sales || []).length };
      });
      const plan = planPastSales(parsed.rows, seasons);
      const ready = plan.filter((p) => p.ready);
      const farmCommodities = db.get().commodities;

      const why = (p) => (!p.exists ? 'not in the app: import its paddocks first' : p.hasSales ? 'already has contracts, left alone' : '');
      out.innerHTML = `
        <div class="subhead">What the file holds</div>
        ${plan.map((p) => `
          <div class="row"><span class="label"><strong>${esc(p.label)}</strong>${why(p) ? ` <span class="meta">(${why(p)})</span>` : ''}</span>
            <span class="value">${p.contracts} contract${p.contracts === 1 ? '' : 's'} &middot; ${num(p.tons, 0)} t &middot; ${num(p.delivered, 0)} t delivered &middot; ${money(p.value)}</span></div>`).join('')}
        ${plan.some((p) => p.ready && p.added.length) ? `
          <div class="subhead" style="margin-top:12px">Crops added to a season</div>
          <div class="hint">A contract for a crop the season has no paddocks of gets the crop added, so it still shows in the position.</div>
          <div class="meta" style="margin-bottom:8px">${plan.filter((p) => p.ready && p.added.length).map((p) => `<strong>${esc(p.label)}</strong>: ${p.added.map(esc).join(', ')}`).join(' &middot; ')}</div>` : ''}
        ${parsed.warnings.length ? `
          <div class="subhead" style="margin-top:12px">Kept, with something left out</div>
          <div class="meta" style="margin-bottom:8px">${parsed.warnings.slice(0, 10).map(esc).join('<br>')}${parsed.warnings.length > 10 ? `<br>and ${parsed.warnings.length - 10} more` : ''}</div>` : ''}
        ${parsed.errors.length ? `
          <div class="subhead" style="margin-top:12px">Rows left out</div>
          <div class="meta" style="margin-bottom:8px">${parsed.errors.slice(0, 12).map(esc).join('<br>')}${parsed.errors.length > 12 ? `<br>and ${parsed.errors.length - 12} more` : ''}</div>` : ''}
        ${ready.length
    ? `<div class="save-bar solo"><button class="btn" id="ps-go">Import contracts into ${ready.length} season${ready.length === 1 ? '' : 's'}</button></div>`
    : '<div class="empty">No season in the file can take contracts yet.</div>'}`;

      out.querySelector('#ps-go')?.addEventListener('click', () => {
        let made = 0;
        let contracts = 0;
        for (const p of ready) {
          const rec = salesRecords(p, db.getYearData(p.label).commodities || [], uid, (name) => commodityProps(name, farmCommodities));
          if (db.addPastSales(p.label, rec)) { made += 1; contracts += rec.sales.length; }
        }
        closeSheet();
        toast(`Imported ${contracts} contract${contracts === 1 ? '' : 's'} into ${made} season${made === 1 ? '' : 's'}`);
      });
    });
  });
}
