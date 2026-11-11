import { db } from '../storage.js?v=136';
import { siloResult, bunkerResult, bunkerTarpRequirement } from '../calc.js?v=136';
import { storageLedgerStock, movementNetForStorage } from '../derived.js?v=136';
import { hasStorageQuality } from '../mapping.js?v=136';
import { searchStorages, commodityTabs, filterByTab, naturalByName, sortStorages, sortGroupLabel, SORTS } from '../storagefilter.js?v=136';
import { num, tons, esc, shortDate } from '../fmt.js?v=136';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, askConfirm, notify } from '../ui.js?v=136';
import { renderRelatedMovements } from './movements.js?v=136';
import { openSiloSetupSheet } from './silosetup.js?v=136';
import { commodityFills } from '../commodityfill.js?v=136';
import { layersForStorage, predictPlan, specText, SPECS } from '../outload.js?v=136';

let unsub = null;
let listMode = 'chronological';
let view = 'saved';
let quickKind = 'silo';
// The search box and the chosen commodity tab, kept across repaints so a sync
// arriving does not clear what you were looking for.
let searchText = '';
let commodityTab = '';
// How the list is ordered, remembered on the device like the measured switch.
const SORT_KEY = 'grainflow.storageSort';
let sortMode = (() => { try { const v = localStorage.getItem(SORT_KEY); return SORTS.some((x) => x.id === v) ? v : 'volume'; } catch { return 'volume'; } })();

// Measured is an estimate from a dip and the silo's dimensions; tracked is the
// stock figure plus the loads in and out. Plenty of people only trust the
// second, so the first can be hidden — in the summary and in the list. Kept on
// the device so it is as it was left.
const MEASURED_KEY = 'grainflow.storageShowMeasured';
let showMeasured = (() => { try { return localStorage.getItem(MEASURED_KEY) !== '0'; } catch { return true; } })();
const setShowMeasured = (on) => {
  showMeasured = on;
  try { localStorage.setItem(MEASURED_KEY, on ? '1' : '0'); } catch { /* private mode: it just resets */ }
};

export function renderStorage(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, storages, movements } = db.get();

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Storage</h1>
        <div class="sub">Saved silos &amp; bunkers, plus a quick calculator</div>
      </div>
    </div>
    <div class="view">
      <div class="segmented" id="storage-view">
        <button data-view="saved" class="${view === 'saved' ? 'active' : ''}">Saved</button>
        <button data-view="calculator" class="${view === 'calculator' ? 'active' : ''}">Calculator</button>
      </div>
      <div id="storage-body" style="margin-top:12px"></div>
    </div>
    ${view === 'saved' ? `<button class="fab" id="add-storage">+</button>` : ''}
  `;

  root.querySelector('#storage-view').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    paint(root);
  });

  if (view === 'calculator') {
    paintCalculator(root);
    return;
  }

  const body = root.querySelector('#storage-body');
  if (storages.length === 0) {
    body.innerHTML = `<div class="card"><h2>Saved silos &amp; bunkers</h2>
      <div class="empty">Tap + to save a silo or bunker so you only enter today's level next time.</div></div>`;
    root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
    return;
  }

  body.innerHTML = `
    <div id="storage-summary"></div>
    <div class="card">
      <h2>Saved silos &amp; bunkers</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${['owner', 'manager'].includes(db.getRole()) ? `<button class="btn secondary small" id="silo-setup">Season set-up&hellip;</button>` : ''}
        ${['owner', 'manager'].includes(db.getRole()) ? `<button class="btn secondary small" id="fill-commodity">Fill in commodities from loads</button>` : ''}
        <button type="button" class="chip ${showMeasured ? 'active' : ''}" id="toggle-measured" aria-pressed="${showMeasured}">Measured: ${showMeasured ? 'shown' : 'hidden'}</button>
      </div>
      <div class="segmented" id="list-mode">
        <button data-mode="chronological" class="${listMode === 'chronological' ? 'active' : ''}">Chronological</button>
        <button data-mode="commodity" class="${listMode === 'commodity' ? 'active' : ''}">By commodity</button>
      </div>
      <div class="field" style="margin:10px 0 0">
        <label for="storage-search">Search</label>
        <input type="search" id="storage-search" placeholder="A number, name, grade or commodity" value="${esc(searchText)}" />
      </div>
      <div class="field" style="margin:10px 0 0">
        <label for="storage-sort">Sort by</label>
        <select id="storage-sort">${SORTS.map((x) => `<option value="${x.id}" ${sortMode === x.id ? 'selected' : ''}>${x.label}</option>`).join('')}</select>
      </div>
      <div id="storage-chips" style="margin-top:10px"></div>
      <div id="storage-list" style="margin-top:10px"></div>
    </div>
  `;
  paintStorageParts(root);

  // Typing repaints only what depends on the search, so the box keeps its cursor.
  root.querySelector('#storage-search').addEventListener('input', (e) => {
    searchText = e.target.value;
    paintStorageParts(root);
  });

  body.querySelector('#storage-sort').addEventListener('change', (e) => {
    sortMode = e.target.value;
    try { localStorage.setItem(SORT_KEY, sortMode); } catch { /* private mode: it just resets */ }
    paintStorageParts(root);
  });
  body.querySelector('#list-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    listMode = btn.dataset.mode;
    paint(root);
  });
  body.querySelector('#storage-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tab]');
    if (!chip) return;
    commodityTab = chip.dataset.tab;
    paintStorageParts(root);
  });
  body.querySelector('#storage-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-edit-storage]');
    if (row) openStorageSheet(db.get().storages.find((s) => s.id === row.dataset.editStorage));
  });
  root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
  root.querySelector('#silo-setup')?.addEventListener('click', () => openSiloSetupSheet());
  root.querySelector('#fill-commodity')?.addEventListener('click', async () => {
    const { storages, movements, fields, commodities } = db.get();
    const { fills, mixed } = commodityFills(storages, movements, fields);
    const nameOf = (id) => commodities.find((c) => c.id === id)?.name ?? 'Unknown';
    if (fills.length === 0) {
      notify(mixed.length
        ? `${mixed.length} silo${mixed.length === 1 ? '' : 's'} with no commodity took more than one commodity, so I have not guessed: ${mixed.map((m) => m.storage.name).join(', ')}. Set those by hand.`
        : 'Every silo that has had loads delivered into it already has a commodity.');
      return;
    }
    const NL = String.fromCharCode(10);
    const list = fills.map((f) => `${f.storage.name} → ${nameOf(f.commodityId)}`).join(NL);
    const left = mixed.length ? `${NL}${NL}Left alone (more than one commodity): ${mixed.map((m) => m.storage.name).join(', ')}` : '';
    const ok = await askConfirm(`Give these ${fills.length} silos the commodity of the loads delivered into them?${NL}${NL}${list}${left}`, { confirmLabel: 'Fill in' });
    if (!ok) return;
    for (const f of fills) db.upsertStorage({ id: f.storage.id, commodityId: f.commodityId });
    toast(`${fills.length} silo${fills.length === 1 ? '' : 's'} updated`);
    paint(root);
  });
  root.querySelector('#toggle-measured')?.addEventListener('click', () => { setShowMeasured(!showMeasured); paint(root); });
}

