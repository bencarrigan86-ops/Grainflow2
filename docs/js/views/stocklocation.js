// Stock by location: the Reports window that lists every silo, bunker and off-farm site with what it holds, by commodity and grade.
// Three ways to read it: a card for each location, a card for each grade with the locations under it, and a grid (a row for each
// location, a column for each commodity and grade). Narrow it to on farm or off farm, and to the commodities ticked.

import { db } from '../storage.js?v=496';
import { num, esc, todayLocal, dmy } from '../fmt.js?v=496';
import { openSheet, toast } from '../ui.js?v=496';
import { safeFileName, sharePdf, downloadFile, canShareFiles } from '../sharefile.js?v=496';
import { viewPdf } from '../pdfview.js?v=496';
import { exportRowsAsCSV } from '../csv.js?v=496';
import { stockByLocation, stockTree, stockByGrade, stockMatrix, matrixSheet, narrowed, stockRows, STOCK_COLUMNS, stockPdf } from '../stocklocation.js?v=496';

const SCOPES = [['all', 'All'], ['farm', 'On farm'], ['off', 'Off farm']];
const SCOPE_TEXT = { all: '', farm: 'On farm', off: 'Off farm' };
const GROUPS = [['location', 'By location'], ['grade', 'By grade'], ['table', 'Grid']];
const KEY = 'grainflow.stocklocation';
const GROUP_KEY = 'grainflow.stocklocation.group';
const TOTALS_KEY = 'grainflow.stocklocation.rowtotals';
const readGroup = () => { try { const v = localStorage.getItem(GROUP_KEY); return GROUPS.some(([k]) => k === v) ? v : 'location'; } catch { return 'location'; } };
const saveGroup = (v) => { try { localStorage.setItem(GROUP_KEY, v); } catch { /* not remembered */ } };
const readScope = () => { try { const v = localStorage.getItem(KEY); return SCOPES.some(([k]) => k === v) ? v : 'all'; } catch { return 'all'; } };
const saveScope = (v) => { try { localStorage.setItem(KEY, v); } catch { /* not remembered */ } };
const readTotals = () => { try { return localStorage.getItem(TOTALS_KEY) === '1'; } catch { return false; } };
const saveTotals = (v) => { try { localStorage.setItem(TOTALS_KEY, v ? '1' : '0'); } catch { /* not remembered */ } };

const gradeRows = (c) => c.grades.map((g) => `<div class="row" style="padding:2px 0 2px 14px"><span class="label">${esc(g.grade || 'No grade')}</span><span class="value">${num(g.tons, 1)} t${g.tons < 0 ? ' (over-drawn)' : ''}</span></div>`).join('');
const commodityBlock = (c) => `<div class="row" style="margin-top:6px"><span class="label"><strong>${esc(c.name)}</strong></span><span class="value"><strong>${num(c.tons, 1)} t</strong></span></div>${gradeRows(c)}`;

/**
 * The by-location view: on farm / off farm, then property, commodity, grade, and the silos holding that grade. Each step is a line
 * indented a little further, with the tonnes on the right.
 */
const step = (indent, html, tons, style = '') => '<div class="row" style="padding:2px 0 2px ' + indent + 'px;' + style + '"><span class="label">' + html + '</span><span class="value">' + num(tons, 1) + ' t</span></div>';
const treeCard = (top) => {
  const body = top.properties.map((p) => {
    const base = p.label ? 10 : 0;
    const head = p.label ? '<div class="of-commodity" style="margin-top:12px"><span><strong>' + esc(p.label) + '</strong></span><span><strong>' + num(p.tons, 1) + ' t</strong></span></div>' : '';
    const commodities = p.commodities.map((c) => step(base, '<strong>' + esc(c.name) + '</strong>', c.tons, 'margin-top:4px')
      + c.grades.map((g) => step(base + 12, esc(g.grade || 'No grade'), g.tons)
        + g.silos.map((x) => step(base + 26, '<span class="meta">' + esc(x.name) + '</span>', x.tons, 'font-size:13px')).join('')).join('')).join('');
    return head + commodities;
  }).join('');
  return '<div class="card" style="margin-bottom:10px"><div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">' + esc(top.label) + '</h2><div class="main">' + num(top.tons, 1) + ' t</div></div>' + body + '</div>';
};

