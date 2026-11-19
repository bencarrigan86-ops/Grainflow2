import { db } from '../storage.js?v=418';
import { ureaFigures, starterFigures, seedFigures, yieldFigures, ureaSummary, starterSummary, seedSummary } from '../fertfigures.js?v=418';
import { groupFieldsByCommodity, fieldUrea, ureaAppliedKgHaFor, fieldUreaForTarget, nitrogenCalc, fieldTons, SEED_BUFFER_PCT, maxYieldFromUrea, UREA_N_PCT, areaShare, productionSummary } from '../derived.js?v=418';
import { fertPdf } from '../fertpdf.js?v=418';
import { seedPdf } from '../seedpdf.js?v=418';
import { yieldPdf } from '../yieldpdf.js?v=418';
import { harvestPdf } from '../harvestpdf.js?v=418';
import { modulesPdf } from '../modulespdf.js?v=418';
import { modulesReport } from '../modulesreport.js?v=418';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=418';
import { num, tons, esc, money, todayLocal, dmy } from '../fmt.js?v=418';
import { field, getVal, getNum } from '../ui.js?v=418';
import { canSeeYield, canOpen, canSeePrices } from '../nav.js?v=418';
import { gmReport } from '../grossmargin.js?v=418';
import { gmPdf } from '../gmpdf.js?v=418';
import { hubGroups, readMode, saveMode, readFavs, saveFavs, toggledFavs, reportTitle, TILE_ICONS } from '../reportshub.js?v=418';
import { openMoneySheet, openMtmSheet, openDeliveriesSheet } from './outstanding.js?v=418';
import { openOptimiserSheet } from './optimiser.js?v=418';
import { openCalculatorSheet } from './calculator.js?v=418';
import { openEofySheet } from './eofy.js?v=418';
import { openPricesSheet } from './prices.js?v=418';
import { openRotationSheet } from './rotation.js?v=418';
import { openAveragesSheet } from './averages.js?v=418';
import { openLoadReportSheet } from './loadreport.js?v=418';
import { openTraceSheet } from './tracereport.js?v=418';
import { openXeroSheet } from './xero.js?v=418';
import { openMapSheet } from './farmmap.js?v=418';
import { openExportCsvSheet } from './settingsexport.js?v=418';
import { sensitivityCard, bindSensitivity } from './sensitivity.js?v=418';
import { harvestReport, siloSpace, roomSplit, roomSummary, pctText } from '../harvest.js?v=418';
import { assumedCommodity, assumableCommodities } from '../storagecapacity.js?v=418';
import { loadSpaceAs, saveSpaceAs, loadHarvestView, saveHarvestView, loadShowDone, saveShowDone } from '../spacefor.js?v=418';

let unsub = null;
let view = null;   // null is the screen of tiles; otherwise the report that is open

export function renderReports(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

/** The sheets a tile opens over this screen; a person closing one is back at the tiles. */
const SHEETS = {
  owed: () => openMoneySheet(),
  mtm: () => openMtmSheet(),
  eofy: () => openEofySheet(),
  prices: () => openPricesSheet(),
  deliveries: () => openDeliveriesSheet(),
  optimiser: () => openOptimiserSheet(),
  calculator: () => openCalculatorSheet(),
  rotation: () => openRotationSheet(),
  averages: () => openAveragesSheet(),
  loads: () => openLoadReportSheet(),
  trace: () => openTraceSheet(),
  xero: () => openXeroSheet(),
  excel: () => openExportCsvSheet(),
  map: () => openMapSheet(),
};

function paint(root) {
  const showYield = canSeeYield(db.getRole());
  const { commodities: cs, fields: fs0, movements: ms0 } = db.get();
  const hasCotton = cs.some((c) => c.unit === 'bale') || fs0.some((f) => (f.modulesPicked || []).length) || ms0.some((m) => m.modules);
  if (view === 'modules' && !hasCotton) view = null;
  if (view === 'gm' && !canSeePrices(db.getRole())) view = null;   // a report made of prices is for those who are shown them
  if (view === 'yield' && !showYield) view = null;   // harvest is for everyone, but shows no tonnes or yields to a role that is not shown them
  if (!view) { paintHub(root, { showYield, hasCotton, hasFields: fs0.length > 0 }); return; }
  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Reports</h1>
        <div class="sub">${esc(reportTitle(view))}</div>
      </div>
    </div>
    <div class="view">
      <div class="reports-bar"><button type="button" class="btn secondary small" id="reports-back">&lsaquo; All reports</button><div class="reports-gap"></div><div id="reports-pdf-slot"></div></div>
      <div id="reports-body" style="margin-top:12px"></div>
    </div>
  `;

  root.querySelector('#reports-back').addEventListener('click', () => { view = null; paint(root); window.scrollTo(0, 0); });

  if (view === 'seed') {
    paintSeed(root);
  } else if (view === 'yield') {
    paintYield(root);
  } else if (view === 'gm') {
    paintGm(root);
  } else if (view === 'modules') {
    paintModules(root);
  } else if (view === 'harvest') {
    paintHarvest(root, showYield);
  } else {
    paintFert(root);
  }
  dockPdf(root);
  if (scrollToRoom) {
    scrollToRoom = false;
    root.querySelector('[data-fold="room"]')?.scrollIntoView({ block: 'start' });
  }
}

// The Silo room tile opens Harvest progress with the room in the silos open and in view
let scrollToRoom = false;

/** The screen of tiles: Simple shows the reports most people open, Full adds the rest. */
function paintHub(root, { showYield, hasCotton, hasFields }) {
  const role = db.getRole();
  const mode = readMode();
  const favs = readFavs();
  const groups = hubGroups({ mode, role, showYield, hasCotton, hasFields, can: (tab) => canOpen(role, tab), favs });
  const full = mode === 'full';
  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Reports</h1>
        <div class="sub">Pick a report</div>
      </div>
    </div>
    <div class="view">
      <div class="rep-mode" id="reports-mode" role="group" aria-label="Reports shown">
        <button type="button" data-mode="simple" class="${mode === 'simple' ? 'active' : ''}">Favourites</button>
        <button type="button" data-mode="full" class="${mode === 'full' ? 'active' : ''}">All</button>
      </div>
      ${groups.map((g) => `<div class="rep-group">${esc(g.title)}</div>
        <div class="rep-tiles">${g.tiles.map((t) => `<div class="rep-cell"><button type="button" class="rep-tile" data-tile="${esc(t.id)}"><svg class="rep-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE_ICONS[t.id] || ''}</svg><span class="rep-name">${esc(t.label)}</span></button>${full ? `<button type="button" class="rep-star ${t.fav ? 'on' : ''}" data-star="${esc(t.id)}" aria-pressed="${t.fav}" aria-label="${t.fav ? 'Take' : 'Put'} ${esc(t.label)} ${t.fav ? 'out of' : 'in'} Simple">${t.fav ? '&#9733;' : '&#9734;'}</button>` : ''}</div>`).join('')}</div>`).join('')}
      ${groups.length === 0 ? '<div class="empty">Nothing starred. Tap All, then the star on the reports you want here.</div>' : ''}
      <div class="rep-foot">${full ? 'Tap a star to make a report a favourite.' : 'More reports, and the stars that choose these, are under All.'}</div>
    </div>
  `;
  root.querySelector('#reports-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    saveMode(btn.dataset.mode);
    paint(root);
  });
  root.querySelectorAll('[data-star]').forEach((el) => el.addEventListener('click', () => {
    saveFavs(toggledFavs(groups, favs, el.dataset.star));
    paint(root);
  }));
  root.querySelectorAll('[data-tile]').forEach((el) => el.addEventListener('click', () => {
    const t = groups.flatMap((g) => g.tiles).find((x) => x.id === el.dataset.tile);
    if (!t) return;
    if (t.kind === 'go') { location.hash = `#/${t.tab}`; return; }
    if (t.kind === 'sheet') { SHEETS[t.id]?.(); return; }
    if (t.id === 'room') { harvestOpen.set('room', true); scrollToRoom = true; }
    view = t.view || t.id;
    window.scrollTo(0, 0);
    paint(root);   // the Silo room tile scrolls itself to the room once it is drawn
  }));
}

/**
 * Each report draws its own Share/Download PDF button at the top of its body. Move it up beside the switcher, so it is
 * not a full-width row of its own on every report. The label is shortened; the full one stays as its title.
 */
