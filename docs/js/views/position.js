import { db } from '../storage.js?v=496';
import { positionRows, positionTotals, farmProfitLoss } from '../derived.js?v=496';
import { num, tons, money, pct, esc, ha } from '../fmt.js?v=496';
import { payablesCost } from '../payables.js?v=496';
import { commodityClass } from '../commoditycolor.js?v=496';
import { hasCommodityOrder } from '../commodityorder.js?v=496';
import { startProgress, missingLine } from '../helpcontent.js?v=496';
import { openSetupWalk } from './setupwalk.js?v=496';
import { attentionItems } from '../attention.js?v=496';
import { lastBackup } from '../backup.js?v=496';
import { supportWaitingCount } from './support.js?v=496';
import { todayLocal, dmy } from '../fmt.js?v=496';
import { openMoneySheet, openDeliveriesSheet } from './outstanding.js?v=496';
import { openSheet, closeSheet } from '../ui.js?v=496';
import { positionPdf, POSITION_COLUMNS, DEFAULT_COLUMNS, COLUMN_PRESETS } from '../positionpdf.js?v=496';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=496';
import { viewPdf } from '../pdfview.js?v=496';

const TONE = { bad: 'var(--danger)', warn: 'var(--warn)', info: 'var(--accent-input)' };

// Needs attention opens by default and stays as the person left it: shut, it shows how many there are and the worst of them
const ATTN_KEY = 'grainflow.attention.open';
const attentionOpen = () => { try { return localStorage.getItem(ATTN_KEY) !== '0'; } catch { return true; } };

/** The things that need looking at today, a line each; empty when there is nothing. */
function attentionCard() {
  const { invoices, sales, movements } = db.get();
  const items = attentionItems({ role: db.getRole(), today: todayLocal(), invoices, sales, movements, orders: db.getOrders(), payables: db.getPayables(), lastBackup: lastBackup(), supportWaiting });
  if (!items.length) return '';
  const worst = items.some((i) => i.tone === 'bad') ? 'bad' : items.some((i) => i.tone === 'warn') ? 'warn' : 'info';
  return `<div class="card" id="attention-card"><details class="fold" id="attention-fold" ${attentionOpen() ? 'open' : ''}>
        <summary><div><div style="display:flex;align-items:center;gap:8px"><span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:none;background:${TONE[worst]}"></span><h2 style="margin:0">Needs attention &middot; ${items.length}</h2></div><div class="sub" id="attn-sub" ${attentionOpen() ? "hidden" : ""}>${esc(items[0].title)}${items.length > 1 ? ` and ${items.length - 1} more` : ''}</div></div></summary>
        ${items.map((i) => `<div class="list-item" data-attn="${esc(i.action)}" style="cursor:pointer">
          <div style="display:flex;align-items:flex-start;gap:10px"><span aria-hidden="true" style="width:10px;height:10px;border-radius:50%;flex:none;margin-top:6px;background:${TONE[i.tone]}"></span>
            <div><div class="main">${esc(i.title)}</div><div class="meta">${esc(i.detail)}</div></div></div>
        </div>`).join('')}
      </details></div>`;
}

let unsub = null;
let supportWaiting = 0;   // problem reports waiting for the owner's OK (asked when the screen is drawn)

const START_HIDDEN = 'grainflow.start.hidden';
const startHidden = () => { try { return localStorage.getItem(START_HIDDEN) === '1'; } catch { return false; } };

