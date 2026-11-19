import { db } from '../storage.js?v=434';
import { siloResult, bunkerResult, bunkerTarpRequirement } from '../calc.js?v=434';
import { isHay, balesInStorage, describeBales } from '../hay.js?v=434';
import { modulesReport } from '../modulesreport.js?v=434';
import { storageLedgerStock, movementNetForStorage, movementsForEndpoint, bigFirst } from '../derived.js?v=434';
import { isTransit } from '../transit.js?v=434';
import { isOffFarm } from '../offfarm.js?v=434';
import { paintOffFarmCard } from './offfarm.js?v=434';
import { gradesFor, allGradeCodes, OTHER_GRADE } from '../grades.js?v=434';
import { gradeFieldHtml, wireGradeField } from '../gradepick.js?v=434';
import { hasStorageQuality } from '../mapping.js?v=434';
import { fumigationLog, fumigationState, fumigationLine, withholdingEnd, clearOn } from '../fumigation.js?v=434';
import { searchStorages, commodityTabs, filterByTab, naturalByName, NO_COMMODITY, sortStorages, sortGroupLabel, SORTS } from '../storagefilter.js?v=434';
import { num, tons, esc, shortDate, todayLocal, dmy } from '../fmt.js?v=434';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, askConfirm, notify } from '../ui.js?v=434';
import { renderRelatedMovements } from './movements.js?v=434';
import { openSiloSetupSheet } from './silosetup.js?v=434';
import { openCalculatorSheet } from './calculator.js?v=434';
import { commodityFills } from '../commodityfill.js?v=434';
import { capacityInfo, capacityLine, assumedCommodity, wantsCommodity } from '../storagecapacity.js?v=434';
import { loadSpaceAs, saveSpaceAs } from '../spacefor.js?v=434';
import { layersForStorage, predictPlan, predictOutload, specText, SPECS, outloadEndOf, looksLikeBunker, extraSpecKey } from '../outload.js?v=434';
import {
  gradeMix, visibleMix, dominantGrade, hasGrades, mixText, storageSvg, cleanBands, layersTotal, gradeKey, NO_GRADE,
} from '../silolayers.js?v=434';

let unsub = null;
// 'commodity': grouped by commodity, in the order of Sort by. 'name': one flat list, A to Z (and no Sort by to choose).
let listMode = 'commodity';
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
  const { commodities, storages: allStorages, movements } = db.get();
  // locations held by a third party have their own card; they are not silos to measure
  const storages = allStorages.filter((s) => !isOffFarm(s));

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Storage</h1>
        <div class="sub">Silos and bunkers</div>
      </div>
    </div>
    <div class="view">
      <div id="storage-body"></div>
    </div>
    <button class="fab" id="add-storage">+</button>
  `;

  const body = root.querySelector('#storage-body');
  if (storages.length === 0) {
    body.innerHTML = `<div class="card"><h2>Saved silos &amp; bunkers</h2>
      <div class="empty">Tap + to save a silo or bunker so you only enter today's level next time.</div></div>
      <div id="offfarm-card"></div>`;
    root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
    paintOffFarmCard(root.querySelector('#offfarm-card'));
    return;
  }

  const canSetUp = ['owner', 'manager'].includes(db.getRole());
  body.innerHTML = `
    <div id="storage-summary"></div>
    <div class="card">
      <div class="mv-searchrow">
        <input type="search" id="storage-search" aria-label="Search silos" placeholder="Search&hellip;" value="${esc(searchText)}" />
        ${listMode === 'name' ? '' : `<select id="storage-sort" class="storage-sort" aria-label="Sort by">${SORTS.map((x) => `<option value="${x.id}" ${sortMode === x.id ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`}
        <button type="button" class="btn secondary small mv-more-btn" id="storage-more-btn" aria-haspopup="true" aria-expanded="false">More &#9662;</button>
      </div>
      <div class="mv-menu" id="storage-more" hidden style="margin-top:8px">
        <button type="button" id="toggle-measured" aria-pressed="${showMeasured}">Measured figures: ${showMeasured ? 'shown' : 'hidden'}</button>
        <button type="button" id="list-mode" data-mode="${listMode === 'name' ? 'commodity' : 'name'}">${listMode === 'name' ? 'Group by commodity' : 'List by name, A to Z'}</button>
        <button type="button" id="silo-calculator">Silo calculator&hellip;</button>
        ${canSetUp ? `<button type="button" id="silo-setup">Season set-up&hellip;</button>
        <button type="button" id="fill-commodity">Fill in commodities from loads</button>` : ''}
      </div>
      <div id="storage-chips" style="margin-top:10px"></div>
      <div id="storage-list" style="margin-top:10px"></div>
    </div>
    <div id="offfarm-card"></div>
  `;
  paintStorageParts(root);
  paintOffFarmCard(root.querySelector('#offfarm-card'));

  // Typing repaints only what depends on the search, so the box keeps its cursor.
  root.querySelector('#storage-search').addEventListener('input', (e) => {
    searchText = e.target.value;
    paintStorageParts(root);
  });

  body.querySelector('#storage-sort')?.addEventListener('change', (e) => {
    sortMode = e.target.value;
    try { localStorage.setItem(SORT_KEY, sortMode); } catch { /* private mode: it just resets */ }
    paintStorageParts(root);
  });
  body.querySelector('#list-mode').addEventListener('click', (e) => {
    listMode = e.currentTarget.dataset.mode;
    paint(root);
  });
  // The measured switch, the list order and the tools sit behind More, so the list starts straight under the search
  const menu = body.querySelector('#storage-more');
  const moreBtn = body.querySelector('#storage-more-btn');
  const setMenu = (open) => { menu.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
  moreBtn.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', (ev) => { if (ev.target.closest('button')) setMenu(false); });
  root.onclick = (ev) => { if (!menu.hidden && !ev.target.closest('#storage-more, #storage-more-btn')) setMenu(false); };
  body.querySelector('#storage-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tab]');
    if (!chip) return;
    commodityTab = chip.dataset.tab;
    paintStorageParts(root);
  });
  body.querySelector('#storage-list').addEventListener('change', (e) => {
    if (e.target.id !== 'storage-assume-sel') return;
    saveSpaceAs(e.target.value);
    paintStorageParts(root);
  });
  body.querySelector('#storage-list').addEventListener('click', (e) => {
    const card = e.target.closest('[data-open-transit]');
    if (card) { openTransitSheet(db.get().storages.find((x) => x.id === card.dataset.openTransit)); return; }
    const row = e.target.closest('[data-edit-storage]');
    if (row) openStorageSheet(db.get().storages.find((s) => s.id === row.dataset.editStorage));
  });
  root.querySelector('#add-storage').addEventListener('click', () => openStorageSheet(null));
  root.querySelector('#silo-calculator')?.addEventListener('click', () => openCalculatorSheet());
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
/**
 * A silo as the list sees it: with the grades its layers hold. Its grade is the one
 * most of it is, so sorting, grouping and searching by grade follow what is actually
 * in the silo — not only what was typed on it — and a silo with nothing graded keeps
 * the grade it was given. Computed once per paint and carried on the copy.
 */
function withLayers(s, movements) {
  const { layers } = layersForStorage(s, movements);
  return { ...s, grade: dominantGrade(layers) || s.grade, __layers: layers, __mix: gradeMix(layers) };
}

function paintStorageParts(root) {
  const { commodities, storages: saved, movements } = db.get();
  const transits = saved.filter(isTransit);
  const storages = saved.filter((x) => !isTransit(x) && !isOffFarm(x)).map((x) => withLayers(x, movements));
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
    const tabs = commodityTabs(found, commoditiesByStock(commodities, storages, movements));
    // A tab that has nothing left in it (after a search, or once its last silo moved) is not a place to be stuck.
    if (commodityTab && !tabs.some((t) => t.id === commodityTab)) commodityTab = '';
    chipsEl.innerHTML = `<div class="chips" role="tablist">
      <button type="button" class="chip ${commodityTab ? '' : 'active'}" data-tab="" role="tab">All ${found.length}</button>
      ${tabs.map((t) => `<button type="button" class="chip ${commodityTab === t.id ? 'active' : ''}" data-tab="${esc(t.id)}" role="tab">${esc(t.name)} ${t.count}</button>`).join('')}
    </div>`;
    shown = filterByTab(found, commodities, commodityTab);
    // With one commodity (or "No commodity") picked, a total for its silos: held, room when full, and what is spare.
    if (commodityTab) chipsEl.innerHTML += tabTotalLine(shown, commodities, movements, tabs.find((t) => t.id === commodityTab)?.name || '');
  } else chipsEl.innerHTML = '';

  // ---- the list ----
  // On a commodity tab, the cards that are not that commodity's stay out of the way: cotton on hand only on All and the cotton
  // tabs, and grain waiting on trucks only on its own commodity's tab (or when it has none set).
  const tab = listMode === 'commodity' ? commodityTab : '';
  const tabName = (commodities.find((c) => c.id === tab)?.name || '').toLowerCase();
  const cottonHere = !tab || tabName.startsWith('cotton');
  const transitsHere = tab ? transits.filter((x) => !x.commodityId || x.commodityId === tab) : transits;
  root.querySelector('#storage-list').innerHTML = (searchText.trim() || !cottonHere ? '' : cottonOnHandCard()) + transitCards(transitsHere, commodities, movements) + (shown.length
    ? renderStorageList(shown, commodities, movements)
    : `<div class="empty">No silos match &ldquo;${esc(searchText.trim())}&rdquo;.</div>`);
}