function dockPdf(root) {
  const slot = root.querySelector('#reports-pdf-slot');
  const b = root.querySelector('#reports-body button[id$="-pdf"]');
  if (!slot || !b) return;
  b.title = b.textContent.trim();
  b.textContent = 'PDF';
  b.removeAttribute('style');
  b.classList.add('small');
  slot.innerHTML = '';
  slot.appendChild(b);
}

/** The modules report: a summary of where the modules are and what has been ginned, then the grower position as the gin prints it. */

function paintModules(root) {
  const { fields, movements, storages, commodities } = db.get();
  const report = modulesReport({ fields, movements, storages, commodities });
  const s = report.summary;
  const body = root.querySelector('#reports-body');
  if (!report.rows.length) {
    body.innerHTML = `<div class="card report"><h2><span class="dot report"></span>Modules</h2><div class="empty">Nothing yet. Open a cotton paddock in Production and tap + Log modules picked.</div></div>`;
    return;
  }
  body.innerHTML = `
    <button type="button" class="btn secondary" id="modules-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>
    <div class="card report">
      <h2><span class="dot report"></span>Summary</h2>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${num(s.picked, 0)}</div><div class="l">Modules picked</div></div>
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${num(s.inField, 0)}</div><div class="l">Still in the field</div></div>
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${num(s.inYard, 0)}</div><div class="l">At the gin, not ginned</div></div>
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${num(s.ginnedModules, 0)}</div><div class="l">Ginned</div></div>
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${num(s.ginnedBales, 1)}</div><div class="l">Bales ginned</div></div>
        <div class="stat" style="padding:10px 8px"><div class="n" style="font-size:18px">${s.turnoutPct > 0 ? `${num(s.turnoutPct, 1)}%` : '-'}</div><div class="l">Turnout</div></div>
        <div class="stat" style="padding:10px 8px;grid-column:1 / -1"><div class="n" style="font-size:18px">${num(s.expectedBales, 0)}</div><div class="l">Total expected bales</div></div>
      </div>
      <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Total expected bales is the bales ginned plus the modules still in the field and the yard, at their average weight and turnout.</div>
    </div>
    <div class="card report">
      <h2><span class="dot report"></span>Grower position</h2>
      <div class="table-scroll">
        <table class="tight" style="min-width:520px">
          <thead><tr><th>Field</th><th>Ha</th><th>Picked</th><th>In field</th><th>Delivered</th><th>At gin</th><th>Avg kg</th><th>Ginned</th><th>227 kg bales</th><th>Turnout %</th><th>Yield</th></tr></thead>
          <tbody>
            ${report.grower.map((r) => `<tr><td><span class="fname" title="${esc(r.field.name)}">${esc(r.field.name)}</span></td><td>${num(r.ha, 0)}</td><td>${num(r.picked, 0)}</td><td>${num(r.inField, 0)}</td><td>${num(r.moved, 0)}</td><td>${num(r.inYard, 0)}</td><td>${num(r.avgKg, 0)}</td><td>${num(r.ginnedModules, 0)}</td><td>${r.bales > 0 ? num(r.bales, 1) : '-'}</td><td>${r.turnoutPct > 0 ? num(r.turnoutPct, 1) : '-'}</td><td>${r.yieldBalesHa > 0 ? num(r.yieldBalesHa, 1) : '-'}</td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td>${num(report.growerTotals.ha, 0)}</td><td>${num(report.growerTotals.picked, 0)}</td><td>${num(report.growerTotals.inField, 0)}</td><td>${num(report.growerTotals.moved, 0)}</td><td>${num(report.growerTotals.inYard, 0)}</td><td>${num(report.growerTotals.avgKg, 0)}</td><td>${num(report.growerTotals.ginnedModules, 0)}</td><td>${report.growerTotals.bales > 0 ? num(report.growerTotals.bales, 1) : '-'}</td><td>${report.growerTotals.turnoutPct > 0 ? num(report.growerTotals.turnoutPct, 1) : '-'}</td><td>${report.growerTotals.yieldBalesHa > 0 ? num(report.growerTotals.yieldBalesHa, 1) : '-'}</td></tr></tfoot>
        </table>
      </div>
      <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Laid out as the gin's grower position summary, to check against it. Yield is ginned standard bales a hectare, so it grows as the ginning does. Modules come out of the yard in the order they arrived, so a run that mixed paddocks is shared between them by module weight. Slide the table sideways to see every column.</div>
    </div>
    ${report.pending.loads ? `<div class="card report">
      <div class="row" id="modules-pending" style="cursor:pointer"><span class="label">Loads waiting for the weighbridge weight</span><span class="value"><span class="badge warn">${report.pending.loads} · ${num(report.pending.modules, 0)} modules</span></span></div>
    </div>` : ''}`;
  body.querySelector('#modules-pdf')?.addEventListener('click', async () => {
    const season = db.getCurrentYear();
    const bytes = modulesPdf({ report, business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()) });
    const fileName = safeFileName(`Modules ${season} ${dmy(todayLocal())}`);
    if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
    await sharePdf(bytes, fileName, { title: `Modules ${season}` });
  });
  body.querySelector('#modules-pending')?.addEventListener('click', () => { location.hash = '#movement'; });
}

function paintFert(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');

  // The two tools sit at the top, as the Yield tab's sensitivity does, so they are not lost beneath the tables.
  body.innerHTML = `
    ${groups.length === 0 ? '' : `<button type="button" class="btn secondary" id="fert-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>`}
    <details class="fold feature" style="margin-top:0">
      <summary><div class="feature-head"><h2>Nitrogen calculator</h2><div class="sub">Urea needed to reach a target yield</div></div></summary>
      <div id="n-calc-form"></div>
      <div id="n-calc-result"></div>
    </details>
    ${groups.length === 0 ? '' : `
    <div class="card report bare">
      <details class="fold feature" id="fert-sens" style="margin-top:0" ${fertSens.open ? 'open' : ''}>
        <summary><div class="feature-head"><h2>Fert sensitivity</h2><div class="sub">Urea needed if the target yield moves</div></div></summary>
        <div class="hint" style="margin:0 0 10px;font-size:12px;color:var(--text-dim)">See how the urea requirement across a commodity's fields changes as its target yield moves. Fields with their own target yield scale from that, not the commodity default. Doesn't change any saved data.</div>
        <div id="fert-sens-form"></div>
        <div id="fert-sens-table"></div>
      </details>
    </div>`}
    <div class="card report">
      <h2><span class="dot report"></span>Urea</h2>
      ${groups.length === 0 ? '' : `<div class="n-key"><span><i class="sw n"></i>Nitrogen (N)</span><span><i class="sw u"></i>Urea equivalent (N &divide; ${UREA_N_PCT / 100})</span></div>`}
      ${groups.length === 0 ? `<div class="empty">Add fields with urea rates in the Production tab.</div>` : `${groups.length > 1 ? fertSummaryTable(ureaSummary(groups.map((g) => ureaFigures(g, commodities.find((c) => c.id === g.id))))) : ''}${groups.map((g) => ureaTable(g, commodities.find((c) => c.id === g.id))).join('')}`}
    </div>
    <div class="card report">
      <h2><span class="dot report"></span>Starter fertiliser</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields with starter rates in the Production tab.</div>` : `${groups.length > 1 ? fertSummaryTable(starterSummary(groups.map((g) => starterFigures(g)))) : ''}${groups.map((g) => starterTable(g)).join('')}`}
    </div>
  `;
  buildNitrogenCalc(body, commodities);
  body.querySelector('#fert-pdf')?.addEventListener('click', () => exportFertPdf(groups, commodities));
  if (groups.length > 0) buildFertSensitivity(body, groups.filter((g) => g.id), commodities, fields);
}

