// The farm map: every paddock's outline on one map, coloured by what is growing in it. Tap a paddock to open it.
//
// The outlines come from a shapefile (John Deere Operations Center, and most farm software, can export one). Choose the
// .shp and .dbf together, or the zip they came in. Paddocks are matched to yours by name, and the area worked out from
// the outline replaces the area typed in, as it is the more accurate. The reading and drawing are in farmmap.js.

import { db } from '../storage.js?v=243';
import { openSheet, toast, notify, askConfirm } from '../ui.js?v=243';
import { esc, num } from '../fmt.js?v=243';
import {
  readBoundaries, unzipFiles, simplifyRings, ringsAreaHa, matchBoundaries, mapLayout, PALETTE, NO_CROP,
} from '../farmmap.js?v=243';

const MAX_ZOOM = 40;

/** @param {{onOpenField?: (field: object) => void}} [opts] */
export function openMapSheet({ onOpenField } = {}) {
  openSheet('Farm map', (root) => {
    const draw = () => {
      const { fields, commodities } = db.get();
      const mapped = fields.filter((f) => f.boundary?.length);
      if (!mapped.length) { importView(root, draw); return; }

      // a colour for each commodity that has a mapped paddock
      const inUse = commodities.filter((c) => mapped.some((f) => f.commodityId === c.id));
      const colourOf = (f) => { const i = inUse.findIndex((c) => c.id === f.commodityId); return i < 0 ? NO_CROP : PALETTE[i % PALETTE.length]; };
      const layout = mapLayout(mapped.map((f) => ({ id: f.id, name: f.name, color: colourOf(f), rings: f.boundary })));
      const vb = layout.viewBox;
      const unmapped = fields.filter((f) => !f.boundary?.length);
      const mappedHa = mapped.reduce((s, f) => s + (Number(f.areaHa) || 0), 0);

      root.innerHTML = `
        <div class="hint" style="margin-bottom:8px">${mapped.length} paddock${mapped.length === 1 ? '' : 's'} mapped, ${num(mappedHa, 0)} ha. Tap one to open it. Pinch or use the buttons to zoom.</div>
        <div id="fm-wrap" style="position:relative;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--bg);touch-action:none">
          <svg id="fm-svg" viewBox="0 0 ${vb.w} ${vb.h}" style="display:block;width:100%;height:auto;max-height:68vh" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of the paddocks">
            ${layout.items.map((i) => `<path data-id="${esc(i.id)}" d="${i.d}" fill="${i.color}" fill-opacity="0.55" fill-rule="evenodd" stroke="var(--text)" stroke-opacity="0.55" stroke-width="1" vector-effect="non-scaling-stroke" style="cursor:pointer"><title>${esc(i.name)}</title></path>`).join('')}
            ${layout.items.map((i) => `<text data-label="${esc(i.id)}" data-area="${Math.round(i.areaHa * 10000)}" x="${Math.round(i.cx)}" y="${Math.round(i.cy)}" text-anchor="middle" dominant-baseline="central" fill="var(--text)" stroke="var(--bg)" stroke-width="3" paint-order="stroke" pointer-events="none" style="font-weight:600">${esc(i.name)}</text>`).join('')}
          </svg>
          <div style="position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px">
            <button type="button" class="btn secondary small" id="fm-in" aria-label="Zoom in" style="width:40px;padding:6px 0">+</button>
            <button type="button" class="btn secondary small" id="fm-out" aria-label="Zoom out" style="width:40px;padding:6px 0">&minus;</button>
            <button type="button" class="btn secondary small" id="fm-reset" aria-label="Show everything" style="width:40px;padding:6px 0">&#8962;</button>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0">
          ${inUse.map((c, i) => `<span class="meta"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};vertical-align:-1px"></span> ${esc(c.name)}</span>`).join('')}
          ${mapped.some((f) => colourOf(f) === NO_CROP) ? `<span class="meta"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${NO_CROP};vertical-align:-1px"></span> No crop set</span>` : ''}
        </div>
        ${unmapped.length ? `<div class="hint" style="margin-bottom:8px">Not on the map: ${unmapped.map((f) => esc(f.name)).join(', ')}.</div>` : ''}
        <button type="button" class="btn secondary" id="fm-update" style="margin-top:6px">Update from a file</button>
        <button type="button" class="btn ghost-danger" id="fm-clear" style="margin-top:8px">Remove the map</button>`;

      wireMap(root, vb, layout, (id) => { const f = fields.find((x) => x.id === id); if (f && onOpenField) onOpenField(f); });
      root.querySelector('#fm-update').addEventListener('click', () => importView(root, draw, true));
      root.querySelector('#fm-clear').addEventListener('click', async () => {
        if (!(await askConfirm('Remove the outlines from every paddock? The paddocks and their areas stay. You can import the file again.', { confirmLabel: 'Remove', danger: true }))) return;
        db.clearFieldBoundaries();
        toast('Map removed');
        draw();
      });
    };
    draw();
  });
}

/** Pan, pinch and button zoom on the map, by moving the viewBox. A tap on a paddock opens it. */
function wireMap(root, full, layout, open) {
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
  const labels = () => {
    const width = svg.getBoundingClientRect().width || 360;
    const unit = v.w / width;                              // map metres to a pixel
    const size = 11 * unit;
    svg.querySelectorAll('text[data-label]').forEach((t) => {
      const px2 = Number(t.dataset.area) / (unit * unit);   // the paddock's area in square pixels (data-area is square metres)
      t.style.display = px2 > 2600 ? '' : 'none';
      t.setAttribute('font-size', size);
      t.setAttribute('stroke-width', 3 * unit);
    });
  };
  const zoomAt = (factor, cx = 0.5, cy = 0.5) => {         // cx, cy: where on the map to hold still, as a fraction of it
    const nx = v.x + v.w * cx; const ny = v.y + v.h * cy;
    v.w /= factor; v.h = v.w * (full.h / full.w);
    v.x = nx - v.w * cx; v.y = ny - v.h * cy;
    clamp(); fit();
  };
  root.querySelector('#fm-in').addEventListener('click', () => zoomAt(1.6));
  root.querySelector('#fm-out').addEventListener('click', () => zoomAt(1 / 1.6));
  root.querySelector('#fm-reset').addEventListener('click', () => { v = { ...full }; fit(); });

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
  fit();
  window.addEventListener('resize', labels, { once: true });
}

/** Choosing the files, matching them to the paddocks, and saving. */
function importView(root, done, haveMap = false) {
  const { fields } = db.get();
  root.innerHTML = `
    <div class="hint" style="margin-bottom:10px">${haveMap ? 'Choose the file again to update the outlines.' : 'Draw your paddocks on a map.'}
      In John Deere Operations Center export your boundaries as a shapefile, then choose the <strong>.shp</strong> and <strong>.dbf</strong> files together
      (select both at once), or the <strong>.zip</strong> they came in. Paddocks are matched to yours by name.</div>
    <label class="btn" style="display:block;text-align:center;cursor:pointer">Choose the files&hellip;
      <input type="file" id="fm-files" multiple accept=".shp,.dbf,.zip,.prj,.cpg,.shx" style="display:none" />
    </label>
    <div id="fm-problem" class="hint" style="color:var(--danger);margin:8px 0"></div>
    <div id="fm-preview"></div>
    ${haveMap ? '<button type="button" class="btn secondary" id="fm-back" style="margin-top:8px">Back to the map</button>' : ''}`;
  root.querySelector('#fm-back')?.addEventListener('click', done);
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
    const items = matched.map((m) => ({ id: m.field.id, name: m.field.name, was: Number(m.field.areaHa) || 0, areaHa: Math.round(ringsAreaHa(m.feature.rings) * 100) / 100, boundary: simplifyRings(m.feature.rings) }));
    const extra = unmatched.map((f) => ({ name: f.name, farm: f.farm, areaHa: Math.round(ringsAreaHa(f.rings) * 100) / 100, boundary: simplifyRings(f.rings) }));
    const was = items.reduce((s, i) => s + i.was, 0);
    const now = items.reduce((s, i) => s + i.areaHa, 0);
    const box = root.querySelector('#fm-preview');
    box.innerHTML = `
      <div class="card" style="margin-top:10px">
        <h2>${features.length} outlines found</h2>
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
      db.applyFieldBoundaries({ matched: items.map((i, n) => ({ id: i.id, boundary: i.boundary, areaHa: useBoxes[n]?.checked === false ? 0 : i.areaHa })), added: add ? extra : [] });
      toast(`Map saved: ${items.length} paddock${items.length === 1 ? '' : 's'}${add && extra.length ? `, ${extra.length} added` : ''}`);
      done();
    });
  };
}
