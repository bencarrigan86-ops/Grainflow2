// The traceability sheet: choose the loads (all going to contracts, one contract, or every load; dates and commodity if wanted),
// see which paddocks made them up (load by load, or sale by sale), and send or download it as a PDF.

import { db } from '../storage.js?v=429';
import { num, todayLocal, dmy, esc } from '../fmt.js?v=429';
import { openSheet, field, getVal, toast, notify } from '../ui.js?v=429';
import { exportRowsAsCSV } from '../csv.js?v=429';
import { sharePdf, downloadFile, safeFileName } from '../sharefile.js?v=429';
import { nowTime, rangeText } from '../loadreport.js?v=429';
import { traceReportRows, traceTotals, traceSummary, traceBySale, sourceText, traceCsvRows, TRACE_CSV_COLUMNS, buildTraceReportPdf } from '../tracereport.js?v=429';

const SHOWN = 40;   // loads listed on screen; the PDF has them all
const KEY = 'grainflow.tracereport.by';
const readBy = () => { try { return localStorage.getItem(KEY) === 'sale' ? 'sale' : 'load'; } catch { return 'load'; } };
const readStore = () => { try { return localStorage.getItem(KEY + '.store') === '1'; } catch { return false; } };
const saveStore = (on) => { try { localStorage.setItem(KEY + '.store', on ? '1' : '0'); } catch { /* off next time */ } };
const saveBy = (by) => { try { localStorage.setItem(KEY, by); } catch { /* shown by load next time */ } };

const bars = (summary, max = 12) => `<div class="tr-sum">${summary.slice(0, max).map((s) => `<div class="tr-line"><span class="tr-name">${esc(s.name)}</span><span class="tr-bar"><i style="width:${Math.max(2, Math.round(s.share * 100))}%"></i></span><span class="tr-t">${num(s.tons, 1)} t &middot; ${Math.round(s.share * 100)}%</span></div>`).join('')}
  ${summary.length > max ? `<div class="hint">and ${summary.length - max} more, in the PDF</div>` : ''}</div>`;

const loadLine = (x, store) => `<div class="list-item"><div><div class="main">${x.ticketNo === '' ? '' : `#${esc(x.ticketNo)} &middot; `}${esc(dmy(x.date))} &middot; ${num(x.tons, 2)} t</div><div class="meta">To ${esc(x.goingTo || 'nowhere recorded')}</div><div class="meta tr-from">${esc(sourceText(x, store))}</div></div></div>`;