/** The Fert report as a PDF: the same figures as the tables, shared where the phone can share and downloaded elsewhere. */
async function exportFertPdf(groups, commodities) {
  const season = db.getCurrentYear();
  const bytes = fertPdf(
    { urea: groups.map((g) => ureaFigures(g, commodities.find((c) => c.id === g.id))), starter: groups.map((g) => starterFigures(g)), summary: groups.length > 1 },
    { business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()), ureaNPct: UREA_N_PCT },
  );
  const fileName = safeFileName(`Fertiliser ${season} ${dmy(todayLocal())}`);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Fertiliser ${season}` });
}

// What the panel was last set to, so it survives the page repainting when data changes.
const fertSens = { open: false, commodityId: '', pct: 0 };

/**
 * A what-if for one commodity: flexes its target yield (or, per field, that field's own
 * override) by an adjustment % and recomputes the urea required across every field using it.
 * Reads the commodity's saved target yield and N per tonne from Settings.
 */
function buildFertSensitivity(root, groups, commodities, fields) {
  const formEl = root.querySelector('#fert-sens-form');
  const tableEl = root.querySelector('#fert-sens-table');
  const detailsEl = root.querySelector('#fert-sens');
  if (!formEl || !detailsEl) return;
  detailsEl.addEventListener('toggle', () => { fertSens.open = detailsEl.open; });

  const options = groups.map((g) => ({ value: g.id, label: g.name }));
  if (!options.length) { formEl.innerHTML = '<div class="empty">No fields use a commodity yet.</div>'; return; }
  if (!options.some((o) => o.value === fertSens.commodityId)) fertSens.commodityId = options[0].value;

  formEl.innerHTML = `
    ${field({ label: 'Commodity', id: 'fs-commodity', type: 'select', value: fertSens.commodityId, options })}
    ${field({ label: 'Sensitivity adjustment (%)', id: 'fs-pct', type: 'number', step: '5', value: fertSens.pct, allowNegative: true, hint: "Applied on top of the target yield (or each field's own override)" })}
  `;

  const recompute = () => {
    fertSens.commodityId = getVal(formEl, 'fs-commodity');
    fertSens.pct = getNum(formEl, 'fs-pct');
    const commodity = commodities.find((c) => c.id === fertSens.commodityId);
    const commodityFields = fields.filter((f) => f.commodityId === fertSens.commodityId);
    if (!commodity || commodityFields.length === 0) {
      tableEl.innerHTML = `<div class="empty">No fields use this commodity yet.</div>`;
      return;
    }
    const factor = 1 + fertSens.pct / 100;
    const live = { targetYieldTHa: commodity.targetYieldTHa, nPerTonne: commodity.nPerTonne };

    const rows = commodityFields.map((f) => {
      const base = fieldUreaForTarget(f, live);
      const scenarioYieldTHa = base.targetYieldTHa * factor;
      const { additionalUreaRequired } = nitrogenCalc({ nPerTonne: live.nPerTonne, targetYieldTHa: scenarioYieldTHa, soilTestN: f.soilTestNKgHa });
      const area = Number(f.areaHa) || 0;
      const appliedKgHa = ureaAppliedKgHaFor(f);
      // What the paddock will have once the plan is done: the soil's nitrogen plus all the urea planned (its
      // urea required), and the yield that much nitrogen can carry. The adjustment scales the plan, so +10%
      // is 10% more urea than planned. Urea already on cannot be taken off, so the plan is never counted as
      // less than what is applied. A paddock with nothing in the ground yet still gets a figure.
      const plannedTotalKgHa = Math.max(appliedKgHa, (Number(f.ureaRequiredKgHa) || 0) * Math.max(0, factor));
      const max = maxYieldFromUrea({ nPerTonne: live.nPerTonne, soilTestN: f.soilTestNKgHa, ureaAppliedKgHa: plannedTotalKgHa });
      const reqT = (area * additionalUreaRequired) / 1000;
      return {
        f, area, scenarioYieldTHa, kgHa: additionalUreaRequired, reqT, currentReqT: fieldUrea(f).requiredTons,
        maxYield: max.maxYieldTHa,
        // applied to date, and what the scenario still needs on top of it: rates first, tonnes as the one total
        appliedKgHa,
        leftKgHa: additionalUreaRequired - appliedKgHa,
        leftT: (area * (additionalUreaRequired - appliedKgHa)) / 1000,
      };
    });
    const signed = (n) => `${n >= 0 ? '+' : ''}${num(n, 2)}`;
    const signed0 = (n) => `${n >= 0 ? '+' : ''}${num(n, 0)}`;
    const totalArea = rows.reduce((s, r) => s + r.area, 0);
    // area-weighted, as in the urea report: a big paddock counts for more than a small corner
    const wtd = (key) => (totalArea > 0 ? rows.reduce((s, r) => s + r[key] * r.area, 0) / totalArea : 0);
    const totalReqT = rows.reduce((s, r) => s + r.reqT, 0);
    const totalLeftT = rows.reduce((s, r) => s + r.leftT, 0);
    const totalCurrentT = rows.reduce((s, r) => s + r.currentReqT, 0);
    const delta = totalReqT - totalCurrentT;
    const hasN = Number(live.nPerTonne) > 0;   // without N per tonne there is no yield the nitrogen can carry
    const missing = !hasN || !(Number(live.targetYieldTHa) > 0);

    tableEl.innerHTML = `
      <div class="row"><span class="label">${esc(commodity.name)} in Settings</span><span class="value">${num(live.targetYieldTHa, 1)} t/ha target &middot; ${num(live.nPerTonne, 0)} kg N/t</span></div>
      ${missing ? `<div class="field hint" style="margin:6px 0">Set this commodity's target yield and N required in Settings to get a sensible result.</div>` : ''}
      <div class="hint" style="margin:8px 0 4px;font-size:12px;color:var(--text-dim)">Need, Applied and Left are urea in kg/ha (Left t in tonnes). Diff is the change in tonnes against what is recorded as required. <strong>Calc max</strong> assumes all planned urea is applied, scaled by the adjustment, and shows red when it is below Target.</div>
      <div class="table-scroll tight-wrap">
        <table class="tight wrap-first">
          <thead><tr><th>Field</th><th>Target</th><th>Calc max</th><th>Need</th><th>Applied</th><th>Left</th><th>Left t</th><th>Diff</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.f.name)}</td>
                <td>${num(r.scenarioYieldTHa, 2)}</td>
                <td ${hasN && r.maxYield < r.scenarioYieldTHa ? 'style="color:var(--danger);font-weight:700"' : ''}>${hasN ? num(r.maxYield, 2) : '—'}</td>
                <td>${num(r.kgHa, 0)}</td>
                <td>${num(r.appliedKgHa, 0)}</td>
                <td>${signed0(r.leftKgHa)}</td>
                <td>${signed(r.leftT)}</td>
                <td>${signed(r.reqT - r.currentReqT)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td>Total</td>
            <td>${num(wtd('scenarioYieldTHa'), 2)}</td>
            <td>${hasN ? num(wtd('maxYield'), 2) : '—'}</td>
            <td>${num(wtd('kgHa'), 0)}</td>
            <td>${num(wtd('appliedKgHa'), 0)}</td>
            <td>${signed0(wtd('leftKgHa'))}</td>
            <td>${signed(totalLeftT)}</td>
            <td>${signed(delta)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div class="row" style="margin-top:6px"><span class="label">Vs currently recorded "required"</span><span class="value">${num(totalCurrentT, 2)} t &nbsp; <span class="badge ${delta >= 0 ? 'neg' : 'pos'}">${delta >= 0 ? '+' : ''}${num(delta, 2)} t</span></span></div>
    `;
  };

  formEl.querySelector('#fs-commodity').addEventListener('change', recompute);
  formEl.querySelector('#fs-pct').addEventListener('input', recompute);
  recompute();
}

function commodityOptionsCalc(commodities) {
  return [{ value: '', label: 'None / manual' }, ...commodities.map((c) => ({ value: c.id, label: c.name }))];
}

function buildNitrogenCalc(root, commodities) {
  const formEl = root.querySelector('#n-calc-form');
  const resultEl = root.querySelector('#n-calc-result');

  formEl.innerHTML = `
    ${field({ label: 'Crop (autofills N required)', id: 'n-commodity', type: 'select', options: commodityOptionsCalc(commodities) })}
    <div class="grid-2">
      ${field({ label: 'Target yield (t/ha)', id: 'n-yield', type: 'number', step: '0.1' })}
      ${field({ label: 'Soil test N (kg/ha)', id: 'n-soil', type: 'number', step: '1' })}
    </div>
    ${field({ label: 'N required (kg/t)', id: 'n-per-tonne', type: 'number', step: '1', hint: 'From the crop, or enter your own' })}
  `;
  formEl.querySelector('#n-commodity').addEventListener('change', () => {
    const c = commodities.find((c) => c.id === getVal(formEl, 'n-commodity'));
    if (c) formEl.querySelector('#n-per-tonne').value = c.nPerTonne ?? '';
    recompute();
  });
  formEl.querySelectorAll('input').forEach((el) => el.addEventListener('input', recompute));

  function recompute() {
    const r = nitrogenCalc({
      nPerTonne: getNum(formEl, 'n-per-tonne'),
      targetYieldTHa: getNum(formEl, 'n-yield'),
      soilTestN: getNum(formEl, 'n-soil'),
    });
    resultEl.innerHTML = `
      <hr class="sep" />
      <div class="row"><span class="label">Soil N (urea equivalent)</span><span class="value">${num(r.soilUreaEquivalent, 0)} kg/ha</span></div>
      <div class="row"><span class="label">Urea required for target yield</span><span class="value">${num(r.ureaForTargetYield, 0)} kg/ha</span></div>
      <div class="row"><span class="label"><strong>Additional urea required</strong></span><span class="value" style="font-size:22px">${num(r.additionalUreaRequired, 0)} kg/ha</span></div>
    `;
  }
  recompute();
}

/** The whole farm's urea or starter in one small table: a row for each commodity and a total, so what is left to buy is one glance. */
function fertSummaryTable(sum) {
  const { rows, total } = sum;
  return `
    <div class="group-label"><span>By commodity</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Commodity</th><th>Area</th><th>Req t</th><th>App t</th><th>Left t</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${num(r.area, 1)}</td>
              <td>${num(r.reqT, 2)}</td>
              <td>${num(r.appT, 2)}</td>
              <td>${num(r.leftT, 2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(total.area, 1)}</td>
          <td>${num(total.reqT, 2)}</td>
          <td>${num(total.appT, 2)}</td>
          <td>${num(total.leftT, 2)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

function ureaTable(g, commodity) {
  const { rows, total } = ureaFigures(g, commodity);

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table class="fert">
        <thead><tr><th>Field</th><th>Area</th><th class="n">Soil N kg/ha</th><th class="u">Soil equiv kg/ha</th><th>Target t/ha</th><th class="u">Req kg/ha</th><th class="u">App kg/ha</th><th class="u">Left kg/ha</th><th class="u">Req t</th><th class="u">App t</th><th class="u">Left t</th><th class="n">N avail kg/ha</th><th>Max t/ha</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${num(r.area, 1)}</td>
              <td class="n">${num(r.soilN, 0)}</td>
              <td class="u">${num(r.soilEquiv, 0)}</td>
              <td>${r.targetYield > 0 ? num(r.targetYield, 2) : '—'}</td>
              <td class="u">${num(r.req, 0)}</td>
              <td class="u">${num(r.app, 0)}</td>
              <td class="u">${num(r.left, 0)}</td>
              <td class="u">${num(r.reqT, 2)}</td>
              <td class="u">${num(r.appT, 2)}</td>
              <td class="u">${num(r.leftT, 2)}</td>
              <td class="n">${num(r.nAvail, 0)}</td>
              <td>${r.maxYield > 0 ? num(r.maxYield, 2) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(total.area, 1)}</td>
          <td class="n">${num(total.soilN, 0)}</td>
          <td class="u">${num(total.soilEquiv, 0)}</td>
          <td>${total.targetYield > 0 ? num(total.targetYield, 2) : '—'}</td>
          <td class="u">${num(total.req, 0)}</td>
          <td class="u">${num(total.app, 0)}</td>
          <td class="u">${num(total.left, 0)}</td>
          <td class="u">${num(total.reqT, 2)}</td>
          <td class="u">${num(total.appT, 2)}</td>
          <td class="u">${num(total.leftT, 2)}</td>
          <td class="n">${num(total.nAvail, 0)}</td>
          <td>${total.maxYield > 0 ? num(total.maxYield, 2) : '—'}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

function starterTable(g) {
  const { rows, total } = starterFigures(g);

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Req kg/ha</th><th>App kg/ha</th><th>Left kg/ha</th><th>Req t</th><th>App t</th><th>Left t</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${num(r.area, 1)}</td>
              <td>${num(r.req, 0)}</td>
              <td>${num(r.app, 0)}</td>
              <td>${num(r.left, 0)}</td>
              <td>${num(r.reqT, 2)}</td>
              <td>${num(r.appT, 2)}</td>
              <td>${num(r.leftT, 2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(total.area, 1)}</td>
          <td>${num(total.req, 0)}</td>
          <td>${num(total.app, 0)}</td>
          <td>${num(total.left, 0)}</td>
          <td>${num(total.reqT, 2)}</td>
          <td>${num(total.appT, 2)}</td>
          <td>${num(total.leftT, 2)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

function paintSeed(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');

  body.innerHTML = `
    ${groups.length === 0 ? '' : `<button type="button" class="btn secondary" id="seed-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>`}
    <div class="card report">
      <h2><span class="dot report"></span>Seed</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields with a seed rate in the Production tab.</div>` : seedSummaryTable(seedSummary(groups.map((g) => seedFigures(g)))) + groups.map((g) => seedTable(g)).join('')}
    </div>
  `;
  body.querySelector('#seed-pdf')?.addEventListener('click', () => exportSeedPdf(groups));
}

/** The Seed report as a PDF: the same figures as the tables, shared where the phone can share and downloaded elsewhere. */
async function exportSeedPdf(groups) {
  const season = db.getCurrentYear();
  const bytes = seedPdf(groups.map((g) => seedFigures(g)), { business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()), bufferPct: SEED_BUFFER_PCT });
  const fileName = safeFileName(`Seed ${season} ${dmy(todayLocal())}`);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Seed ${season}` });
}

/**
 * Seed as it is ordered: each commodity with its varieties under it, and the hectares, rate and tonnes for each. Left out when it
 * would only repeat the field tables below: one commodity, one variety.
 */
function seedSummaryTable(commodities) {
  if (commodities.length < 2 && !commodities.some((c) => c.varieties.length > 1)) return '';
  return `
    <div class="group-label"><span>By commodity and variety</span></div>
    <div class="table-scroll">
      <table class="tight">
        <thead><tr><th>Variety</th><th>Area ha</th><th>kg/ha</th><th>Req t</th><th>+${num(SEED_BUFFER_PCT, 0)}% t</th></tr></thead>
        <tbody>
          ${commodities.map((c) => `
            <tr class="sum-head">
              <td>${esc(c.name)}</td>
              <td>${num(c.total.area, 1)}</td>
              <td>${num(c.total.rate, 0)}</td>
              <td>${num(c.total.requiredT, 2)}</td>
              <td>${num(c.total.bufferedT, 2)}</td>
            </tr>${c.varieties.map((v) => `
            <tr>
              <td class="sum-sub">${esc(v.variety)}</td>
              <td>${num(v.area, 1)}</td>
              <td>${num(v.rate, 0)}</td>
              <td>${num(v.requiredT, 2)}</td>
              <td>${num(v.bufferedT, 2)}</td>
            </tr>`).join('')}`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function seedTable(g) {
  const { rows, total } = seedFigures(g);

  return `
    <div class="group-label"><span>${esc(g.name)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Variety</th><th>Area</th><th>Rate kg/ha</th><th>Required t</th><th>+${num(SEED_BUFFER_PCT, 0)}% t</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${esc(r.variety || '—')}</td>
              <td>${num(r.area, 1)}</td>
              <td>${num(r.rate, 0)}</td>
              <td>${num(r.requiredT, 2)}</td>
              <td>${num(r.bufferedT, 2)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td></td>
          <td>${num(total.area, 1)}</td>
          <td>${num(total.rate, 0)}</td>
          <td>${num(total.requiredT, 2)}</td>
          <td>${num(total.bufferedT, 2)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}

// Which folding sections of the harvest report are open, kept while the app is open. Open until closed.
const harvestOpen = new Map();
// Sections that start folded away until opened: the room in the silos. Everything else starts open. A choice made on the screen is kept.
const CLOSED_AT_START = new Set(['room']);
const foldIsOpen = (key) => (harvestOpen.has(key) ? harvestOpen.get(key) !== false : !CLOSED_AT_START.has(key));

// Silos with less room than this are left out of the harvest report: not worth sending a load to. Kept on this device.
const MIN_ROOM_KEY = 'grainflow.harvest.minRoom';
const DEFAULT_MIN_ROOM = 20;
function loadMinRoom() {
  try {
    const raw = localStorage.getItem(MIN_ROOM_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_ROOM;
  } catch { return DEFAULT_MIN_ROOM; }
}
function saveMinRoom(n) { try { localStorage.setItem(MIN_ROOM_KEY, String(n)); } catch { /* the setting just does not stick */ } }

/**
 * Harvest progress: what is in against what is still to come, by commodity and field, and the room left in the silos
 * to take it. "In" is the tonnes carted off the field; "to come" is its estimate less that, until the field is marked
 * finished (see harvest.js). The silos and each commodity's fields fold away.
 */
function paintHarvest(root, showYield = true) {
  const { commodities, fields, storages, movements } = db.get();
  const all = harvestReport(commodities, fields, movements);
  const { seasons } = all;
  // Which part of the year is being looked at: winter crops, summer crops or both. Only offered when the farm has crops in more than one
  // season. A season looked at takes its own figures, its own silos' room and its own paddocks, so what is left to plan for is clear.
  const wanted = loadHarvestView();
  const pick = seasons.length > 1 && seasons.some((s) => s.key === wanted) ? wanted : 'both';
  const scope = pick === 'both' ? null : seasons.find((s) => s.key === pick);
  const groups = scope ? all.groups.filter((g) => scope.ids.includes(g.id)) : all.groups;
  const farm = scope ? scope.totals : all.farm;
  const title = scope ? scope.label : 'Whole farm';
  const minRoom = loadMinRoom();
  const showDone = loadShowDone();
  const assumeOptions = assumableCommodities(commodities, scope ? pick : null);
  const picked = loadSpaceAs(scope ? pick : null);
  const assume = assumedCommodity(commodities, picked, scope ? pick : null);
  const scenario = assumeOptions.find((c) => c.name === picked) || null;   // a crop tried on purpose: every empty silo with a volume is worked out as it
  const space = siloSpace(storages, movements, { minRoom, commodities, assume, scenario, season: scope ? pick : null });
  const picker = seasonPicker(seasons, pick);
  const scopeNote = scope ? ` Silos holding a ${pick === 'winter' ? 'summer' : 'winter'} crop are left out.` : '';
  const body = root.querySelector('#reports-body');
  const t1 = (n) => num(n, 0);
  const split = roomSplit(space, groups, (id) => commodities.find((c) => c.id === id)?.name || 'No commodity');
  const sum = roomSummary(split, space, true);
  const margin = sum.margin;

  if (all.groups.length === 0) {
    body.innerHTML = `<div class="card report"><div class="empty">Add fields in the Production tab.</div></div>`;
    return;
  }
  const nameOf = (id) => commodities.find((c) => c.id === id)?.name || 'No commodity';
  const pdfButton = `<button type="button" class="btn secondary" id="harvest-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>`;
  const wirePdf = () => body.querySelector('#harvest-pdf')?.addEventListener('click', () => exportHarvestPdf({ groups, farm, seasons: scope ? [] : seasons, scopeLabel: scope ? scope.label : '', split, space, minRoom, nameOf, showYield }));
  // what a role that is not shown yields sees: how much ground is cut and what is left, and the room in the silos. A tonne
  // figure beside a hectare figure is a yield, and the estimate and what is still to come are built from yields.
  const haPct = (done, area) => (area > 0 ? `${Math.round((done / area) * 100)}%` : '-');
  const fold = (key, summary, inner) => `
    <details class="fold" data-fold="${key}" style="border-top:none;margin-top:0" ${foldIsOpen(key) ? 'open' : ''}>
      <summary>${summary}</summary>
      ${inner}
    </details>`;
  if (!showYield) { body.innerHTML = pdfButton + picker + harvestNoYieldHtml({ groups, farm, seasons: scope ? [] : seasons, split, space, minRoom, t1, haPct, fold, nameOf, assumeOptions, assume, pick, picked: scenario ? scenario.name : '', title, scopeNote, showDone }); wireHarvest(root, body, showYield); wirePdf(); dockPdf(root); return; }
  body.innerHTML = `
    ${pdfButton}${picker}
    <div class="card report">
      <h2><span class="dot report"></span>${esc(title)}</h2>
      <div class="stat-grid">
        <div class="stat"><div class="n">${t1(farm.inT)} t</div><div class="l">Harvested</div></div>
        <div class="stat"><div class="n">${t1(farm.toComeT)} t</div><div class="l">Still to harvest</div></div>
        <div class="stat"><div class="n">${pctText(farm.pct)}</div><div class="l">Done</div></div>
        <div class="stat"><div class="n">${t1(farm.toGoHa)} ha</div><div class="l">Left to harvest</div></div>
      </div>
      <div class="row" style="margin-top:8px"><span class="label">Paddocks finished</span><span class="value">${farm.doneFields} of ${farm.fields} · ${t1(farm.doneHa)} of ${t1(farm.areaHa)} ha</span></div>
      ${seasonBlock(scope ? [] : seasons, { t1, byHa: false })}
    </div>

    <div class="card report">
      ${fold('room', `<div><h2><span class="dot report"></span>Available storage</h2><div class="sub">${margin >= 0 ? `${t1(margin)} t spare after harvest` : `short ${t1(-margin)} t after harvest`} · ${t1(sum.canTake)} t available storage space${minRoom > 0 ? ` · silos under ${t1(minRoom)} t left out` : ''}</div></div>`, `
      ${minRoomRow(minRoom)}
      ${roomSummaryHtml({ sum, space, assumeOptions, assume, pick, picked: scenario ? scenario.name : '', t1, showYield: true })}
      ${roomBySilo(split, space, { t1, showYield: true })}
      ${space.notCounted.length ? `<div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Not counted: ${space.notCounted.map(esc).join('; ')}. Set the capacity or commodity on the Storage tab to include them.</div>` : ''}
      ${space.tooSmall.count ? `<div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">${space.tooSmall.count} silo${space.tooSmall.count === 1 ? '' : 's'} with under ${t1(minRoom)} t of room left out (${t1(space.tooSmall.room)} t between them).</div>` : ''}
      <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Third-party storage is not counted. An empty silo can take any grain, so it is counted once, here, and not under each commodity.${scopeNote}</div>`)}
    </div>

    ${groups.map((g) => {
      const own = g.id ? space.byCommodity.get(g.id) : null;
      const tc = harvestTotals(g, t1);
      const summary = `<div><h2>${esc(g.name)} <span class="badge ${g.totals.pct >= 1 ? 'pos' : 'muted'}">${pctText(g.totals.pct)} in</span></h2>
        <div class="sub">${t1(g.totals.toComeT)} t still to harvest · ${t1(g.totals.doneHa)} of ${t1(g.totals.areaHa)} ha finished</div></div>`;
      return `
      <div class="card report">
        ${fold('c-' + (g.id || 'none'), summary, `
        <div class="table-scroll tight-wrap">
          <table class="tight wrap-first harvest-cols">
            <colgroup><col style="width:26%"><col style="width:12%"><col style="width:15%"><col style="width:15%"><col style="width:17%"><col style="width:15%"></colgroup>
            <thead><tr><th>Field</th><th>Left ha</th><th>Yield left t/ha</th><th>To come t</th><th>So far t/ha</th><th>Done</th></tr></thead>
            <tbody>
              ${shownRows(g, showDone).map((r) => { const c = harvestCells(r); return `<tr>
                <td><span class="fname" title="${esc(r.field.name)}">${r.done ? '&#10003;&nbsp;' : ''}${esc(r.field.name)}</span>${r.haLeft !== null ? '<div class="meta">part cut</div>' : ''}</td>
                <td>${c.leftHa}</td>
                <td>${c.leftYield}</td>
                <td>${t1(r.toComeT)}</td>
                <td>${c.soFar}</td>
                <td>${r.done ? 'Done' : (r.ahead ? 'Over' : pctText(r.pct))}</td>
              </tr>`; }).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td><td>${tc.leftHa}</td><td>${tc.leftYield}</td><td>${tc.toCome}</td><td>${tc.soFar}</td><td>${pctText(g.totals.pct)}</td>
            </tr></tfoot>
          </table>
        </div>
        ${doneToggle(g, showDone)}
        <div class="row" style="margin-top:6px"><span class="label">Hectares finished</span><span class="value">${t1(g.totals.doneHa)} of ${t1(g.totals.areaHa)} ha</span></div>
        ${g.id ? `<div class="row"><span class="label">Room in its silos (${own ? own.silos : 0})</span><span class="value">${t1(own ? own.room : 0)} t</span></div>` : ''}`)}
      </div>`;
    }).join('')}`;

  wireHarvest(root, body, showYield);
  wirePdf();
  dockPdf(root);
}

/** The Harvest report as a PDF: the report's own figures, with no tonnes for a role that is not shown yields. */
async function exportHarvestPdf({ groups, farm, seasons, scopeLabel, split, space, minRoom, nameOf, showYield }) {
  const season = db.getCurrentYear();
  const bytes = harvestPdf({ groups, farm, seasons, scopeLabel, split, space, minRoom, nameOf, showYield, business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()) });
  const fileName = safeFileName(`Harvest ${season} ${dmy(todayLocal())}`);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Harvest ${season}` });
}

/** Winter, Summer or Both: which crops the harvest report is looking at. Shown only when there is more than one season to choose between. */
function seasonPicker(seasons, pick) {
  const offered = seasons.filter((s) => s.key === 'winter' || s.key === 'summer');
  if (seasons.length < 2 || !offered.length) return '';
  const opts = [...offered.map((s) => ({ key: s.key, label: s.key === 'winter' ? 'Winter' : 'Summer' })), { key: 'both', label: 'Both' }];
  return `<div class="segmented" id="harvest-season" role="group" aria-label="Which crops" style="margin-bottom:12px">${opts.map((o) => `<button type="button" data-hs="${o.key}" class="${pick === o.key ? 'active' : ''}">${o.label}</button>`).join('')}</div>`;
}

/**
 * Harvest progress read by when the crops are cut, so a summer crop still standing does not hide that the winter crops are nearly
 * all in. Only shown when the farm has crops in more than one of the seasons. With `byHa` it is hectares cut, not tonnes (the version
 * of the report with no yields in it).
 */
function seasonBlock(seasons, { t1, byHa }) {
  if (!seasons || seasons.length < 2) return '';
  const rows = seasons.map((s) => {
    const t = s.totals;
    const pct = byHa ? (t.areaHa > 0 ? Math.min(1, t.doneHa / t.areaHa) : 0) : t.pct;
    const what = byHa ? `${t1(t.doneHa)} of ${t1(t.areaHa)} ha cut` : `${t1(t.inT)} of ${t1(t.expectedT)} t in · ${t1(t.doneHa)} of ${t1(t.areaHa)} ha`;
    return `<div class="list-item stack">
      <div class="li-top"><div class="main">${esc(s.label)}</div><div class="main">${pctText(pct)} ${byHa ? 'cut' : 'in'}</div></div>
      <div class="meta">${esc(s.names.join(', '))} · ${what}</div>
      <div class="gauge" role="img" aria-label="${Math.round(pct * 100)} percent"><i style="width:${pct * 100}%"></i></div>
    </div>`;
  }).join('');
  return `<div class="subhead" style="margin-top:12px">By season</div>${rows}`;
}

/**
 * The what-if for the empty silos, in a box so it is not read as another row of figures: which crop to work them out as. "As set on each
 * silo" is the plain answer; picking a crop works every empty silo with a volume out as it (silos with no commodity set always need one, so
 * they use the first crop with a test weight when nothing is picked). Nothing is saved on the silos; the pick is remembered on this phone
 * (spacefor.js). Shown whenever an empty silo has a volume, so plans can be tried without changing the silos.
 */
function spaceAsRow(space, options, assume, pick, picked = '') {
  if (!(space.needsCommodity || space.emptyWithVolume) || !options.length) return '';
  const n = space.emptyWithVolume || space.needsCommodity;
  const fallback = space.needsCommodity && !picked && assume ? ` Silos with no commodity set are worked out as ${esc(assume.name)}.` : '';
  return `<div class="assume-line compact"><label for="space-as">Try empty silos (${n}) as</label><select id="space-as" data-season="${esc(pick)}"><option value="">As set</option>${options.map((c) => `<option value="${esc(c.name)}" ${picked === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><div class="hint">A what-if: empty silos with a volume are worked out as this crop; "As set" uses each silo's own. Nothing is changed on the silos.${fallback}</div></div>`;
}

/** A commodity's paddocks for the table: the ones still being harvested, and the finished ones too when asked for. */
function shownRows(g, showDone) {
  return showDone.has(g.id || 'none') ? g.rows : g.rows.filter((r) => !r.done);
}

/**
 * The figures in a paddock's row that read left to right as a sum: hectares left, the yield expected from them, and (in the next column)
 * the tonnes to come. A paddock not started has all of it left, at its own estimate. A part cut paddock with the hectares left given has
 * those, at their own yield. One with tickets in but no hectares left given has no way to say, so those two are dashes: the tonnes to come
 * are its estimate less the tickets. The yield so far is the tonnes in over the hectares cut (over the whole area when the hectares left are
 * not given).
 */
function harvestCells(r) {
  const dash = '–';
  const started = r.inT > 0;
  let leftHa = dash;
  let leftYield = dash;
  if (r.done) { leftHa = '0'; leftYield = dash; }
  else if (r.haLeft !== null) { leftHa = num(r.haLeft, 0); leftYield = num(r.leftYield, 2); }
  else if (!started) { leftHa = num(r.areaHa, 0); leftYield = num(r.field.yieldTHa, 2); }
  const cutHa = r.haLeft !== null || r.done ? r.doneHa : r.areaHa;
  return { leftHa, leftYield, soFar: started && cutHa > 0 ? num(r.inT / cutHa, 2) : dash };
}

/**
 * The figures of a commodity's Total row that match harvestCells: hectares left and their yield (over the paddocks whose hectares left are
 * known, as the column shows them, so the two read as a sum), tonnes to come (over all of them) and the yield so far.
 */
function harvestTotals(g, t1) {
  const t = g.totals;
  const known = g.rows.filter((r) => !r.done && (r.haLeft !== null || !(r.inT > 0)));
  const leftHa = known.reduce((a, r) => a + (r.haLeft !== null ? r.haLeft : r.areaHa), 0);
  const knownT = known.reduce((a, r) => a + r.toComeT, 0);
  const leftYield = leftHa > 0 ? num(knownT / leftHa, 2) : '–';
  // the same way each row works it: tonnes in over the hectares cut, over the whole area where the hectares left were not given
  const started = g.rows.filter((r) => r.inT > 0);
  const cutHa = started.reduce((acc, r) => acc + (r.haLeft !== null || r.done ? r.doneHa : r.areaHa), 0);
  const soFar = cutHa > 0 ? num(started.reduce((acc, r) => acc + r.inT, 0) / cutHa, 2) : '–';
  return { leftHa: t1(leftHa), leftYield, toCome: t1(t.toComeT), soFar };
}

/** The line under a commodity's table that brings its finished paddocks in or out of sight. They are all still in the Total. */
function doneToggle(g, showDone) {
  const n = g.rows.filter((r) => r.done).length;
  if (!n) return '';
  const shown = showDone.has(g.id || 'none');
  return `<button type="button" class="btn secondary small" data-show-done="${esc(g.id || 'none')}" style="margin-top:6px">${shown ? 'Hide' : 'Show'} ${n} finished paddock${n === 1 ? '' : 's'}</button>`;
}

/** The box that leaves out silos with little room left, at the top of the room section. */
function minRoomRow(minRoom) {
  return `<div class="row" style="margin-bottom:8px"><label class="label" for="min-room">Leave out silos with less room than (t)</label><span class="value"><input id="min-room" type="number" inputmode="decimal" min="0" step="1" value="${minRoom}" style="width:80px;text-align:right" /></span></div>`;
}

/** One silo in the list: its name, the room left in it and how full it is. */
function siloItem(s, t1, note = '') {
  return `<div class="list-item stack">
    <div class="li-top"><div class="main">${esc(s.name)}</div><div class="main">${t1(s.room)} t room</div></div>
    <div class="meta">${note}${t1(s.stock)} of ${t1(s.capacity)} t</div>
    <div class="gauge" role="img" aria-label="${Math.round(s.pct * 100)} percent full"><i style="width:${s.pct * 100}%"></i></div>
  </div>`;
}

/**
 * The silos grouped by what is in them: a heading for each crop (wheat, barley...) with the room in its silos and what is still to come of
 * it, then each of that crop's silos underneath, and the empty silos last. So room in a silo of a crop with nothing left to cut is plain
 * to see, and not mistaken for room for what is coming. With no yields it is hectares left to cut instead of tonnes.
 */
function roomBySilo(split, space, { t1, showYield }) {
  if (!split.rows.length && !split.empty.length) return '';
  const head = (title, right, meta) => `<div class="crop-head"><div class="crop-top"><span class="crop-name">${title}</span>${right}</div>${meta ? `<div class="crop-sub">${meta}</div>` : ''}</div>`;
  const crops = split.rows.map((c) => {
    const left = c.finished ? 'all cut' : (showYield && c.nothingToCome ? 'all in' : (showYield ? `${t1(c.toComeT)} t still to harvest` : `${t1(c.toGoHa)} ha to cut`));
    let badge = '';
    if (showYield && c.short > 0.5) badge = `<span class="badge neg">short ${t1(c.short)} t</span>`;
    else if (c.room > 0.5 && (showYield ? c.nothingToCome : c.finished)) badge = '<span class="badge muted">room not needed</span>';
    else if (showYield && c.unusable > 0.5) badge = `<span class="badge muted">${t1(c.unusable)} t more than needed</span>`;
    const silosText = c.silos ? `${c.silos} silo${c.silos === 1 ? '' : 's'}` : 'no silo holding it';
    // with yields: the space left once what is still to come is in (room less to come); without them, just the room
    const right = showYield
      ? `<span class="crop-space ${c.space >= 0 ? 'pos' : 'neg'}">Space ${signedT(c.space, t1)}</span>`
      : `<span class="crop-space">${t1(c.room)} t room</span>`;
    const meta = showYield ? `Room ${t1(c.room)} t − to come ${t1(c.toComeT)} t · ${silosText} ${badge}` : `${silosText} · ${left} ${badge}`;
    return head(esc(c.name), right, meta) + c.list.map((s) => siloItem(s, t1)).join('');
  }).join('');
  const emptyRoom = split.empty.reduce((a, s) => a + s.room, 0);
  const empties = split.empty.length
    ? head('Empty silos', `<span class="crop-space">${t1(emptyRoom)} t room</span>`, `${split.empty.length} silo${split.empty.length === 1 ? '' : 's'} · take any grain`) + split.empty.map((s) => siloItem(s, t1, s.assumed ? `Worked out as ${esc(space.assumeName)} · ` : '')).join('')
    : '';
  const count = split.rows.reduce((a, c) => a + c.list.length, 0) + split.empty.length;
  return `<details class="fold" data-fold="silos" style="border-top:none;margin-top:8px" ${harvestOpen.get('silos') !== false ? 'open' : ''}>
    <summary><div><h2>Silos by crop</h2><div class="sub">${count} silo${count === 1 ? '' : 's'}, a heading for each crop</div></div></summary>
    ${crops}${empties}
  </details>`;
}

/**
 * The room summary, in the order it is read: what is still to harvest, then the room that can take it (silos of crops still to come, empty
 * silos), the answer, and a grey note for the room that cannot help. See roomSummary() in harvest.js. With no yields there is no tonnage to
 * come, so it is the room that can take what is left to cut.
 */
function roomSummaryHtml({ sum, space, assumeOptions, assume, pick, picked = '', t1, showYield }) {
  const row = (label, value, strong) => `<div class="row"><span class="label">${strong ? `<strong>${label}</strong>` : label}</span><span class="value">${strong ? `<strong>${value}</strong>` : value}</span></div>`;
  const margin = sum.margin;
  const open = showYield ? 'crops still to harvest' : 'crops still to cut';
  return `${showYield ? row('Still to harvest', `${t1(sum.stillT)} t`, true) : ''}
      <div class="subhead" style="margin-top:10px">${showYield ? 'Storage space for what is left to harvest' : 'Storage space for what is left to cut'}</div>
      ${row(`In silos of ${open}${sum.cropSilos ? ` (${sum.cropSilos})` : ''}`, `${t1(sum.cropUsable)} t`)}
      ${row(`In empty silos (${sum.emptyCount}), for any grain`, `${t1(sum.emptyRoom)} t`)}
      ${spaceAsRow(space, assumeOptions, assume, pick, picked)}
      ${row('Available storage space', `${t1(sum.canTake)} t`, true)}
      ${showYield ? `<div class="row"><span class="label"><strong>${margin >= 0 ? 'Room to spare' : 'Short of room by'}</strong></span><span class="value"><span class="badge ${margin >= 0 ? 'pos' : 'neg'}">${t1(Math.abs(margin))} t</span></span></div>` : ''}
      ${sum.unusable > 0.5 ? `<div class="hint" style="margin:6px 0 4px;font-size:12px;color:var(--text-dim)">Another ${t1(sum.unusable)} t of room is in silos of crops with ${showYield ? 'little or nothing left to harvest' : 'every hectare already cut'}, so it can't take what is left unless a silo is emptied. See Silos by crop below.</div>` : ''}`;
}

/** A tonnage with its sign: "+20 t" or "−20 t" (a true minus sign), "0 t" for none. */
function signedT(v, t1) {
  const n = Math.round(Number(v) || 0);
  return n === 0 ? '0 t' : `${n > 0 ? '+' : '−'}${t1(Math.abs(n))} t`;
}

/** The minimum-room box and the folds, for either version of the harvest report. */
function wireHarvest(root, body, showYield) {
  body.querySelector('#min-room')?.addEventListener('change', (e) => {
    const n = Number(e.target.value);
    saveMinRoom(Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_ROOM);
    paintHarvest(root, showYield);
  });

  body.querySelector('#space-as')?.addEventListener('change', (e) => {
    saveSpaceAs(e.target.value, e.target.dataset.season);
    paintHarvest(root, showYield);
  });
  body.querySelectorAll('[data-show-done]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.showDone;
    saveShowDone(key, !loadShowDone().has(key));
    paintHarvest(root, showYield);
  }));
  body.querySelectorAll('[data-hs]').forEach((b) => b.addEventListener('click', () => {
    saveHarvestView(b.dataset.hs);
    paintHarvest(root, showYield);
  }));

  // remember which sections were opened or closed, so a repaint does not undo it
  body.querySelectorAll('details[data-fold]').forEach((d) => d.addEventListener('toggle', () => harvestOpen.set(d.dataset.fold, d.open)));
}

/** Harvest progress with no tonnes, estimates or yields: hectares cut and left, paddocks finished, and the room in the silos. */
function harvestNoYieldHtml({ groups, farm, seasons, split, space, minRoom, t1, haPct, fold, nameOf, assumeOptions, assume, pick, picked = '', title, scopeNote, showDone }) {
  return `
    <div class="card report">
      <h2><span class="dot report"></span>${esc(title)}</h2>
      <div class="stat-grid">
        <div class="stat"><div class="n">${t1(farm.doneHa)} ha</div><div class="l">Cut</div></div>
        <div class="stat"><div class="n">${t1(farm.toGoHa)} ha</div><div class="l">Left to harvest</div></div>
        <div class="stat"><div class="n">${haPct(farm.doneHa, farm.areaHa)}</div><div class="l">Of the area done</div></div>
        <div class="stat"><div class="n">${farm.doneFields} of ${farm.fields}</div><div class="l">Paddocks finished</div></div>
      </div>
      ${seasonBlock(seasons, { t1, byHa: true })}
    </div>

    <div class="card report">
      ${fold('room', `<div><h2><span class="dot report"></span>Available storage</h2><div class="sub">${t1(roomSummary(split, space, false).canTake)} t available storage space${minRoom > 0 ? ` · silos under ${t1(minRoom)} t left out` : ''}</div></div>`, `
      ${minRoomRow(minRoom)}
      ${roomSummaryHtml({ sum: roomSummary(split, space, false), space, assumeOptions, assume, pick, picked, t1, showYield: false })}
      ${roomBySilo(split, space, { t1, showYield: false })}
      <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Third-party storage is not counted. An empty silo can take any grain, so it is counted once, here, and not under each commodity.${scopeNote}</div>`)}
    </div>

    ${groups.map((g) => {
      const summary = `<div><h2>${esc(g.name)} <span class="badge ${g.totals.doneHa >= g.totals.areaHa && g.totals.areaHa > 0 ? 'pos' : 'muted'}">${haPct(g.totals.doneHa, g.totals.areaHa)} cut</span></h2>
        <div class="sub">${t1(g.totals.doneHa)} of ${t1(g.totals.areaHa)} ha finished</div></div>`;
      return `
      <div class="card report">
        ${fold('c-' + (g.id || 'none'), summary, `
        <div class="table-scroll tight-wrap">
          <table class="tight wrap-first">
            <thead><tr><th>Field</th><th>Area ha</th><th>To cut ha</th><th>Done</th></tr></thead>
            <tbody>
              ${shownRows(g, showDone).map((r) => `<tr>
                <td>${r.done ? '&#10003;&nbsp;' : ''}${esc(r.field.name)}</td>
                <td>${t1(r.areaHa)}</td>
                <td>${r.done ? '0' : t1(r.haLeft !== null ? r.haLeft : r.areaHa)}</td>
                <td>${r.done ? 'Done' : haPct(r.doneHa, r.areaHa)}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td><td>${t1(g.totals.areaHa)}</td><td>${t1(g.totals.toGoHa)}</td><td>${haPct(g.totals.doneHa, g.totals.areaHa)}</td>
            </tr></tfoot>
          </table>
        </div>
        ${doneToggle(g, showDone)}`)}
      </div>`;
    }).join('')}`;
}

/**
 * Gross margin: each paddock's yield, the crop's price, and revenue, cost and margin per hectare. The cost box on a paddock is
 * its own figure; empty means the crop's cost spread over its area (shown faintly in the box). See grossmargin.js.
 */
function paintGm(root) {
  const { commodities, fields, sales, movements } = db.get();
  const { groups, total } = gmReport(commodities, fields, sales, movements);
  const canEditCost = ['owner', 'manager'].includes(db.getRole());
  const body = root.querySelector('#reports-body');
  const d0 = (v) => num(v, 0);
  const gm = (v) => `<span style="${v < 0 ? 'color:var(--danger)' : ''}">${d0(v)}</span>`;
  const costCell = (r) => canEditCost
    ? `<input type="number" inputmode="decimal" min="0" step="1" class="gm-cost${r.costIsOverride ? ' set' : ''}" data-field="${esc(r.id)}" value="${r.costIsOverride ? r.costHa : ''}" placeholder="${d0(r.defaultCostHa)}" aria-label="Cost per hectare for ${esc(r.name)}" />`
    : d0(r.costHa);
  body.innerHTML = groups.length === 0 ? '<div class="card report"><div class="empty">Add fields in the Production tab.</div></div>' : `
    <button type="button" class="btn secondary" id="gm-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>
    <div class="hint" style="margin-bottom:8px">Price is the crop's blended price (sold and unsold). Cost is the crop's gross margin cost over its area${canEditCost ? '; type a figure in a paddock to use your own, clear it to go back' : ''}.</div>
    ${groups.map((g) => `<div class="card report">
      <h2><span class="dot report"></span>${esc(g.name)}</h2>
      <div class="table-scroll">
        <table class="tight gm-table">
          <thead><tr><th>Field</th><th>Area</th><th>Yield</th><th>Price</th><th>Rev /ha</th><th>Cost /ha</th><th>GM /ha</th></tr></thead>
          <tbody>${g.fields.map((r) => `<tr><td>${esc(r.name)}</td><td>${num(r.area, 0)}</td><td>${num(r.yieldTHa, 2)}</td><td>${d0(r.price)}</td><td>${d0(r.revenueHa)}</td><td>${costCell(r)}</td><td>${gm(r.gmHa)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td>${num(g.total.area, 0)}</td><td>${num(g.total.yieldTHa, 2)}</td><td>${d0(g.price)}</td><td>${d0(g.total.revenueHa)}</td><td>${d0(g.total.costHa)}</td><td>${gm(g.total.gmHa)}</td></tr></tfoot>
        </table>
      </div>
    </div>`).join('')}
    <div class="card report">
      <div class="row"><span class="label"><strong>Whole farm</strong></span><span class="value">${num(total.area, 0)} ha</span></div>
      <div class="row"><span class="label">Revenue</span><span class="value">${d0(total.revenueHa)} /ha &middot; ${money(total.revenue, 0)}</span></div>
      <div class="row"><span class="label">Cost</span><span class="value">${d0(total.costHa)} /ha &middot; ${money(total.cost, 0)}</span></div>
      <div class="row"><span class="label"><strong>Gross margin</strong></span><span class="value"><strong>${gm(total.gmHa)} /ha &middot; ${money(total.gm, 0)}</strong></span></div>
    </div>`;
  body.querySelector('#gm-pdf')?.addEventListener('click', async () => {
    const season = db.getCurrentYear();
    const bytes = gmPdf({ groups, total }, { business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()) });
    const fileName = safeFileName(`Gross margin ${season} ${dmy(todayLocal())}`);
    if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
    await sharePdf(bytes, fileName, { title: `Gross margin ${season}` });
  });
  body.querySelectorAll('.gm-cost').forEach((el) => el.addEventListener('change', () => {
    const v = el.value.trim();
    const at = window.scrollY;
    db.upsertField({ id: el.dataset.field, gmCostHa: v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v) });
    paintGm(root);
    dockPdf(root);   // the button is redrawn with the report, and its figures have changed
    window.scrollTo(0, at);
  }));
}

/** The summary at the top of the Yield report: the same table as By commodity on the Production tab (area, share of area, yield, tonnes). */
function yieldSummaryCard({ rows, totals }) {
  if (!rows.length) return '';
  return `<div class="card report">
      <h2><span class="dot report"></span>Production summary</h2>
      <div class="table-scroll">
        <table class="tight">
          <thead><tr><th>Commodity</th><th>Area</th><th>% of area</th><th>Yield</th><th>Tons</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.commodity.name)}</td><td>${num(r.area, 0)}</td><td>${areaShare(r.area, totals.area)}</td><td>${num(r.yieldTHa, 2)}</td><td>${num(r.tons, 0)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td>${num(totals.area, 0)}</td><td>${totals.area > 0 ? '100%' : ''}</td><td>${num(totals.yieldTHa, 2)}</td><td>${num(totals.tons, 0)}</td></tr></tfoot>
        </table>
      </div>
    </div>`;
}

function paintYield(root) {
  const { commodities, fields, movements } = db.get();
  const groups = groupFieldsByCommodity(commodities, fields, movements);
  const body = root.querySelector('#reports-body');
  const grandArea = groups.reduce((s, g) => s + g.fields.reduce((s2, f) => s2 + (Number(f.areaHa) || 0), 0), 0);
  const grandTons = groups.reduce((s, g) => s + g.totalTons, 0);
  const grandYieldTHa = grandArea > 0 ? grandTons / grandArea : 0;

  body.innerHTML = `
    ${groups.length > 0 ? `<button type="button" class="btn secondary" id="yield-pdf" style="margin-bottom:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button>` : ''}
    ${groups.length > 0 ? yieldSummaryCard(productionSummary(commodities, fields, movements)) : ''}
    ${groups.length > 0 ? sensitivityCard() : ''}
    <div class="card report">
      <h2><span class="dot report"></span>Yield by commodity, by field</h2>
      ${groups.length === 0 ? `<div class="empty">Add fields in the Production tab.</div>` : groups.map((g) => yieldTable(g, movements)).join('')}
      ${groups.length > 0 ? `
        <hr class="sep" />
        <div class="row"><span class="label"><strong>Whole farm</strong></span><span class="value">${num(grandArea, 1)} ha &middot; ${num(grandYieldTHa, 2)} t/ha &middot; ${tons(grandTons)}</span></div>
      ` : ''}
    </div>
  `;
  bindSensitivity(body);
  body.querySelector('#yield-pdf')?.addEventListener('click', () => exportYieldPdf(groups, movements));
}

/** The Yield report as a PDF: the same figures as the tables, shared where the phone can share and downloaded elsewhere. */
async function exportYieldPdf(groups, movements) {
  const season = db.getCurrentYear();
  const bytes = yieldPdf(groups.map((g) => yieldFigures(g, movements)), { business: db.getBusinessDetails().entityName || '', season, today: dmy(todayLocal()) });
  const fileName = safeFileName(`Yield ${season} ${dmy(todayLocal())}`);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Yield ${season}` });
}

function yieldTable(g, movements) {
  const { rows: figures, total } = yieldFigures(g, movements);
  const rows = figures.map((r, i) => ({ f: g.fields[i], t: r.tons, yieldTHa: r.yieldTHa }));
  const totals = { area: total.area, tons: total.tons };
  const avgYieldTHa = total.yieldTHa;

  return `
    <div class="group-label"><span>${esc(g.name)}</span><span class="n">${tons(totals.tons)}</span></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Field</th><th>Area</th><th>Mode</th><th>Yield t/ha</th><th>Tons</th></tr></thead>
        <tbody>
          ${rows.map(({ f, t, yieldTHa }) => `
            <tr>
              <td>${esc(f.name)}</td>
              <td>${num(f.areaHa, 1)}</td>
              <td><span class="badge ${f.yieldMode === 'actual' || f.yieldMode === 'recorded' ? 'pos' : 'neg'}">${f.yieldMode === 'actual' ? 'Actual' : f.yieldMode === 'recorded' ? 'Recorded' : 'Estimate'}</span></td>
              <td>${num(yieldTHa, 2)}</td>
              <td>${num(t, 1)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>Total</td>
          <td>${num(totals.area, 1)}</td>
          <td></td>
          <td>${num(avgYieldTHa, 2)}</td>
          <td>${num(totals.tons, 1)}</td>
        </tr></tfoot>
      </table>
    </div>
  `;
}
