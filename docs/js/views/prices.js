// Prices: the weekly price of each commodity, a chart and the last weeks in a table, and the sheet that sets this week's prices.
//
// A week's price is also the price unsold grain is valued at, so setting the week sets the MTM price too. A commodity can carry
// grade spreads (protein spreads on wheat, for example): a $ a tonne above or below its price for each grade, kept week to week
// until they are changed. The arithmetic is in pricehistory.js.

import { db } from '../storage.js?v=479';
import { openSheet, closeSheet, openOver, field, getVal, getNum, toast } from '../ui.js?v=479';
import { esc, money, todayLocal, dmy } from '../fmt.js?v=479';
import {
  seriesByCommodity, weekRows, changeOver, chartPoints, latestEntry, latestSpreads, weekStart, canSetPrices, WHEAT_GRADES, isWheat,
} from '../pricehistory.js?v=479';

let pickName = '';   // the commodity tab, kept while the app is open

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n), 0)}`;
const tone = (n) => (n > 0 ? 'var(--accent-summary)' : n < 0 ? 'var(--danger)' : 'var(--text-dim)');
const spreadText = (list) => list.map((s) => `${esc(s.grade)} ${s.adjust === 0 ? '$0' : signed(s.adjust)}`).join(' &middot; ');

/** The prices screen: a tab for each commodity that has a history. */
export function openPricesSheet() {
  openSheet('Prices', (root) => {
    const draw = () => {
      const years = db.getYears().map((y) => db.getYearData(y)).filter(Boolean);
      // in the order the farm lists its commodities (this season's order), any other after them
      const order = db.get().commodities.map((c) => String(c.name || '').trim().toLowerCase());
      const rank = (n) => { const i = order.indexOf(n.toLowerCase()); return i < 0 ? order.length : i; };
      const list = seriesByCommodity(years).sort((x, y) => rank(x.name) - rank(y.name));
      const canSet = canSetPrices(db.getRole());
      const setButton = canSet ? '<button type="button" class="btn" id="pr-set" style="margin-top:12px">Set this week\'s prices</button>' : '';
      if (list.length === 0) {
        root.innerHTML = `<div class="empty" style="padding:10px 0">No prices recorded yet. ${canSet ? 'Set this week\'s prices and the history starts here: one price a commodity a week.' : 'Prices appear here once the owner or a manager sets them.'}</div>${setButton}`;
        root.querySelector('#pr-set')?.addEventListener('click', () => openOver(openSetPricesSheet, draw));
        return;
      }
      const cur = list.find((x) => x.name === pickName) || list[0];
      pickName = cur.name;
      const last = latestEntry(cur.series);
      const ch = changeOver(cur.series, 4);
      const pts = chartPoints(cur.series, { n: 12, width: 220, height: 90, pad: 8 });
      const rows = weekRows(cur.series, 8);
      const spreads = latestSpreads(cur.series);
      root.innerHTML = `
        ${list.length > 1 ? `<div class="chips" style="margin-bottom:10px">${list.map((x) => `<button type="button" class="chip ${x.name === cur.name ? 'active' : ''}" data-com="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div>` : ''}
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
          <div style="font-size:26px;font-weight:800">${money(last.price, 2).replace(/\.00$/, '')}</div>
          ${ch ? `<div style="font-weight:700;color:${tone(ch.change)}">${signed(ch.change)} on ${ch.weeks} week${ch.weeks === 1 ? '' : 's'}</div>` : ''}
        </div>
        <div class="meta" style="margin-bottom:6px">Week of ${esc(dmy(last.week))}</div>
        ${pts.length >= 2 ? `<svg viewBox="0 0 220 90" width="100%" role="img" aria-label="${esc(cur.name)} price over ${pts.length} weeks" style="display:block;margin:4px 0">
          <line x1="0" y1="8" x2="220" y2="8" stroke="var(--border)" stroke-width="0.5"/><line x1="0" y1="45" x2="220" y2="45" stroke="var(--border)" stroke-width="0.5"/><line x1="0" y1="82" x2="220" y2="82" stroke="var(--border)" stroke-width="0.5"/>
          <polyline fill="none" stroke="var(--accent-summary)" stroke-width="2" stroke-linejoin="round" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>
          <circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="3.5" fill="var(--accent-summary)"/>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim)"><span>${esc(dmy(pts[0].week))}</span><span>${esc(dmy(pts[pts.length - 1].week))}</span></div>` : '<div class="meta" style="margin:8px 0">The chart starts once there are two weeks.</div>'}
        <div class="table-scroll"><table class="tight">
          <thead><tr><th>Week of</th><th>Price</th><th>Change</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(dmy(r.week))}</td><td>${money(r.price, 2).replace(/\.00$/, '')}</td><td style="color:${r.change === null ? 'var(--text-dim)' : tone(r.change)}">${r.change === null ? '-' : signed(r.change)}</td></tr>`).join('')}</tbody>
        </table></div>
        ${spreads.length ? `<div class="meta" style="margin-top:8px"><strong>Spreads</strong> on the price: ${spreadText(spreads)}</div>` : ''}
        ${setButton}`;
      root.querySelectorAll('[data-com]').forEach((b) => b.addEventListener('click', () => { pickName = b.dataset.com; draw(); }));
      root.querySelector('#pr-set')?.addEventListener('click', () => openOver(openSetPricesSheet, draw));
    };
    draw();
  });
}

