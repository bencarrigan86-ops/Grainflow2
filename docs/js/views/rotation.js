// Rotation and yield history: every paddock against every season, with the crop and its yield in each cell, and the
// farm's yield for each crop by season underneath. Built from the seasons the farm already holds; nothing is entered here.

import { db } from '../storage.js?v=297';
import { num, esc, todayLocal, dmy } from '../fmt.js?v=297';
import { openSheet, toast } from '../ui.js?v=297';
import { canSeeYield } from '../nav.js?v=297';
import { PALETTE } from '../farmmap.js?v=297';
import { rotationGrid, rotationFarms, withoutFarms } from '../fieldhistory.js?v=297';
import { rotationCsv, rotationPdf, areaSummary, ORIENTATIONS, orientationOf } from '../rotationexport.js?v=297';
import { nowTime } from '../loadreport.js?v=297';
import { downloadCSV } from '../csv.js?v=297';
import { sharePdf, safeFileName } from '../sharefile.js?v=297';

const ORIENT_KEY = 'grainflow.rotation.orientation';
const lastOrientation = () => { try { return orientationOf(localStorage.getItem(ORIENT_KEY)); } catch { return 'landscape'; } };
const rememberOrientation = (v) => { try { localStorage.setItem(ORIENT_KEY, v); } catch { /* not kept; it still works */ } };

const haText = (v) => { const r = Math.round(v * 10) / 10; return num(r, Number.isInteger(r) ? 0 : 1); };

// farms switched off on the report, remembered on this device (the same idea as the farm map's Farms list)
const HIDDEN_KEY = 'grainflow.rotation.hidden';
const readHidden = () => { try { const h = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; } };
// whether the Farms list is open, remembered on this device (open until you fold it away)
const OPEN_KEY = 'grainflow.rotation.farmsopen';
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } };
const saveOpen = (open) => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* not remembered */ } };
const saveHidden = (list) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); } catch { /* not remembered */ } };

