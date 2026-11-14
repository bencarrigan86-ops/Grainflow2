// Export for Xero: the sales invoices and the bills in a date range, as two CSV files for Xero's own import
// (Business > Invoices > Import for sales invoices, Business > Bills to pay > Import for bills). The account codes
// are the accountant's, so they are asked for here and remembered on this device. The files are made in xero.js.

import { db } from '../storage.js?v=244';
import { openSheet, field, getVal } from '../ui.js?v=244';
import { esc, todayLocal } from '../fmt.js?v=244';
import { downloadCSV } from '../csv.js?v=244';
import { xeroInvoices, xeroBills, xeroCsv, DEFAULT_CODES, financialYearStart } from '../xero.js?v=244';

const CODES_KEY = 'grainflow.xero.codes';
const loadCodes = () => { try { return { ...DEFAULT_CODES, ...JSON.parse(localStorage.getItem(CODES_KEY) || '{}') }; } catch { return { ...DEFAULT_CODES }; } };
const saveCodes = (c) => { try { localStorage.setItem(CODES_KEY, JSON.stringify(c)); } catch { /* not kept; it still works */ } };

export function openXeroSheet() {
  const today = todayLocal();
  let from = financialYearStart(today);
  let to = today;
  let codes = loadCodes();

  openSheet('Export for Xero', (root) => {
    const make = () => {
      const { sales, commodities, invoices } = db.get();
      return {
        inv: xeroInvoices({ invoices, sales, commodities, from, to, codes }),
        bills: xeroBills({ payables: db.getPayables(), from, to, codes }),
      };
    };
    const readCodes = () => {
      codes = {};
      for (const k of Object.keys(DEFAULT_CODES)) codes[k] = (getVal(root, `xr-${k}`) || '').trim() || DEFAULT_CODES[k];
      saveCodes(codes);
    };
    const paint = () => {
      const { inv, bills } = make();
      const warnings = [...inv.warnings, ...bills.warnings];
      root.innerHTML = `
        <div class="hint" style="margin-bottom:8px">Two files for Xero's import: sales invoices, and bills. Invoices and bills are picked by their own date.</div>
        <div class="grid-2">
          ${field({ label: 'From', id: 'xr-from', type: 'date', value: from })}
          ${field({ label: 'To', id: 'xr-to', type: 'date', value: to })}
        </div>
        <div class="subhead">Xero account codes</div>
        <div class="hint" style="margin-bottom:6px">The codes in your Xero chart of accounts. Kept on this device.</div>
        <div class="grid-2">
          ${field({ label: 'Grain sales', id: 'xr-sales', value: codes.sales })}
          ${field({ label: 'Freight bills', id: 'xr-freight', value: codes.freight })}
          ${field({ label: 'Brokerage bills', id: 'xr-brokerage', value: codes.brokerage })}
          ${field({ label: 'Storage bills', id: 'xr-storage', value: codes.storage })}
        </div>
        ${field({ label: 'Other bills', id: 'xr-other', value: codes.other })}
        <button class="btn" id="xr-inv" ${inv.count ? '' : 'disabled'} style="margin-top:8px">Sales invoices (${inv.count})</button>
        <button class="btn" id="xr-bills" ${bills.count ? '' : 'disabled'} style="margin-top:8px">Bills (${bills.count})</button>
        ${warnings.length ? `<div class="hint" style="margin-top:10px;color:var(--danger)">Check before importing:<br>${warnings.slice(0, 8).map(esc).join('<br>')}${warnings.length > 8 ? `<br>and ${warnings.length - 8} more` : ''}</div>` : ''}
        <div class="hint" style="margin-top:10px">Levies and freight the buyer takes off are lines of their own, without GST, so each invoice comes to what Grainflow says is payable. Amounts are before GST; Xero adds it.</div>`;

      root.querySelector('#xr-from').addEventListener('change', () => { from = getVal(root, 'xr-from') || from; readCodes(); paint(); });
      root.querySelector('#xr-to').addEventListener('change', () => { to = getVal(root, 'xr-to') || to; readCodes(); paint(); });
      root.querySelector('#xr-inv').addEventListener('click', () => { readCodes(); downloadCSV(`Xero sales invoices ${from} to ${to}.csv`, xeroCsv(make().inv.rows)); });
      root.querySelector('#xr-bills').addEventListener('click', () => { readCodes(); downloadCSV(`Xero bills ${from} to ${to}.csv`, xeroCsv(make().bills.rows)); });
      for (const k of Object.keys(DEFAULT_CODES)) root.querySelector(`#xr-${k}`).addEventListener('change', () => { readCodes(); });
    };
    paint();
  });
}