/** The Getting started list: what a new farm still has to set up, ticking itself off as the farm fills in. */
function startCard() {
  if (startHidden()) return '';
  const start = startProgress(db.getRole(), { business: db.getBusinessDetails(), ...db.get() });
  if (!start.steps.length || start.complete) return '';
  return `<div class="card input" id="start-card">
        <h2><span class="dot input"></span>Getting started &middot; ${start.done} of ${start.total}</h2>
        ${start.steps.map((s) => `<div class="list-item" ${s.canOpen ? `data-start-go="${esc(s.route)}" style="cursor:pointer"` : ''}>
          <div style="display:flex;align-items:center;gap:10px"><span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;${s.done ? 'background:var(--accent-summary);color:#fff' : 'border:1.5px solid var(--border)'}">${s.done ? '&#10003;' : ''}</span>
            <div><div class="main" style="${s.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(s.label)}</div><div class="meta">${esc(s.detail)}</div></div></div>
        </div>`).join('')}
        <div class="swipe-actions" style="margin-top:10px">
          <button type="button" class="btn small" id="start-walk">${start.done ? 'Continue setup' : 'Start setup'}</button>
          <button type="button" class="btn secondary small" id="start-help">How-to guide</button>
          <button type="button" class="btn secondary small" id="start-hide">Hide this</button>
        </div>
      </div>`;
}

export function renderPosition(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
  // the owner is told when a report from the farm is waiting for their OK (asked once here, drawn again only if it changed)
  if (db.getRole() === 'owner') {
    supportWaitingCount(db.getFarmId()).then((n) => { if (n !== supportWaiting && root.isConnected) { supportWaiting = n; paint(root); } });
  }
}

function paint(root) {
  const { commodities, fields, sales, movements } = db.get();
  const overheads = db.getOverheads();
  const rows = positionRows(commodities, fields, sales, movements);
  const totals = positionTotals(rows);
  // bills owed: brokerage, freight, storage and the rest come off profit as costs
  const cost = payablesCost(sales, movements, db.getPayables());
  const pl = farmProfitLoss(totals.grossMargin, overheads, totals.openingValue, cost.total);

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Position</h1>
        <div class="sub">Production, sales &amp; unsold at MTM</div>
      </div>
    </div>
    <div class="view">
      ${missingLine(db.getRole(), 'position', db.getBusinessDetails().switches) ? `<div class="field hint" style="margin:0 0 10px">${esc(missingLine(db.getRole(), 'position', db.getBusinessDetails().switches))}</div>` : ''}
      ${attentionCard()}
      ${startCard()}
      ${rows.length ? `<div class="pos-by"><span class="pos-season">${esc(db.getCurrentYear())} season</span><span class="pos-actions"><button type="button" class="pos-display" id="tile-figures" aria-label="Display: choose the figures on the crop tiles" title="Display"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg></button><button type="button" class="btn secondary small pos-pdf" id="position-pdf"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>${canShareFiles() ? 'Share PDF' : 'PDF'}</button></span></div>` : ''}
      ${rows.length ? dashTop(totals) : ''}
      ${rows.length === 0 ? `<div class="empty">Nothing to report yet.<br/>Add a paddock in Production, or a contract in Sales, and your position appears here.</div>` : ''}
      ${rows.length ? `<div class="pos-by"><span>${hasCommodityOrder() ? 'In your order' : 'Biggest first'} &middot; tap a crop for the detail</span></div><div class="pos-tiles">${cropTiles(rows)}</div>` : ''}

      ${rows.length > 0 ? farmSummaryCard(totals, overheads, pl, cost) : ''}
    </div>
  `;
  const bindCrops = () => root.querySelectorAll('[data-crop]').forEach((el) => el.addEventListener('click', () => {
    const r = rows.find((x) => x.commodity.id === el.dataset.crop);
    if (r) openSheet(r.commodity.name, (body) => { body.innerHTML = cropDetail(r); });
  }));
  bindCrops();
  root.querySelector('#tile-figures')?.addEventListener('click', () => openTileSheet(() => { root.querySelector('.pos-tiles').innerHTML = cropTiles(rows); bindCrops(); }));
  root.querySelector('#position-pdf')?.addEventListener('click', () => openPdfSheet({ rows, totals, overheads, pl, cost }));
  root.querySelectorAll('[data-start-go]').forEach((el) => el.addEventListener('click', () => { location.hash = `#/${el.dataset.startGo}`; }));
  root.querySelector('#attention-fold')?.addEventListener('toggle', (e) => { root.querySelector('#attn-sub').hidden = e.target.open; try { localStorage.setItem(ATTN_KEY, e.target.open ? '1' : '0'); } catch { /* opens again next time */ } });
  root.querySelectorAll('[data-attn]').forEach((el) => el.addEventListener('click', () => {
    const go = el.dataset.attn;
    if (go === 'money') openMoneySheet();
    else if (go === 'deliveries') openDeliveriesSheet();
    else if (go === 'settings') location.hash = '#/settings';
  }));
  root.querySelector('#start-walk')?.addEventListener('click', () => openSetupWalk());
  root.querySelector('#start-help')?.addEventListener('click', () => { location.hash = '#/help'; });
  root.querySelector('#start-hide')?.addEventListener('click', () => { try { localStorage.setItem(START_HIDDEN, '1'); } catch { /* shown again next time */ } paint(root); });
}

