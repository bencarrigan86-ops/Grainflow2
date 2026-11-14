// End of year snapshot: the grain position, what is sold and not delivered, and what is delivered and not invoiced, as at
// one day (30 June by default). The sheet shows it; Download PDF keeps a frozen copy to hand to the accountant. The
// arithmetic and the PDF are in eofy.js.

import { db } from '../storage.js?v=244';
import { openSheet, field, getVal } from '../ui.js?v=244';
import { num, money, esc, dmy, todayLocal } from '../fmt.js?v=244';
import { eofySnapshot, eofyPdf, financialYearEnd } from '../eofy.js?v=244';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=244';

const contractText = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};
const t = (v) => `${num(v, 1)} t`;

export function openEofySheet() {
  let asAt = financialYearEnd(todayLocal());
  const compute = () => {
    const { commodities, fields, sales, movements, invoices } = db.get();
    return eofySnapshot({ asAt, commodities, fields, sales, movements, invoices });
  };

  openSheet('End of year snapshot', (root) => {
    const paint = () => {
      const { commodities } = db.get();
      const snap = compute();
      const pos = snap.position;
      const row = (label, value, sub = '') => `<div class="row"><span class="label">${label}${sub ? `<span class="sub" style="display:block;font-size:12px;color:var(--text-dim)">${sub}</span>` : ''}</span><span class="value">${value}</span></div>`;

      root.innerHTML = `
        ${field({ label: 'As at', id: 'eofy-date', type: 'date', value: asAt, hint: 'The end of the financial year. Contracts, loads and invoices after this day are left out.' })}

        <div class="card summary">
          <h2><span class="dot summary"></span>Grain position</h2>
          ${pos.rows.length === 0 ? '<div class="empty">No grain to report on this day.</div>' : pos.rows.map((r) => `
          <div class="list-item stack">
            <div class="li-top"><div class="main">${esc(r.commodity.name)}</div><div class="main">${money(r.soldValue + r.unsoldValue, 0)}</div></div>
            ${row('Sold', `${t(r.soldTons)} &middot; ${money(r.soldValue, 0)}`, r.avgSoldPrice ? `average ${money(r.avgSoldPrice, 0)}/t` : '')}
            ${row('Not sold', `${t(r.unsoldTons)} &middot; ${money(r.unsoldValue, 0)}`, r.priceBasis === 'none' ? 'no price to value it at' : r.priceBasis === 'average' ? `at the average ${money(r.unsoldPrice, 0)}/t` : `at ${money(r.unsoldPrice, 0)}/t mark-to-market, nothing sold yet`)}
          </div>`).join('')}
          ${pos.rows.length ? `
          ${row('Sold', `${t(pos.soldTons)} &middot; ${money(pos.soldValue, 0)}`)}
          ${row('Not sold', `${t(pos.unsoldTons)} &middot; ${money(pos.unsoldValue, 0)}`)}
          ${row('<strong>Sold plus not sold</strong>', `<strong>${money(pos.total, 0)}</strong>`)}` : ''}
        </div>

        <div class="card">
          <h2>Sold, not yet delivered</h2>
          ${snap.notDelivered.rows.length === 0 ? '<div class="empty">Every contract is delivered.</div>' : snap.notDelivered.rows.map((r) => `
          <div class="list-item stack"><div class="li-top"><div class="main">${esc(contractText(r.sale, commodities))}</div><div class="main">${money(r.value, 0)}</div></div>
            <div class="meta">${t(r.tons)} owed at ${money(r.price, 0)}/t</div></div>`).join('')}
          ${snap.notDelivered.rows.length ? row('<strong>Total</strong>', `<strong>${t(snap.notDelivered.tons)} &middot; ${money(snap.notDelivered.value, 0)}</strong>`) : ''}
        </div>

        <div class="card">
          <h2>Delivered, not yet invoiced</h2>
          ${snap.notInvoiced.rows.length === 0 ? '<div class="empty">Every load is invoiced.</div>' : snap.notInvoiced.rows.map((r) => `
          <div class="list-item stack"><div class="li-top"><div class="main">${esc(contractText(r.sale, commodities))}</div><div class="main">${money(r.value, 0)}</div></div>
            <div class="meta">${t(r.tons)}${r.oldest ? ` &middot; oldest load ${esc(dmy(r.oldest))}` : ''}</div></div>`).join('')}
          ${snap.notInvoiced.rows.length ? row('<strong>Total</strong>', `<strong>${t(snap.notInvoiced.tons)} &middot; ${money(snap.notInvoiced.value, 0)}</strong>`) : ''}
          <div class="hint" style="margin-top:6px">Before GST.</div>
        </div>

        <div class="card">
          <h2>Invoiced, not yet paid</h2>
          ${snap.unpaid.count === 0 ? '<div class="empty">Nothing owed by buyers.</div>' : row(`${snap.unpaid.count} invoice${snap.unpaid.count === 1 ? '' : 's'}`, `<strong>${money(snap.unpaid.total, 0)}</strong>`, 'GST included')}
        </div>

        <button class="btn" id="eofy-pdf" style="margin-top:6px">${canShareFiles() ? 'Share PDF' : 'Download PDF'}</button>
        <div class="hint" style="margin-top:8px">The PDF is the frozen copy: these figures move on as the books do, the file does not.</div>`;

      root.querySelector('#eofy-date').addEventListener('change', () => {
        const v = getVal(root, 'eofy-date');
        if (v) { asAt = v; paint(); }
      });
      root.querySelector('#eofy-pdf').addEventListener('click', async () => {
        const bytes = eofyPdf(compute(), { businessName: db.getBusinessDetails().entityName || '', commodities });
        const fileName = safeFileName(`End of year snapshot ${dmy(asAt)}`);
        if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
        await sharePdf(bytes, fileName, { title: `End of year snapshot ${dmy(asAt)}` });
      });
    };
    paint();
  });
}