/**
 * The total for the silos on one commodity tab: how many, what they hold by the books, what they hold when full and what is spare.
 * Silos with no commodity are worked out as the commodity picked above the list, the same as each row, so the total agrees with the rows.
 * A tally storage counts in its own unit, not tonnes, so it is left out of the tonnes.
 */
function tabTotalLine(silos, commodities, movements, name) {
  const assume = assumedCommodity(commodities, loadSpaceAs());
  let held = 0; let room = 0; let counted = 0; let unknown = 0;
  for (const s of silos) {
    if (s.kind === 'tally' && (s.unitLabel || 't') !== 't') continue;
    counted += 1;
    held += storageLedgerStock(s, movements);
    const c = commodities.find((x) => x.id === s.commodityId);
    const cap = capacityInfo(s, c || assume).tons;
    if (cap > 0) room += cap; else unknown += 1;
  }
  if (!counted) return '';
  const spare = room - held;
  const asNote = !silos.some((s) => commodities.some((x) => x.id === s.commodityId)) && assume ? ` as ${esc(assume.name)}` : '';
  return `<div class="tab-total"><strong>${esc(name)} total</strong> · ${counted} silo${counted === 1 ? '' : 's'}
    <div class="tab-total-fig"><span><b>${num(held, 1)} t</b> held</span><span><b>${num(room, 0)} t</b> room when full${asNote}</span>${room > 0 ? `<span${spare < 0 ? ' class="short"' : ''}><b>${num(Math.abs(spare), 0)} t</b> ${spare < 0 ? 'short' : 'spare'}</span>` : ''}</div>
    ${unknown ? `<div class="meta">${unknown} silo${unknown === 1 ? ' has' : 's have'} no volume or tonnes set, so no room is counted for ${unknown === 1 ? 'it' : 'them'}.</div>` : ''}</div>`;
}

/**
 * Cotton on hand: modules still in the field, modules in the gin yard and bales in the bale shed, with the bales expected from them
 * all. The field is not a store, so this sits above the stores rather than among them. A module is in one place at a time (carting
 * it to the yard takes it off the field), so the three do not overlap. Shown only while the farm has cotton on hand.
 */
function cottonOnHandCard() {
  const { fields, movements, storages, commodities } = db.get();
  if (!commodities.some((c) => c.unit === 'bale')) return '';
  const report = modulesReport({ fields, movements, storages, commodities });
  const h = report.onHand;
  if (!(h.inField > 0 || h.inYard > 0 || h.inShed > 0)) return '';
  const inFields = report.rows.filter((r) => r.inField > 0);
  const line = (label, value) => `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  return `<div class="card report">
    <h2><span class="dot report"></span>Cotton on hand</h2>
    ${line('In the field', `${num(h.inField, 0)} modules &middot; ${num(h.inFieldBales, 0)} bales`)}
    ${inFields.map((r) => `<div class="row" style="padding-left:14px"><span class="label meta">${esc(r.field.name)}</span><span class="value meta">${num(r.inField, 0)} modules &middot; ${num(r.inFieldBales, 0)} bales</span></div>`).join('')}
    ${h.inYard > 0 ? line('In the gin yard', `${num(h.inYard, 0)} modules &middot; ${num(h.yardBales, 0)} bales`) : ''}
    ${h.inShed > 0 ? line('In the bale shed', `${num(h.inShed, 0)} bales`) : ''}
    ${line('<strong>Expected bales on hand</strong>', `<strong>${num(h.total, 0)}</strong>`)}
    <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Modules in the field are listed by paddock, so you can see where they are. Moving them to the gin yard takes them off the paddock.</div>
  </div>`;
}

/**
 * Grain on trucks that has no silo yet, one card per commodity: the tonnes, how many
 * tickets are waiting, and a way in to allocate them. Shown only while there is something
 * waiting, and never mixed into silo stock.
 */
function transitCards(transits, commodities, movements) {
  return transits.map((t) => {
    const waiting = movementsForEndpoint('silo', t.id, movements).filter((m) => (m.tos || []).some((x) => x.id === t.id));
    const held = storageLedgerStock(t, movements);
    if (waiting.length === 0 && Math.abs(held) < 0.05) return '';
    return `<div class="card transit-card" data-open-transit="${esc(t.id)}" role="button" tabindex="0">
      <div class="transit-head"><strong>${esc(t.name)}</strong><span class="badge warn">Needs allocating</span></div>
      <div class="meta">${num(held, 1)} t on ${waiting.length} ticket${waiting.length === 1 ? '' : 's'} &middot; not yet in a silo. Tap to allocate.</div>
    </div>`;
  }).join('');
}

/** The tickets waiting in an in-transit store; opening one and choosing its silo allocates it. */
function openTransitSheet(t) {
  openSheet(t.name, (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">Grain on trucks that has no silo yet. Open a ticket and choose the silo it went into
        &mdash; or split it across two &mdash; and it moves out of here. This store should come back to zero.</div>
      <div id="transit-list"></div>`;
    renderRelatedMovements(root.querySelector('#transit-list'), 'silo', t.id);
  });
}

function storageTonsByCommodity(commodities, storages, movements) {
  return commodities
    .map((c) => {
      const rows = storages.filter((s) => s.commodityId === c.id);
      const measuredTons = rows.reduce((sum, s) => sum + computeStorageTons(s, commodities).tons, 0);
      const trackedTons = rows.reduce((sum, s) => sum + storageLedgerStock(s, movements), 0);
      return { name: c.name, measuredTons, trackedTons, count: rows.length };
    })
    .filter((r) => r.count > 0)
    .sort(bigFirst((r) => r.trackedTons || r.measuredTons));   // the most grain held first
}

/** The commodities, the one with the most grain in the silos first (what the books say, then the dip). */
function commoditiesByStock(commodities, storages, movements) {
  const held = new Map(commodities.map((c) => {
    const rows = storages.filter((s) => s.commodityId === c.id);
    const tracked = rows.reduce((sum, s) => sum + storageLedgerStock(s, movements), 0);
    return [c.id, tracked || rows.reduce((sum, s) => sum + computeStorageTons(s, commodities).tons, 0)];
  }));
  return [...commodities].sort(bigFirst((c) => held.get(c.id), (c) => c.name));
}

/**
 * The commodity the space in silos with no commodity is worked out as: one small line where those silos are listed (under the
 * "No commodity" heading, at the top of the No commodity tab, or above a flat list that has some), never above everything else.
 * Only when some silo listed has a volume and nothing set to go in it, and some commodity has a test weight to work it out with.
 */