/** The screen as a PDF, shared from the phone's share sheet or downloaded on a computer. */
const PDF_KEY = 'grainflow.positionpdf';
const readShow = () => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PDF_KEY) || '{}') || {}; } catch { /* the defaults */ }
  const keys = Array.isArray(saved.columns) ? saved.columns.filter((k) => POSITION_COLUMNS.some((c) => c.key === k)) : [];
  return { result: true, overheads: true, ...saved, columns: keys.length ? keys : DEFAULT_COLUMNS };
};
const saveShow = (v) => { try { localStorage.setItem(PDF_KEY, JSON.stringify(v)); } catch { /* not remembered */ } };

/** What goes at the bottom of the PDF: ticks, remembered on this device, then the file. The commodity table is always there. */
function openPdfSheet(data) {
  openSheet('Position PDF', (root) => {
    const d = readShow();
    const tick = (id, on, text) => `<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0 0 12px"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:20px;height:20px;margin-top:1px;flex:none" /><span>${text}</span></label>`;
    const chosen = new Set(d.columns);
    const colTick = (c) => `<label class="pp-col"><input type="checkbox" data-col="${c.key}" ${c.key === 'commodity' || chosen.has(c.key) ? 'checked' : ''} ${c.key === 'commodity' ? 'disabled' : ''} /><span>${esc(c.label)}</span></label>`;
    root.innerHTML = `
      <div class="subhead">Columns</div>
      <div class="chips" style="margin:0 0 8px">${COLUMN_PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>
      <div class="pp-cols">${POSITION_COLUMNS.map(colTick).join('')}</div>
      <div class="subhead" style="margin-top:14px">Under the table</div>
      ${tick('pp-result', d.result, '<strong>Whole farm result</strong><span class="meta" style="display:block">Gross margin, overheads and the profit or loss</span>')}
      ${tick('pp-over', d.overheads, '<strong>Overheads and bills</strong><span class="meta" style="display:block">Each overhead, and the bills taken off profit</span>')}
      <div class="pv-actions"><button type="button" class="btn secondary" id="pp-view">View</button><button type="button" class="btn" id="pp-go">${canShareFiles() ? 'Share PDF' : 'Download PDF'}</button></div>`;
    const setCols = (keys) => root.querySelectorAll('[data-col]').forEach((el) => { el.checked = el.dataset.col === 'commodity' || keys.includes(el.dataset.col); });
    root.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => setCols(COLUMN_PRESETS.find((p) => p.id === el.dataset.preset).keys)));
    const chosenShow = () => {
      const columns = [...root.querySelectorAll('[data-col]:checked')].map((el) => el.dataset.col);
      const show = { result: root.querySelector('#pp-result').checked, overheads: root.querySelector('#pp-over').checked, columns: columns.length > 1 ? columns : DEFAULT_COLUMNS };
      saveShow(show);
      return show;
    };
    root.querySelector('#pp-view').addEventListener('click', () => { const file = makePdf(data, chosenShow()); viewPdf(file.bytes, { title: 'Position', fileName: file.fileName, share: { title: `Position ${file.season}` } }); });
    root.querySelector('#pp-go').addEventListener('click', () => {
      const show = chosenShow();
      closeSheet();
      exportPdf(data, show);
    });
  }, { askBeforeClose: false });
}

