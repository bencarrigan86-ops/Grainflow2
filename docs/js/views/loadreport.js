// The load report sheet: pick the dates (and a commodity or contract if wanted), then send the list of loads on as a PDF.

import { db } from '../storage.js?v=349';
import { num, todayLocal, dmy } from '../fmt.js?v=349';
import { openSheet, field, getVal, toast, notify } from '../ui.js?v=349';
import { sharePdf, downloadFile, safeFileName } from '../sharefile.js?v=349';
import { loadReportRows, loadReportTotals, buildLoadReportPdf, buildLoadTicketPdf, rangeText, nowTime } from '../loadreport.js?v=349';

// what was chosen last time, remembered on this device
const KEY = 'grainflow.loadreport';
const read = () => { try { return { showOrigin: true, email: '', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { showOrigin: true, email: '' }; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* not remembered */ } };

/** The show-where-it-came-from choice, shared by the report and a single ticket. */
export const readOrigin = () => read().showOrigin !== false;
export const saveOrigin = (showOrigin) => save({ ...read(), showOrigin });
export const readQuality = () => read().showQuality !== false;
export const saveQuality = (showQuality) => save({ ...read(), showQuality });
export const readSplit = () => read().showSplit !== false;
export const saveSplit = (showSplit) => save({ ...read(), showSplit });
export const readComments = () => read().showComments !== false;
export const saveComments = (showComments) => save({ ...read(), showComments });
export const readDestination = () => read().showDestination !== false;
export const saveDestination = (showDestination) => save({ ...read(), showDestination });

/** One saved load, made into a slip and sent on (or downloaded). */
export async function sendLoadTicket(m, { showOrigin = true, showDestination = true, showComments = true, showQuality = true, showSplit = true, download = false } = {}) {
  const { fields, storages, sales, commodities } = db.get();
  const row = loadReportRows([m], { fields, storages, sales, commodities })[0];
  const business = db.getBusinessDetails();
  const name = business.entityName || business.farmName || '';
  const bytes = buildLoadTicketPdf(row, { business: name, ngr: business.ngr || '', showOrigin, showDestination, showComments, showQuality, showSplit, madeAt: `${dmy(todayLocal())} ${nowTime()}` });
  const fileName = safeFileName(`Load ticket ${row.ticketNo === '' ? '' : `${row.ticketNo} `}${dmy(row.date)}`);
  if (download) { downloadFile(bytes, fileName); toast('Downloaded'); return; }
  const subject = `Load ticket${row.ticketNo === '' ? '' : ` #${row.ticketNo}`} ${dmy(row.date)}${name ? ` - ${name}` : ''}`;
  const body = `Hi,

Please find the load ticket attached${row.truck ? ` for truck ${row.truck}` : ''}${row.tons ? `, ${num(row.tons, 1)} t` : ''}.

Thanks`;
  const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: read().email || '', subject, body } });
  if (result !== 'cancelled') toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
}