/** The by-grade view: for each commodity, each grade, and under it every location holding it with that grade's own tonnes. */
const gradeBlock = (c) => `
  <div class="card" style="margin-bottom:10px">
    <div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${esc(c.name)}</h2><div class="main">${num(c.tons, 1)} t</div></div>
    ${c.grades.map((g) => `
      <div class="of-commodity"><span><strong>${esc(g.grade || 'No grade')}</strong></span><span><strong>${num(g.tons, 1)} t</strong></span></div>
      ${g.sites.map((s) => `<div class="of-grade"><span>${esc(s.name)}${s.operator ? ` &middot; ${esc(s.operator)}` : s.kind === 'off' ? ' &middot; off farm' : ''}</span><span>${num(s.tons, 1)} t</span></div>`).join('')}`).join('')}
  </div>`;

/** A figure in the grid: whole tonnes when it is, else one decimal; nothing for an empty cell. */
const cell = (v) => (v ? num(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1) : '');

/** The grid: commodities across the top with their grades under them, a row for each location, a total row along the bottom. */
function gridHtml(m, rowTotals) {
  const span = 1 + m.columns.length + (rowTotals ? 1 : 0);
  // the first grade of each commodity gets a heavier line on its left, so the commodities read as blocks
  const first = new Set(m.columns.filter((c, i) => i === 0 || m.columns[i - 1].commodity !== c.commodity).map((c) => c.key));
  const td = (c, v) => `<td${first.has(c.key) ? ' class="sm-first"' : ''}>${cell(v)}</td>`;
  const section = (kind, label) => {
    const rows = m.rows.filter((r) => r.kind === kind);
    if (!rows.length) return '';
    return `<tr class="sm-sec"><th colspan="${span}">${label}</th></tr>${rows.map((r) => `<tr><th class="sm-loc">${esc(r.name)}${r.operator ? `<span class="sm-op"> ${esc(r.operator)}</span>` : ''}</th>${m.columns.map((c) => td(c, r.cells[c.key])).join('')}${rowTotals ? `<td class="sm-tot">${cell(r.total)}</td>` : ''}</tr>`).join('')}`;
  };
  return `<div class="table-scroll sm-scroll"><table class="sm" data-grid>
    <thead>
      <tr><th class="sm-loc" rowspan="2">Location</th>${m.groups.map((g) => `<th colspan="${g.span}" class="sm-grp">${esc(g.commodity)}</th>`).join('')}${rowTotals ? '<th rowspan="2" class="sm-tot">Total</th>' : ''}</tr>
      <tr>${m.columns.map((c) => `<th${first.has(c.key) ? ' class="sm-first"' : ''}>${esc(c.grade || 'No grade')}</th>`).join('')}</tr>
    </thead>
    <tbody>${section('farm', 'On farm')}${section('off', 'Off farm')}</tbody>
    <tfoot><tr><th class="sm-loc">Total</th>${m.columns.map((c) => td(c, m.totals[c.key])).join('')}${rowTotals ? `<td class="sm-tot">${cell(m.grand)}</td>` : ''}</tr></tfoot>
  </table></div>`;
}