/** The PDF for what the sheet has ticked, with the name it is saved or sent under. */
function makePdf(data, show = readShow()) {
  const business = db.getBusinessDetails().entityName || '';
  const season = db.getCurrentYear();
  return { bytes: positionPdf(data, { business, season, today: dmy(todayLocal()), show }), season, fileName: safeFileName(`Position ${season} ${dmy(todayLocal())}`) };
}

async function exportPdf(data, show = readShow()) {
  const { bytes, season, fileName } = makePdf(data, show);
  if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
  await sharePdf(bytes, fileName, { title: `Position ${season}` });
}

/** A ring that fills to the share sold (0 to 1); it takes the colour of the element it sits in. */
function ring(share, size, stroke) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const half = size / 2;
  const dash = Math.min(1, Math.max(0, share)) * c;
  return `<svg class="pos-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${Math.round(share * 100)} percent sold"><circle cx="${half}" cy="${half}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/><circle cx="${half}" cy="${half}" r="${r}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${half} ${half})"/></svg>`;
}

/** The four tiles at the top: crop value, gross margin, how much is sold, and the sold and unsold values. */
function dashTop(totals) {
  const total = totals.soldValue + totals.unsoldValue;
  const soldShare = total > 0 ? totals.soldValue / total : 0;
  const opening = totals.openingValue || 0;
  const openingTons = totals.openingTons || 0;
  return `<div class="pos-dash">
      ${opening ? `<div class="card dash-tile dash-sum">
        <div class="r"><span>Total value</span><span>${money(totals.totalValue + opening, 0)}</span></div>
        <div class="r"><span>Open stock</span><span>(${money(opening, 0)})</span></div>
        <div class="r end"><span>Current crop value</span><span class="n">${money(totals.totalValue, 0)}</span></div></div>` : `<div class="card dash-tile"><div class="l">Total position value</div><div class="n">${money(totals.totalValue, 0)}</div><div class="s">sold plus unsold at MTM</div></div>`}
      ${openingTons > 0 ? `<div class="card dash-tile dash-sum">
        <div class="r"><span>Total volume</span><span>${tons(openingTons + totals.productionTons, 0)}</span></div>
        <div class="r"><span>Open stock</span><span>(${tons(openingTons, 0)})</span></div>
        <div class="r end"><span>Total produced</span><span class="n">${tons(totals.productionTons, 0)}</span></div></div>` : `<div class="card dash-tile"><div class="l">Produced</div><div class="n">${tons(totals.productionTons, 0)}</div>
        ${totals.area > 0 ? `<div class="s">Income ${money(totals.totalValue / totals.area, 0)}/ha</div>` : ''}</div>`}
      <div class="card dash-tile dash-ringtile com-green">${ring(soldShare, 52, 8)}<div class="dash-ringtext"><div class="n">${pct(soldShare)} <span class="s">sold</span></div><div class="s">Sold ${money(totals.soldValue, 0)}</div><div class="s">Unsold ${money(totals.unsoldValue, 0)}</div></div></div>
      <div class="card dash-tile"><div class="l">Gross margin</div><div class="n">${money(totals.grossMargin, 0)}</div>
        <div class="s">${totals.area > 0 ? `${money(totals.grossMargin / totals.area, 0)} per ha` : '&nbsp;'}</div></div>
    </div>`;
}

/** How a crop's quantities are counted: bales for cotton, tonnes for the rest. */
function cropBits(r) {
  const bales = r.commodity.unit === 'bale';
  return { bales, qty: (v) => (bales ? `${num(v, 0)} bales` : tons(v, 0)), per: bales ? 'bale' : 't' };
}

/**
 * The crops: in the order the farm set in Settings when there is one (the rows arrive in it), otherwise biggest value first. A crop with
 * a negative value (stock carried in, valued above today's price) is not pushed to the bottom of a list the owner has ordered.
 */