function assumeBlock(silos, commodities) {
  const wanting = silos.filter((x) => x.kind !== 'tally' && wantsCommodity(x));
  const options = commodities.filter((x) => Number(x.testWeight) > 0);
  if (!wanting.length || !options.length) return '';
  const now = assumedCommodity(commodities, loadSpaceAs());
  return `<div class="assume-line"><label for="storage-assume-sel">Space in the ${wanting.length} with no commodity is worked out as</label>
    <select id="storage-assume-sel">${options.map((x) => `<option value="${esc(x.name)}" ${now?.name === x.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <div class="hint">Volume needs a test weight to become tonnes. Only changes this screen and the harvest report.</div></div>`;
}

/** The two columns down the right edge, labelled once above the list. */
function columnHead() {
  return `<div class="storage-head" aria-hidden="true"><span></span>${showMeasured ? '<span class="sr-col">Measured</span>' : ''}<span class="sr-col">Tracked</span></div>`;
}

function renderStorageList(storages, commodities, movements) {
  // How much each silo holds, for sorting: what the books say, then the dip.
  const volumeOf = (s) => ({ tracked: storageLedgerStock(s, movements), measured: computeStorageTons(s, commodities).tons });
  // By name is one flat list A to Z; otherwise the order chosen in Sort by
  const effectiveSort = listMode === 'name' ? 'name' : sortMode;
  const sortBy = (list) => sortStorages(list, effectiveSort, volumeOf);
  const row = (s) => storageRow(s, commodities, movements);

  // Sorted by grade (or crop year) the rows are laid out in sections, one per
  // grade: a bold heading with how many silos and how many tonnes are under it,
  // then the silos. That holds wherever the list is — flat, under a commodity
  // tab, or inside each commodity heading — so a grade is always something you
  // can see the extent of at a glance, not a word to read in every row.
  const sections = (rows, nested) => {
    if (!sortGroupLabel(rows[0] ?? {}, effectiveSort)) return rows.map(row).join('');
    const order = [];
    const by = new Map();
    for (const s of rows) {
      const label = sortGroupLabel(s, effectiveSort);
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
    const groups = commoditiesByStock(commodities, storages, movements)
      .map((c) => ({ name: c.name, rows: sortBy(storages.filter((s) => s.commodityId === c.id)) }))
      .filter((g) => g.rows.length > 0);
    const noCommodity = storages.filter((s) => !commodities.some((c) => c.id === s.commodityId));
    if (noCommodity.length > 0) groups.push({ name: 'No commodity', rows: sortBy(noCommodity) });

    // One commodity chosen: just its silos, no group heading to repeat what the tab says.
    if (commodityTab) return (commodityTab === NO_COMMODITY ? assumeBlock(noCommodity, commodities) : '') + columnHead() + sections(groups.flatMap((g) => g.rows), false);

    return columnHead() + groups.map((g) => `
      <div class="group-label"><span>${esc(g.name)}</span></div>
      ${g.name === 'No commodity' ? assumeBlock(g.rows, commodities) : ''}
      ${sections(g.rows, true)}
    `).join('');
  }

  return assumeBlock(storages, commodities) + columnHead() + sections(sortBy(storages), false);
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
    return bunkerResult({ width: s.width, length: s.length, angleDeg: angleOfRepose, testWeight, wallHeight: s.wallHeight });
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
function qualityFold(existing, commodity) {
  const has = hasStorageQuality(existing || {});
  return `
    <details class="fold">
      <summary><div><h2>Default grade</h2>
        <div class="sub">Used only when a load or a section doesn't record its own</div></div></summary>
      <div class="grid-2">
        ${field({ label: 'Crop year', id: 'q-year', value: existing?.cropYear, placeholder: 'e.g. 2026/27' })}
        ${gradeFieldHtml({ id: 'q-grade', commodity, value: existing?.grade })}
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
      <div id="q-oil-wrap" ${extraSpecKey(commodity?.name) === 'oilPct' || existing?.oilPct != null ? '' : 'hidden'}>${field({ label: 'Oil (%)', id: 'q-oil', type: 'number', step: '0.1', value: existing?.oilPct ?? '', hint: 'Canola' })}</div>
      <div id="q-ffa-wrap" ${extraSpecKey(commodity?.name) === 'oilPct' || existing?.ffaPct != null ? '' : 'hidden'}>${field({ label: 'Free fatty acid (%)', id: 'q-ffa', type: 'number', step: '0.01', value: existing?.ffaPct ?? '', hint: 'Canola' })}</div>
      <div id="q-ret-wrap" ${extraSpecKey(commodity?.name) === 'retentionPct' || existing?.retentionPct != null ? '' : 'hidden'}>${field({ label: 'Retention (%)', id: 'q-ret', type: 'number', step: '0.1', value: existing?.retentionPct ?? '', hint: 'Barley: kept above 2.5 mm' })}</div>
    </details>`;
}

/** The quality fields from the form; a blank box is null, not zero. */
function readQuality(root, gradeCtl) {
  const n = (id) => (getVal(root, id) === '' || getVal(root, id) == null ? null : getNum(root, id));
  return {
    cropYear: getVal(root, 'q-year')?.trim() || '',
    grade: gradeCtl ? gradeCtl.read() : (getVal(root, 'q-grade')?.trim() || ''),
    moisturePct: n('q-moisture'),
    proteinPct: n('q-protein'),
    screeningsPct: n('q-screenings'),
    testWeightKgHl: n('q-tw'),
    fallingNumber: n('q-fn'),
    oilPct: n('q-oil'),
    ffaPct: n('q-ffa'),
    retentionPct: n('q-ret'),
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
    pct(s.oilPct, 'oil'), s.ffaPct != null && s.ffaPct !== '' ? `${num(s.ffaPct, 2)}% FFA` : '', pct(s.retentionPct, 'retention'),
  ].filter(Boolean).map(esc).join(' · ');
}

function kindLabel(kind) {
  if (kind === 'bunker') return 'Bunker / shed';
  if (kind === 'tally') return 'Tally';
  return 'Silo';
}

/** Hay in a store is counted in bales as well as tonnes: the bales loaded in less those loaded out. */
function baleLine(s, c, movements) {
  if (!isHay(c)) return '';
  const b = balesInStorage(s.id, movements);
  return b.bales > 0 ? `<div class="meta">${esc(describeBales(b.bales, b.kg))}</div>` : '';
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
          ${baleLine(s, c, movements)}
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
  // the most it holds: its volume times the test weight of what is in it, or the tonnes typed on it
  // A storage with no commodity set has no test weight to turn its volume into tonnes, so it is worked out as the commodity picked above
  // the list (nothing is saved on the storage by that).
  const assume = c ? null : assumedCommodity(commodities, loadSpaceAs());
  const capInfo = capacityInfo(s, c || assume);
  const capT = capInfo.tons;
  const asNote = assume && capInfo.source === 'volume' && capInfo.testWeightSource === 'commodity' ? ` (as ${esc(assume.name)})` : '';
  const spare = capT - ledger;
  const capPct = capT > 0 ? Math.max(0, (ledger / capT) * 100) : null;
  const mix = visibleMix(s.__mix);
  const layered = hasGrades(s.__layers || []);
  // The bar is the silo filled to what the books say, split by grade where grades are known:
  // bottom of the silo at the left. Without grades it is the plain fill it always was.
  const bar = capPct === null ? '' : layered
    ? `<div class="gauge layered ${capPct > 100 ? 'over' : ''}" role="img" aria-label="${esc(mixText(mix, 5))}"><div class="lay" style="width:${Math.min(100, capPct)}%">${(s.__layers || []).map((l) => {
        const g = gradeMix([l])[0];
        return `<i style="width:${(l.tons / ((s.__layers || []).reduce((a, x) => a + x.tons, 0) || 1)) * 100}%;background:${g.color}"></i>`;
      }).join('')}</div></div>`
    : `<div class="gauge ${capPct > 100 ? 'over' : capPct >= 95 ? 'warn' : ''}" role="img" aria-label="${Math.round(capPct)} percent full"><i style="width:${Math.min(100, capPct)}%"></i></div>`;
  const mixLine = mix.length > 1 || (mix.length === 1 && layered && mix[0].grade !== (s.grade || ''))
    ? `<div class="meta mix-line">${mix.slice(0, 4).map((g) => `<span class="mix-chip"><i style="background:${g.color}"></i>${esc(g.grade)}${mix.length > 1 ? ` ${Math.round(g.pct * 100)}%` : ''}</span>`).join('')}</div>`
    : '';
  const angleOfRepose = s.angleOfRepose ?? c?.angleOfRepose ?? 0;
  const tarp = s.kind === 'bunker'
    ? bunkerTarpRequirement({ width: s.width, length: s.length, angleDeg: angleOfRepose, overhangM: s.tarpOverhangM ?? 1.5 })
    : null;
  return `
    <div class="list-item storage-row" data-edit-storage="${s.id}">
      <div>
        <div class="main">${esc(s.name)} <span class="badge muted">${kindLabel(looksLikeBunker(s) ? 'bunker' : s.kind)}</span></div>
        <div class="meta">${esc(c ? c.name : 'No commodity set')}${capPct !== null ? ` · ${num(capPct, 0)}% of ${num(capT, 0)} t${asNote}${spare > 0.05 ? ` · ${num(spare, 0)} t spare` : ''}` : ''}</div>
        ${baleLine(s, c, movements)}
        ${qualityLine(s) ? `<div class="meta">${qualityLine(s)}</div>` : ''}
        ${noteLine(s) ? `<div class="meta" style="font-style:italic">${noteLine(s)}</div>` : ''}
        ${mixLine}
        ${fumigationBadge(s)}
        ${bar}
        ${tarp ? `<div class="meta">Tarp needed: ${num(tarp.tarpWidthNeeded, 1)} x ${num(tarp.tarpLengthNeeded, 1)} m</div>` : ''}
      </div>
      ${columns(num(r.tons, 1))}
    </div>`;
}

/** On the list: a red-ish line while the grain is being withheld after a fumigation, nothing once it is clear. */
function fumigationBadge(s) {
  const st = fumigationState(s, todayLocal());
  return st.withheld ? `<div class="meta"><span class="badge warn">Withholding</span> until ${esc(dmy(st.clearOn))} · fumigated ${esc(dmy(st.last.date))}</div>` : '';
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
/**
 * One band of the samples editor: a sample of the silo, by tonnes, with its grade and specs. Every box carries its name above it,
 * so a number that has been typed in still says what it is. The first line is the tonnes and the grade; then moisture and protein;
 * then the other measurements, two to a line.
 */
/**
 * The grade of a sample, or of one load in a silo, as a drop-down: the grades this silo can hold, "No grade", a grade already on the sample that is not on the
 * list (so opening an old sample never loses it) and "Other" for a one-off, which reveals a box to type it in.
 */
function sampleGradeHtml(grades, value, { cls = 'lay-grade', aria = 'Grade of this sample', other = 'lay-grade-other' } = {}) {
  const cur = String(value ?? '').trim();
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const list = [...new Set(grades || [])];
  const opts = [['', 'No grade'], ...list.map((g) => [g, g]), ...(cur && !list.some((g) => same(g, cur)) ? [[cur, `${cur} (not on the list)`]] : []), [OTHER_GRADE, 'Other…']];
  return `<select class="${cls}" aria-label="${aria}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${same(v, cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <input type="text" class="${other}" aria-label="Type the grade" placeholder="Type the grade" autocomplete="off" style="display:none;margin-top:4px" />`;
}

function bandRowHtml(r = {}, grades = []) {
  const v = (x) => (x === undefined || x === null ? '' : x);
  const num = (cls, caption, aria, value, step = '0.1') => `<div class="lay-f"><span class="lay-cap">${caption}</span>
      <input type="number" inputmode="decimal" step="${step}" class="${cls}" aria-label="${aria}" value="${v(value)}" /></div>`;
  return `<div class="lay-row" data-lay>
    <div class="lay-f"><span class="lay-cap">Tonnes</span>
      <input type="number" inputmode="decimal" step="0.1" class="lay-tons" aria-label="Tonnes in this sample" value="${v(r.tons)}" /></div>
    <div class="lay-f"><span class="lay-cap">Grade</span>
      ${sampleGradeHtml(grades, r.grade)}</div>
    <span class="lay-btns">
      <button type="button" class="lay-up" aria-label="Move this sample up">&uarr;</button>
      <button type="button" class="lay-down" aria-label="Move this sample down">&darr;</button>
      <button type="button" class="lay-del" aria-label="Remove this sample">&times;</button>
    </span>
    <span class="lay-tag meta"></span>
    <div class="lay-more">
      ${num('lay-moisture', 'Moisture %', 'Moisture', r.moisturePct)}
      ${num('lay-protein', 'Protein %', 'Protein', r.proteinPct)}
      ${num('lay-screenings', 'Screenings %', 'Screenings', r.screeningsPct)}
      ${num('lay-tw', 'Test weight kg/hL', 'Test weight', r.testWeightKgHl)}
      ${num('lay-fn', 'Falling number', 'Falling number', r.fallingNumber, '1')}
      ${num('lay-oil', 'Oil %', 'Oil', r.oilPct)}
      ${num('lay-ffa', 'Free fatty acid %', 'Free fatty acid', r.ffaPct, '0.01')}
      ${num('lay-ret', 'Retention %', 'Retention', r.retentionPct)}
    </div>
  </div>`;
}

/**
 * What is in a silo or bunker, layer by layer: a picture, the order it comes out in, the
 * running samples (by tonnes from the bottom, with their grade and specs), and the outload
 * planner. The loads that went in are layers of their own; a sample band replaces what the
 * loads say for the grain it covers.
 */
function contentsFold(existing, grades, kind = existing?.kind) {
  const isBunker = kind === 'bunker';
  const rows = Array.isArray(existing?.gradeBands) ? existing.gradeBands : [];
  // What is in it, said on the closed header itself, so the section tells you something before it is opened.
  const held = existing ? layersForStorage(existing, db.get().movements).layers : [];
  const heldTons = held.reduce((a, l) => a + l.tons, 0);
  const heldMix = gradeMix(held);
  const heldLine = !held.length ? 'Nothing in it on the books yet'
    : hasGrades(held) ? `${esc(mixText(heldMix, 4))} · ${num(heldTons, 0)} t`
      : `${num(heldTons, 0)} t · no grades recorded yet — tap to add`;
  const heldBar = hasGrades(held)
    ? `<div class="gauge layered feature-bar"><div class="lay" style="width:100%">${held.map((l) => `<i style="width:${(l.tons / heldTons) * 100}%;background:${gradeMix([l])[0].color}"></i>`).join('')}</div></div>`
    : '';
  return `
    <details class="fold feature" id="contents-fold" ${rows.length ? 'open' : ''}>
      <summary><div class="feature-head"><h2>Grade summary</h2>
        <div class="sub">${heldLine}</div>${heldBar}</div></summary>
      ${isBunker ? `
      <div class="field" style="margin:8px 0 0">
        <label>Outload starts from</label>
        <div class="segmented" id="lay-end">
          <button type="button" data-end="last" class="${outloadEndOf(existing) === 'last' ? 'active' : ''}">Front (last in, first out)</button>
          <button type="button" data-end="first" class="${outloadEndOf(existing) === 'first' ? 'active' : ''}">Back (first in, first out)</button>
        </div>
        <div class="hint">Switch it if this bunker is emptied from the back, or opened at both ends. The picture and the outload plan follow it.</div>
      </div>` : ''}
      <div id="lay-picture"></div>
      <div id="lay-bulk" class="lay-bulk"></div>
      <details class="inner-fold" id="stack-fold">
        <summary id="lay-stack-head"></summary>
        <div id="op-stack"></div>
      </details>
      <details class="inner-fold" id="sample-fold">
        <summary><span>Regrade sections <span class="meta">${rows.length ? `· ${rows.length} set` : '· optional'}</span></span></summary>
        <div class="field hint" style="margin:8px 0">Set the grade of blocks of the ${isBunker ? 'bunker' : 'silo'} from your sample results, e.g. the first 800 t is APH1, the next 600 t is AUH2. Grain that arrives after the date below keeps its own grade.</div>
        <div class="field" style="margin-bottom:8px"><label for="lay-asof">Sampled on</label>
          <input type="date" id="lay-asof" value="${esc(existing?.gradeBandsDate || todayLocal())}" /></div>
        <div id="lay-rows">${rows.map((r) => bandRowHtml(r, grades)).join('')}</div>
        <datalist id="lay-grades">${grades.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
        <button type="button" class="btn secondary small" id="lay-add">+ Add the next section</button>
        <div class="field hint" id="lay-total"></div>
      </details>
    </details>
    ${planFold()}`;
}

/**
 * Fumigation: a record of each time the grain was fumigated, with the date the withholding period ends. The newest
 * one decides whether the grain is clear to load out. Entries are kept on the form until Save, like the samples.
 */
function fumigationFold(list) {
  const st = fumigationState({ fumigations: list }, todayLocal());
  return `
    <details class="fold ${st.withheld ? 'feature' : ''}" id="fumigation-fold" ${st.withheld ? 'open' : ''}>
      <summary><div class="${st.withheld ? 'feature-head' : ''}"><h2>Fumigation</h2>
        <div class="sub" id="fum-sub">${esc(fumigationLine(st, dmy) || 'Not recorded yet')}</div></div></summary>
      <div id="fum-list"></div>
      <div class="subhead">Record a fumigation</div>
      <div class="grid-2">
        ${field({ label: 'Fumigated on', id: 'fum-date', type: 'date', value: todayLocal() })}
        ${field({ label: 'Product', id: 'fum-product', list: 'dl-fum-products', placeholder: 'e.g. Phosphine' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Withholding (days)', id: 'fum-days', type: 'number', step: '1', placeholder: 'From the label' })}
        ${field({ label: 'Clear to load out from', id: 'fum-end', type: 'date' })}
      </div>
      <button type="button" class="btn secondary small" id="fum-add">+ Add to the record</button>
      <datalist id="dl-fum-products">${[...new Set(['Phosphine', ...db.get().storages.flatMap((x) => (x.fumigations || []).map((f) => f.product)).filter(Boolean)])].map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    </details>`;
}

/** Draws the record and takes new entries. `getList`/`setList` hold the entries until the storage is saved. */
function wireFumigation(root, getList, setList) {
  const listEl = root.querySelector('#fum-list');
  if (!listEl) return;
  const draw = () => {
    const log = fumigationLog(getList());
    const st = fumigationState({ fumigations: log }, todayLocal());
    root.querySelector('#fum-sub').textContent = fumigationLine(st, dmy) || 'Not recorded yet';
    listEl.innerHTML = log.length ? log.map((f, i) => `
      <div class="row" style="align-items:flex-start">
        <span class="label"><strong>${esc(dmy(f.date))}</strong>${f.product ? ` · ${esc(f.product)}` : ''}${f.days != null ? ` · ${f.days} day${f.days === 1 ? '' : 's'}` : ''}
          <div class="meta">${f.endsOn ? (i === 0 && st.withheld ? `<span class="badge warn">Withholding</span> until ${esc(dmy(f.endsOn))}` : `Clear from ${esc(dmy(f.endsOn))}`) : 'No withholding period recorded'}</div></span>
        <button type="button" class="btn ghost-danger small" data-fum-del="${esc(f.id)}" style="width:auto;margin:0;padding:6px 12px" aria-label="Remove this fumigation">&times;</button>
      </div>`).join('') : '<div class="field hint">Nothing recorded yet.</div>';
    listEl.querySelectorAll('[data-fum-del]').forEach((b) => b.addEventListener('click', () => { setList(getList().filter((f) => f.id !== b.dataset.fumDel)); draw(); }));
  };
  // the clear-to date follows the date and days until it is typed over
  let typedEnd = false;
  const dateEl = root.querySelector('#fum-date'); const daysEl = root.querySelector('#fum-days'); const endEl = root.querySelector('#fum-end');
  const follow = () => { if (!typedEnd) endEl.value = withholdingEnd(dateEl.value, daysEl.value); };
  dateEl.addEventListener('input', follow); daysEl.addEventListener('input', follow);
  endEl.addEventListener('input', () => { typedEnd = true; });
  root.querySelector('#fum-add').addEventListener('click', () => {
    if (!dateEl.value) { dateEl.focus(); return; }
    const entry = { id: `f${dateEl.value}-${Math.random().toString(36).slice(2, 7)}`, date: dateEl.value, product: getVal(root, 'fum-product') || '', days: daysEl.value, endsOn: endEl.value, notes: '' };
    entry.endsOn = clearOn(entry);
    setList([...getList(), entry]);
    daysEl.value = ''; endEl.value = ''; typedEnd = false; root.querySelector('#fum-product').value = '';
    draw();
    toast('Added. Save to keep it.');
  });
  draw();
}

/** Plan an outload: the tonnes and the truck size in, what each truck will carry out. Reads the grade summary above it. */
function planFold() {
  return `
    <details class="fold" id="plan-fold">
      <summary><div><h2>Plan an outload</h2>
        <div class="sub">Tonnes to take out and truck size: what each truck will carry</div></div></summary>
      <div class="grid-2">
        ${field({ label: 'Tonnes to take out', id: 'op-total', type: 'number', step: '1', value: '' })}
        ${field({ label: 'Truck size (t)', id: 'op-truck', type: 'number', step: '1', value: 36 })}
      </div>
      <div id="op-result"></div>
    </details>`;
}

/** The bands as typed. */
function readLayerRows(root) {
  const val = (row, sel) => row.querySelector(sel)?.value ?? '';
  return [...root.querySelectorAll('#lay-rows [data-lay]')].map((row) => ({
    tons: val(row, '.lay-tons'),
    grade: val(row, '.lay-grade') === OTHER_GRADE ? val(row, '.lay-grade-other').trim() : val(row, '.lay-grade'),
    proteinPct: val(row, '.lay-protein'),
    moisturePct: val(row, '.lay-moisture'),
    screeningsPct: val(row, '.lay-screenings'),
    testWeightKgHl: val(row, '.lay-tw'),
    fallingNumber: val(row, '.lay-fn'),
    oilPct: val(row, '.lay-oil'),
    ffaPct: val(row, '.lay-ffa'),
    retentionPct: val(row, '.lay-ret'),
  }));
}

function buildContents(root, existing, kind = existing?.kind) {
  // the kind as the form shows it now: a storage being added can be switched to a bunker before it is saved
  const isBunker = kind === 'bunker';
  const stackEl = root.querySelector('#op-stack');
  if (!stackEl) return;
  const resultEl = root.querySelector('#op-result');
  const rowsEl = root.querySelector('#lay-rows');
  // the grades this silo can hold, as the list on the form has them (for the grade drop-downs)
  const gradeList = () => [...root.querySelectorAll('#lay-grades option')].map((o) => o.value);
  let layers = [];
  let ungradedIds = [];
  let contents = 0;
  // which end of a bunker is emptied first (see outload.js); a silo is always last in, first out
  let outEnd = outloadEndOf(existing);

  // The storage as the form describes it right now, so the picture follows the typing.
  const live = () => ({
    ...(existing || {}),
    id: existing?.id ?? '__new',
    openingStock: Number(root.querySelector('#s-opening')?.value) || 0,
    gradeBands: cleanBands(readLayerRows(root)),
    gradeBandsDate: root.querySelector('#lay-asof')?.value || '',
    kind,
    ...(isBunker ? { outloadEnd: outEnd } : {}),
  });

  const layerLabel = (l) => {
    const base = l.source === 'opening'
      ? 'Opening stock'
      : `Ticket #${l.ticketNo ?? '?'} · ${esc(shortDate(l.date) || 'no date')}${l.rego ? ` · ${esc(l.rego)}` : ''}`;
    return l.banded ? `${base} <span class="meta">· section ${l.banded}</span>` : base;
  };

  const redraw = () => {
    const st = live();
    // what is in it, without the samples: the grain itself
    contents = layersForStorage({ ...st, gradeBands: [] }, db.get().movements).layers.reduce((a, l) => a + l.tons, 0);
    const result = layersForStorage(st, db.get().movements);
    layers = result.layers;
    const mix = gradeMix(layers);
    const capacity = formCapacity(root, existing).tons;
    const total = layers.reduce((a, l) => a + l.tons, 0);

    root.querySelector('#lay-picture').innerHTML = `
      <div class="silo-pic${isBunker ? ' stack' : ''}">
        <div>${storageSvg(isBunker ? 'bunker' : existing?.kind, layers, capacity, { outloadEnd: outEnd, coneAngle: Number(root.querySelector('#s-cone')?.value ?? existing?.coneAngle) || 0 })}</div>
        <div class="silo-legend">
          <div class="main">${num(total, 1)} t${capacity ? ` <span class="meta">of ${num(capacity, 0)} t</span>` : ''}</div>
          ${visibleMix(mix).length ? visibleMix(mix).map((g) => `<div class="legend-row"><i style="background:${g.color}"></i><span>${esc(g.grade)}</span><span class="meta">${num(g.tons, 1)} t · ${Math.round(g.pct * 100)}%</span></div>`).join('')
            : '<div class="field hint">Nothing in it on the books.</div>'}
        </div>
      </div>`;

    // the grain that comes out first is listed first
    const top = outEnd === 'first' ? [...layers] : [...layers].reverse();
    root.querySelector('#lay-stack-head').innerHTML = `<span>Outload order - quality <span class="meta">· ${isBunker ? `${outEnd === 'first' ? 'back' : 'front'} first` : 'top first'} · ${layers.length} load${layers.length === 1 ? '' : 's'}</span></span>`;
    stackEl.innerHTML = top.length
      ? top.slice(0, 14).map((l) => `<div class="row" style="align-items:flex-start"><span class="label"><i class="sw" style="background:${gradeMix([l])[0].color}"></i>${layerLabel(l)}
          <div class="meta">${esc(specText(l.spec)) || 'no grade or quality recorded'}</div></span><span class="value">${num(l.tons, 1)} t${l.source === 'load' && l.id && !l.banded ? `<div><button type="button" class="btn secondary small le-open" data-load="${esc(l.id)}" style="min-height:30px;padding:4px 12px;margin-top:4px">Grade</button></div>` : ''}</span></div>`).join('')
        + (top.length > 14 ? `<div class="field hint">…and ${top.length - 14} more behind.</div>` : '')
      : '<div class="field hint">Nothing in this storage on the books.</div>';
    if (result.shortfall > 0.05) {
      stackEl.innerHTML += `<div class="field hint" style="color:var(--danger)">${num(result.shortfall, 1)} t has been loaded out that no load or opening stock accounts for, so what is shown may be off.</div>`;
    }

    // loads with no grade of their own and no sample over them
    const bulk = root.querySelector('#lay-bulk');
    const typed = bulk.querySelector('#lay-bulk-grade')?.value ?? '';
    ungradedIds = layers.filter((l) => l.source === 'load' && l.id && !l.banded && !gradeKey(l.spec?.grade)).map((l) => l.id);
    const ungradedTons = layers.filter((l) => l.source === 'load' && !l.banded && !gradeKey(l.spec?.grade)).reduce((a, l) => a + l.tons, 0);
    bulk.innerHTML = ungradedIds.length
      ? `<div class="field hint" style="margin:8px 0 4px">${ungradedIds.length} load${ungradedIds.length === 1 ? ' has' : 's have'} no grade (${num(ungradedTons, 1)} t). Give them all one in a single step:</div>
         <div style="display:flex;gap:6px"><input type="text" id="lay-bulk-grade" list="lay-grades" placeholder="Grade, e.g. APH1" value="${esc(typed)}" />
         <button type="button" class="btn secondary small" id="lay-bulk-go" style="flex:none">Set all</button></div>`
      : '';

    // each sample labelled with where it sits in the silo, from the bottom
    const rows = [...rowsEl.querySelectorAll('[data-lay]')];
    let from = 0;
    rows.forEach((row, i) => {
      const t = Number(row.querySelector('.lay-tons').value) || 0;
      const to = from + (t > 0 ? t : 0);
      const tag = row.querySelector('.lay-tag');
      tag.textContent = t > 0 ? `${num(from, 0)}\u2013${num(to, 0)} t from the ${isBunker ? 'back' : 'bottom'}${from >= contents - 1e-6 ? ` \u2014 more than is in the ${isBunker ? 'bunker' : 'silo'}, ignored` : ''}` : '';
      from = to;
      row.querySelector('.lay-up').disabled = i === 0;
      row.querySelector('.lay-down').disabled = i === rows.length - 1;
    });
    const covered = cleanBands(readLayerRows(root)).reduce((a, b) => a + b.tons, 0);
    root.querySelector('#lay-total').textContent = covered > 0
      ? `These sections cover ${num(Math.min(covered, contents), 1)} t of the ${num(contents, 1)} t in the silo${contents - covered > 0.05 ? `; the top ${num(contents - covered, 1)} t keeps the grade of the loads it came from.` : '.'}`
      : 'No sections set: each load and the opening stock keep their own grade.';
    drawPlan();
  };

  const truckCard = (pl, title, whole = false) => {
    const mix = pl.grades.map((g) => `${esc(g.grade || 'No grade')} ${Math.round(g.pct * 100)}%`).join(' · ');
    const lines = SPECS.map((sp) => {
      const v = pl.specs[sp.key];
      if (!v) return '';
      const range = Math.abs(v.max - v.min) > 1e-9 ? ` (${num(v.min, sp.dp)}–${num(v.max, sp.dp)})` : '';
      const partial = v.coverage < 0.995 ? ` <span class="meta">from ${Math.round(v.coverage * 100)}% of the load</span>` : '';
      return `<div class="row"><span class="label">${sp.label}</span><span class="value">${num(v.avg, sp.dp)} ${sp.unit}${range}${partial}</span></div>`;
    }).join('');
    const from = [...new Set(pl.segments.map((sg) => (sg.layer.source === 'opening' ? 'opening stock' : `#${sg.layer.ticketNo ?? '?'}`)
      + (sg.layer.banded ? ` (section ${sg.layer.banded})` : '')))].join(', ');
    return `<div class="card${whole ? ' whole-outload' : ''}" style="margin:8px 0">
      <h2 style="margin-bottom:4px">${title}</h2>
      <div class="meta">${mix || 'No grade recorded'}</div>
      <div class="meta" style="margin-bottom:6px">From ${esc(from)}</div>
      ${lines || '<div class="field hint">No quality recorded on these loads.</div>'}
    </div>`;
  };
  const drawPlan = () => {
    const total = Number(root.querySelector('#op-total').value) || 0;
    const size = Number(root.querySelector('#op-truck').value) || 36;
    if (!(total > 0)) { resultEl.innerHTML = ''; return; }
    const plan = predictPlan(layers, total, size, outEnd);
    // The figure for the whole outload — tonne-weighted across every truck — before the
    // trucks one by one. Without it, 90 t in 36 t trucks shows three averages and never the
    // one for the 90 t.
    const wholeCard = plan.trucks.length > 1
      ? truckCard(predictOutload(layers, total, outEnd), `Whole outload · ${num(total - plan.short, 1)} t`, true) + '<div class="subhead">By truck</div>'
      : '';
    resultEl.innerHTML = wholeCard + plan.trucks.map((pl, i) => truckCard(pl, `Truck ${i + 1} · ${num(pl.total, 1)} t`)).join('')
      + (plan.short > 0.05 ? `<div class="field hint" style="color:var(--danger)">Only ${num(total - plan.short, 1)} t is in the storage; ${num(plan.short, 1)} t of that outload has nothing to come from.</div>` : '');
  };

  // Grade one load in place, from the silo, without going to the Movement tab.
  // choosing "Other" for a load's grade reveals the box to type it in
  stackEl.addEventListener('change', (e) => {
    if (!e.target.matches('.le-grade')) return;
    const other = e.target.closest('.le-edit')?.querySelector('.le-grade-other');
    if (!other) return;
    other.style.display = e.target.value === OTHER_GRADE ? 'block' : 'none';
    if (e.target.value === OTHER_GRADE) other.focus();
  });
  stackEl.addEventListener('click', (e) => {
    const open = e.target.closest('.le-open');
    const row = e.target.closest('.row');
    if (open && row) {
      const m = db.get().movements.find((x) => x.id === open.dataset.load);
      if (!m) return;
      const nv = (x) => (x === undefined || x === null ? '' : x);
      row.querySelector('.label .meta').outerHTML = `<div class="le-edit" data-load="${esc(m.id)}" style="margin-top:4px">
        <div class="le-grid">
          <div class="lay-f wide"><span class="lay-cap">Grade</span>${sampleGradeHtml(gradeList(), m.grade, { cls: 'le-grade', aria: 'Grade', other: 'le-grade-other' })}</div>
          <div class="lay-f"><span class="lay-cap">Moisture %</span><input type="number" inputmode="decimal" step="0.1" class="le-moisture" aria-label="Moisture" value="${nv(m.moisturePct)}" /></div>
          <div class="lay-f"><span class="lay-cap">Protein %</span><input type="number" inputmode="decimal" step="0.1" class="le-protein" aria-label="Protein" value="${nv(m.proteinPct)}" /></div>
          <div class="lay-f"><span class="lay-cap">Screenings %</span><input type="number" inputmode="decimal" step="0.1" class="le-screenings" aria-label="Screenings" value="${nv(m.screeningsPct)}" /></div>
          <div class="lay-f"><span class="lay-cap">Test weight kg/hL</span><input type="number" inputmode="decimal" step="0.1" class="le-tw" aria-label="Test weight" value="${nv(m.testWeightKgHl)}" /></div>
          <div class="lay-f"><span class="lay-cap">Falling number</span><input type="number" inputmode="decimal" step="1" class="le-fn" aria-label="Falling number" value="${nv(m.fallingNumber)}" /></div>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="btn small le-save" style="flex:none;min-height:38px">Save</button>
          <button type="button" class="btn secondary small le-cancel" style="flex:none;min-height:38px">Cancel</button></div></div>`;
      open.remove();
      row.querySelector('.le-grade').focus();
      return;
    }
    if (e.target.closest('.le-cancel')) { redraw(); return; }
    const save = e.target.closest('.le-save');
    if (save) {
      const edit = save.closest('.le-edit');
      const num = (sel) => { const v = edit.querySelector(sel).value; return v === '' ? null : Number(v); };
      db.upsertMovement({
        id: edit.dataset.load,
        grade: edit.querySelector('.le-grade').value === OTHER_GRADE ? edit.querySelector('.le-grade-other').value.trim() : edit.querySelector('.le-grade').value,
        proteinPct: num('.le-protein'), moisturePct: num('.le-moisture'), screeningsPct: num('.le-screenings'),
        testWeightKgHl: num('.le-tw'), fallingNumber: num('.le-fn'),
      });
      toast('Load updated');
      redraw();
    }
  });
  root.querySelector('#lay-bulk').addEventListener('click', async (e) => {
    if (!e.target.closest('#lay-bulk-go')) return;
    const input = root.querySelector('#lay-bulk-grade');
    const grade = input.value.trim();
    if (!grade) { input.focus(); return; }
    const ids = [...ungradedIds];
    const ok = await askConfirm(`Set the grade of ${ids.length} load${ids.length === 1 ? '' : 's'} to ${grade}?\n\nThis changes the loads themselves (on the Movement tab), not just this silo.`, { confirmLabel: 'Set grade' });
    if (!ok) return;
    for (const id of ids) db.upsertMovement({ id, grade });
    toast(`${ids.length} load${ids.length === 1 ? '' : 's'} set to ${grade}`);
    redraw();
  });

  root.querySelector('#lay-end')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-end]');
    if (!b || b.dataset.end === outEnd) return;
    outEnd = b.dataset.end;
    root.querySelectorAll('#lay-end button').forEach((x) => x.classList.toggle('active', x === b));
    redraw();
    drawPlan();
  });
  rowsEl.addEventListener('input', redraw);
  // choosing "Other" for a grade reveals the box to type it in
  rowsEl.addEventListener('change', (e) => {
    if (!e.target.matches('.lay-grade')) return;
    const other = e.target.closest('[data-lay]')?.querySelector('.lay-grade-other');
    if (!other) return;
    other.style.display = e.target.value === OTHER_GRADE ? 'block' : 'none';
    if (e.target.value === OTHER_GRADE) other.focus();
  });
  rowsEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-lay]');
    if (!row) return;
    if (e.target.closest('.lay-del')) row.remove();
    else if (e.target.closest('.lay-up') && row.previousElementSibling) row.previousElementSibling.before(row);
    else if (e.target.closest('.lay-down') && row.nextElementSibling) row.nextElementSibling.after(row);
    else return;
    redraw();
  });
  // The next sample starts where the last ended; the tonnes left over are filled in to save typing.
  root.querySelector('#lay-add').addEventListener('click', () => {
    const covered = cleanBands(readLayerRows(root)).reduce((a, b) => a + b.tons, 0);
    const left = Math.max(0, Math.round((contents - covered) * 10) / 10);
    rowsEl.insertAdjacentHTML('beforeend', bandRowHtml({ tons: left > 0 ? left : '' }, gradeList()));
    redraw();
    rowsEl.lastElementChild.querySelector('.lay-grade').focus();
  });
  root.querySelector('#op-total').addEventListener('input', drawPlan);
  root.querySelector('#op-truck').addEventListener('input', drawPlan);
  root.querySelector('#lay-asof').addEventListener('change', redraw);
  root.querySelector('#s-capacity')?.addEventListener('input', redraw);
  // the picture's fullness follows the volume, the test weight and what is in it
  for (const id of ['#s-volume', '#s-tw', '#s-commodity']) root.querySelector(id)?.addEventListener('input', redraw);
  root.querySelector('#s-cone')?.addEventListener('input', redraw);          // a silo's picture follows its bottom
  root.querySelector('#s-opening')?.addEventListener('input', redraw);
  redraw();
}