/**
 * The parts of the Saved view that depend on the search and the commodity tab:
 * the summary, the tabs, and the list. The search box is not among them — it is
 * left alone so it keeps its cursor while the list underneath it changes.
 */
function paintStorageParts(root) {
  const { commodities, storages, movements } = db.get();
  const found = searchStorages(storages, commodities, searchText);

  // ---- summary ----
  const commodityRollup = storageTonsByCommodity(commodities, storages, movements);
  const storageTotals = commodityRollup.reduce((acc, r) => ({
    measuredTons: acc.measuredTons + r.measuredTons,
    trackedTons: acc.trackedTons + r.trackedTons,
  }), { measuredTons: 0, trackedTons: 0 });
  root.querySelector('#storage-summary').innerHTML = `
    <div class="card report">
      <h2><span class="dot report"></span>By commodity</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Commodity</th>${showMeasured ? '<th>Measured</th>' : ''}<th>Tracked</th></tr></thead>
          <tbody>
            ${commodityRollup.map((r) => `
              <tr>
                <td>${esc(r.name)}</td>
                ${showMeasured ? `<td>${num(r.measuredTons, 1)}</td>` : ''}
                <td>${num(r.trackedTons, 1)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td>
            ${showMeasured ? `<td>${num(storageTotals.measuredTons, 1)}</td>` : ''}
            <td>${num(storageTotals.trackedTons, 1)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>`;

  // ---- commodity tabs: only in the By commodity view ----
  const chipsEl = root.querySelector('#storage-chips');
  let shown = found;
  if (listMode === 'commodity') {
    const tabs = commodityTabs(found, commodities);
    // A tab that has nothing left in it (after a search, or once its last silo moved) is not a place to be stuck.
    if (commodityTab && !tabs.some((t) => t.id === commodityTab)) commodityTab = '';
    chipsEl.innerHTML = `<div class="chips" role="tablist">
      <button type="button" class="chip ${commodityTab ? '' : 'active'}" data-tab="" role="tab">All ${found.length}</button>
      ${tabs.map((t) => `<button type="button" class="chip ${commodityTab === t.id ? 'active' : ''}" data-tab="${esc(t.id)}" role="tab">${esc(t.name)} ${t.count}</button>`).join('')}
    </div>`;
    shown = filterByTab(found, commodities, commodityTab);
  } else chipsEl.innerHTML = '';

  // ---- the list ----
  root.querySelector('#storage-list').innerHTML = shown.length
    ? renderStorageList(shown, commodities, movements)
    : `<div class="empty">No silos match &ldquo;${esc(searchText.trim())}&rdquo;.</div>`;
}

function paintCalculator(root) {
  const { commodities } = db.get();
  const body = root.querySelector('#storage-body');
  body.innerHTML = `
    <div class="card">
      <div class="segmented" id="quick-kind">
        <button data-kind="silo" class="${quickKind === 'silo' ? 'active' : ''}">Silo</button>
        <button data-kind="bunker" class="${quickKind === 'bunker' ? 'active' : ''}">Bunker</button>
      </div>
      <div id="quick-form" style="margin-top:12px"></div>
      <div id="quick-result"></div>
    </div>
    <div class="field hint" style="padding:0 4px">Quick one-off calc — save it below under Saved if you want to track it day to day.</div>
  `;
  body.querySelector('#quick-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    quickKind = btn.dataset.kind;
    paintCalculator(root);
  });
  buildQuickForm(body, commodities);
}

function commodityOptionsQuick(commodities) {
  return [{ value: '', label: 'None / manual' }, ...commodities.map((c) => ({ value: c.id, label: c.name }))];
}

function buildQuickForm(root, commodities) {
  const formEl = root.querySelector('#quick-form');
  const resultEl = root.querySelector('#quick-result');

  if (quickKind === 'silo') {
    formEl.innerHTML = `
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptionsQuick(commodities) })}
      <div class="grid-2">
        ${field({ label: 'Radius (m)', id: 'q-radius', type: 'number', step: '0.01' })}
        ${field({ label: 'Grain height (m)', id: 'q-height', type: 'number', step: '0.01' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Cone angle (°)', id: 'q-cone', type: 'number', step: '1', value: 0, hint: '0 = flat bottom' })}
        ${field({ label: 'Angle of repose (°)', id: 'q-angle', type: 'number', step: '1' })}
      </div>
      ${field({ label: 'Test weight (t/m³)', id: 'q-tw', type: 'number', step: '0.01' })}
      <div class="segmented" id="q-fill">
        <button data-fill="peak" class="active">Peaked</button>
        <button data-fill="flat">Flat</button>
        <button data-fill="decline">Declined</button>
      </div>
    `;
    let fillState = 'peak';
    formEl.querySelector('#q-fill').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-fill]');
      if (!btn) return;
      fillState = btn.dataset.fill;
      formEl.querySelectorAll('#q-fill button').forEach((b) => b.classList.toggle('active', b === btn));
      recompute();
    });
    formEl.querySelector('#q-commodity').addEventListener('change', () => {
      const c = commodities.find((c) => c.id === getVal(formEl, 'q-commodity'));
      if (c) {
        formEl.querySelector('#q-angle').value = c.angleOfRepose ?? '';
        formEl.querySelector('#q-tw').value = c.testWeight ?? '';
      }
      recompute();
    });
    formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

    function recompute() {
      const r = siloResult({
        radius: getNum(formEl, 'q-radius'),
        height: getNum(formEl, 'q-height'),
        coneAngle: getNum(formEl, 'q-cone'),
        angleOfRepose: getNum(formEl, 'q-angle'),
        testWeight: getNum(formEl, 'q-tw'),
        fillState,
      });
      resultEl.innerHTML = quickResultHTML(r.tons, [
        ['Volume', `${num(r.totalVol, 1)} m³`],
        ['Cone height', `${num(r.coneHeight, 2)} m`],
        ['Peak/decline height', `${num(r.peakHeight, 2)} m`],
      ]);
    }
    recompute();
  } else {
    formEl.innerHTML = `
      ${field({ label: 'Commodity (autofills angle &amp; test weight)', id: 'q-commodity', type: 'select', options: commodityOptionsQuick(commodities) })}
      <div class="grid-2">
        ${field({ label: 'Width (m)', id: 'q-width', type: 'number', step: '0.01' })}
        ${field({ label: 'Length (m)', id: 'q-length', type: 'number', step: '0.01' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Peak angle (°)', id: 'q-angle', type: 'number', step: '1', hint: 'Grain angle of repose' })}
        ${field({ label: 'Test weight (t/m³)', id: 'q-tw', type: 'number', step: '0.01' })}
      </div>
      ${field({ label: 'Tarp overhang per side (m)', id: 'q-overhang', type: 'number', step: '0.1', value: 1.5 })}
    `;
    formEl.querySelector('#q-commodity').addEventListener('change', () => {
      const c = commodities.find((c) => c.id === getVal(formEl, 'q-commodity'));
      if (c) {
        formEl.querySelector('#q-angle').value = c.angleOfRepose ?? '';
        formEl.querySelector('#q-tw').value = c.testWeight ?? '';
      }
      recompute();
    });
    formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

    function recompute() {
      const r = bunkerResult({
        width: getNum(formEl, 'q-width'),
        length: getNum(formEl, 'q-length'),
        angleDeg: getNum(formEl, 'q-angle'),
        testWeight: getNum(formEl, 'q-tw'),
      });
      const t = bunkerTarpRequirement({
        width: getNum(formEl, 'q-width'),
        length: getNum(formEl, 'q-length'),
        angleDeg: getNum(formEl, 'q-angle'),
        overhangM: getNum(formEl, 'q-overhang'),
      });
      resultEl.innerHTML = quickResultHTML(r.tons, [
        ['Volume', `${num(r.volume, 1)} m³`],
        ['Peak height', `${num(r.height, 2)} m`],
      ]) + tarpResultHTML(t);
    }
    recompute();
  }
}

function tarpResultHTML(t) {
  return `
    <hr class="sep" />
    <div class="row"><span class="label"><strong>Tarp needed</strong></span></div>
    <div class="row"><span class="label">Width</span><span class="value">${num(t.tarpWidthNeeded, 1)} m</span></div>
    <div class="row"><span class="label">Length</span><span class="value">${num(t.tarpLengthNeeded, 1)} m</span></div>
    <div class="row"><span class="label">Bare minimum to reach ground</span><span class="value">${num(t.slantWidth, 1)} x ${num(t.slantLength, 1)} m</span></div>
  `;
}

function quickResultHTML(tonsVal, extraRows) {
  return `
    <hr class="sep" />
    <div class="row"><span class="label"><strong>Tons</strong></span><span class="value" style="font-size:22px">${num(tonsVal, 1)} t</span></div>
    ${extraRows.map(([l, v]) => `<div class="row"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('')}
  `;
}

function storageTonsByCommodity(commodities, storages, movements) {
  return commodities
    .map((c) => {
      const rows = storages.filter((s) => s.commodityId === c.id);
      const measuredTons = rows.reduce((sum, s) => sum + computeStorageTons(s, commodities).tons, 0);
      const trackedTons = rows.reduce((sum, s) => sum + storageLedgerStock(s, movements), 0);
      return { name: c.name, measuredTons, trackedTons, count: rows.length };
    })
    .filter((r) => r.count > 0);
}

/** The two columns down the right edge, labelled once above the list. */
function columnHead() {
  return `<div class="storage-head" aria-hidden="true"><span></span>${showMeasured ? '<span class="sr-col">Measured</span>' : ''}<span class="sr-col">Tracked</span></div>`;
}

function renderStorageList(storages, commodities, movements) {
  // How much each silo holds, for sorting: what the books say, then the dip.
  const volumeOf = (s) => ({ tracked: storageLedgerStock(s, movements), measured: computeStorageTons(s, commodities).tons });
  const sortBy = (list) => sortStorages(list, sortMode, volumeOf);
  const row = (s) => storageRow(s, commodities, movements);

  // Sorted by grade (or crop year) the rows are laid out in sections, one per
  // grade: a bold heading with how many silos and how many tonnes are under it,
  // then the silos. That holds wherever the list is — flat, under a commodity
  // tab, or inside each commodity heading — so a grade is always something you
  // can see the extent of at a glance, not a word to read in every row.
  const sections = (rows, nested) => {
    if (!sortGroupLabel(rows[0] ?? {}, sortMode)) return rows.map(row).join('');
    const order = [];
    const by = new Map();
    for (const s of rows) {
      const label = sortGroupLabel(s, sortMode);
      if (!by.has(label)) { by.set(label, []); order.push(label); }
      by.get(label).push(s);
    }
    return order.map((label) => {
      const list = by.get(label);
      const held = list.reduce((a, s) => a + storageLedgerStock(s, movements), 0);
      return `<div class="group-label section${nested ? ' nested' : ''}"><span>${esc(label)}</span><span class="n">${list.length} silo${list.length === 1 ? '' : 's'} · ${num(held, 0)} t</span></div>${list.map(row).join('')}`;
    }).join('');
  };

  if (listMode === 'commodity') {
    const groups = commodities
      .map((c) => ({ name: c.name, rows: sortBy(storages.filter((s) => s.commodityId === c.id)) }))
      .filter((g) => g.rows.length > 0);
    const noCommodity = storages.filter((s) => !commodities.some((c) => c.id === s.commodityId));
    if (noCommodity.length > 0) groups.push({ name: 'No commodity', rows: sortBy(noCommodity) });

    // One commodity chosen: just its silos, no group heading to repeat what the tab says.
    if (commodityTab) return columnHead() + sections(groups.flatMap((g) => g.rows), false);

    return columnHead() + groups.map((g) => `
      <div class="group-label"><span>${esc(g.name)}</span></div>
      ${sections(g.rows, true)}
    `).join('');
  }

  return columnHead() + sections(sortBy(storages), false);
}

function commodityOptions(commodities, includeNone = true) {
  const opts = commodities.map((c) => ({ value: c.id, label: c.name }));
  return includeNone ? [{ value: '', label: 'None / manual' }, ...opts] : opts;
}

function computeStorageTons(s, commodities) {
  if (s.kind === 'tally') return { tons: 0 };
  const c = commodities.find((c) => c.id === s.commodityId);
  const angleOfRepose = s.angleOfRepose ?? c?.angleOfRepose ?? 0;
  const testWeight = s.testWeight ?? c?.testWeight ?? 0;
  if (s.kind === 'bunker') {
    return bunkerResult({ width: s.width, length: s.length, angleDeg: angleOfRepose, testWeight });
  }
  return siloResult({
    radius: s.radius, height: s.currentHeight, coneAngle: s.coneAngle,
    angleOfRepose, testWeight, fillState: s.fillState || 'peak',
  });
}

/**
 * What is in the storage: crop year, grade and the measurements behind it.
 * Folded away until there is something in it, so a silo that has never been
 * classed does not carry seven empty boxes.
 *
 * "Test weight" here is the measured weight of the grain, in kg/hL. It is not the
 * density override further down the sheet (t/m³), which is a setting that turns a
 * measured volume into tonnes; 78 kg/hL is 0.78 t/m³ but the two are kept apart.
 */
function qualityFold(existing, grades) {
  const has = hasStorageQuality(existing || {});
  return `
    <details class="fold" ${has ? 'open' : ''}>
      <summary><div><h2>Grain quality</h2>
        <div class="sub">Crop year, grade, moisture, protein, screenings, test weight, falling number</div></div></summary>
      <datalist id="dl-grades">${grades.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="grid-2">
        ${field({ label: 'Crop year', id: 'q-year', value: existing?.cropYear, placeholder: 'e.g. 2026/27' })}
        ${field({ label: 'Grade', id: 'q-grade', value: existing?.grade, placeholder: 'e.g. APH1', list: 'dl-grades' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Moisture (%)', id: 'q-moisture', type: 'number', step: '0.1', value: existing?.moisturePct ?? '' })}
        ${field({ label: 'Protein (%)', id: 'q-protein', type: 'number', step: '0.1', value: existing?.proteinPct ?? '' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Screenings (%)', id: 'q-screenings', type: 'number', step: '0.1', value: existing?.screeningsPct ?? '' })}
        ${field({ label: 'Test weight (kg/hL)', id: 'q-tw', type: 'number', step: '0.1', value: existing?.testWeightKgHl ?? '', hint: 'As measured. Not the volume density below.' })}
      </div>
      ${field({ label: 'Falling number (seconds)', id: 'q-fn', type: 'number', step: '1', value: existing?.fallingNumber ?? '' })}
    </details>`;
}

/** The quality fields from the form; a blank box is null, not zero. */
function readQuality(root) {
  const n = (id) => (getVal(root, id) === '' || getVal(root, id) == null ? null : getNum(root, id));
  return {
    cropYear: getVal(root, 'q-year')?.trim() || '',
    grade: getVal(root, 'q-grade')?.trim() || '',
    moisturePct: n('q-moisture'),
    proteinPct: n('q-protein'),
    screeningsPct: n('q-screenings'),
    testWeightKgHl: n('q-tw'),
    fallingNumber: n('q-fn'),
  };
}

/** "2026/27 · APH1 · 11.2% moisture · 11.5% protein · 78 kg/hL" — what is recorded, nothing else. */
function qualityLine(s) {
  const pct = (v, label) => (v !== null && v !== undefined && v !== '' ? `${num(v, 1)}% ${label}` : '');
  return [
    s.cropYear, s.grade,
    pct(s.moisturePct, 'moisture'), pct(s.proteinPct, 'protein'), pct(s.screeningsPct, 'screenings'),
    s.testWeightKgHl != null && s.testWeightKgHl !== '' ? `${num(s.testWeightKgHl, 1)} kg/hL` : '',
    s.fallingNumber != null && s.fallingNumber !== '' ? `FN ${num(s.fallingNumber, 0)}` : '',
  ].filter(Boolean).map(esc).join(' · ');
}

function kindLabel(kind) {
  if (kind === 'bunker') return 'Bunker';
  if (kind === 'tally') return 'Tally';
  return 'Silo';
}

function storageRow(s, commodities, movements) {
  const c = commodities.find((c) => c.id === s.commodityId);
  const ledger = storageLedgerStock(s, movements);
  const isTally = s.kind === 'tally';
  const unitLabel = isTally ? (s.unitLabel || 't') : 't';

  // Two figures down the right edge, the same two as the summary above: what the
  // dip says is there, and what the books say is there. A tally storage has no
  // geometry, so it has no measured figure.
  const columns = (measured, trackedNote) => `
    ${showMeasured ? `<div class="sr-col"><div class="main">${measured}</div></div>` : ''}
    <div class="sr-col"><div class="main">${num(ledger, 1)}</div>${trackedNote ? `<div class="meta">${esc(trackedNote)}</div>` : ''}</div>`;

  if (isTally) {
    return `
      <div class="list-item storage-row" data-edit-storage="${s.id}">
        <div>
          <div class="main">${esc(s.name)} <span class="badge muted">Tally</span></div>
          <div class="meta">${esc(c ? c.name : 'No commodity set')}</div>
          ${qualityLine(s) ? `<div class="meta">${qualityLine(s)}</div>` : ''}
          ${noteLine(s) ? `<div class="meta" style="font-style:italic">${noteLine(s)}</div>` : ''}
        </div>
        ${columns('–', unitLabel === 't' ? '' : unitLabel)}
      </div>`;
  }

  const r = computeStorageTons(s, commodities);
  // The bar and the percentage follow the tracked stock — the opening figure plus
  // the loads in and out — so entering an opening stock fills it. It used to
  // follow the measured estimate, which is zero until someone dips the silo.
  // Over capacity is shown as over, not clipped to a bar that looks merely full.
  const capPct = s.capacityTons ? Math.max(0, (ledger / s.capacityTons) * 100) : null;
  const angleOfRepose = s.angleOfRepose ?? c?.angleOfRepose ?? 0;
  const tarp = s.kind === 'bunker'
    ? bunkerTarpRequirement({ width: s.width, length: s.length, angleDeg: angleOfRepose, overhangM: s.tarpOverhangM ?? 1.5 })
    : null;
  return `
    <div class="list-item storage-row" data-edit-storage="${s.id}">
      <div>
        <div class="main">${esc(s.name)} <span class="badge muted">${kindLabel(s.kind)}</span></div>
        <div class="meta">${esc(c ? c.name : 'No commodity set')}${capPct !== null ? ` · ${num(capPct, 0)}% of ${num(s.capacityTons, 0)} t` : ''}</div>
        ${qualityLine(s) ? `<div class="meta">${qualityLine(s)}</div>` : ''}
        ${noteLine(s) ? `<div class="meta" style="font-style:italic">${noteLine(s)}</div>` : ''}
        ${capPct !== null ? `<div class="gauge ${capPct > 100 ? 'over' : capPct >= 95 ? 'warn' : ''}" role="img" aria-label="${Math.round(capPct)} percent full"><i style="width:${Math.min(100, capPct)}%"></i></div>` : ''}
        ${tarp ? `<div class="meta">Tarp needed: ${num(tarp.tarpWidthNeeded, 1)} x ${num(tarp.tarpLengthNeeded, 1)} m</div>` : ''}
      </div>
      ${columns(num(r.tons, 1))}
    </div>`;
}

/** A silo's free-text note. */
function notesField(existing) {
  return field({ label: 'Notes', id: 's-notes', type: 'textarea', rows: 3, value: existing?.notes ?? '', placeholder: 'Anything worth remembering about this storage' });
}

/** The first line of a note, for the list. */
function noteLine(s) {
  const first = String(s.notes ?? '').trim().split(/\r?\n/)[0];
  return first ? esc(first.length > 70 ? `${first.slice(0, 70)}…` : first) : '';
}

/**
 * What is in this storage, top to bottom, and what the next trucks will take
 * out — last in, first out. Needs the quality of each load to say anything
 * about quality; without it the prediction is a list of which loads come first.
 */
function predictorFold(existing) {
  return `
    <details class="fold">
      <summary><div><h2>What's in it &amp; outload predictor</h2>
        <div class="sub">Loads in the order they will come out, and what each truck will carry</div></div></summary>
      <div class="field hint" style="margin-bottom:8px">Last in, first out: the most recent load comes out first. Add
        the grade, protein and moisture to each load on the Movement tab and this shows what every truck will take.</div>
      <div class="subhead" style="margin-top:4px">In the storage now, top first</div>
      <div id="op-stack"></div>
      <div class="subhead">Plan an outload</div>
      <div class="grid-2">
        ${field({ label: 'Tonnes to take out', id: 'op-total', type: 'number', step: '1', value: '' })}
        ${field({ label: 'Truck size (t)', id: 'op-truck', type: 'number', step: '1', value: 36 })}
      </div>
      <div id="op-result"></div>
    </details>`;
}

function buildPredictor(root, existing) {
  const stackEl = root.querySelector('#op-stack');
  if (!stackEl) return;
  const resultEl = root.querySelector('#op-result');
  const { layers, shortfall } = layersForStorage(existing, db.get().movements);

  const layerLabel = (l) => (l.source === 'opening'
    ? 'Opening stock (carried over)'
    : `Ticket #${l.ticketNo ?? '?'} · ${esc(shortDate(l.date) || 'no date')}${l.rego ? ` · ${esc(l.rego)}` : ''}`);
  const top = [...layers].reverse();
  stackEl.innerHTML = top.length
    ? top.slice(0, 12).map((l) => `<div class="row" style="align-items:flex-start"><span class="label">${layerLabel(l)}
        <div class="meta">${esc(specText(l.spec)) || 'no quality recorded'}</div></span><span class="value">${num(l.tons, 1)} t</span></div>`).join('')
      + (top.length > 12 ? `<div class="field hint">…and ${top.length - 12} older layers underneath.</div>` : '')
    : '<div class="field hint">Nothing in this storage on the books.</div>';
  if (shortfall > 0.05) {
    stackEl.innerHTML += `<div class="field hint" style="color:var(--danger)">${num(shortfall, 1)} t has been loaded out that no load or opening stock accounts for, so what is shown may be off.</div>`;
  }

  const truckCard = (p, i) => {
    const mix = p.grades.map((g) => `${esc(g.grade || 'No grade')} ${Math.round(g.pct * 100)}%`).join(' · ');
    const lines = SPECS.map((sp) => {
      const v = p.specs[sp.key];
      if (!v) return '';
      const range = Math.abs(v.max - v.min) > 1e-9 ? ` (${num(v.min, sp.dp)}–${num(v.max, sp.dp)})` : '';
      const partial = v.coverage < 0.995 ? ` <span class="meta">from ${Math.round(v.coverage * 100)}% of the load</span>` : '';
      return `<div class="row"><span class="label">${sp.label}</span><span class="value">${num(v.avg, sp.dp)} ${sp.unit}${range}${partial}</span></div>`;
    }).join('');
    const from = p.segments.map((s) => (s.layer.source === 'opening' ? 'opening stock' : `#${s.layer.ticketNo ?? '?'}`)).join(', ');
    return `<div class="card" style="margin:8px 0">
      <h2 style="margin-bottom:4px">Truck ${i + 1} · ${num(p.total, 1)} t</h2>
      <div class="meta">${mix || 'No grade recorded'}</div>
      <div class="meta" style="margin-bottom:6px">From ${esc(from)}</div>
      ${lines || '<div class="field hint">No quality recorded on these loads.</div>'}
    </div>`;
  };
  const draw = () => {
    const total = getNum(root, 'op-total');
    const size = getNum(root, 'op-truck') || 36;
    if (!(total > 0)) { resultEl.innerHTML = ''; return; }
    const plan = predictPlan(layers, total, size);
    resultEl.innerHTML = plan.trucks.map(truckCard).join('')
      + (plan.short > 0.05 ? `<div class="field hint" style="color:var(--danger)">Only ${num(total - plan.short, 1)} t is in the storage; ${num(plan.short, 1)} t of that outload has nothing to come from.</div>` : '');
  };
  root.querySelector('#op-total').addEventListener('input', draw);
  root.querySelector('#op-truck').addEventListener('input', draw);
}

function openStorageSheet(existing) {
  const { commodities, movements, storages } = db.get();
  // Grades already used on other storages, offered as suggestions so APH1 is typed once.
  const gradesInUse = [...new Set(storages.map((x) => x.grade).filter(Boolean))].sort();
  const fixedMovementNet = existing ? movementNetForStorage(existing.id, movements) : 0;
  let kind = existing?.kind || 'silo';

  const body = openSheet(existing ? 'Edit storage' : 'Add storage', (root) => {
    build();

    function build() {
      if (kind === 'tally') { buildTally(); return; }
      root.innerHTML = `
        ${!existing ? `
        <div class="segmented" id="s-kind">
          <button data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${kind === 'bunker' ? 'active' : ''}">Bunker</button>
          <button data-kind="tally" class="${kind === 'tally' ? 'active' : ''}">Tally</button>
        </div>` : ''}
        ${field({ label: 'Name', id: 's-name', value: existing?.name, placeholder: existing?.kind === 'bunker' || kind === 'bunker' ? 'e.g. Bunker 1' : 'e.g. Silo 12 (155t)' })}
        ${field({ label: 'Commodity currently stored', id: 's-commodity', type: 'select', value: existing?.commodityId, options: commodityOptions(commodities) })}
        ${field({ label: 'Opening / current stock (t)', id: 's-opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0, hint: 'A stocktake baseline — movements adjust from here' })}
        <div class="row"><span class="label"><strong>Tracked stock</strong></span><span class="value" id="s-ledger-preview" style="font-size:20px">—</span></div>
        ${qualityFold(existing, gradesInUse)}
        ${notesField(existing)}
        ${existing ? predictorFold(existing) : ''}
        <hr class="sep" />
        ${kind === 'silo' ? `
          <div class="grid-2">
            ${field({ label: 'Radius (m)', id: 's-radius', type: 'number', step: '0.01', value: existing?.radius })}
            ${field({ label: 'Cone angle (°)', id: 's-cone', type: 'number', step: '1', value: existing?.coneAngle ?? 0, hint: '0 = flat bottom' })}
          </div>
          ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          <hr class="sep" />
          ${field({ label: 'Current grain height (m)', id: 's-height', type: 'number', step: '0.01', value: existing?.currentHeight })}
        ` : `
          <div class="grid-2">
            ${field({ label: 'Width (m)', id: 's-width', type: 'number', step: '0.01', value: existing?.width })}
            ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          </div>
          <hr class="sep" />
          ${field({ label: 'Current filled length (m)', id: 's-length', type: 'number', step: '0.01', value: existing?.length, hint: 'How much of the bunker currently has grain in it' })}
        `}
        ${field({ label: 'Angle of repose override (°, optional)', id: 's-angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'Leave blank to use the commodity default' })}
        ${field({ label: 'Test weight override (t/m³, optional)', id: 's-tw', type: 'number', step: '0.01', value: existing?.testWeight, hint: 'Leave blank to use the commodity default' })}
        ${kind === 'silo' ? `
        <div class="field">
          <label>Grain surface</label>
          <div class="segmented" id="s-fill">
            <button data-fill="peak" class="${(existing?.fillState || 'peak') === 'peak' ? 'active' : ''}">Peaked</button>
            <button data-fill="flat" class="${existing?.fillState === 'flat' ? 'active' : ''}">Flat</button>
            <button data-fill="decline" class="${existing?.fillState === 'decline' ? 'active' : ''}">Declined</button>
          </div>
        </div>` : ''}
        <div class="row"><span class="label"><strong>Estimated total (measured)</strong></span><span class="value" id="s-total-preview" style="font-size:20px">—</span></div>
        <div class="field hint">Set the level above after physically dipping the ${kind}. Tracked stock is separate: it's your opening/current stock figure plus movements in/out, and doesn't need to match the measured estimate exactly.</div>
        ${kind === 'bunker' ? `
        <hr class="sep" />
        ${field({ label: 'Tarp overhang per side (m)', id: 's-overhang', type: 'number', step: '0.1', value: existing?.tarpOverhangM ?? 1.5 })}
        <div class="row"><span class="label">Tarp width needed</span><span class="value" id="s-tarp-width">—</span></div>
        <div class="row"><span class="label">Tarp length needed</span><span class="value" id="s-tarp-length">—</span></div>
        ` : ''}
        ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
        ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete ${kindLabel(existing.kind).toLowerCase()}</button>` : ''}
        <div class="save-bar solo"><button class="btn" id="save">Save</button></div>
      `;
      if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'silo', existing.id);
      if (existing) buildPredictor(root, existing);

      const kindSel = root.querySelector('#s-kind');
      if (kindSel) {
        kindSel.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-kind]');
          if (!btn) return;
          kind = btn.dataset.kind;
          build();
        });
      }

      let fillState = existing?.fillState || 'peak';
      const fillSel = root.querySelector('#s-fill');
      if (fillSel) {
        fillSel.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-fill]');
          if (!btn) return;
          fillState = btn.dataset.fill;
          fillSel.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
          recomputePreview();
        });
      }

      const ledgerPreview = root.querySelector('#s-ledger-preview');
      function recomputeLedger() {
        ledgerPreview.textContent = `${num(getNum(root, 's-opening') + fixedMovementNet, 1)} t`;
      }
      root.querySelector('#s-opening').addEventListener('input', recomputeLedger);
      recomputeLedger();

      const preview = root.querySelector('#s-total-preview');
      const tarpWidthEl = root.querySelector('#s-tarp-width');
      const tarpLengthEl = root.querySelector('#s-tarp-length');
      function recomputePreview() {
        const c = commodities.find((cc) => cc.id === getVal(root, 's-commodity'));
        const angleOverride = getVal(root, 's-angle');
        const twOverride = getVal(root, 's-tw');
        const angleOfRepose = angleOverride ? parseFloat(angleOverride) : (c?.angleOfRepose ?? 0);
        const testWeight = twOverride ? parseFloat(twOverride) : (c?.testWeight ?? 0);
        const r = kind === 'bunker'
          ? bunkerResult({ width: getNum(root, 's-width'), length: getNum(root, 's-length'), angleDeg: angleOfRepose, testWeight })
          : siloResult({ radius: getNum(root, 's-radius'), height: getNum(root, 's-height'), coneAngle: getNum(root, 's-cone'), angleOfRepose, testWeight, fillState });
        preview.textContent = `${num(r.tons, 1)} t`;
        if (kind === 'bunker' && tarpWidthEl) {
          const t = bunkerTarpRequirement({
            width: getNum(root, 's-width'), length: getNum(root, 's-length'),
            angleDeg: angleOfRepose, overhangM: getNum(root, 's-overhang'),
          });
          tarpWidthEl.textContent = `${num(t.tarpWidthNeeded, 1)} m`;
          tarpLengthEl.textContent = `${num(t.tarpLengthNeeded, 1)} m`;
        }
      }
      root.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', recomputePreview));
      recomputePreview();

      root.querySelector('#save').addEventListener('click', () => {
        const name = getVal(root, 's-name')?.trim();
        if (!name) { root.querySelector('#s-name').focus(); return; }
        const angleOverride = getVal(root, 's-angle');
        const twOverride = getVal(root, 's-tw');
        const payload = {
          id: existing?.id,
          kind,
          name,
          commodityId: getVal(root, 's-commodity') || null,
          openingStock: getNum(root, 's-opening'),
          capacityTons: getNum(root, 's-capacity') || null,
          angleOfRepose: angleOverride ? parseFloat(angleOverride) : null,
          testWeight: twOverride ? parseFloat(twOverride) : null,
          ...readQuality(root),
          notes: getVal(root, 's-notes')?.trim() || '',
        };
        if (kind === 'silo') {
          payload.radius = getNum(root, 's-radius');
          payload.coneAngle = getNum(root, 's-cone');
          payload.currentHeight = getNum(root, 's-height');
          payload.fillState = fillState;
        } else {
          payload.width = getNum(root, 's-width');
          payload.length = getNum(root, 's-length');
          payload.tarpOverhangM = getNum(root, 's-overhang');
        }
        db.upsertStorage(payload);
        closeSheet(); toast('Saved');
      });
      const del = root.querySelector('#del');
      if (del) {
        del.addEventListener('click', () => {
          confirmDelete(`Delete "${existing.name}"?`, () => {
            db.deleteStorage(existing.id);
            closeSheet();
          });
        });
      }
    }

    // A bare count with no geometry — round bales, ginned lint bales, seed
    // tonnes: anything tracked purely by a movement-adjusted ledger, not a
    // measured shape. Reuses the same opening-stock/ledger mechanism as
    // silo/bunker, just skips every geometry field.
    function buildTally() {
      root.innerHTML = `
        ${!existing ? `
        <div class="segmented" id="s-kind">
          <button data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${kind === 'bunker' ? 'active' : ''}">Bunker</button>
          <button data-kind="tally" class="${kind === 'tally' ? 'active' : ''}">Tally</button>
        </div>` : ''}
        ${field({ label: 'Name', id: 's-name', value: existing?.name, placeholder: 'e.g. SR1 round bales' })}
        ${field({ label: 'Commodity', id: 's-commodity', type: 'select', value: existing?.commodityId, options: commodityOptions(commodities) })}
        ${field({ label: 'Unit', id: 's-unit', value: existing?.unitLabel, placeholder: 'e.g. round bales, bales, t', hint: "Whatever this storage counts — shown next to the tracked stock figure" })}
        ${field({ label: 'Opening / current stock', id: 's-opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0, hint: 'A stocktake baseline — movements adjust from here' })}
        <div class="row"><span class="label"><strong>Tracked stock</strong></span><span class="value" id="s-ledger-preview" style="font-size:20px">—</span></div>
        ${qualityFold(existing, gradesInUse)}
        ${notesField(existing)}
        ${existing ? predictorFold(existing) : ''}
        ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
        ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete ${kindLabel(existing.kind).toLowerCase()}</button>` : ''}
        <div class="save-bar solo"><button class="btn" id="save">Save</button></div>
      `;
      if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'silo', existing.id);
      if (existing) buildPredictor(root, existing);

      const kindSel = root.querySelector('#s-kind');
      if (kindSel) {
        kindSel.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-kind]');
          if (!btn) return;
          kind = btn.dataset.kind;
          build();
        });
      }

      const ledgerPreview = root.querySelector('#s-ledger-preview');
      function recomputeLedger() {
        const unit = getVal(root, 's-unit')?.trim() || 't';
        ledgerPreview.textContent = `${num(getNum(root, 's-opening') + fixedMovementNet, 1)} ${unit}`;
      }
      root.querySelector('#s-opening').addEventListener('input', recomputeLedger);
      root.querySelector('#s-unit').addEventListener('input', recomputeLedger);
      recomputeLedger();

      root.querySelector('#save').addEventListener('click', () => {
        const name = getVal(root, 's-name')?.trim();
        if (!name) { root.querySelector('#s-name').focus(); return; }
        db.upsertStorage({
          ...readQuality(root),
          notes: getVal(root, 's-notes')?.trim() || '',
          id: existing?.id,
          kind,
          name,
          commodityId: getVal(root, 's-commodity') || null,
          unitLabel: getVal(root, 's-unit')?.trim() || 't',
          openingStock: getNum(root, 's-opening'),
        });
        closeSheet(); toast('Saved');
      });
      const del = root.querySelector('#del');
      if (del) {
        del.addEventListener('click', () => {
          confirmDelete(`Delete "${existing.name}"?`, () => {
            db.deleteStorage(existing.id);
            closeSheet();
          });
        });
      }
    }
  });
  return body;
}