export function openStockByLocationSheet() {
  openSheet('Stock by location', (root) => {
    let scope = readScope();
    let group = readGroup();
    let rowTotals = readTotals();
    const picked = new Set();   // commodities ticked; none ticked means all of them
    const data = () => db.get();
    const full = () => stockByLocation(data());
    const shown = () => narrowed(full(), scope, data(), [...picked]);

    const paint = () => {
      // the commodity chips come from what is held in the scope chosen, so a ticked one never vanishes from the row
      const offered = narrowed(full(), scope, data()).total.commodities;
      for (const id of [...picked]) if (!offered.some((c) => c.commodityId === id)) picked.delete(id);
      root.querySelector('#sl-chips').innerHTML = offered.length > 1
        ? `<div class="chips" role="group" aria-label="Commodities"><button type="button" class="chip ${picked.size ? '' : 'active'}" data-c="">All</button>${offered.map((c) => `<button type="button" class="chip ${picked.has(c.commodityId) ? 'active' : ''}" data-c="${esc(c.commodityId)}">${esc(c.name)}</button>`).join('')}</div>` : '';
      root.querySelector('#sl-totals-row').hidden = group !== 'table';
      root.querySelector('#sl-rowtotals').checked = rowTotals;

      const report = shown();
      root.querySelector('#sl-body').innerHTML = !report.locations.length
        ? `<div class="empty">${scope === 'off' ? 'Nothing is held off farm.' : scope === 'farm' ? 'Nothing is held in the silos and bunkers.' : 'Nothing is held in storage yet.'}</div>`
        : group === 'table' ? gridHtml(stockMatrix(report), rowTotals)
        : group === 'grade' ? stockByGrade(report).map(gradeBlock).join('')
        : `${stockTree(report).map(treeCard).join('')}
          ${report.locations.length > 1 ? `<div class="card" style="margin-bottom:10px">
            <div class="li-top" style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><h2 style="margin:0">${scope === 'all' ? 'All locations' : `All ${SCOPE_TEXT[scope].toLowerCase()} locations`}</h2><div class="main">${num(report.total.tons, 1)} t</div></div>
            ${report.total.commodities.map(commodityBlock).join('')}
          </div>` : ''}`;
      root.querySelectorAll('.sl-scope').forEach((b) => b.classList.toggle('active', b.dataset.scope === scope));
      root.querySelectorAll('.sl-group').forEach((b) => b.classList.toggle('active', b.dataset.group === group));
      root.querySelectorAll('#sl-chips [data-c]').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.c;
        if (!id) picked.clear();
        else if (picked.has(id)) picked.delete(id);
        else picked.add(id);
        paint();
      }));
    };

    root.innerHTML = `
      <div class="segmented" style="margin-bottom:8px">${GROUPS.map(([k, label]) => `<button type="button" class="sl-group" data-group="${k}">${label}</button>`).join('')}</div>
      <div class="segmented" style="margin-bottom:10px">${SCOPES.map(([k, label]) => `<button type="button" class="sl-scope" data-scope="${k}">${label}</button>`).join('')}</div>
      <div id="sl-chips" style="margin-bottom:10px"></div>
      <label id="sl-totals-row" class="sw-row" style="margin:0 0 10px" hidden><input type="checkbox" id="sl-rowtotals" /><span>Show a total for each location</span></label>
      <div id="sl-body"></div>
      <div class="save-bar"><button type="button" class="btn secondary" id="sl-csv" style="flex:1;padding-left:12px;padding-right:12px">Excel (CSV)</button><button type="button" class="btn secondary" id="sl-view" style="flex:1;padding-left:12px;padding-right:12px">View</button><button type="button" class="btn" id="sl-pdf" style="flex:1;padding-left:12px;padding-right:12px">PDF</button></div>`;
    root.querySelectorAll('.sl-scope').forEach((b) => b.addEventListener('click', () => { scope = b.dataset.scope; saveScope(scope); paint(); }));
    root.querySelectorAll('.sl-group').forEach((b) => b.addEventListener('click', () => { group = b.dataset.group; saveGroup(group); paint(); }));
    root.querySelector('#sl-rowtotals').addEventListener('change', (e) => { rowTotals = e.target.checked; saveTotals(rowTotals); paint(); });
    root.querySelector('#sl-csv').addEventListener('click', () => {
      const report = shown();
      if (!report.locations.length) { toast('Nothing to export yet.'); return; }
      const name = safeFileName(`grainflow-stock-by-location-${todayLocal()}`, 'csv');
      if (group === 'table') { const s = matrixSheet(stockMatrix(report), { rowTotals }); exportRowsAsCSV(name, s.rows, s.columns); } else exportRowsAsCSV(name, stockRows(report), STOCK_COLUMNS);
      toast('Downloaded. It opens in Excel.');
    });
    // the report as it is on screen, as a PDF; null when there is nothing to put in it
    const makePdf = () => {
      const report = shown();
      if (!report.locations.length) { toast('Nothing to put in the PDF yet.'); return null; }
      const bytes = stockPdf({ report, business: db.getBusinessDetails().entityName || '', today: dmy(todayLocal()), scope: SCOPE_TEXT[scope], group, rowTotals });
      return { bytes, fileName: safeFileName(`Stock by location ${dmy(todayLocal())}`) };
    };
    root.querySelector('#sl-view').addEventListener('click', () => {
      const file = makePdf();
      if (file) viewPdf(file.bytes, { title: 'Stock by location', fileName: file.fileName, share: { title: 'Stock by location' } });
    });
    root.querySelector('#sl-pdf').addEventListener('click', async () => {
      const file = makePdf();
      if (!file) return;
      if (!canShareFiles()) { downloadFile(file.bytes, file.fileName); return; }
      await sharePdf(file.bytes, file.fileName, { title: 'Stock by location' });
    });
    paint();
  });
}