export function openRotationSheet() {
  let orientation = lastOrientation();
  const showYield = canSeeYield(db.getRole());
  const years = Object.fromEntries(db.getYears().map((y) => [y, db.getYearData(y)]));
  const fullGrid = rotationGrid(years);
  const farms = rotationFarms(fullGrid);
  const hidden = new Set(readHidden().filter((n) => farms.some((f) => f.name === n)));
  let grid = withoutFarms(fullGrid, hidden);
  const tint = (crop) => { const i = grid.allCrops.indexOf(crop); return i < 0 ? '' : PALETTE[i % PALETTE.length]; };
  const cell = (c, repeat) => {
    if (!c) return '<td class="meta" style="text-align:center">&ndash;</td>';
    const col = tint(c.crop);
    return `<td style="${col ? `background:color-mix(in srgb, ${col} 20%, transparent);` : ''}white-space:normal;min-width:74px;padding:4px 6px;${repeat ? 'outline:2px solid var(--warn);outline-offset:-2px;' : ''}">
      <div style="font-weight:600;font-size:12px">${esc(c.crop || 'No crop')}</div>
      ${showYield && c.tons > 0 ? `<div class="meta" style="font-size:11px">${num(c.yieldTHa, 2)} t/ha${c.actual ? '' : ' est'}</div>` : ''}</td>`;
  };
  const repeatIn = (row, season) => row.repeats.some(([, b]) => b === season);

  openSheet('Rotation and yield history', (root) => {
    if (!fullGrid.rows.length) { root.innerHTML = '<div class="empty">No paddocks yet.</div>'; return; }
    const paintBody = () => {
    const yields = areaSummary(grid);
    let lastProperty = null;
    const hasFarms = grid.rows.some((x) => x.property);
    // one column per season, so the header and body rows are built here rather than written out in the template
    const seasonHeads = grid.seasons.map((s) => `<th>${esc(s)}</th>`).join('');
    const gridHead = `<tr><th style="text-align:left">Paddock</th>${seasonHeads}</tr>`;
    const gridBody = grid.rows.map((r) => {
      const head = hasFarms && r.property !== lastProperty ? `<tr><td colspan="${grid.seasons.length + 1}" class="meta" style="text-align:left;font-weight:700;padding-top:8px">${esc(r.property || 'No farm name')}</td></tr>` : '';
      lastProperty = r.property;
      return `${head}<tr><td style="text-align:left;white-space:nowrap">${esc(r.name)}</td>${grid.seasons.map((s) => cell(r.cells[s], repeatIn(r, s))).join('')}</tr>`;
    }).join('');
    const yieldHead = `<tr><th style="text-align:left">Crop</th>${seasonHeads}</tr>`;
    const yieldCell = (y, s) => {
      const b = y.bySeason[s];
      if (!b) return '<td>&ndash;</td>';
      return `<td style="${y.total ? 'font-weight:700;' : ''}">${haText(b.areaHa)} ha${showYield && b.tons > 0 ? `<div class="meta" style="font-size:11px">${num(b.yieldTHa, 2)} t/ha</div>` : ''}</td>`;
    };
    const yieldBody = yields.map((y) => `<tr><td style="text-align:left;${y.total ? 'font-weight:700;' : ''}">${esc(y.crop)}</td>${grid.seasons.map((s) => yieldCell(y, s)).join('')}</tr>`).join('');
    if (!grid.rows.length) { root.querySelector('#rot-body').innerHTML = '<div class="empty">No farms switched on. Tick a farm above.</div>'; return; }
    root.querySelector('#rot-body').innerHTML = `
      <div class="hint" style="margin-bottom:8px">Each paddock in each season, found by its name. Colours are crops. ${showYield ? 'Yield is tonnes per hectare: the actual loads once a paddock is on actual, otherwise the estimate. ' : ''}An outlined cell is the same crop as the season before.</div>
      <div class="table-scroll"><table>
        <thead>${gridHead}</thead>
        <tbody>${gridBody}</tbody>
      </table></div>
      ${grid.crops.length ? `<div class="hint" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 12px">${grid.crops.map((c) => `<span><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${tint(c)};vertical-align:-1px"></span> ${esc(c)}</span>`).join('')}</div>` : ''}
      ${yields.length ? `
      <div class="subhead" style="margin-top:14px">${showYield ? 'Area and yield by crop across the farm' : 'Area by crop across the farm'}</div>
      <div class="table-scroll"><table>
        <thead>${yieldHead}</thead>
        <tbody>${yieldBody}</tbody>
      </table></div>` : ''}`;
    };
    const farmRow = (f) => `<label class="row" style="cursor:pointer"><span class="label"><input type="checkbox" class="rot-farm" data-farm="${esc(f.name)}" ${hidden.has(f.name) ? '' : 'checked'} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />${esc(f.name || 'No farm name')}</span><span class="value">${f.paddocks} paddock${f.paddocks === 1 ? '' : 's'}</span></label>`;
    const farmsSub = () => `${farms.length} farms, ${hidden.size ? `${farms.length - hidden.size} showing` : 'all showing'}`;
    root.innerHTML = `
      ${farms.length > 1 ? `<div class="card" style="margin-bottom:10px"><details class="fold" id="rot-farms" style="margin-top:0;border-top:none" ${readOpen() ? 'open' : ''}><summary><div><h2>Farms</h2><div class="sub" id="rot-farmsub">${farmsSub()}</div></div></summary>
        <div style="display:flex;gap:8px;margin:8px 0"><button type="button" class="btn secondary" id="rot-all">Select all</button><button type="button" class="btn secondary" id="rot-none">Clear all</button></div>
        ${farms.map(farmRow).join('')}</details></div>` : ''}
      <div id="rot-body"></div>
      <div class="subhead" style="margin-top:14px">Save or send</div>
      <div class="segmented" id="rot-orient" style="margin-bottom:8px">
        ${ORIENTATIONS.map((x) => `<button data-orient="${x.value}" class="${x.value === orientation ? 'active' : ''}">${x.label}</button>`).join('')}
      </div>
      <div class="grid-2">
        <button type="button" class="btn secondary" id="rot-pdf">PDF to print or send</button>
        <button type="button" class="btn secondary" id="rot-csv">Excel (CSV)</button>
      </div>`;
    paintBody();
    root.querySelector('#rot-farms')?.addEventListener('toggle', (e) => saveOpen(e.currentTarget.open));
    const setHidden = () => {
      saveHidden([...hidden]);
      grid = withoutFarms(fullGrid, hidden);
      root.querySelectorAll('.rot-farm').forEach((b) => { b.checked = !hidden.has(b.dataset.farm); });
      const sub = root.querySelector('#rot-farmsub'); if (sub) sub.textContent = farmsSub();
      paintBody();
    };
    root.querySelectorAll('.rot-farm').forEach((b) => b.addEventListener('change', () => { if (b.checked) hidden.delete(b.dataset.farm); else hidden.add(b.dataset.farm); setHidden(); }));
    root.querySelector('#rot-all')?.addEventListener('click', () => { hidden.clear(); setHidden(); });
    root.querySelector('#rot-none')?.addEventListener('click', () => { farms.forEach((f) => hidden.add(f.name)); setHidden(); });
    const stamp = todayLocal();
    const business = db.getBusinessDetails();
    root.querySelector('#rot-orient').addEventListener('click', (e) => {
      const b = e.target.closest('[data-orient]');
      if (!b) return;
      orientation = orientationOf(b.dataset.orient);
      rememberOrientation(orientation);
      root.querySelectorAll('#rot-orient button').forEach((x) => x.classList.toggle('active', x === b));
    });
    root.querySelector('#rot-csv').addEventListener('click', () => {
      downloadCSV(safeFileName(`grainflow-rotation-${stamp}`, 'csv'), rotationCsv(grid, { showYield }));
      toast('Downloaded. It opens in Excel.');
    });
    root.querySelector('#rot-pdf').addEventListener('click', async () => {
      const bytes = rotationPdf(grid, {
        orientation, showYield, business: business.entityName || business.farmName || '', ngr: business.ngr || '',
        today: dmy(stamp), madeAt: `${dmy(stamp)} ${nowTime()}`,
      });
      await sharePdf(bytes, `Rotation and yield history ${stamp}`, { title: 'Rotation and yield history', text: `Rotation and yield history, ${business.farmName || business.entityName || ''}`.trim() });
    });
  });
}
