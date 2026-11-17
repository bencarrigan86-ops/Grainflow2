// Averages by commodity: each crop's yield and sale price over the seasons picked, with the season-by-season figures
// underneath. Built from the seasons the farm already holds; nothing is entered here. Owner, manager and bookkeeper only
// (it is yields and prices, the same line as Position).

import { db } from '../storage.js?v=345';
import { num, esc, money, todayLocal, dmy } from '../fmt.js?v=345';
import { openSheet, toast } from '../ui.js?v=345';
import { canSeeYield } from '../nav.js?v=345';
import { exportRowsAsCSV } from '../csv.js?v=345';
import { safeFileName, sharePdf, downloadFile, canShareFiles } from '../sharefile.js?v=345';
import { averagesPdf } from '../averagespdf.js?v=345';
import { seasonAverages, finishedSeasons, averagesRows, AVERAGES_COLUMNS } from '../seasonaverages.js?v=345';

const KEY = 'grainflow.averages.seasons';
const readPicked = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const savePicked = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* not remembered; it still works */ } };

// the season list folds away, and stays folded on this device
const OPEN_KEY = 'grainflow.averages.seasonsopen';
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } };
const saveOpen = (open) => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* not remembered */ } };

export function openAveragesSheet() {
  const allowed = canSeeYield(db.getRole());
  const labels = db.getYears().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const years = Object.fromEntries(labels.map((l) => [l, db.getYearData(l)]));
  const defaults = finishedSeasons(labels, db.getCurrentYear());
  const remembered = readPicked();
  const picked = new Set((remembered ? remembered.filter((l) => labels.includes(l)) : defaults));

  openSheet('Averages by commodity', (root) => {
    if (!allowed) { root.innerHTML = '<div class="empty">Yields and prices are shown to owners, managers and bookkeepers.</div>'; return; }
    const paint = () => {
      const chosen = labels.filter((l) => picked.has(l));
      const result = seasonAverages(years, chosen);
      const noEstimate = result.commodities.every((c) => !c.total.est);
      root.querySelector('#av-body').innerHTML = !chosen.length
        ? '<div class="empty">Tick at least one season.</div>'
        : !result.commodities.length ? '<div class="empty">Nothing grown or sold in the seasons ticked.</div>'
          : `${result.commodities.map((c) => card(c, chosen)).join('')}
            ${noEstimate ? '' : '<div class="hint">&ldquo;est&rdquo; means at least one season in that average is a forecast yield, not a recorded one.</div>'}
            <div class="hint">Yield is total tonnes over total hectares, so bigger paddocks count for more. Seasons with no tonnes are left out. Price is weighted by tonnes sold: <strong>contract</strong> is the price on the contract, <strong>net</strong> is what is left per tonne after freight and levies.</div>`;
      root.querySelector('#av-sub').textContent = chosen.length ? `${chosen.length} season${chosen.length === 1 ? '' : 's'}: ${chosen[0]}${chosen.length > 1 ? ` to ${chosen[chosen.length - 1]}` : ''}` : 'No seasons';
    };

    const card = (c, chosen) => {
      const t = c.total;
      const rows = chosen.filter((l) => c.seasons[l]).map((l) => {
        const s = c.seasons[l];
        return `<tr><td>${esc(l)}</td><td style="text-align:right">${s.ha ? num(s.ha, 0) : ''}</td><td style="text-align:right">${s.yieldTHa ? `${num(s.yieldTHa, 2)}${s.est ? ' est' : ''}` : ''}</td><td style="text-align:right">${s.soldTons ? num(s.soldTons, 0) : ''}</td><td style="text-align:right">${s.soldTons ? money(s.netPrice) : ''}</td></tr>`;
      }).join('');
      return `<div class="card" style="margin-bottom:10px">
        <h2>${esc(c.name)}</h2>
        <div class="row"><span class="label">Average yield</span><span class="value"><strong>${t.yieldTHa ? `${num(t.yieldTHa, 2)} t/ha${t.est ? ' est' : ''}` : 'none yet'}</strong></span></div>
        <div class="meta" style="margin-bottom:6px">${t.seasonsGrown} season${t.seasonsGrown === 1 ? '' : 's'} grown &middot; ${num(t.ha, 0)} ha &middot; ${num(t.tons, 0)} t</div>
        <div class="row"><span class="label">Average price</span><span class="value"><strong>${t.soldTons ? `${money(t.contractPrice)}/t` : 'no sales'}</strong></span></div>
        ${t.soldTons ? `<div class="meta" style="margin-bottom:6px">net ${money(t.netPrice)}/t after freight and levies &middot; ${num(t.soldTons, 0)} t sold &middot; ${money(t.soldValue)}</div>` : ''}
        <div class="table-scroll"><table><thead><tr><th style="text-align:left">Season</th><th>Ha</th><th>t/ha</th><th>Sold t</th><th>Net $/t</th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    };

    root.innerHTML = `
      <div class="card" style="margin-bottom:10px"><details class="fold" id="av-seasons" style="margin-top:0;border-top:none" ${readOpen() ? 'open' : ''}>
        <summary><div><h2>Seasons</h2><div class="sub" id="av-sub"></div></div></summary>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0">${labels.map((l) => `<label style="cursor:pointer"><input type="checkbox" class="av-season" value="${esc(l)}" ${picked.has(l) ? 'checked' : ''} style="width:18px;height:18px;vertical-align:middle;margin-right:5px" />${esc(l)}</label>`).join('')}</div>
        <div style="display:flex;gap:8px"><button type="button" class="btn secondary" id="av-all">Select all</button><button type="button" class="btn secondary" id="av-done">Finished seasons</button></div>
      </details></div>
      <div id="av-body"></div>
      <div class="save-bar"><button type="button" class="btn secondary" id="av-csv" style="flex:1;padding-left:12px;padding-right:12px">Excel (CSV)</button><button type="button" class="btn" id="av-pdf" style="flex:1;padding-left:12px;padding-right:12px">${canShareFiles() ? 'Share as PDF' : 'Download PDF'}</button></div>`;

    const set = (list) => { picked.clear(); list.forEach((l) => picked.add(l)); root.querySelectorAll('.av-season').forEach((b) => { b.checked = picked.has(b.value); }); savePicked([...picked]); paint(); };
    root.querySelectorAll('.av-season').forEach((b) => b.addEventListener('change', () => { if (b.checked) picked.add(b.value); else picked.delete(b.value); savePicked([...picked]); paint(); }));
    root.querySelector('#av-seasons').addEventListener('toggle', (e) => saveOpen(e.currentTarget.open));
    root.querySelector('#av-all').addEventListener('click', () => set(labels));
    root.querySelector('#av-done').addEventListener('click', () => set(defaults));
    root.querySelector('#av-csv').addEventListener('click', () => {
      const chosen = labels.filter((l) => picked.has(l));
      exportRowsAsCSV(safeFileName(`grainflow-averages-${todayLocal()}`, 'csv'), averagesRows(seasonAverages(years, chosen)), AVERAGES_COLUMNS(true));
      toast('Downloaded. It opens in Excel.');
    });
    root.querySelector('#av-pdf').addEventListener('click', async () => {
      const chosen = labels.filter((l) => picked.has(l));
      const result = seasonAverages(years, chosen);
      if (!chosen.length || !result.commodities.length) { toast('Tick a season with something grown or sold first.'); return; }
      const bytes = averagesPdf(result, { business: db.getBusinessDetails().entityName || '', today: dmy(todayLocal()) });
      const span = `${chosen[0]}${chosen.length > 1 ? ` to ${chosen[chosen.length - 1]}` : ''}`;
      const fileName = safeFileName(`Averages ${span} ${dmy(todayLocal())}`);
      if (!canShareFiles()) { downloadFile(bytes, fileName); return; }
      await sharePdf(bytes, fileName, { title: `Averages ${span}` });
    });
    paint();
  });
}
