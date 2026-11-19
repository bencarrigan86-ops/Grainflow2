// The load report sheet: pick the dates, tick what to narrow the loads by (any number of commodities, contracts, paddocks, silos,
// grades, trucks or drivers), then send the list of loads on as a PDF.

import { db } from '../storage.js?v=428';
import { num, todayLocal, dmy, esc } from '../fmt.js?v=428';
import { openSheet, field, getVal, toast, notify } from '../ui.js?v=428';
import { sharePdf, downloadFile, safeFileName } from '../sharefile.js?v=428';
import { loadReportRows, loadReportTotals, loadFilterChoices, filterText, datePresets, buildLoadReportPdf, buildLoadTicketPdf, rangeText, nowTime } from '../loadreport.js?v=428';

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

/** The filters, in the order they are on the sheet: the name in the draft, what it is called, and which list of choices feeds it. */
const FILTERS = [
  { key: 'commodityIds', label: 'Commodity', list: 'commodities' },
  { key: 'saleIds', label: 'Contract', list: 'sales' },
  { key: 'fieldIds', label: 'Paddock', list: 'fields' },
  { key: 'storageIds', label: 'Storage', list: 'storages' },
  { key: 'grades', label: 'Grade', list: 'grades' },
  { key: 'trucks', label: 'Truck', list: 'trucks' },
  { key: 'drivers', label: 'Driver', list: 'drivers' },
];

/** What a filter says on its closed row: "All", the names when one or two are ticked, else how many. */
const pickedText = (labels) => (!labels.length ? 'All' : labels.length <= 2 ? labels.join(', ') : `${labels.length} picked`);