function cropTiles(rows) {
  const list = hasCommodityOrder() ? rows : [...rows].sort((x, y) => y.totalValue - x.totalValue);
  return list.map((r) => cropTile(r)).join('');
}

/** The figures a crop tile can show, in the order they appear; which ones is each device's own choice (remembered here, not on the farm). */
const dash = '&ndash;';
const TILE_FIELDS = [
  { key: 'produced', label: 'Produced', get: (r, b) => `${b.bales ? num(r.productionTons, 0) : b.qty(r.productionTons)}` },
  { key: 'sold', label: 'Sold', get: (r, b) => `${b.bales ? num(r.soldTons, 0) : b.qty(r.soldTons)}` },
  { key: 'unsold', label: 'Unsold', get: (r, b) => `${b.bales ? num(r.unsoldTons, 0) : b.qty(r.unsoldTons)}` },
  { key: 'area', label: 'Area', get: (r) => (r.area > 0 ? `${num(r.area, 0)} ha` : dash) },
  { key: 'yield', label: 'Yield', get: (r, b) => `${num(r.yieldTHa, 2)}${b.bales ? '' : ' t'}/ha` },
  { key: 'price', label: 'Avg price', get: (r, b) => `${money(r.avgSoldPrice, 0)}/${b.per}` },
  { key: 'margin', label: 'Margin', get: (r) => money(r.grossMargin, 0) },
  { key: 'marginpct', label: 'Margin %', get: (r) => pct(r.grossMarginPct) },
  { key: 'marginha', label: 'Margin /ha', get: (r) => (r.area > 0 ? money(r.grossMargin / r.area, 0) : dash) },
];
const TILE_PRESETS = [
  { id: 'all', label: 'Everything', keys: TILE_FIELDS.map((f) => f.key) },
  { id: 'short', label: 'Short', keys: ['produced', 'sold', 'unsold', 'yield', 'margin'] },
];
const TILE_KEY = 'grainflow.positiontile';
export const tileKeys = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(TILE_KEY) || 'null');
    const keys = Array.isArray(saved) ? saved.filter((k) => TILE_FIELDS.some((f) => f.key === k)) : [];
    if (keys.length) return keys;
  } catch { /* all of them */ }
  return TILE_FIELDS.map((f) => f.key);
};

/** The sheet that picks the figures on the crop tiles: ticks and two presets, remembered on this device. */
function openTileSheet(onDone) {
  openSheet('Display', (root) => {
    const chosen = new Set(tileKeys());
    root.innerHTML = `
      <div class="hint" style="margin:0 0 10px;font-size:12.5px;color:var(--text-dim)">Pick what shows on each crop tile on this device. The crop detail still has every figure.</div>
      <div class="chips" style="margin:0 0 8px">${TILE_PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>
      <div class="pp-cols">${TILE_FIELDS.map((f) => `<label class="pp-col"><input type="checkbox" data-tile="${f.key}" ${chosen.has(f.key) ? 'checked' : ''} /><span>${esc(f.label)}</span></label>`).join('')}</div>`;
    const save = () => {
      let keys = [...root.querySelectorAll('[data-tile]:checked')].map((el) => el.dataset.tile);
      if (!keys.length) { keys = tileKeys(); root.querySelectorAll('[data-tile]').forEach((el) => { el.checked = keys.includes(el.dataset.tile); }); return; }   // at least one stays ticked
      try { localStorage.setItem(TILE_KEY, JSON.stringify(keys)); } catch { /* not remembered */ }
      onDone();
    };
    root.querySelectorAll('[data-tile]').forEach((el) => el.addEventListener('change', save));
    root.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => {
      const keys = TILE_PRESETS.find((p) => p.id === el.dataset.preset).keys;
      root.querySelectorAll('[data-tile]').forEach((c) => { c.checked = keys.includes(c.dataset.tile); });
      save();
    }));
  }, { askBeforeClose: false });
}

