// Stock by location: the Reports window that lists every silo, bunker and off-farm site with what it holds, by commodity and grade.

import { db } from '../storage.js?v=437';
import { num, esc, todayLocal, dmy } from '../fmt.js?v=437';
import { openSheet, toast } from '../ui.js?v=437';
import { safeFileName, sharePdf, downloadFile, canShareFiles } from '../sharefile.js?v=437';
import { exportRowsAsCSV } from '../csv.js?v=437';
import { stockByLocation, stockByGrade, narrowed, stockRows, STOCK_COLUMNS, stockPdf } from '../stocklocation.js?v=437';

const SCOPES = [['all', 'All'], ['farm', 'On farm'], ['off', 'Off farm']];
const SCOPE_TEXT = { all: '', farm: 'On farm', off: 'Off farm' };
const GROUPS = [['location', 'By location'], ['grade', 'By grade']];
const KEY = 'grainflow.stocklocation';
const GROUP_KEY = 'grainflow.stocklocation.group';
const readGroup = () => { try { return localStorage.getItem(GROUP_KEY) === 'grade' ? 'grade' : 'location'; } catch { return 'location'; } };
const saveGroup = (v) => { try { localStorage.setItem(GROUP_KEY, v); } catch { /* not remembered */ } };
const readScope = () => { try { const v = localStorage.getItem(KEY); return SCOPES.some(([k]) => k === v) ? v : 'all'; } catch { return 'all'; } };
const saveScope = (v) => { try { localStorage.setItem(KEY, v); } catch { /* not remembered */ } };

const gradeRows = (c) => c.grades.map((g) => `<div class="row" style="padding:2px 0 2px 14px"><span class="label">${esc(g.grade || 'No grade')}</span><span class="value">${num(g.tons, 1)} t${g.tons < 0 ? ' (over-drawn)' : ''}</span></div>`).join('');
const commodityBlock = (c) => `<div class="row" style="margin-top:6px"><span class="label"><strong>${esc(c.name)}</strong></span><span class="value"><strong>${num(c.tons, 1)} t</strong></span></div>${gradeRows(c)}`;

/** The by-grade view: for each commodity, each grade, and under it every location holding it with that grade's own tonnes. */
const gradeBlock = (c) => `
  <div class="card" style="margin-bottom:10px">
    <div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${esc(c.name)}</h2><div class="main">${num(c.tons, 1)} t</div></div>
    ${c.grades.map((g) => `
      <div class="of-commodity"><span><strong>${esc(g.grade || 'No grade')}</strong></span><span><strong>${num(g.tons, 1)} t</strong></span></div>
      ${g.sites.map((s) => `<div class="of-grade"><span>${esc(s.name)}${s.operator ? ` &middot; ${esc(s.operator)}` : s.kind === 'off' ? ' &middot; off farm' : ''}</span><span>${num(s.tons, 1)} t</span></div>`).join('')}`).join('')}
  </div>`;

export function openStockByLocationSheet() {
  openSheet('Stock by location', (root) => {
    let scope = readScope();
    let group = readGroup();
    const data = () => {
      const d = db.get();
      return d;
    };
    const full = () => stockByLocation(data());
    const shown = () => narrowed(full(), scope, data());

    const paint = () => {
      const report = shown();
      root.querySelector('#sl-body').innerHTML = report.locations.length && group === 'grade' ? stockByGrade(report).map(gradeBlock).join('')
        : !report.locations.length
        ? `<div class="empty">${scope === 'off' ? 'Nothing is held off farm.' : scope === 'farm' ? 'Nothing is held in the silos and bunkers.' : 'Nothing is held in storage yet.'}</div>`
        : `${report.locations.map((l) => `
          <div class="card" style="margin-bottom:10px">
            <div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${esc(l.name)}</h2><div class="main">${num(l.tons, 1)} t</div></div>
            <div class="meta">${l.kind === 'off' ? `Off farm${l.operator ? ` &middot; ${esc(l.operator)}` : ''}` : 'On farm'}</div>
            ${l.commodities.map(commodityBlock).join('')}
          </div>`).join('')}
          ${report.locations.length > 1 ? `<div class="card" style="margin-bottom:10px">
            <div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${scope === 'all' ? 'All locations' : `All ${SCOPE_TEXT[scope].toLowerCase()} locations`}</h2><div class="main">${num(report.total.tons, 1)} t</div></div>
            ${report.total.commodities.map(commodityBlock).join('')}
          </div>` : ''}`;
      root.querySelectorAll('.sl-scope').forEach((b) => b.classList.toggle('active', b.dataset.scope === scope));
      root.querySelectorAll('.sl-group').forEach((b) => b.classList.toggle('active', b.dataset.group === group));
    };

    root.innerHTML = `
      <div class="segmented" style="margin-bottom:8px">${GROUPS.map(([k, label]) => `<button type="button" class="sl-group" data-group="${k}">${label}</button>`).join('')}</div>
      <div class="segmented" style="margin-bottom:10px">${SCOPES.map(([k, label]) => `<button type="button" class="sl-scope" data-scope="${k}">${label}</button>`).join('')}</div>
      <div id="sl-body"></div>
      <div class="save-bar"><button type="button" class="btn secondary" id="sl-csv" style="flex:1;padding-left:12px;padding-right:12px">Excel (CSV)</button><button type="button" class="btn" id="sl-pdf" style="flex:1;padding-left:12px;padding-right:12px">PDF</button></div>`;
    root.querySelectorAll('.sl-scope').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; saveScope(scope); paint(); }));
    root.querySelectorAll('.sl-group').forEach((b) => b.addEventListener('click', () => { group = b.dataset.group; saveGroup(group); paint(); }));
    root.querySelector('#sl-csv').addEventListener('click', () => {
      const report = shown();
      if (!report.locations.length) { toast('Nothing to export yet.'); return; }
      exportRowsAsCSV(safeFileName(`grainflow-stock-by-location-${todayLocal()}`, 'csv'), stockRows(report), STOCK_COLUMNS);
      toast('Downloaded. It opens in Excel.');
    });
    root.querySelector('#sl-pdf').addEventListener('click', async () => {
      const report = shown();
      if (!report.locations.length) { toast('Nothing to put in the PDF yet.'); return; }
      const bytes = stockPdf({ report, business: db.getBusinessDetails().entityName || '', today: dmy(todayLocal()), scope: SCOPE_TEXT[scope], group });
      const fileName = safeFileName(`Stock by location ${dmy(todayLocal())}`);
      if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
      await sharePdf(bytes, fileName, { title: 'Stock by location' });
    });
    paint();
  });
}
