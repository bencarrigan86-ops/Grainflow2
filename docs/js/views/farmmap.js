// The farm map: every paddock's outline on one map, coloured by what is growing in it. Tap a paddock to open it.
//
// The outlines come from a shapefile (any mapping or farm software can export one). Choose the
// .shp and .dbf together, or the zip they came in. Paddocks are matched to yours by name, and the area worked out from
// the outline replaces the area typed in, as it is the more accurate. The reading and drawing are in farmmap.js.

import { db } from '../storage.js?v=422';
import { openSheet, closeSheet, toast, notify, askConfirm } from '../ui.js?v=422';
import { esc, num, todayLocal, dmy } from '../fmt.js?v=422';
import { sharePdf, safeFileName } from '../sharefile.js?v=422';
import { APP_VERSION } from '../version.js?v=422';
import { buildFarmMapPdf } from '../spraypdf.js?v=422';
import {
  readBoundaries, unzipFiles, simplifyRings, ringsAreaHa, matchBoundaries, mapLayout, PALETTE, NO_CROP, NO_FARM, farmGroups, visibleBox, labelFontPx, farmLabelPx, commonLabelPx,
} from '../farmmap.js?v=422';

const MAX_ZOOM = 40;
const MIN_LABEL_PX = 6.5;    // the smallest writing a paddock's name is shown in, on screen
const MAX_LABEL_PX = 16;     // the largest

// what is written on the paddocks, remembered on this device
const SHOW_KEY = 'grainflow.farmmap.show';
const readShow = () => {
  try { return { names: true, areas: false, ...JSON.parse(localStorage.getItem(SHOW_KEY) || '{}') }; } catch { return { names: true, areas: false }; }
};
// which farms are switched off, remembered on this device
const HIDDEN_KEY = 'grainflow.farmmap.hidden';
const readHidden = () => { try { const h = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; } };
// whether the Farms list is open, remembered on this device (open until you fold it away)
const FARMS_OPEN_KEY = 'grainflow.farmmap.farmsopen';
const readFarmsOpen = () => { try { return localStorage.getItem(FARMS_OPEN_KEY) !== '0'; } catch { return true; } };
const saveFarmsOpen = (open) => { try { localStorage.setItem(FARMS_OPEN_KEY, open ? '1' : '0'); } catch { /* not remembered */ } };
const saveHidden = (list) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(list)); } catch { /* not remembered */ } };
const saveShow = (show) => { try { localStorage.setItem(SHOW_KEY, JSON.stringify(show)); } catch { /* private mode: it just is not remembered */ } };

/**
 * @param {{
 *   onOpenField?: (field: object) => void,
 *   onSpray?: (ids: string[]) => void,                       // shows "Spray request": the paddocks are picked here first
 *   pick?: { ids: string[], onDone: (ids: string[]) => void, onCancel?: () => void },   // tapping a paddock ticks it
 * }} [opts]
 */