/** A crop as a tile: its value and margin, then the ring with the figures this device has picked. Tap it for the detail. */
function cropTile(r) {
  const { bales, qty, per } = cropBits(r);
  const bits = { bales, qty, per };
  const keys = new Set(tileKeys());
  const sold = r.pctSold >= 1 ? 'Sold out' : `${pct(r.pctSold)} sold`;
  return `<button type="button" class="card dash-crop ${commodityClass(r.commodity.name)}" data-crop="${esc(r.commodity.id)}">
      <div class="dc-top"><div><div class="dc-name">${esc(r.commodity.name)}${bales ? ' <small>in bales</small>' : ''}</div><div class="dc-pct">${sold}</div></div>
        <div class="dc-right"><div class="dc-val">${money(r.totalValue, 0)}</div></div></div>
      <div class="dc-body">${ring(r.pctSold, 44, 7)}
        <div class="dc-main">
          <div class="dc-stats">
            ${TILE_FIELDS.filter((f) => keys.has(f.key)).map((f) => `<div><small>${f.label}</small><b>${f.get(r, bits)}</b></div>`).join('')}
          </div></div></div></button>`;
}

function farmSummaryCard(totals, overheads, pl, cost) {
  const plClass = pl.profitLoss >= 0 ? 'pos' : 'neg';
  const oh = (label, v) => `<div class="row"><span class="label">${label}</span><span class="value">${money(v, 0)}</span></div>`;
  return `
    <div class="card summary">
      <h2><span class="dot summary"></span>Whole farm</h2>
      <div class="trio">
        <div class="kv"><div class="l">Gross margin</div><div class="v">${money(totals.grossMargin, 0)}</div></div>
        <div class="kv"><div class="l">Overheads</div><div class="v">${money(pl.overheadsTotal, 0)}</div></div>
        <div class="kv"><div class="l">${pl.profitLoss >= 0 ? 'Profit' : 'Loss'}</div><div class="v"><span class="badge ${plClass}" style="font-size:15px">${money(pl.profitLoss, 0)}</span></div></div>
      </div>
      ${pl.payablesTotal ? `
      <details class="fold" style="margin-top:6px">
        <summary><div><h2>Payables</h2><div class="sub">${money(pl.payablesTotal, 0)} taken off profit: brokerage, freight, storage, other</div></div></summary>
        ${[['Brokerage', cost.brokerage], ['Freight, above or below the contract estimate', cost.freight], ['Storage', cost.storage], ['Other', cost.other]].filter(([, v]) => v).map(([l, v]) => `<div class="row"><span class="label">${l}</span><span class="value">${v < 0 ? '&minus;' : ''}${money(Math.abs(v), 0)}</span></div>`).join('')}
        <div class="row"><span class="label"><strong>Total</strong></span><span class="value"><strong>${money(pl.payablesTotal, 0)}</strong></span></div>
        <div class="hint" style="margin-top:6px;font-size:12px;color:var(--text-dim)">Bills count at their amount before GST, paid or not. Brokerage is each contract's $/t on the tonnes delivered, or the broker's bills if more. A freight bill on a contract replaces its Freight ($/t) estimate for those tonnes, so only the difference shows here.</div>
      </details>` : ''}
      ${pl.openingValue ? `
      <div class="liquidity">
        <div class="row"><span class="label">${pl.profitLoss >= 0 ? 'Profit' : 'Loss'} this season</span><span class="value">${money(pl.profitLoss, 0)}</span></div>
        <div class="row"><span class="label">Plus opening stock value</span><span class="value">+${money(pl.openingValue, 0)}</span></div>
        <div class="row total"><span class="label"><strong>Total incl. opening stock</strong><span class="sub">Profit plus the grain brought in</span></span><span class="value"><span class="badge ${pl.profitWithOpening >= 0 ? 'pos' : 'neg'}" style="font-size:15px">${money(pl.profitWithOpening, 0)}</span></span></div>
      </div>` : ''}
      <details class="fold">
        <summary><div><h2>Overheads</h2><div class="sub">Finance, wages, drawings and the rest</div></div></summary>
        ${oh('Finance', overheads.finance)}${oh('Equipment repayments', overheads.equipmentRepayments)}${oh('Depreciation', overheads.depreciation)}
        ${oh('Wages', overheads.wages)}${oh('Drawings', overheads.drawings)}${oh('Admin', overheads.admin)}
        ${oh('Energy', overheads.energy)}${oh('Insurance', overheads.insurance)}${oh('R&amp;M', overheads.repairsMaintenance)}${oh('Other', overheads.other)}
        ${oh('<strong>Total overheads</strong>', pl.overheadsTotal)}
      </details>
    </div>
  `;
}