export function openLoadReportSheet() {
  const { fields, storages, sales, commodities, movements } = db.get();
  const ctx = { fields, storages, sales, commodities };
  const saved = read();
  const d = { from: todayLocal(), to: todayLocal(), commodityId: '', saleId: '', showOrigin: saved.showOrigin !== false, showDestination: saved.showDestination !== false, showQuality: saved.showQuality !== false, email: saved.email || '' };
  const inUse = commodities.filter((c) => movements.some((m) => m.commodityId === c.id));
  const toSales = sales.filter((s) => movements.some((m) => (m.tos || []).some((t) => t.type === 'sale' && t.id === s.id)));
  const saleLabel = (s) => [commodities.find((c) => c.id === s.commodityId)?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : ''].filter(Boolean).join(' · ') || 'Contract';

  openSheet('Send a load report', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin:0 0 10px">A list of loads to send on: date, time, truck, driver, contract, estimated weight and ticket number.</div>
      <div class="grid-2">
        ${field({ label: 'From', id: 'lr-from', type: 'date', value: d.from })}
        ${field({ label: 'To', id: 'lr-to', type: 'date', value: d.to })}
      </div>
      ${inUse.length > 1 ? field({ label: 'Commodity', id: 'lr-commodity', type: 'select', value: d.commodityId, options: [{ value: '', label: 'All commodities' }, ...inUse.map((c) => ({ value: c.id, label: c.name }))] }) : ''}
      ${toSales.length ? field({ label: 'Contract', id: 'lr-sale', type: 'select', value: d.saleId, options: [{ value: '', label: 'All contracts and silos' }, ...toSales.map((s) => ({ value: s.id, label: saleLabel(s) }))] }) : ''}
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:4px 0 10px"><input type="checkbox" id="lr-origin" ${d.showOrigin ? 'checked' : ''} style="width:18px;height:18px" /> Show where each load came from (storage or paddock)</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="lr-dest" ${d.showDestination ? 'checked' : ''} style="width:18px;height:18px" /> Show the destination when a load is going to a contract</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="lr-quality" ${d.showQuality ? 'checked' : ''} style="width:18px;height:18px" /> Show quality results where a load was tested</label>
      ${field({ label: 'Send to (email, optional)', id: 'lr-email', value: d.email, placeholder: 'name@example.com' })}
      <div class="row"><span class="label">On the report</span><span class="value" id="lr-count">-</span></div>
      <button class="btn" id="lr-send" type="button" style="margin-top:10px">Send as PDF</button>
      <button class="btn secondary" id="lr-download" type="button" style="margin-top:8px">Download</button>`;

    const collect = () => {
      d.from = getVal(root, 'lr-from') || ''; d.to = getVal(root, 'lr-to') || '';
      d.commodityId = getVal(root, 'lr-commodity') || ''; d.saleId = getVal(root, 'lr-sale') || '';
      d.showOrigin = root.querySelector('#lr-origin').checked;
      d.showDestination = root.querySelector('#lr-dest').checked;
      d.showQuality = root.querySelector('#lr-quality').checked;
      d.email = (getVal(root, 'lr-email') || '').trim();
    };
    const rows = () => loadReportRows(movements, ctx, d);
    const calc = () => {
      collect();
      const t = loadReportTotals(rows());
      root.querySelector('#lr-count').textContent = `${t.loads} load${t.loads === 1 ? '' : 's'}, ${num(t.tons, 1)} t`;
    };
    root.addEventListener('input', calc); root.addEventListener('change', calc);
    calc();

    const make = async (andSend) => {
      collect();
      const r = rows();
      if (!r.length) { notify('No loads fall in those dates. Widen the dates or clear the commodity or contract.'); return; }
      save({ showOrigin: d.showOrigin, showDestination: d.showDestination, showQuality: d.showQuality, email: d.email });
      const business = db.getBusinessDetails();
      const btns = [...root.querySelectorAll('button')]; btns.forEach((b) => { b.disabled = true; });
      try {
        const name = business.entityName || business.farmName || '';
        const bytes = buildLoadReportPdf(r, { business: name, ngr: business.ngr || '', from: d.from, to: d.to, showOrigin: d.showOrigin, showDestination: d.showDestination, showQuality: d.showQuality, madeAt: `${dmy(todayLocal())} ${nowTime()}` });
        const fileName = safeFileName(`Load report ${rangeText(d.from, d.to)}`);
        if (!andSend) { downloadFile(bytes, fileName); toast('Downloaded'); return; }
        const t = loadReportTotals(r);
        const subject = `Load report ${rangeText(d.from, d.to)}${name ? ` - ${name}` : ''}`;
        const body = `Hi,\n\nPlease find the load report attached for ${rangeText(d.from, d.to)}: ${t.loads} load${t.loads === 1 ? '' : 's'}, ${num(t.tons, 1)} t.\n\nThanks`;
        const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: d.email, subject, body } });
        if (result !== 'cancelled') toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
      } catch (e) {
        notify(`The report could not be made: ${e.message}`);
      } finally { btns.forEach((b) => { b.disabled = false; }); }
    };
    root.querySelector('#lr-send').addEventListener('click', () => make(true));
    root.querySelector('#lr-download').addEventListener('click', () => make(false));
  });
}