export function openMapSheet({ onOpenField, onSpray, pick } = {}) {
  const chosen = new Set(pick?.ids || []);
  const RED = '#d8362b';
  openSheet(pick ? 'Pick paddocks' : 'Farm map', (root) => {
    const draw = () => {
      const { fields, commodities } = db.get();
      const mapped = fields.filter((f) => f.boundary?.length);
      if (!mapped.length) { importView(root, draw); return; }

      // a colour for each commodity that has a mapped paddock
      const inUse = commodities.filter((c) => mapped.some((f) => f.commodityId === c.id));
      const colourOf = (f) => { const i = inUse.findIndex((c) => c.id === f.commodityId); return i < 0 ? NO_CROP : PALETTE[i % PALETTE.length]; };
      const layout = mapLayout(mapped.map((f) => ({ id: f.id, name: f.name, farm: f.property, color: colourOf(f), rings: f.boundary })));
      const groups = farmGroups(layout.items, readHidden());
      const hasFarms = groups.some((g) => g.name !== NO_FARM);
      const farmSummary = (showing = groups.filter((g) => !g.hidden).length) => `${groups.length} farm${groups.length === 1 ? '' : 's'}, ${showing === groups.length ? 'all showing' : `${showing} showing`}`;
      const vb = layout.viewBox;
      const unmapped = fields.filter((f) => !f.boundary?.length);
      const mappedHa = mapped.reduce((s, f) => s + (Number(f.areaHa) || 0), 0);

      const haOf = (id) => Number(mapped.find((f) => f.id === id)?.areaHa) || 0;
      const pickedText = () => {
        const ids = [...chosen].filter((id) => mapped.some((f) => f.id === id));
        return ids.length ? `${ids.length} paddock${ids.length === 1 ? '' : 's'} picked, ${num(ids.reduce((s, id) => s + haOf(id), 0), 1)} ha` : 'Tap the paddocks to spray';
      };
      root.innerHTML = `
        ${pick ? `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><strong id="fm-picked">${pickedText()}</strong><button type="button" class="btn small" id="fm-pickdone" style="width:auto">Done</button></div>` : ''}
        <div class="hint" style="margin-bottom:8px">${mapped.length} paddock${mapped.length === 1 ? '' : 's'} mapped${hasFarms ? ` on ${groups.filter((g) => g.name !== NO_FARM).length} farm${groups.filter((g) => g.name !== NO_FARM).length === 1 ? '' : 's'}` : ''}, ${num(mappedHa, 0)} ha. ${pick ? 'Tap a paddock to pick it, and again to take it off.' : 'Tap one to open it.'} Pinch or use the buttons to zoom.</div>
        <div id="fm-wrap" style="position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg);touch-action:none">
          <svg id="fm-svg" viewBox="0 0 ${vb.w} ${vb.h}" style="display:block;width:100%;height:auto;max-height:68vh" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of the paddocks">
            ${layout.items.map((i) => `<path data-id="${esc(i.id)}" data-farm="${esc(i.farm || NO_FARM)}" d="${i.d}" fill="${chosen.has(i.id) ? RED : i.color}" fill-opacity="${chosen.has(i.id) ? 0.85 : pick ? 0.3 : 0.55}" fill-rule="evenodd" stroke="var(--text)" stroke-opacity="0.55" stroke-width="1" vector-effect="non-scaling-stroke" style="cursor:pointer"><title>${esc(i.name)}</title></path>`).join('')}
            ${layout.items.map((i) => `<text data-label="${esc(i.id)}" data-farm="${esc(i.farm || NO_FARM)}" data-area="${Math.round(i.areaHa * 10000)}" data-w="${Math.round(i.bbox[2] - i.bbox[0])}" data-h="${Math.round(i.bbox[3] - i.bbox[1])}" x="${Math.round(i.cx)}" y="${Math.round(i.cy)}" text-anchor="middle" dominant-baseline="central" fill="var(--text)" stroke="var(--bg)" stroke-width="3" paint-order="stroke" pointer-events="none" style="font-weight:600"><tspan class="fm-n" x="${Math.round(i.cx)}">${esc(i.name)}</tspan><tspan class="fm-a" x="${Math.round(i.cx)}" dy="1.15em" style="font-weight:500">${num(Number(mapped.find((f) => f.id === i.id)?.areaHa) || i.areaHa, 1)} ha</tspan></text>`).join('')}
            ${hasFarms ? groups.filter((g) => g.name !== NO_FARM).map((g) => `<text data-farm-label="${esc(g.name)}" data-w="${Math.round(g.bbox[2] - g.bbox[0])}" x="${Math.round(g.cx)}" y="${Math.round(g.cy)}" text-anchor="middle" dominant-baseline="central" fill="var(--text)" stroke="var(--bg)" stroke-width="4" paint-order="stroke" pointer-events="none" style="font-weight:800;letter-spacing:.05em;text-transform:uppercase">${esc(g.name)}</text>`).join('') : ''}
          </svg>
          <div style="position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px">
            <button type="button" class="btn secondary small" id="fm-in" aria-label="Zoom in" style="width:40px;padding:6px 0">+</button>
            <button type="button" class="btn secondary small" id="fm-out" aria-label="Zoom out" style="width:40px;padding:6px 0">&minus;</button>
            <button type="button" class="btn secondary small" id="fm-reset" aria-label="Show everything" style="width:40px;padding:6px 0">&#8962;</button>
          </div>
        </div>
        <div style="display:flex;gap:18px;margin:10px 0 0">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fm-names" style="width:18px;height:18px" /> Names</label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fm-areas" style="width:18px;height:18px" /> Areas (ha)</label>
        </div>
        ${hasFarms ? `<div class="card" style="margin-top:12px">
          <details class="fold" id="fm-farms" style="margin-top:0;border-top:none" ${readFarmsOpen() ? 'open' : ''}><summary><div><h2>Farms</h2><div class="sub" id="fm-farmsub">${farmSummary()}</div></div></summary>
          <div style="display:flex;gap:8px;margin:8px 0"><button type="button" class="btn secondary" id="fm-all">Select all</button><button type="button" class="btn secondary" id="fm-none">Clear all</button></div>
          ${groups.map((g) => `<label class="row" style="cursor:pointer"><span class="label"><input type="checkbox" class="fm-farm" data-farm="${esc(g.name)}" ${g.hidden ? '' : 'checked'} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />${esc(g.name)}</span><span class="value">${g.paddocks} &middot; ${num(g.ha, 0)} ha</span></label>`).join('')}
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px"><input type="checkbox" id="fm-farmnames" style="width:18px;height:18px" /> Farm names on the map</label>
          </details>
        </div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0">
          ${inUse.map((c, i) => `<span class="meta"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};vertical-align:-1px"></span> ${esc(c.name)}</span>`).join('')}
          ${mapped.some((f) => colourOf(f) === NO_CROP) ? `<span class="meta"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${NO_CROP};vertical-align:-1px"></span> No crop set</span>` : ''}
        </div>
        ${unmapped.length ? `<div class="hint" style="margin-bottom:8px">Not on the map: ${unmapped.map((f) => esc(f.name)).join(', ')}.</div>` : ''}
        ${pick ? '<button type="button" class="btn secondary" id="fm-pickcancel" style="margin-top:6px">Cancel</button>' : `
        ${onSpray ? '<button type="button" class="btn" id="fm-spray" style="margin-top:6px">Spray request from this map</button>' : ''}
        <button type="button" class="btn secondary" id="fm-pdf" style="margin-top:8px">Send this view as a PDF</button>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px"><input type="checkbox" id="fm-pdftotals" style="width:18px;height:18px" /> Paddock and hectare totals on the PDF</label>
        <div class="hint" style="margin-top:4px">The PDF shows what is on the map now: zoom to the area you want, switch off the farms you do not, and the Names, Areas and Farm names ticks above decide what is written on it.</div>
        <button type="button" class="btn secondary" id="fm-update" style="margin-top:8px">Update from a file</button>
        <button type="button" class="btn ghost-danger" id="fm-clear" style="margin-top:8px">Remove the map</button>`}`;

      const toggle = (id) => {
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
        const el = root.querySelector(`path[data-id="${CSS.escape(id)}"]`);
        const item = layout.items.find((i) => i.id === id);
        if (el && item) { el.setAttribute('fill', chosen.has(id) ? RED : item.color); el.setAttribute('fill-opacity', chosen.has(id) ? 0.85 : 0.3); }
        root.querySelector('#fm-picked').textContent = pickedText();
      };
      const mapApi = wireMap(root, vb, layout, (id) => {
        if (pick) { toggle(id); return; }
        const f = fields.find((x) => x.id === id); if (f && onOpenField) onOpenField(f);
      }, { groups });
      root.querySelector('#fm-pickdone')?.addEventListener('click', () => pick.onDone([...chosen].filter((id) => mapped.some((f) => f.id === id))));
      root.querySelector('#fm-pickcancel')?.addEventListener('click', () => (pick.onCancel ? pick.onCancel() : closeSheet()));
      root.querySelector('#fm-spray')?.addEventListener('click', () => openMapSheet({
        onOpenField, onSpray,
        pick: { ids: [], onDone: (ids) => onSpray(ids), onCancel: () => openMapSheet({ onOpenField, onSpray }) },
      }));
      const totalsBox = root.querySelector('#fm-pdftotals');
      if (totalsBox) { totalsBox.checked = readShow().totals !== false; totalsBox.addEventListener('change', () => saveShow({ ...readShow(), totals: totalsBox.checked })); }
      root.querySelector('#fm-pdf')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const business = db.getBusinessDetails();
          const legend = [...inUse.map((c, i) => ({ name: c.name, color: PALETTE[i % PALETTE.length] })), ...(mapped.some((f) => colourOf(f) === NO_CROP) ? [{ name: 'No crop set', color: NO_CROP }] : [])];
          const shown = readShow();
          const bytes = await buildFarmMapPdf(layout, {
            showNames: shown.names, showAreas: shown.areas, showFarmNames: shown.farmNames !== false, showTotals: shown.totals !== false,
            title: 'Farm map', date: todayLocal(), legend, hiddenFarms: readHidden(), view: mapApi.getView(),
            subtitle: [business.entityName || business.farmName, db.getCurrentYear()].filter(Boolean).join('  ·  '),
          });
          const fileName = safeFileName(`Farm map ${dmy(todayLocal())}`);
          const result = await sharePdf(bytes, fileName, { title: 'Farm map', text: `Farm map: ${mapped.length} paddocks, ${num(mappedHa, 0)} ha.` });
          if (result !== 'cancelled') toast(result === 'shared' ? 'Sent' : 'Saved to this device');
        } catch (err) {
          notify(`The map could not be made into a PDF: ${err.message}`);
        } finally { btn.disabled = false; }
      });
      root.querySelector('#fm-update')?.addEventListener('click', () => importView(root, draw, true));
      root.querySelector('#fm-clear')?.addEventListener('click', async () => {
        if (!(await askConfirm('Remove the outlines from every paddock? The paddocks and their areas stay. You can import the file again.', { confirmLabel: 'Remove', danger: true }))) return;
        db.clearFieldBoundaries();
        toast('Map removed');
        draw();
      });
    };
    draw();
  }, { askBeforeClose: false });   // the ticks on the import screen are not typing to lose: once saved, Close just closes
}

/** Pan, pinch and button zoom on the map, by moving the viewBox. A tap on a paddock opens it. */
function wireMap(root, full, layout, open, { groups = [] } = {}) {
  const svg = root.querySelector('#fm-svg');
  let v = { ...full };
  const fit = () => { svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); labels(); };
  const clamp = () => {
    v.w = Math.min(full.w * 1.2, Math.max(full.w / MAX_ZOOM, v.w));
    v.h = v.w * (full.h / full.w);
    v.x = Math.min(full.w - v.w * 0.1, Math.max(-v.w * 0.9, v.x));
    v.y = Math.min(full.h - v.h * 0.1, Math.max(-v.h * 0.9, v.y));
  };
  // names are drawn at one size on screen, and left out of paddocks too small to hold them
  const show = readShow();
  const hidden = new Set(groups.filter((g) => g.hidden).map((g) => g.name));
  const applyFarms = () => { svg.querySelectorAll('path[data-farm]').forEach((el) => { el.style.display = hidden.has(el.dataset.farm) ? 'none' : ''; }); };
  // fit the picture to the farms that are switched on (everything when none are switched off)
  const fitToVisible = () => {
    if (!hidden.size) { v = { ...full }; return; }
    const [x0, y0, x1, y1] = visibleBox(layout.items, [...hidden]);
    const aspect = full.h / full.w;
    const w = Math.max((x1 - x0) * 1.12, ((y1 - y0) * 1.12) / aspect, full.w / MAX_ZOOM);
    v = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * aspect) / 2, w, h: w * aspect };
    clamp();
  };
  const labels = () => {
    const r = svg.getBoundingClientRect();
    // a pixel in metres: the picture is fitted to its box, so it is the larger of the two scales
    const unit = Math.max(v.w / (r.width || 360), v.h / (r.height || 300));
    // Names are all written in one size that follows the zoom (bigger paddocks on screen, bigger writing), and a name
    // only goes smaller than that where its own paddock cannot hold it, and is left out when even the smallest would not fit.
    const texts = [...svg.querySelectorAll('text[data-label]')];
    // one lettering size for the whole view, set by the paddocks that are in it
    const inView = texts.filter((t) => !hidden.has(t.dataset.farm) && Number(t.getAttribute('x')) >= v.x && Number(t.getAttribute('x')) <= v.x + v.w && Number(t.getAttribute('y')) >= v.y && Number(t.getAttribute('y')) <= v.y + v.h);
    const common = commonLabelPx(inView.map((t) => Math.min(Number(t.dataset.w), Number(t.dataset.h)) / unit), { max: MAX_LABEL_PX });
    texts.forEach((t) => {
      const n = t.querySelector('.fm-n'); const a = t.querySelector('.fm-a');
      n.style.display = show.names ? '' : 'none';
      a.style.display = show.areas ? '' : 'none';
      a.setAttribute('dy', show.names ? '1.15em' : '0');
      const lines = (show.names ? 1 : 0) + (show.areas ? 1 : 0);
      if (!lines || hidden.has(t.dataset.farm)) { t.style.display = 'none'; return; }
      const wPx = Number(t.dataset.w) / unit; const hPx = Number(t.dataset.h) / unit;
      const chars = Math.max(show.names ? n.textContent.length : 0, show.areas ? a.textContent.length : 0);
      const px = labelFontPx(wPx, hPx, chars, lines, { min: MIN_LABEL_PX, max: common });
      if (!px) { t.style.display = 'none'; return; }
      t.style.display = '';
      t.setAttribute('font-size', px * unit);
      t.setAttribute('stroke-width', Math.max(1.5, px * 0.28) * unit);
    });
    svg.querySelectorAll('text[data-farm-label]').forEach((t) => {
      // a farm's name grows and shrinks with the farm, and goes when the farm is too small on screen to carry it
      // a farm's name is the larger lettering, but only a step above the paddock names: never smaller than them, and
      // never so much larger that it swamps them when zoomed out
      const fit = farmLabelPx(Number(t.dataset.w) / unit, t.textContent.length);
      const px = fit ? Math.min(Math.max(fit, common * 1.15), common * 1.5, 22) : 0;
      t.style.display = show.farmNames !== false && !hidden.has(t.dataset.farmLabel) && px ? '' : 'none';
      t.setAttribute('font-size', px * unit);
      t.setAttribute('stroke-width', Math.max(2, px * 0.25) * unit);
    });
  };
  const nameBox = root.querySelector('#fm-names'); const areaBox = root.querySelector('#fm-areas');
  nameBox.checked = show.names; areaBox.checked = show.areas;
  const ticked = () => { show.names = nameBox.checked; show.areas = areaBox.checked; saveShow({ ...readShow(), names: show.names, areas: show.areas }); labels(); };
  nameBox.addEventListener('change', ticked); areaBox.addEventListener('change', ticked);
  const farmNamesBox = root.querySelector('#fm-farmnames');
  if (farmNamesBox) { farmNamesBox.checked = show.farmNames !== false; farmNamesBox.addEventListener('change', () => { show.farmNames = farmNamesBox.checked; saveShow({ ...readShow(), farmNames: show.farmNames }); labels(); }); }
  root.querySelector('#fm-farms')?.addEventListener('toggle', (e) => saveFarmsOpen(e.currentTarget.open));
  const farmsChanged = () => {
    saveHidden([...hidden]);
    root.querySelectorAll('.fm-farm').forEach((b) => { b.checked = !hidden.has(b.dataset.farm); });
    const sub = root.querySelector('#fm-farmsub'); if (sub) sub.textContent = `${groups.length} farm${groups.length === 1 ? '' : 's'}, ${groups.length - hidden.size === groups.length ? 'all showing' : `${groups.length - hidden.size} showing`}`;
    applyFarms(); fitToVisible(); fit();
  };
  root.querySelectorAll('.fm-farm').forEach((box) => box.addEventListener('change', () => {
    if (box.checked) hidden.delete(box.dataset.farm); else hidden.add(box.dataset.farm);
    farmsChanged();
  }));
  root.querySelector('#fm-all')?.addEventListener('click', () => { hidden.clear(); farmsChanged(); });
  root.querySelector('#fm-none')?.addEventListener('click', () => { groups.forEach((g) => hidden.add(g.name)); farmsChanged(); });
  const zoomAt = (factor, cx = 0.5, cy = 0.5) => {         // cx, cy: where on the map to hold still, as a fraction of it
    const nx = v.x + v.w * cx; const ny = v.y + v.h * cy;
    v.w /= factor; v.h = v.w * (full.h / full.w);
    v.x = nx - v.w * cx; v.y = ny - v.h * cy;
    clamp(); fit();
  };
  root.querySelector('#fm-in').addEventListener('click', () => zoomAt(1.6));
  root.querySelector('#fm-out').addEventListener('click', () => zoomAt(1 / 1.6));
  root.querySelector('#fm-reset').addEventListener('click', () => { fitToVisible(); fit(); });

  const frac = (clientX, clientY) => { const r = svg.getBoundingClientRect(); return [(clientX - r.left) / r.width, (clientY - r.top) / r.height]; };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const [cx, cy] = frac(e.clientX, e.clientY); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, cx, cy); }, { passive: false });

  const pointers = new Map();
  let moved = 0; let pinch = 0; let downTarget = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    try { svg.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone: nothing to hold */ }
    if (pointers.size === 1) { moved = 0; downTarget = e.target.closest?.('path[data-id]') || null; }
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const r = svg.getBoundingClientRect();
    if (pointers.size === 1) {
      const dx = e.clientX - prev[0]; const dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      // the picture is fitted to the box, so a pixel is the larger of the two scales
      const k = Math.max(v.w / r.width, v.h / r.height);
      v.x -= dx * k; v.y -= dy * k; clamp(); fit();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) { const [cx, cy] = frac((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); zoomAt(d / pinch, cx, cy); }
      pinch = d; moved = 99;
    }
  });
  const up = (e) => {
    const wasOne = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (wasOne && moved < 6 && downTarget && e.type === 'pointerup') open(downTarget.dataset.id);
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  applyFarms(); fitToVisible(); fit();
  window.addEventListener('resize', labels, { once: true });
  return { getView: () => ({ ...v }) };   // the area on the screen now, in metres
}

/** Choosing the files, matching them to the paddocks, and saving. */
function importView(root, done, haveMap = false) {
  const { fields } = db.get();
  root.innerHTML = `
    ${!haveMap && /^sample/i.test(db.getCurrentYear() || '') ? `<div class="card input" style="margin-bottom:12px"><h2><span class="dot input"></span>This is the sample farm</h2>
      <div class="hint">It was set up before the sample had a map. Add the sample map to its paddocks: nothing else changes.</div>
      <button type="button" class="btn" id="fm-sample">Add the sample map</button></div>` : ''}
    <div class="hint" style="margin-bottom:10px">${haveMap ? 'Choose the file again to update the outlines.' : 'Draw your paddocks on a map.'}
      Export your boundaries as a shapefile from any mapping software, then choose the <strong>.shp</strong> and <strong>.dbf</strong> files together
      (select both at once), or the <strong>.zip</strong> they came in. Paddocks are matched to yours by name.</div>
    <label class="btn" style="display:block;text-align:center;cursor:pointer">Choose the files&hellip;
      <input type="file" id="fm-files" multiple style="display:none" />
    </label>
    <div class="meta" style="margin-top:6px">Every kind of file is offered, so the picker lists all your locations, OneDrive included. If your OneDrive is not in the list, open the Files app or the OneDrive app, make the files available on this device (or zip them), and choose them again.</div>
    <div id="fm-problem" class="hint" style="color:var(--danger);margin:8px 0"></div>
    <div id="fm-preview"></div>
    ${haveMap ? '<button type="button" class="btn secondary" id="fm-back" style="margin-top:8px">Back to the map</button>' : ''}`;
  root.querySelector('#fm-back')?.addEventListener('click', done);
  // a sample farm made before the sample had a map: its paddocks take the sample outlines, matched by name
  root.querySelector('#fm-sample')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const res = await fetch(`./demo/seed.json?v=${APP_VERSION}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`The sample map could not be fetched (${res.status}).`);
      const seed = await res.json();
      const sample = seed.years?.[seed.currentYear]?.fields || [];
      const features = sample.filter((f) => f.boundary?.length).map((f) => ({ name: f.name, farm: f.property || '', rings: f.boundary }));
      const { matched } = matchBoundaries(features, db.get().fields);
      if (!matched.length) { notify('None of these paddocks has a name from the sample farm, so there is no sample map to put on them.'); btn.disabled = false; return; }
      db.applyFieldBoundaries({ matched: matched.map((m) => ({ id: m.field.id, boundary: m.feature.rings, property: m.feature.farm, areaHa: 0 })) });
      toast(`Sample map added: ${matched.length} paddock${matched.length === 1 ? '' : 's'}`);
      done();
    } catch (err) { notify(err.message || 'The sample map could not be added.'); btn.disabled = false; }
  });
  const problem = (t) => { root.querySelector('#fm-problem').textContent = t; };

  root.querySelector('#fm-files').addEventListener('change', async (e) => {
    problem('');
    const picked = [...e.target.files];
    if (!picked.length) return;
    try {
      let shp = null; let dbf = null;
      for (const f of picked) {
        const name = f.name.toLowerCase();
        if (name.endsWith('.zip')) {
          const inside = await unzipFiles(await f.arrayBuffer());
          for (const [n, data] of Object.entries(inside)) {
            if (n.toLowerCase().endsWith('.shp') && !shp) shp = data;
            if (n.toLowerCase().endsWith('.dbf') && !dbf) dbf = data;
          }
        } else if (name.endsWith('.shp')) shp = new Uint8Array(await f.arrayBuffer());
        else if (name.endsWith('.dbf')) dbf = new Uint8Array(await f.arrayBuffer());
      }
      if (!shp) throw new Error('Choose the .shp file as well (or the zip).');
      if (!dbf) throw new Error('Choose the .dbf file as well: it holds the paddock names.');
      const { features } = readBoundaries(shp, dbf);
      if (!features.length) throw new Error('That file has no paddock outlines in it.');
      preview(features, fields);
    } catch (err) {
      problem(err.message || 'That file could not be read.');
    }
  });

  const preview = (features, fieldsNow) => {
    const { matched, unmatched } = matchBoundaries(features, fieldsNow);
    // the area comes from the full outline, before it is thinned
    const items = matched.map((m) => ({ id: m.field.id, name: m.field.name, was: Number(m.field.areaHa) || 0, areaHa: Math.round(ringsAreaHa(m.feature.rings) * 100) / 100, boundary: simplifyRings(m.feature.rings), property: String(m.feature.farm || '').trim() }));
    const extra = unmatched.map((f) => ({ name: f.name, farm: f.farm, property: String(f.farm || '').trim(), areaHa: Math.round(ringsAreaHa(f.rings) * 100) / 100, boundary: simplifyRings(f.rings) }));
    const farmNames = [...new Set(features.map((f) => String(f.farm || '').trim()).filter(Boolean))];
    const was = items.reduce((s, i) => s + i.was, 0);
    const now = items.reduce((s, i) => s + i.areaHa, 0);
    const box = root.querySelector('#fm-preview');
    box.innerHTML = `
      <div class="card" style="margin-top:10px">
        <h2>${features.length} outlines found</h2>
        ${farmNames.length ? `<div class="row"><span class="label">Farms in the file</span><span class="value">${farmNames.length}</span></div><div class="hint" style="margin:0 0 8px">${farmNames.map(esc).join(', ')}. Each paddock keeps its farm name, so the map can label the farms and show or hide them.</div>` : ''}
        <div class="row"><span class="label">Matched to your paddocks</span><span class="value">${items.length}</span></div>
        <div class="row"><span class="label">Their area now</span><span class="value">${num(was, 1)} ha</span></div>
        <div class="row"><span class="label">Their area after saving</span><span class="value" id="fm-after"><strong>${num(now, 1)} ha</strong></span></div>
        ${items.length ? `<details class="fold" style="margin-top:6px"><summary><div><h2>Each paddock</h2><div class="sub">Tick to take the area from the map, untick to keep the one you typed</div></div></summary>
          <label class="row" style="cursor:pointer"><span class="label"><input type="checkbox" id="fm-all" checked style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />All paddocks</span><span class="value"></span></label>
          ${items.map((i, n) => `<label class="row" style="cursor:pointer"><span class="label"><input type="checkbox" class="fm-use" data-n="${n}" checked style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />${esc(i.name)}</span><span class="value">${num(i.was, 1)} &rarr; ${num(i.areaHa, 1)} ha</span></label>`).join('')}</details>` : ''}
        ${extra.length ? `
        <div class="row" style="margin-top:8px"><span class="label">On the map, no paddock of that name</span><span class="value">${extra.length}</span></div>
        <div class="hint" style="margin:4px 0 8px">${extra.map((f) => esc(f.name)).join(', ')}</div>
        <label class="list-item" style="cursor:pointer"><div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="fm-add" ${items.length ? '' : 'checked'} style="width:18px;height:18px" />
          <div><div class="main">Add these as new paddocks</div><div class="meta">With the area from the map. Set their crop afterwards.</div></div></div></label>` : ''}
        <div class="hint" style="margin-top:8px">Ticked paddocks take the area measured from the outline; unticked ones keep the area you typed.</div>
        <button type="button" class="btn" id="fm-save" style="margin-top:8px" ${items.length || extra.length ? '' : 'disabled'}>Save the map</button>
      </div>`;
    const useBoxes = [...box.querySelectorAll('.fm-use')];
    const syncTotals = () => {
      const on = items.filter((_, n) => useBoxes[n]?.checked);
      const after = items.reduce((s, i, n) => s + (useBoxes[n]?.checked ? i.areaHa : i.was), 0);
      const el = box.querySelector('#fm-after');
      if (el) el.innerHTML = `<strong>${num(after, 1)} ha</strong>`;
      const all = box.querySelector('#fm-all');
      if (all) { all.checked = on.length === items.length; all.indeterminate = on.length > 0 && on.length < items.length; }
    };
    box.querySelector('#fm-all')?.addEventListener('change', (e) => { useBoxes.forEach((b) => { b.checked = e.target.checked; }); syncTotals(); });
    useBoxes.forEach((b) => b.addEventListener('change', syncTotals));
    box.querySelector('#fm-save').addEventListener('click', () => {
      const add = !!box.querySelector('#fm-add')?.checked;
      if (!items.length && !(add && extra.length)) { notify('Nothing matched your paddocks. Tick Add these as new paddocks, or check the names.'); return; }
      // an unticked paddock keeps its outline but not the new area (0 = leave the typed area alone)
      db.applyFieldBoundaries({ matched: items.map((i, n) => ({ id: i.id, boundary: i.boundary, property: i.property, areaHa: useBoxes[n]?.checked === false ? 0 : i.areaHa })), added: add ? extra : [] });
      toast(`Map saved: ${items.length} paddock${items.length === 1 ? '' : 's'}${add && extra.length ? `, ${extra.length} added` : ''}`);
      done();
    });
  };
}