/** Cotton's position as three values, shown apart: the lint, the seed, and the ginning that comes off. */
function cottonLines(r) {
  const c = r.cotton;
  if (!c || !(c.seedValue || c.ginningCost)) return '';
  const sub = (t) => `<small style="display:block;font-size:11.5px;color:var(--text-dim);font-weight:400">${t}</small>`;
  const row = (label, note, value) => `<div class="row"><span class="label">${label}${sub(note)}</span><span class="value" style="white-space:nowrap">${value}</span></div>`;
  const est = c.unginnedBales > 0.5 ? `${num(c.unginnedBales, 0)} bales to gin, estimated` : 'From the gin invoices';
  // each as dollars a bale of lint too, so it reads against the lint price
  const perBale = (v) => (c.bales > 0 ? ` · ${money(v / c.bales, 2)}/bale` : '');
  return `
      <div style="margin-top:8px">
      ${row('Cotton (lint)', 'Sold plus unsold at MTM', money(r.soldValue + r.unsoldValue, 0))}
      ${row('Seed', `${num(c.seedT, 1)} t at ${money(c.seedMtm, 0)}/t${perBale(c.seedValue)}`, money(c.seedValue, 0))}
      ${row('Less ginning', `${est}${perBale(c.ginningCost)}`, `&minus;${money(c.ginningCost, 0)}`)}
      </div>`;
}