export function openTraceSheet() {
  const data = db.get();
  const { commodities, sales, movements } = data;
  const inUse = commodities.filter((c) => movements.some((m) => m.commodityId === c.id));
  const toSales = sales.filter((s) => movements.some((m) => (m.tos || []).some((t) => t.type === 'sale' && t.id === s.id)));
  const saleLabel = (s) => [commodities.find((c) => c.id === s.commodityId)?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : ''].filter(Boolean).join(' · ') || 'Contract';
  let by = readBy();
  let store = readStore();

  openSheet('Traceability', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin:0 0 10px">Which paddocks the grain came from, worked out through the silos it passed through.</div>
      <div class="rep-mode" id="tr-by" role="group" aria-label="Show">
        <button type="button" data-by="load" class="${by === 'load' ? 'active' : ''}">By load</button>
        <button type="button" data-by="sale" class="${by === 'sale' ? 'active' : ''}">By sale</button>
      </div>
      <div style="height:10px"></div>
      ${field({ label: 'Loads', id: 'tr-scope', type: 'select', value: 'contracts', options: [{ value: 'contracts', label: 'All loads to contracts' }, ...toSales.map((s) => ({ value: s.id, label: saleLabel(s) })), { value: 'all', label: 'Every load, including to silos' }] })}
      ${inUse.length > 1 ? field({ label: 'Commodity', id: 'tr-commodity', type: 'select', value: '', options: [{ value: '', label: 'All commodities' }, ...inUse.map((c) => ({ value: c.id, label: c.name }))] }) : ''}
      <div class="grid-2">
        ${field({ label: 'From', id: 'tr-from', type: 'date', value: '' })}
        ${field({ label: 'To', id: 'tr-to', type: 'date', value: '' })}
      </div>
      <label class="tr-tick"><input type="checkbox" id="tr-store" ${store ? 'checked' : ''} /> Show the silo it came from <span>A silo holding several paddocks shows as a blend.</span></label>
      <div id="tr-result"></div>
      ${field({ label: 'Send to (email, optional)', id: 'tr-email', value: '', placeholder: 'name@example.com' })}
      <button class="btn" id="tr-csv" type="button" style="margin-top:6px">Download for Excel (CSV)</button>
      <button class="btn secondary" id="tr-send" type="button" style="margin-top:8px">Send as PDF</button>
      <button class="btn secondary" id="tr-download" type="button" style="margin-top:8px">Download PDF</button>`;

    const pick = () => ({ scope: getVal(root, 'tr-scope') || 'contracts', commodityId: getVal(root, 'tr-commodity') || '', from: getVal(root, 'tr-from') || '', to: getVal(root, 'tr-to') || '' });
    const rows = () => traceReportRows(data, pick());
    const paint = () => {
      const r = rows();
      const t = traceTotals(r);
      const out = root.querySelector('#tr-result');
      if (!r.length) { out.innerHTML = '<div class="empty">No loads match. Widen the dates, or choose all loads.</div>'; return; }
      const head = `<div class="row"><span class="label">On the report</span><span class="value">${t.loads} load${t.loads === 1 ? '' : 's'}, ${num(t.tons, 1)} t</span></div>`;
      if (by === 'sale') {
        out.innerHTML = head + traceBySale(r).map((g) => `<div class="tr-sale">
          <div class="tr-sale-head"><b>${esc([g.commodity, g.name].filter(Boolean).join(' · '))}</b><span>${g.loads} load${g.loads === 1 ? '' : 's'}, ${num(g.tons, 1)} t</span></div>
          ${bars(g.summary, 8)}
          <details class="fold"><summary><div><h2>Loads</h2></div></summary>${g.rows.slice(0, SHOWN).map((x) => loadLine(x, store)).join('')}${g.rows.length > SHOWN ? `<div class="hint">${g.rows.length - SHOWN} more loads in the PDF</div>` : ''}</details>
        </div>`).join('');
        return;
      }
      out.innerHTML = `${head}${bars(traceSummary(r))}
        ${r.slice(0, SHOWN).map((x) => loadLine(x, store)).join('')}
        ${r.length > SHOWN ? `<div class="hint" style="margin:6px 0">${r.length - SHOWN} more loads in the PDF</div>` : ''}`;
    };
    root.addEventListener('input', paint); root.addEventListener('change', paint);
    root.querySelector('#tr-store').addEventListener('change', (e) => { store = e.target.checked; saveStore(store); paint(); });
    root.querySelectorAll('[data-by]').forEach((b) => b.addEventListener('click', () => {
      by = b.dataset.by; saveBy(by);
      root.querySelectorAll('[data-by]').forEach((x) => x.classList.toggle('active', x === b));
      paint();
    }));
    paint();

    const make = async (andSend) => {
      const p = pick();
      const r = rows();
      if (!r.length) { notify('No loads match. Widen the dates, or choose all loads.'); return; }
      const email = (getVal(root, 'tr-email') || '').trim();
      const business = db.getBusinessDetails();
      const btns = [...root.querySelectorAll('button')]; btns.forEach((b) => { b.disabled = true; });
      try {
        const name = business.entityName || business.farmName || '';
        const scopeLabel = p.scope === 'contracts' ? 'Loads to contracts' : p.scope === 'all' ? 'Every load' : saleLabel(sales.find((s) => s.id === p.scope) || {});
        const bytes = buildTraceReportPdf(r, { business: name, ngr: business.ngr || '', from: p.from, to: p.to, scopeLabel, by, showStore: store, madeAt: `${dmy(todayLocal())} ${nowTime()}` });
        const fileName = safeFileName(`Traceability by ${by} ${rangeText(p.from, p.to)}`);
        if (!andSend) { downloadFile(bytes, fileName); toast('Downloaded'); return; }
        const t = traceTotals(r);
        const subject = `Traceability ${scopeLabel}${name ? ` - ${name}` : ''}`;
        const body = `Hi,\n\nPlease find the traceability report attached: ${t.loads} load${t.loads === 1 ? '' : 's'}, ${num(t.tons, 1)} t, with the paddocks each came from.\n\nThanks`;
        const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: email, subject, body } });
        if (result !== 'cancelled') toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
      } catch (e) {
        notify(`The report could not be made: ${e.message}`);
      } finally { btns.forEach((b) => { b.disabled = false; }); }
    };
    root.querySelector('#tr-csv').addEventListener('click', () => {
      const r = rows();
      if (!r.length) { notify('No loads match. Widen the dates, or choose all loads.'); return; }
      const p = pick();
      exportRowsAsCSV(`traceability-by-${by}-${p.from || 'all'}-${p.to || 'dates'}-${todayLocal()}.csv`, traceCsvRows(r, by), TRACE_CSV_COLUMNS);
      toast('Downloaded');
    });
    root.querySelector('#tr-send').addEventListener('click', () => make(true));
    root.querySelector('#tr-download').addEventListener('click', () => make(false));
  });
}