/** The sheet that sets a week's prices: one for each commodity, spreads under it if it has them. */
export function openSetPricesSheet() {
  const { commodities } = db.get();
  openSheet('Set prices', (root) => {
    // each commodity's spreads as they stand now, carried over; wheat is offered the usual grades
    const spreadsOf = (c) => {
      const have = latestSpreads(c.priceHistory);
      return have.length ? have : (isWheat(c.name) ? WHEAT_GRADES.map((grade) => ({ grade, adjust: '' })) : []);
    };
    const state = new Map(commodities.map((c) => [c.id, spreadsOf(c).map((s) => ({ ...s }))]));
    const spreadRowsHtml = (c) => state.get(c.id).map((s, i) => `
      <div class="row" style="align-items:center;gap:8px" data-srow="${esc(c.id)}:${i}">
        <input type="text" class="pr-grade" value="${esc(s.grade)}" placeholder="Grade" aria-label="Grade" style="flex:1;min-width:0" />
        <input type="number" class="pr-adj" step="0.01" value="${esc(s.adjust)}" placeholder="$/t" aria-label="Spread in dollars a tonne" inputmode="decimal" style="width:90px;text-align:right" />
        <button type="button" class="btn ghost-danger small" data-sdel="${esc(c.id)}:${i}" aria-label="Remove ${esc(s.grade || 'this grade')}" style="width:auto;margin:0">&times;</button>
      </div>`).join('');

    const render = () => {
      root.innerHTML = `
        ${field({ label: 'Week of', id: 'pr-date', type: 'date', value: todayLocal(), hint: 'Any day in the week. The latest week is also the price unsold grain is valued at.' })}
        ${commodities.map((c) => {
          const last = latestEntry(c.priceHistory);
          const price = last ? last.price : (Number(c.mtmPrice) || '');
          const per = c.unit === 'bale' ? 'bale' : 't';
          return `<div class="card" style="margin:0 0 10px">
            ${field({ label: `${esc(c.name)} ($/${per})`, id: `pr-${c.id}`, type: 'number', step: '0.01', value: price })}
            <details class="fold" ${state.get(c.id).length ? 'open' : ''} data-spreads="${esc(c.id)}" style="border-top:none">
              <summary><div><div class="sub">Spreads by grade (optional)</div></div></summary>
              <div data-slist="${esc(c.id)}">${spreadRowsHtml(c)}</div>
              <button type="button" class="btn secondary small" data-sadd="${esc(c.id)}" style="margin-top:6px">+ Add a grade</button>
              <div class="field" style="margin:6px 0 0"><div class="hint">A spread is dollars a tonne above or below the price for that grade. It carries over each week until you change it.</div></div>
            </details>
          </div>`;
        }).join('')}
        <div class="save-bar solo"><button class="btn" id="pr-save">Save prices</button></div>`;
      root.querySelectorAll('[data-sadd]').forEach((b) => b.addEventListener('click', () => { readSpreads(); state.get(b.dataset.sadd).push({ grade: '', adjust: '' }); render(); }));
      root.querySelectorAll('[data-sdel]').forEach((b) => b.addEventListener('click', () => {
        readSpreads();
        const [id, i] = b.dataset.sdel.split(':');
        state.get(id).splice(Number(i), 1);
        render();
      }));
      root.querySelector('#pr-save').addEventListener('click', save);
    };

    // keep what was typed in the spread rows when the list is drawn again
    const readSpreads = () => {
      for (const c of commodities) {
        const box = root.querySelector(`[data-slist="${c.id}"]`);
        if (!box) continue;
        state.set(c.id, [...box.querySelectorAll('[data-srow]')].map((r) => ({ grade: r.querySelector('.pr-grade').value, adjust: r.querySelector('.pr-adj').value })));
      }
    };

    const save = () => {
      readSpreads();
      const date = getVal(root, 'pr-date');
      if (!weekStart(date)) { toast('Pick the week.'); return; }
      const prices = commodities
        .map((c) => ({ commodityId: c.id, price: getNum(root, `pr-${c.id}`), spreads: state.get(c.id).filter((s) => String(s.grade).trim()).map((s) => ({ grade: s.grade, adjust: Number(s.adjust) || 0 })) }))
        .filter((p) => p.price > 0);
      if (prices.length === 0) { toast('Enter at least one price.'); return; }
      const n = db.setWeeklyPrices({ date, prices });
      toast(`${n} price${n === 1 ? '' : 's'} saved.`);
      closeSheet();
    };
    render();
  });
}