function predictorFold(existing) {
  return `
    <details class="fold">
      <summary><div><h2>Plan an outload</h2>
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

/**
 * What the form says the storage holds when full: its volume times the test weight of the commodity picked (or the test weight typed
 * on the storage), otherwise the tonnes typed. Falls back to the saved storage for anything the form does not show.
 */
function formCapacity(root, existing) {
  const el = (id) => root.querySelector(id);
  const commodityId = el('#s-commodity') ? el('#s-commodity').value : existing?.commodityId;
  const commodity = db.get().commodities.find((c) => c.id === commodityId) || null;
  const read = (id, fallback) => (el(id) ? Number(el(id).value) || 0 : Number(fallback) || 0);
  const storage = { volumeM3: read('#s-volume', existing?.volumeM3), testWeight: read('#s-tw', existing?.testWeight), capacityTons: read('#s-capacity', existing?.capacityTons) };
  return { ...capacityInfo(storage, commodity), storage, commodity };
}

/** The words under the volume field, and the test weight field showing what it will use unless a figure is typed. */
function paintCapacityLine(root, existing) {
  const line = root.querySelector('#s-cap-line');
  if (!line) return;
  const { storage, commodity } = formCapacity(root, existing);
  const base = capacityLine(storage, commodity, num);
  const ignored = storage.volumeM3 > 0 && storage.capacityTons > 0 && capacityInfo(storage, commodity).source === 'volume'
    ? '. The tonnes typed beside it are not used while there is a volume.' : '';
  line.textContent = base ? base + ignored : '';
  line.hidden = !base;
  // the test weight in use, drawn from the commodity unless one is typed for this storage
  const tw = root.querySelector('#s-tw');
  const twLine = root.querySelector('#s-tw-line');
  if (tw) tw.placeholder = commodity?.testWeight > 0 ? String(commodity.testWeight) : '';
  if (twLine) {
    twLine.textContent = storage.testWeight > 0
      ? `Using ${num(storage.testWeight, 3)} t/m³ set on this storage. Clear it to go back to ${commodity?.testWeight > 0 ? `${commodity.name}'s ${num(commodity.testWeight, 3)}` : 'the commodity\'s'}.`
      : commodity?.testWeight > 0
        ? `Using ${commodity.name}'s ${num(commodity.testWeight, 3)} t/m³ (from Commodities). Type a figure here to use a different one for this storage.`
        : 'Pick the commodity in it and its test weight is used here. Or type one for this storage.';
  }
}

