// The feedlot prototype's screens: Position, Demand, Cattle, Rations,
// Contracts. Everything is worked out by engine.js; this file reads the seed,
// keeps the edits, and paints.
//
// Deliberately standalone for now — its own page, no sign-in, no Supabase.
// The engine is the part worth proving against the spreadsheet first; the
// tables, policies and sync it will need to live inside Grainflow are a step
// of their own, and the engine does not change when they arrive.
//
// Edits are kept in this browser only (localStorage) so a what-if survives a
// reload. "Reset" goes back to the seed.

import { computePosition } from './engine.js?v=98';
import { num, money, esc } from '../fmt.js?v=98';

const STORE_KEY = 'grainflow.feedlot.v1';

// The real Grassdale seed is git-ignored and never deployed (see .gitignore
// and .assetsignore). Where it is present — on the machine that has it — the
// page uses it; everywhere else it falls back to the anonymised demo.
const SOURCES = [
  { url: 'private/feedlot-seed.json', label: 'Grassdale workbook, 5 July 2016' },
  { url: 'demo/feedlot-demo.json', label: 'Demo feedyard (anonymised Grassdale)' },
];

const TABS = [
  { id: 'position', label: 'Position', icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><rect x="2.5" y="13" width="4.8" height="9"/><rect x="9.6" y="6.5" width="4.8" height="15.5"/><rect x="16.7" y="10" width="4.8" height="12"/></svg>' },
  { id: 'demand', label: 'Demand', icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M2 20h20v2H2z M3 17l5-6 4 3 5-7 4 4v3l-4-4-5 7-4-3-5 6z"/></svg>' },
  { id: 'cattle', label: 'Cattle', icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M3 6l3 2h12l3-2v4l-2 1v6h-2v4h-2v-4H9v4H7v-4H5v-6l-2-1z"/></svg>' },
  { id: 'rations', label: 'Rations', icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M2 11h20v2a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z M6 4h2v5H6z M11 2h2v7h-2z M16 4h2v5h-2z"/></svg>' },
  { id: 'contracts', label: 'Contracts', icon: '<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path fill-rule="evenodd" d="M5 2h10l4 4v16H5z M8 9h8v1.6H8z M8 13h8v1.6H8z M8 17h5v1.6H8z"/></svg>' },
];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

let seed = null;       // as loaded, for Reset
let cfg = null;        // as edited
let sourceLabel = '';
let result = null;
let rationProgram = 'SF';
let rationVersion = 0;
let contractCommodity = null;

// --- loading and keeping ---------------------------------------------------

async function loadSeed() {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { cache: 'no-store' });
      if (!res.ok) continue;
      sourceLabel = s.label;
      return await res.json();
    } catch { /* try the next one */ }
  }
  throw new Error('No feedlot seed could be loaded.');
}

function readSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // An edit made against the demo is no use against Grassdale, or back.
    return saved.source === sourceLabel ? saved.cfg : null;
  } catch { return null; }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ source: sourceLabel, cfg })); } catch { /* private mode */ }
}

function recompute() {
  result = computePosition(cfg);
}

function changed() {
  save();
  recompute();
  // Repaint where the person is, rather than jumping them back to the top of
  // a 185-row table after every keystroke.
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

// --- shell -----------------------------------------------------------------

const monthLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dateLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function currentTab() {
  const id = location.hash.replace('#/', '');
  return TABS.some((t) => t.id === id) ? id : 'position';
}

function renderTabbar() {
  const active = currentTab();
  tabbar.innerHTML = TABS.map((t) => `
    <button data-tab="${t.id}" class="${t.id === active ? 'active' : ''}">
      <span class="icon">${t.icon}</span><span>${t.label}</span>
    </button>`).join('');
  tabbar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.tab}`; }));
}

function topbar(title, sub) {
  return `<div class="topbar"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>`;
}

function banner() {
  return `<div class="fl-banner"><strong>${esc(cfg.yard)}</strong> · inventory ${dateLabel(cfg.inventoryDate)} · ${esc(sourceLabel)}</div>`;
}

function warningsCard() {
  if (!result.warnings.length) return '';
  return `<div class="card fl-warn"><h2>Check before relying on these numbers</h2>
    <ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
}

