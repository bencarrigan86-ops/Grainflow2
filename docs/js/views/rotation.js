// Rotation and yield history: every paddock against every season, with the crop and its yield in each cell, and the
// farm's yield for each crop by season underneath. Built from the seasons the farm already holds; nothing is entered here.

import { db } from '../storage.js?v=273';
import { num, esc } from '../fmt.js?v=273';
import { openSheet } from '../ui.js?v=273';
import { canSeeYield } from '../nav.js?v=273';
import { PALETTE } from '../farmmap.js?v=273';
import { rotationGrid, cropYields } from '../fieldhistory.js?v=273';

export function openRotationSheet() {
  const showYield = canSeeYield(db.getRole());
  const years = Object.fromEntries(db.getYears().map((y) => [y, db.getYearData(y)]));
  const grid = rotationGrid(years);
  const tint = (crop) => { const i = grid.crops.indexOf(crop); return i < 0 ? '' : PALETTE[i % PALETTE.length]; };
  const cell = (c, repeat) => {
    if (!c) return '<td class="meta" style="text-align:center">&ndash;</td>';
    const col = tint(c.crop);
    return `<td style="${col ? `background:color-mix(in srgb, ${col} 20%, transparent);` : ''}white-space:normal;min-width:74px;padding:4px 6px;${repeat ? 'outline:2px solid var(--warn);outline-offset:-2px;' : ''}">
      <div style="font-weight:600;font-size:12px">${esc(c.crop || 'No crop')}</div>
      ${showYield && c.tons > 0 ? `<div class="meta" style="font-size:11px">${num(c.yieldTHa, 2)} t/ha${c.actual ? '' : ' est'}</div>` : ''}</td>`;
  };
  const repeatIn = (row, season) => row.repeats.some(([, b]) => b === season);

  openSheet('Rotation and yield history', (root) => {
    if (!grid.rows.length) { root.innerHTML = '<div class="empty">No paddocks yet.</div>'; return; }
    const yields = showYield ? cropYields(grid) : [];
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
    const yieldBody = yields.map((y) => `<tr><td style="text-align:left">${esc(y.crop)}</td>${grid.seasons.map((s) => `<td>${y.bySeason[s] && y.bySeason[s].tons > 0 ? num(y.bySeason[s].yieldTHa, 2) : '&ndash;'}</td>`).join('')}</tr>`).join('');
    root.innerHTML = `
      <div class="hint" style="margin-bottom:8px">Each paddock in each season, found by its name. Colours are crops. ${showYield ? 'Yield is tonnes per hectare: the actual loads once a paddock is on actual, otherwise the estimate. ' : ''}An outlined cell is the same crop as the season before.</div>
      <div class="table-scroll"><table>
        <thead>${gridHead}</thead>
        <tbody>${gridBody}</tbody>
      </table></div>
      ${grid.crops.length ? `<div class="hint" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 12px">${grid.crops.map((c) => `<span><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${tint(c)};vertical-align:-1px"></span> ${esc(c)}</span>`).join('')}</div>` : ''}
      ${showYield && yields.length ? `
      <div class="subhead" style="margin-top:14px">Yield by crop across the farm (t/ha)</div>
      <div class="table-scroll"><table>
        <thead>${yieldHead}</thead>
        <tbody>${yieldBody}</tbody>
      </table></div>` : ''}`;
  });
}