/** The closed "Measure & dimensions" header: the measured total, the level and the capacity, kept current as they are typed. */
function wireMeasureSummary(root) {
  const fold = root.querySelector('#measure-fold');
  const sub = root.querySelector('#measure-sub');
  if (!fold || !sub) return;
  const update = () => {
    const total = root.querySelector('#s-total-preview')?.textContent.trim();
    const cap = formCapacity(root).tons;
    const high = root.querySelector('#s-height');
    const level = Number((high || root.querySelector('#s-length'))?.value) || 0;
    const bits = [];
    if (total && total !== '—') bits.push(`${total} measured`);
    if (level) bits.push(`${num(level, 1)} m ${high ? 'high' : 'filled'}`);
    if (cap) bits.push(`${num(cap, 0)} t capacity`);
    sub.textContent = bits.join(' · ') || 'Set the dimensions and dip the level';
  };
  // after the sheet's own handlers have worked the total out
  fold.addEventListener('input', () => setTimeout(update, 0));
  fold.addEventListener('click', () => setTimeout(update, 0));
  update();
  setTimeout(update, 0);
}

/** The farm or site a storage sits on: typed, with the farms already used on paddocks and storages offered. Shown on the load ticket. */
export function farmNames(state) {
  const names = new Map();
  for (const x of [...(state?.fields || []), ...(state?.storages || [])]) {
    const v = String(x.property || '').trim();
    if (v && !names.has(v.toLowerCase())) names.set(v.toLowerCase(), v);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
function siteField(existing) {
  const options = farmNames(db.get()).map((x) => `<option value="${esc(x)}">`).join('');
  return `<datalist id="dl-sites">${options}</datalist>${field({ label: 'Farm / site', id: 's-property', value: existing?.property, list: 'dl-sites', placeholder: 'e.g. Aralu', hint: 'Where it sits. Shown on the load ticket.' })}`;
}

export function openStorageSheet(existing) {
  const { commodities, movements, storages } = db.get();
  // Suggestions for the grade of a sample of grain in this silo: this commodity's grades if it has one, otherwise
  // every commodity's, and any grade already used on another storage.
  const ownCommodity = commodities.find((c) => c.id === existing?.commodityId);
  const gradesInUse = [...new Set([
    ...(ownCommodity ? gradesFor(ownCommodity.name, ownCommodity.customGrades).map((g) => g.code) : allGradeCodes(commodities)),
    ...storages.map((x) => x.grade).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // the grade dropdown in the quality section, set up each time the form is drawn
  let gradeCtl = null;
  const wireGrade = (root) => {
    gradeCtl = wireGradeField(root, 'q-grade', () => commodities.find((c) => c.id === getVal(root, 's-commodity')));
    root.querySelector('#s-commodity')?.addEventListener('change', () => {
      gradeCtl.refresh();
      // barley takes retention where other grains have oil; a figure already typed stays visible
      const key = extraSpecKey(commodities.find((c) => c.id === getVal(root, 's-commodity'))?.name);
      const oil = root.querySelector('#q-oil-wrap'); const ret = root.querySelector('#q-ret-wrap'); const ffa = root.querySelector('#q-ffa-wrap');
      if (oil) oil.hidden = !(key === 'oilPct' || getVal(root, 'q-oil'));
      if (ffa) ffa.hidden = !(key === 'oilPct' || getVal(root, 'q-ffa'));
      if (ret) ret.hidden = !(key === 'retentionPct' || getVal(root, 'q-ret'));
    });
  };
  const fixedMovementNet = existing ? movementNetForStorage(existing.id, movements) : 0;
  // a storage saved as a silo that is measured like a bunker, or called one, is shown as one (it can be changed below)
  let kind = existing ? (looksLikeBunker(existing) ? 'bunker' : (existing.kind || 'silo')) : 'silo';
  // the fumigation record, kept here so switching between silo and bunker doesn't lose what was added
  let fumigations = [...(existing?.fumigations || [])];

  const body = openSheet(existing ? 'Edit storage' : 'Add storage', (root) => {
    build();

    function build() {
      if (kind === 'tally') { buildTally(); return; }
      root.innerHTML = `
        <div class="segmented" id="s-kind">
          <button data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${kind === 'bunker' ? 'active' : ''}">Bunker / shed</button>
          ${!existing || existing.kind === 'tally' ? `<button data-kind="tally" class="${kind === 'tally' ? 'active' : ''}">Tally</button>` : ''}
        </div>
        ${field({ label: 'Name', id: 's-name', value: existing?.name, placeholder: existing?.kind === 'bunker' || kind === 'bunker' ? 'e.g. Bunker 1' : 'e.g. Silo 12 (155t)' })}
        ${siteField(existing)}
        ${field({ label: 'Commodity currently stored', id: 's-commodity', type: 'select', value: existing?.commodityId, options: commodityOptions(commodities) })}
        ${field({ label: 'Opening / current stock (t)', id: 's-opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0, hint: 'A stocktake baseline — movements adjust from here' })}
        <div class="row"><span class="label"><strong>Tracked stock</strong></span><span class="value" id="s-ledger-preview" style="font-size:20px">—</span></div>
        ${qualityFold(existing, commodities.find((c) => c.id === existing?.commodityId))}
        ${notesField(existing)}
        ${contentsFold(existing, gradesInUse, kind)}
        ${fumigationFold(fumigations)}
        <details class="fold feature" id="measure-fold" ${existing ? '' : 'open'}>
          <summary><div class="feature-head"><h2>Measure &amp; dimensions</h2>
            <div class="sub" id="measure-sub">&nbsp;</div></div></summary>
        ${kind === 'silo' ? `
          <div class="grid-2">
            ${field({ label: 'Radius (m)', id: 's-radius', type: 'number', step: '0.01', value: existing?.radius })}
            ${field({ label: 'Cone angle (°)', id: 's-cone', type: 'number', step: '1', value: existing?.coneAngle ?? 0, hint: '0 = flat bottom' })}
          </div>
          <div class="grid-2">
            ${field({ label: 'Volume (m³, optional)', id: 's-volume', type: 'number', step: '1', value: existing?.volumeM3 || '' })}
            ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          </div>
          <div class="field hint" id="s-cap-line" hidden></div>
          <hr class="sep" />
          ${field({ label: 'Current grain height (m)', id: 's-height', type: 'number', step: '0.01', value: existing?.currentHeight })}
        ` : `
          <div class="grid-2">
            ${field({ label: 'Width (m)', id: 's-width', type: 'number', step: '0.01', value: existing?.width })}
            ${field({ label: 'Volume (m³, optional)', id: 's-volume', type: 'number', step: '1', value: existing?.volumeM3 || '' })}
          </div>
          ${field({ label: 'Capacity (t, optional)', id: 's-capacity', type: 'number', step: '1', value: existing?.capacityTons })}
          <div class="field hint" id="s-cap-line" hidden></div>
          <hr class="sep" />
          ${field({ label: 'Current filled length (m)', id: 's-length', type: 'number', step: '0.01', value: existing?.length, hint: 'How much of the bunker currently has grain in it' })}
          ${field({ label: 'Wall height (m, optional)', id: 's-wall', type: 'number', step: '0.01', value: existing?.wallHeight || '', hint: 'Bunkers and sheds can have walls: the grain is held straight up to the top of them, with the peak on top. Leave blank if it has none' })}
        `}
        ${field({ label: 'Angle of repose override (°, optional)', id: 's-angle', type: 'number', step: '1', value: existing?.angleOfRepose, hint: 'Leave blank to use the commodity default' })}
        ${field({ label: 'Test weight (t/m³, optional)', id: 's-tw', type: 'number', step: '0.001', value: existing?.testWeight })}
        <div class="field hint" id="s-tw-line"></div>
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
        </details>
        ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
        ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete ${kindLabel(existing.kind).toLowerCase()}</button>` : ''}
        <div class="save-bar solo"><button class="btn" id="save">Save</button></div>
      `;
      if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'silo', existing.id, { collapsed: true });
      buildContents(root, existing, kind);
      wireFumigation(root, () => fumigations, (l) => { fumigations = l; });
      wireMeasureSummary(root);

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
      wireGrade(root);

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
          ? bunkerResult({ width: getNum(root, 's-width'), length: getNum(root, 's-length'), angleDeg: angleOfRepose, testWeight, wallHeight: getNum(root, 's-wall') })
          : siloResult({ radius: getNum(root, 's-radius'), height: getNum(root, 's-height'), coneAngle: getNum(root, 's-cone'), angleOfRepose, testWeight, fillState });
        preview.textContent = `${num(r.tons, 1)} t`;
        paintCapacityLine(root, existing);
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
          property: getVal(root, 's-property')?.trim() || '',
          openingStock: getNum(root, 's-opening'),
          capacityTons: getNum(root, 's-capacity') || null,
          volumeM3: getNum(root, 's-volume') || null,
          angleOfRepose: angleOverride ? parseFloat(angleOverride) : null,
          testWeight: twOverride ? parseFloat(twOverride) : null,
          gradeBands: cleanBands(readLayerRows(root)),
          gradeBandsDate: root.querySelector('#lay-asof')?.value || todayLocal(),
          fumigations: fumigationLog(fumigations),
          // only a bunker has an end to choose, and it is sent once chosen (or once it has been set before)
          ...(kind === 'bunker' && (existing?.outloadEnd || existing?.__hasOutloadEnd || (root.querySelector('#lay-end .active')?.dataset.end === 'first')) ? { outloadEnd: root.querySelector('#lay-end .active')?.dataset.end || existing?.outloadEnd || 'last' } : {}),
          ...readQuality(root, gradeCtl),
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
          payload.wallHeight = getNum(root, 's-wall') || null;
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
      // an existing tally counted in tonnes (an earlier load import made some) is grain: it can be made a silo or a bunker, to measure it
      const grainTally = !!existing && existing.kind === 'tally' && !isTransit(existing) && (existing.unitLabel || 't') === 't';
      root.innerHTML = `
        ${grainTally ? `<div class="field hint" style="margin-bottom:8px">Counted in tonnes, with no measurements. Choose Silo or Bunker / shed to measure it.</div>
        <div class="segmented" id="s-kind">
          <button data-kind="silo">Silo</button>
          <button data-kind="bunker">Bunker / shed</button>
          <button data-kind="tally" class="active">Tally</button>
        </div>` : ''}
        ${!existing ? `
        <div class="segmented" id="s-kind">
          <button data-kind="silo" class="${kind === 'silo' ? 'active' : ''}">Silo</button>
          <button data-kind="bunker" class="${kind === 'bunker' ? 'active' : ''}">Bunker / shed</button>
          <button data-kind="tally" class="${kind === 'tally' ? 'active' : ''}">Tally</button>
        </div>` : ''}
        ${field({ label: 'Name', id: 's-name', value: existing?.name, placeholder: 'e.g. SR1 round bales' })}
        ${siteField(existing)}
        ${field({ label: 'Commodity', id: 's-commodity', type: 'select', value: existing?.commodityId, options: commodityOptions(commodities) })}
        ${field({ label: 'Unit', id: 's-unit', value: existing?.unitLabel, placeholder: 'e.g. round bales, bales, t', hint: "Whatever this storage counts — shown next to the tracked stock figure" })}
        ${field({ label: 'Opening / current stock', id: 's-opening', type: 'number', step: '0.01', value: existing?.openingStock ?? 0, hint: 'A stocktake baseline — movements adjust from here' })}
        <div class="row"><span class="label"><strong>Tracked stock</strong></span><span class="value" id="s-ledger-preview" style="font-size:20px">—</span></div>
        ${qualityFold(existing, commodities.find((c) => c.id === existing?.commodityId))}
        ${notesField(existing)}
        ${existing ? predictorFold(existing) : ''}
        ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
        ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:12px">Delete ${kindLabel(existing.kind).toLowerCase()}</button>` : ''}
        <div class="save-bar solo"><button class="btn" id="save">Save</button></div>
      `;
      if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'silo', existing.id, { collapsed: true });
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
      wireGrade(root);

      root.querySelector('#save').addEventListener('click', () => {
        const name = getVal(root, 's-name')?.trim();
        if (!name) { root.querySelector('#s-name').focus(); return; }
        db.upsertStorage({
          ...readQuality(root, gradeCtl),
          notes: getVal(root, 's-notes')?.trim() || '',
          id: existing?.id,
          kind,
          name,
          commodityId: getVal(root, 's-commodity') || null,
          property: getVal(root, 's-property')?.trim() || '',
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