/** What opens behind a crop's tile: its quantities, prices, value, margin and the full breakdown. */
function cropDetail(r) {
  const { bales, qty, per } = cropBits(r);
  const sold = Math.min(1, Math.max(0, r.pctSold));
  const pctSoldBadge = r.pctSold >= 1
    ? `<span class="badge pos">Sold out</span>`
    : `<span class="badge ${r.pctSold > 0 ? 'pos' : 'muted'}">${pct(r.pctSold)} sold</span>`;
  return `
      <div class="trio">
        <div class="kv"><div class="l">Produced</div><div class="v">${qty(r.productionTons)}</div></div>
        <div class="kv"><div class="l">Sold</div><div class="v">${qty(r.soldTons)}</div></div>
        <div class="kv"><div class="l">Unsold</div><div class="v">${qty(r.unsoldTons)}</div></div>
      </div>
      <div class="trio quad">
        <div class="kv sm"><div class="l">Area</div><div class="v">${num(r.area, 0)} ha</div></div>
        <div class="kv sm"><div class="l">Yield</div><div class="v">${num(r.yieldTHa, 2)} ${bales ? 'bales' : 't'}/ha</div></div>
        <div class="kv sm"><div class="l">Avg sold</div><div class="v">${money(r.avgSoldPrice, 0)}/${per}</div></div>
        <div class="kv sm"><div class="l">MTM</div><div class="v">${money(r.mtmPrice, 0)}/${per}</div></div>
      </div>
      ${r.split ? `<div class="row"><span class="label">Double crop yield<span style="display:block;font-size:11.5px;color:var(--text-dim);font-weight:400">${r.split.double.count} paddock${r.split.double.count === 1 ? '' : 's'} · ${num(r.split.double.area, 0)} ha</span></span><span class="value">${r.split.double.yieldTHa > 0 ? `${num(r.split.double.yieldTHa, 2)} ${bales ? 'bales' : 't'}/ha` : '&ndash;'}</span></div>
      <div class="row"><span class="label">After fallow yield<span style="display:block;font-size:11.5px;color:var(--text-dim);font-weight:400">${r.split.normal.count} paddock${r.split.normal.count === 1 ? '' : 's'} · ${num(r.split.normal.area, 0)} ha</span></span><span class="value">${r.split.normal.yieldTHa > 0 ? `${num(r.split.normal.yieldTHa, 2)} ${bales ? 'bales' : 't'}/ha` : '&ndash;'}</span></div>` : ''}
      <div class="gauge" role="img" aria-label="${Math.round(sold * 100)} percent sold"><i style="width:${sold * 100}%"></i></div>
      ${cottonLines(r)}
      ${r.openingValue ? `
      <div class="row" style="margin-top:8px"><span class="label">Total Value (Sold + MTM)</span><span class="value">${money(r.totalValue + r.openingValue, 0)}</span></div>
      <div class="row"><span class="label">Less opening stock</span><span class="value">&minus;${money(r.openingValue, 0)}</span></div>
      <div class="row"><span class="label"><strong>Current Crop Value</strong></span><span class="value"><strong>${money(r.totalValue, 0)}</strong></span></div>
      ` : `
      <div class="row" style="margin-top:8px"><span class="label">Total position value</span><span class="value">${money(r.totalValue, 0)}</span></div>
      `}
      <div class="row"><span class="label">Gross margin</span><span class="value">${money(r.grossMargin, 0)} <span class="badge ${r.grossMargin >= 0 ? 'pos' : 'neg'}">${pct(r.grossMarginPct)}</span></span></div>
      ${r.area > 0 ? `<div class="row"><span class="label">Income per ha</span><span class="value">${money(r.totalValue / r.area, 0)}/ha</span></div>
      <div class="row"><span class="label">Gross margin per ha</span><span class="value">${money(r.grossMargin / r.area, 0)}/ha</span></div>` : ''}
      <details class="fold" open>
        <summary><div><h2>Full breakdown</h2><div class="sub">Values, stock and costs</div></div></summary>
        ${r.shrinkTons > 0 ? `<div class="row"><span class="label">Shrink in silos<span class="sub">${num(r.commodity.shrinkPct, 2)}% lost going in from the paddock</span></span><span class="value">${qty(r.shrinkTons)}</span></div>` : ''}
        ${r.usedTons > 0 ? `<div class="row"><span class="label">Used on the farm<span class="sub">Out of the stock, not sold</span></span><span class="value">${qty(r.usedTons)}</span></div>` : ''}
        ${r.strawTons > 0 ? `<div class="row"><span class="label">Baled off crop paddocks<span class="sub">On ${ha(r.strawArea, 0)} ha, already counted in the crop's area</span></span><span class="value">${qty(r.strawTons)}</span></div>` : ''}
        <div class="row"><span class="label">Avg sold price</span><span class="value">${money(r.avgSoldPrice, 2)}/${per}</span></div>
        <div class="row"><span class="label">Sold value</span><span class="value">${money(r.soldValue, 0)}</span></div>
        ${r.opening || r.retainedSeed ? `
        <div class="row"><span class="label">Opening stock</span><span class="value">${qty(r.opening)}</span></div>
        ${r.openingValue && r.opening > 0 ? `<div class="row"><span class="label">Opening stock value ($/${per})</span><span class="value">${money(r.openingValue / r.opening, 2)}/${per}</span></div>` : ''}
        <div class="row"><span class="label">Retained seed</span><span class="value">${qty(r.retainedSeed)}</span></div>
        ` : ''}
        <div class="row"><span class="label">MTM price</span><span class="value">${money(r.mtmPrice, 2)}/${per}</span></div>
        <div class="row"><span class="label">Unsold value</span><span class="value">${money(r.unsoldValue, 0)}</span></div>
        ${r.openingValue ? `<div class="row"><span class="label">Less opening stock</span><span class="value">&minus;${money(r.openingValue, 0)}</span></div>` : ''}
        <div class="row"><span class="label">Gross margin cost</span><span class="value">${money(r.grossMarginCost, 0)}</span></div>
      </details>
  `;
}