export function openLoadReportSheet() {
  const { fields, storages, sales, commodities, movements } = db.get();
  const ctx = { fields, storages, sales, commodities };
  const saved = read();
  const d = {
    from: '', to: '',   // opens on all dates; the buttons or the boxes narrow it
    commodityIds: [], saleIds: [], fieldIds: [], storageIds: [], storageDir: '', grades: [], trucks: [], drivers: [],
    showOrigin: saved.showOrigin !== false, showDestination: saved.showDestination !== false, showQuality: saved.showQuality !== false, email: saved.email || '',
  };
  const presets = datePresets(todayLocal());
  const choices = loadFilterChoices(movements, ctx);
  const saleLabel = (s) => [commodities.find((c) => c.id === s.commodityId)?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : ''].filter(Boolean).join(' · ') || 'Contract';
  // what each filter can be: only things that are on a load
  const options = {
    commodities: commodities.filter((c) => movements.some((m) => m.commodityId === c.id)).map((c) => ({ value: c.id, label: c.name })),
    sales: sales.filter((s) => movements.some((m) => (m.tos || []).some((x) => x.type === 'sale' && x.id === s.id))).map((s) => ({ value: s.id, label: saleLabel(s) })),
    fields: choices.fields.map((x) => ({ value: x.id, label: x.name })),
    storages: choices.storages.map((x) => ({ value: x.id, label: x.name })),
    grades: choices.grades.map((g) => ({ value: g, label: g })),
    trucks: choices.trucks.map((g) => ({ value: g, label: g })),
    drivers: choices.drivers.map((g) => ({ value: g, label: g })),
  };
  const shown = FILTERS.filter((x) => options[x.list].length);
  const dirChips = (x) => x.key !== 'storageIds' ? '' : `<div class="chips" id="lr-dir" role="group" aria-label="Loads in or out" style="margin:0 0 8px">${[['', 'In and out'], ['in', 'Loads in'], ['out', 'Loads out']].map(([v, t]) => `<button type="button" class="chip" data-dir="${v}">${t}</button>`).join('')}</div>`;
  const pickRow = (x) => `<details class="mp" data-mp="${x.key}">
      <summary><span>${x.label}</span><span class="mp-val" data-mp-val="${x.key}">All</span></summary>
      ${dirChips(x)}
      <div class="mp-list">${options[x.list].map((o) => `<label><input type="checkbox" data-mp-box="${x.key}" value="${esc(o.value)}" /> <span>${esc(o.label)}</span></label>`).join('')}</div>
      <div class="mp-foot"><button type="button" class="btn secondary small" data-mp-clear="${x.key}" style="width:auto;margin:0">Clear</button></div>
    </details>`;

  openSheet('Send a load report', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin:0 0 10px">A list of loads to send on: date, time, truck, driver, contract, estimated weight and ticket number.</div>
      <div class="chips" id="lr-presets" role="group" aria-label="Quick date ranges" style="margin-bottom:10px">${presets.map((p) => `<button type="button" class="chip" data-preset="${p.key}">${p.label}</button>`).join('')}</div>
      <div class="grid-2">
        ${field({ label: 'From', id: 'lr-from', type: 'date', value: d.from })}
        ${field({ label: 'To', id: 'lr-to', type: 'date', value: d.to })}
      </div>
      ${shown.length ? `<div class="subhead" style="margin-top:4px">Only loads that match</div>
      <div class="hint" style="margin:0 0 8px">Tick one or more in any of these. A load has to match one tick in each filter you use.</div>
      <div id="lr-filters">${shown.map(pickRow).join('')}</div>` : ''}
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:10px 0 10px"><input type="checkbox" id="lr-origin" ${d.showOrigin ? 'checked' : ''} style="width:18px;height:18px" /> Show where each load came from (storage or paddock)</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="lr-dest" ${d.showDestination ? 'checked' : ''} style="width:18px;height:18px" /> Show the destination when a load is going to a contract</label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0 0 10px"><input type="checkbox" id="lr-quality" ${d.showQuality ? 'checked' : ''} style="width:18px;height:18px" /> Show quality results where a load was tested</label>
      ${field({ label: 'Send to (email, optional)', id: 'lr-email', value: d.email, placeholder: 'name@example.com' })}
      <div class="row"><span class="label">On the report</span><span class="value" id="lr-count">-</span></div>
      <button class="btn" id="lr-send" type="button" style="margin-top:10px">Send as PDF</button>
      <button class="btn secondary" id="lr-download" type="button" style="margin-top:8px">Download</button>`;

    const collect = () => {
      d.from = getVal(root, 'lr-from') || ''; d.to = getVal(root, 'lr-to') || '';
      for (const x of FILTERS) d[x.key] = [...root.querySelectorAll(`[data-mp-box="${x.key}"]:checked`)].map((b) => b.value);
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
      // the button for the range on the screen is lit; a range typed by hand lights none
      root.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('active', b.dataset.dir === d.storageDir));
      root.querySelectorAll('[data-preset]').forEach((b) => { const p = presets.find((x) => x.key === b.dataset.preset); b.classList.toggle('active', !!p && p.from === d.from && p.to === d.to); });
      // each filter's closed row says what is ticked
      for (const x of shown) {
        const labels = options[x.list].filter((o) => d[x.key].includes(o.value)).map((o) => o.label);
        const word = x.key === 'storageIds' && d.storageDir ? (d.storageDir === 'in' ? 'Loads in' : 'Loads out') : '';
        root.querySelector(`[data-mp="${x.key}"]`).classList.toggle('on', labels.length > 0 || !!word);
        root.querySelector(`[data-mp-val="${x.key}"]`).textContent = word ? (labels.length ? `${word}: ${pickedText(labels)}` : word) : pickedText(labels);
      }
    };
    root.querySelector('#lr-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-preset]'); if (!b) return;
      const p = presets.find((x) => x.key === b.dataset.preset);
      root.querySelector('#lr-from').value = p.from; root.querySelector('#lr-to').value = p.to;
      calc();
    });
    root.querySelector('#lr-dir')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dir]'); if (!b) return;
      d.storageDir = b.dataset.dir; calc();
    });
    root.querySelectorAll('[data-mp-clear]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll(`[data-mp-box="${b.dataset.mpClear}"]`).forEach((c) => { c.checked = false; });
      if (b.dataset.mpClear === 'storageIds') d.storageDir = '';
      calc();
    }));
    root.addEventListener('input', calc); root.addEventListener('change', calc);
    calc();

    const make = async (andSend) => {
      collect();
      const r = rows();
      if (!r.length) { notify('No loads match. Widen the dates or clear a filter.'); return; }
      save({ showOrigin: d.showOrigin, showDestination: d.showDestination, showQuality: d.showQuality, email: d.email });
      const business = db.getBusinessDetails();
      const btns = [...root.querySelectorAll('button')]; btns.forEach((b) => { b.disabled = true; });
      try {
        const name = business.entityName || business.farmName || '';
        const bytes = buildLoadReportPdf(r, { business: name, ngr: business.ngr || '', from: d.from, to: d.to, showOrigin: d.showOrigin, showDestination: d.showDestination, showQuality: d.showQuality, filters: filterText(d, ctx), madeAt: `${dmy(todayLocal())} ${nowTime()}` });
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