function render() {
  const tab = currentTab();
  ({ position: paintPosition, demand: paintDemand, cattle: paintCattle, rations: paintRations, contracts: paintContracts })[tab]();
  renderTabbar();
}

// --- Position --------------------------------------------------------------

function paintPosition() {
  const m0 = result.months[0];
  // Overdue lots are still in the yard, so they count here even though they
  // have no feeding days left in the forecast.
  const headOnFeed = cfg.lots.reduce((s, l) => s + (l.daysOnFeed >= 0 ? l.head : 0), 0);
  const rows = result.position.filter((p) => p.totalRequirement > 0.5 || p.open > 0);
  const shortest = rows.filter((p) => p.coveredTo && p.open > 0).sort((a, b) => a.daysCovered - b.daysCovered)[0];
  // Nothing bought at all, the plan filling it with budget tonnes. Not the
  // same as running out next week, so it is said separately.
  const budgetOnly = rows.filter((p) => p.open < 0.5 && p.budgeted > 0);

  app.innerHTML = `
    ${topbar('Feed position', 'Ration demand, cover and cost')}
    <div class="view fl-wide">
      ${banner()}
      <div class="stat-grid">
        <div class="stat"><div class="n">${num(headOnFeed, 0)}</div><div class="l">Head on feed</div></div>
        <div class="stat"><div class="n">${num(m0.totalT / m0.days, 0)} t</div><div class="l">Ration per day, ${monthLabel(m0.end)}</div></div>
        <div class="stat"><div class="n">${money(m0.rationCost, 2)}</div><div class="l">Ration cost per tonne as fed</div></div>
        <div class="stat"><div class="n">${money(m0.costPerHeadDay.sfBullock, 2)}</div><div class="l">Feed cost / head / day (SF bullock)</div></div>
      </div>
      ${shortest ? `<div class="card report"><h2><span class="dot report"></span>First to run out: ${esc(shortest.name)}</h2>
        <div class="hint">Inventory and contracts carry it to <strong>${dateLabel(shortest.coveredTo)}</strong>
        — ${num(shortest.daysCovered, 0)} days at the budgeted head on feed.</div>
        ${budgetOnly.length ? `<div class="hint" style="margin-top:6px">Nothing bought yet for ${budgetOnly.map((p) => esc(shortName(p.name))).join(' or ')} — budget lines cover ${num(budgetOnly.reduce((s, p) => s + p.budgeted, 0), 0)} t.</div>` : ''}</div>` : ''}
      ${warningsCard()}
      <div class="card summary">
        <h2><span class="dot summary"></span>Commodity cover</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Commodity</th><th>Use / day</th><th>Open t</th><th>Avg $/t</th><th>Value</th><th>Covered to</th><th>Days</th><th></th></tr></thead>
          <tbody>${rows.map(coverRow).join('')}</tbody>
          <tfoot><tr><td>Total</td><td>${num(rows.reduce((s, p) => s + p.dailyUse, 0), 1)}</td>
            <td>${num(rows.reduce((s, p) => s + p.open, 0), 0)}</td><td></td>
            <td>${money(rows.reduce((s, p) => s + p.value, 0), 0)}</td><td colspan="3"></td></tr></tfoot>
        </table></div>
      </div>
      <div class="card report">
        <h2><span class="dot report"></span>Long / short by month (tonnes)</h2>
        <div class="hint" style="margin-bottom:8px">Bought and budgeted, less what the cattle need. Red is short.</div>
        <div class="table-scroll"><table>
          <thead><tr><th>Commodity</th>${result.months.map((m) => `<th>${monthLabel(m.end)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((p) => `<tr><td>${esc(shortName(p.name))}</td>${result.months.map((m) => {
            const b = m.commodities[p.name].balance;
            return `<td class="${b < -0.5 ? 'fl-neg' : ''}">${Math.abs(b) < 0.5 ? '–' : num(b, 0)}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
}

function coverRow(p) {
  const horizon = result.months.reduce((s, m) => s + m.days, 0);
  const days = p.coversHorizon ? horizon : (p.daysCovered ?? 0);
  const pctBar = Math.min(100, (days / 90) * 100);
  return `<tr>
    <td>${esc(shortName(p.name))}</td>
    <td>${num(p.dailyUse, 1)}</td>
    <td>${num(p.open, 0)}</td>
    <td>${p.open ? money(p.avgPrice, 2) : '–'}</td>
    <td>${p.open ? money(p.value, 0) : '–'}</td>
    <td>${p.open < 0.5 && p.budgeted > 0 ? '<span class="fl-dim">Budget only</span>' : p.coversHorizon ? 'Whole year' : p.coveredTo ? dateLabel(p.coveredTo) : '–'}</td>
    <td class="${days < 30 ? 'fl-neg' : ''}">${num(days, 0)}</td>
    <td><div class="fl-bar ${days < 30 ? 'short' : ''}"><span style="width:${pctBar}%"></span></div></td>
  </tr>`;
}

const shortName = (n) => n.replace(' (Inventory Gain Component Only)', '');

// --- Demand ----------------------------------------------------------------

function paintDemand() {
  const ms = result.months;
  const line = (label, f, dp = 0, cls = '') => `<tr class="${cls}"><td>${label}</td>${ms.map((m, i) => `<td>${f(m, i)}</td>`).join('')}</tr>`;
  const input = (key) => (m, i) => `<input class="fl-cell" type="number" data-month="${i}" data-key="${key}" value="${cfg.months[i][key] ?? 0}">`;
  app.innerHTML = `
    ${topbar('Demand', 'Head on feed and tonnes of ration, by month')}
    <div class="view">
      ${banner()}
      ${warningsCard()}
      <div class="card input">
        <h2><span class="dot input"></span>Budget head on feed</h2>
        <div class="hint" style="margin-bottom:8px">Average head expected in the yard each month. Whatever the lots
          below do not account for is treated as cattle still to be placed, and fed at the bullock rate (or trade, for the trade line).</div>
        <div class="table-scroll"><table>
          <thead><tr><th></th>${ms.map((m) => `<th>${monthLabel(m.end)}</th>`).join('')}</tr></thead>
          <tbody>
            ${line('Short fed total', input('sfTotalHead'))}
            ${line('of which trade', input('sfTradeHead'))}
            ${line('Long fed total', input('lfTotalHead'))}
          </tbody>
        </table></div>
      </div>
      <div class="card report">
        <h2><span class="dot report"></span>Ration demand</h2>
        <div class="table-scroll"><table>
          <thead><tr><th></th>${ms.map((m) => `<th>${monthLabel(m.end)}</th>`).join('')}</tr></thead>
          <tbody>
            ${line('Days', (m) => m.days)}
            ${line('SF head on feed now', (m) => num(m.sfCommittedHead, 0))}
            ${line('SF to be placed', (m) => num(m.sfBullockOpenHead + m.sfTradeHead, 0))}
            ${line('LF head on feed now', (m) => num(m.lfCommittedHead, 0))}
            ${line('LF to be placed', (m) => num(m.lfOpenHead, 0))}
            ${line('<strong>Total head</strong>', (m) => `<strong>${num(m.totalHead, 0)}</strong>`)}
            ${line('As fed, SF bullock kg/hd/d', (m) => num(m.asFed.sfBullock, 2))}
            ${line('As fed, LF kg/hd/d', (m) => num(m.asFed.lf, 2))}
            ${line('SF tonnes', (m) => num(m.sfTotalT, 0))}
            ${line('LF tonnes', (m) => num(m.lfTotalT, 0))}
            ${line('<strong>Total tonnes</strong>', (m) => `<strong>${num(m.totalT, 0)}</strong>`)}
            ${line('Tonnes per day', (m) => num(m.totalT / m.days, 0))}
            ${line('Ration $/t', (m) => money(m.rationCost, 2))}
          </tbody>
        </table></div>
      </div>
      <div class="card summary">
        <h2><span class="dot summary"></span>Requirement by commodity (tonnes)</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Commodity</th>${ms.map((m) => `<th>${monthLabel(m.end)}</th>`).join('')}<th>Year</th></tr></thead>
          <tbody>${cfg.commodities.map((c) => {
            const v = ms.map((m) => m.commodities[c.name].requirement);
            if (v.every((x) => x < 0.5)) return '';
            return `<tr><td>${esc(shortName(c.name))}</td>${v.map((x) => `<td>${num(x, 0)}</td>`).join('')}<td><strong>${num(v.reduce((a, b) => a + b, 0), 0)}</strong></td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
  app.querySelectorAll('input[data-month]').forEach((el) => el.addEventListener('change', () => {
    cfg.months[Number(el.dataset.month)][el.dataset.key] = Number(el.value) || 0;
    changed();
  }));
}

// --- Cattle ----------------------------------------------------------------

function paintCattle() {
  const lots = result.lots;
  const totalHead = cfg.lots.reduce((s, l) => s + l.head, 0);
  app.innerHTML = `
    ${topbar('Cattle on feed', `${cfg.lots.length} lots · ${num(totalHead, 0)} head`)}
    <div class="view">
      ${banner()}
      <div class="card input">
        <h2><span class="dot input"></span>Intake (kg dry matter / head / day)</h2>
        <div class="grid-3">
          <div class="field"><label>Short fed bullock</label><input type="number" step="0.1" data-intake="sfBullock" value="${cfg.intakeDM.sfBullock}"></div>
          <div class="field"><label>Short fed trade</label><input type="number" step="0.1" data-intake="sfTrade" value="${cfg.intakeDM.sfTrade}"></div>
          <div class="field"><label>Long fed</label><input type="number" step="0.1" data-intake="lf" value="${cfg.intakeDM.lf}"></div>
        </div>
        <div class="grid-2">
          <div class="field"><label>Bullock from exit days</label><input type="number" id="bullock-days" value="${cfg.bullockExitDays}">
            <div class="hint">Short fed lots going out at this many days or more eat at the bullock rate.</div></div>
          <div class="field"><label>Long fed classes</label><input type="text" id="lf-classes" value="${esc(cfg.longFedClasses.join(', '))}">
            <div class="hint">Cattle classes fed the long fed ration.</div></div>
        </div>
        <div class="hint">As fed today: bullock ${num(result.asFed.sfBullock, 2)} kg, trade ${num(result.asFed.sfTrade, 2)} kg,
          long fed ${num(result.asFed.lf, 2)} kg — dry matter ÷ the ration's ${num(result.diet.SF.dryMatter * 100, 1)}% / ${num(result.diet.LF.dryMatter * 100, 1)}% DM.</div>
      </div>
      <div class="card report">
        <h2><span class="dot report"></span>Lots</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Lot</th><th>Class</th><th>Prog</th><th>Head</th><th>DOF</th><th>Exit DOF</th><th>kg/hd/d</th><th>Head days left</th><th>Tonnes left</th><th></th></tr></thead>
          <tbody>${lots.map((l, i) => `<tr>
            <td>${esc(l.id)}${l.overdue ? ' <span class="fl-neg">overdue</span>' : ''}</td>
            <td>${esc(l.cattleClass)}</td><td>${l.program}</td>
            <td><input class="fl-cell" type="number" data-lot="${i}" data-key="head" value="${l.head}"></td>
            <td><input class="fl-cell" type="number" data-lot="${i}" data-key="daysOnFeed" value="${l.daysOnFeed}"></td>
            <td><input class="fl-cell" type="number" data-lot="${i}" data-key="exitDays" value="${l.exitDays}"></td>
            <td>${num(l.intake, 2)}</td><td>${num(l.totalHeadDays, 0)}</td><td>${num(l.totalTonnes, 0)}</td>
            <td><button class="link-btn" data-del="${i}" aria-label="Remove lot">✕</button></td>
          </tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td></td><td></td><td>${num(totalHead, 0)}</td><td colspan="3"></td>
            <td>${num(lots.reduce((s, l) => s + l.totalHeadDays, 0), 0)}</td><td>${num(lots.reduce((s, l) => s + l.totalTonnes, 0), 0)}</td><td></td></tr></tfoot>
        </table></div>
        <div class="fl-actions">
          <button class="btn small" id="add-lot">Add lot</button>
          <button class="btn small secondary" id="reset">Reset to seed</button>
        </div>
        <div class="hint" style="margin-top:8px">A negative DOF is a lot not yet placed: −20 arrives in 20 days.</div>
      </div>
    </div>`;

  app.querySelectorAll('[data-intake]').forEach((el) => el.addEventListener('change', () => {
    cfg.intakeDM[el.dataset.intake] = Number(el.value) || 0; changed();
  }));
  app.querySelector('#bullock-days').addEventListener('change', (e) => { cfg.bullockExitDays = Number(e.target.value) || 0; changed(); });
  app.querySelector('#lf-classes').addEventListener('change', (e) => {
    cfg.longFedClasses = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); changed();
  });
  app.querySelectorAll('input[data-lot]').forEach((el) => el.addEventListener('change', () => {
    cfg.lots[Number(el.dataset.lot)][el.dataset.key] = Number(el.value) || 0; changed();
  }));
  app.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => {
    const lot = cfg.lots[Number(el.dataset.del)];
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove lot ${lot.id} (${lot.head} head)?`)) return;
    cfg.lots.splice(Number(el.dataset.del), 1); changed();
  }));
  app.querySelector('#add-lot').addEventListener('click', () => {
    cfg.lots.unshift({ id: `NEW${cfg.lots.length + 1}`, cattleClass: '1 T', inWeight: 0, sex: 'S', daysOnFeed: -7, head: 100, exitDays: 100 });
    changed();
  });
  app.querySelector('#reset').addEventListener('click', () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Throw away every edit and go back to the seed?')) return;
    cfg = structuredClone(seed); changed();
  });
}

// --- Rations ---------------------------------------------------------------

function paintRations() {
  const list = cfg.rations[rationProgram];
  if (rationVersion >= list.length) rationVersion = 0;
  const r = list[rationVersion];
  const avg = result.diets[r.fromMonth || 0][rationProgram];
  const fromLabel = (v) => monthLabel(result.months[v.fromMonth || 0].end);

  app.innerHTML = `
    ${topbar('Rations', 'Stages, inclusions and the average diet')}
    <div class="view">
      ${banner()}
      <div class="segmented" style="margin-bottom:10px">
        <button data-prog="SF" class="${rationProgram === 'SF' ? 'active' : ''}">Short fed</button>
        <button data-prog="LF" class="${rationProgram === 'LF' ? 'active' : ''}">Long fed</button>
      </div>
      <div class="segmented" style="margin-bottom:12px">
        ${list.map((v, i) => `<button data-ver="${i}" class="${i === rationVersion ? 'active' : ''}">From ${fromLabel(v)}</button>`).join('')}
      </div>
      ${warningsCard()}
      <div class="card input">
        <h2><span class="dot input"></span>${esc(r.name)} — from ${fromLabel(r)}</h2>
        <div class="hint" style="margin-bottom:8px">As-fed inclusion in each stage. Tempered grain is entered wet;
          the average below shows it bought dry, with the tempering water on its own line.</div>
        <div class="table-scroll"><table>
          <thead><tr><th>Ingredient</th><th>Shrink / gain</th>${r.stages.map((s) => `<th>${esc(s.name)}</th>`).join('')}<th>Average</th></tr></thead>
          <tbody>
            ${r.ingredients.map((ing) => `<tr><td>${esc(ing)}</td><td>${num((cfg.shrink[ing] || 0) * 100, 1)}%</td>
              ${r.stages.map((s, si) => `<td><input class="fl-cell" type="number" step="0.1" data-stage="${si}" data-ing="${esc(ing)}" value="${+(s.inclusions[ing] * 100).toFixed(3)}"></td>`).join('')}
              <td>${num(avg.inclusion[ing] * 100, 2)}%</td></tr>`).join('')}
            <tr><td>Tempering water</td><td></td>${r.stages.map(() => '<td></td>').join('')}<td>${num(avg.inclusion['Added Water (Inventory Gain Component Only)'] * 100, 2)}%</td></tr>
          </tbody>
          <tfoot>
            <tr><td>Adds to</td><td></td>${r.stages.map((s) => {
              const t = Object.values(s.inclusions).reduce((a, b) => a + b, 0);
              return `<td class="${Math.abs(t - 1) > 1e-6 && s.share ? 'fl-neg' : ''}">${num(t * 100, 1)}%</td>`;
            }).join('')}<td></td></tr>
            <tr><td>Share of feeding</td><td></td>${r.stages.map((s, si) => `<td><input class="fl-cell" type="number" step="0.1" data-share="${si}" value="${+(s.share * 100).toFixed(3)}"></td>`).join('')}<td>${num(r.stages.reduce((t, s) => t + s.share, 0) * 100, 1)}%</td></tr>
            <tr><td>Dry matter</td><td></td>${r.stages.map((s, si) => `<td><input class="fl-cell" type="number" step="0.1" data-dm="${si}" value="${+(s.dryMatter * 100).toFixed(3)}"></td>`).join('')}<td>${num(avg.dryMatter * 100, 2)}%</td></tr>
          </tfoot>
        </table></div>
      </div>
    </div>`;

  app.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', () => { rationProgram = b.dataset.prog; rationVersion = 0; render(); }));
  app.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => { rationVersion = Number(b.dataset.ver); render(); }));
  app.querySelectorAll('[data-ing]').forEach((el) => el.addEventListener('change', () => {
    r.stages[Number(el.dataset.stage)].inclusions[el.dataset.ing] = (Number(el.value) || 0) / 100; changed();
  }));
  app.querySelectorAll('[data-share]').forEach((el) => el.addEventListener('change', () => {
    r.stages[Number(el.dataset.share)].share = (Number(el.value) || 0) / 100; changed();
  }));
  app.querySelectorAll('[data-dm]').forEach((el) => el.addEventListener('change', () => {
    r.stages[Number(el.dataset.dm)].dryMatter = (Number(el.value) || 0) / 100; changed();
  }));
}

// --- Contracts -------------------------------------------------------------

function paintContracts() {
  const withData = cfg.commodities.filter((c) => c.contracts.length);
  if (!contractCommodity || !withData.some((c) => c.name === contractCommodity)) contractCommodity = withData[0]?.name;
  const c = cfg.commodities.find((x) => x.name === contractCommodity);
  const ms = result.months;

  app.innerHTML = `
    ${topbar('Contracts', 'Inventory and purchases, delivered by month')}
    <div class="view">
      ${banner()}
      <div class="field"><select id="pick">${withData.map((x) => `<option ${x.name === contractCommodity ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="card report">
        <h2><span class="dot report"></span>${esc(shortName(c.name))}</h2>
        <div class="table-scroll"><table>
          <thead><tr><th>Contract</th><th>Supplier</th><th>Terms</th>${ms.map((m) => `<th>${monthLabel(m.end)}</th>`).join('')}<th>Total t</th></tr></thead>
          <tbody>${c.contracts.map((k) => `<tr>
            <td>${esc(String(k.ref || ''))}${k.budget ? ' <span class="fl-dim">budget</span>' : ''}</td>
            <td>${esc(k.vendor || '')}</td><td>${esc(String(k.terms || ''))}</td>
            ${ms.map((m, i) => { const d = k.deliveries.find((x) => x.month === i); return `<td>${d ? `${num(d.tonnes, 0)}<br><span class="fl-dim">${money(d.price, 2)}</span>` : ''}</td>`; }).join('')}
            <td><strong>${num(k.deliveries.reduce((s, d) => s + d.tonnes, 0), 0)}</strong></td>
          </tr>`).join('')}</tbody>
          <tfoot>
            <tr><td>Required</td><td></td><td></td>${ms.map((m) => `<td>${num(m.commodities[c.name].requirement, 0)}</td>`).join('')}<td></td></tr>
            <tr><td>Long / short</td><td></td><td></td>${ms.map((m) => { const b = m.commodities[c.name].balance; return `<td class="${b < -0.5 ? 'fl-neg' : ''}">${num(b, 0)}</td>`; }).join('')}<td></td></tr>
            <tr><td>Weighted $/t</td><td></td><td></td>${ms.map((m) => `<td>${m.commodities[c.name].price ? money(m.commodities[c.name].price, 2) : ''}</td>`).join('')}<td></td></tr>
          </tfoot>
        </table></div>
        <div class="hint" style="margin-top:8px">Budget lines are tonnes not yet bought, priced at the expected market, so a short month still has a cost.</div>
      </div>
    </div>`;
  app.querySelector('#pick').addEventListener('change', (e) => { contractCommodity = e.target.value; render(); });
}

// --- start -----------------------------------------------------------------

async function start() {
  app.innerHTML = '<div class="empty">Loading the feed position…</div>';
  try {
    seed = await loadSeed();
  } catch (e) {
    app.innerHTML = `<div class="view"><div class="card"><h2>Could not load</h2><div class="hint">${esc(e.message)}</div></div></div>`;
    return;
  }
  cfg = readSaved() || structuredClone(seed);
  recompute();
  render();
}

window.addEventListener('hashchange', render);
start();
