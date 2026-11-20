// Import past seasons (CSV): the farm's own records of earlier years, one row per paddock per season.
//
// Choose the file, see what it would make (each season, its paddocks and hectares, and which names found a paddock),
// then import. A season the farm already has is left alone. The seasons go in beside the current one and do not
// change it; the rotation and yield history then reaches back as far as the records do.

import { db, uid } from '../storage.js?v=485';
import { openSheet, closeSheet, toast } from '../ui.js?v=485';
import { esc, num } from '../fmt.js?v=485';
import { parsePastSeasons, planPastSeasons, seasonRecords } from '../pastseasons.js?v=485';

export function openPastSeasonsSheet() {
  openSheet('Import past seasons', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:10px">Your own records of earlier seasons, as a CSV file with a row for each paddock in each season. The first row needs the headings
        <strong>Season</strong>, <strong>Paddock</strong>, <strong>Commodity</strong>, <strong>Ha</strong> and either <strong>Yield (t/ha)</strong> or <strong>Tonnes</strong>.
        <strong>Farm</strong>, <strong>Variety</strong> and <strong>Yield is</strong> (Actual or Estimate) are optional.
        Paddocks are matched to the paddocks you have now by name, so each lines up under its current name.</div>
      <input type="file" id="ps-file" />
      <div id="ps-out" style="margin-top:12px"></div>`;
    const out = root.querySelector('#ps-out');

    root.querySelector('#ps-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parsePastSeasons(text);
      if (!parsed.rows.length) {
        out.innerHTML = `<div class="empty">${parsed.errors.map(esc).join('<br>') || 'Nothing to import.'}</div>`;
        return;
      }
      const farm = db.get();
      const plan = planPastSeasons(parsed.rows, { seasons: db.getYears(), paddocks: farm.fields.map((f) => f.name) });
      const fresh = plan.seasons.filter((s) => !s.exists);

      out.innerHTML = `
        <div class="subhead">What the file holds</div>
        ${plan.seasons.map((s) => `
          <div class="row"><span class="label"><strong>${esc(s.label)}</strong>${s.exists ? ' <span class="meta">(already in the app, left alone)</span>' : ''}</span>
            <span class="value">${s.fields.length} paddocks &middot; ${num(s.ha, 0)} ha &middot; ${num(s.tons, 0)} t</span></div>`).join('')}
        ${plan.unmatched.length ? `
          <div class="subhead" style="margin-top:12px">Not on your paddock list now</div>
          <div class="hint">These are kept under the name they have in the file (a paddock since sold or renamed). To line one up, change its name in the file to the name you use now and choose the file again.</div>
          <div class="meta" style="margin-bottom:8px">${plan.unmatched.map((u) => `<strong>${esc(u.name)}</strong> (${u.seasons.map(esc).join(', ')})`).join(' &middot; ')}</div>` : ''}
        ${plan.seasons.some((s) => s.fields.some((f) => f.mixed)) ? `
          <div class="subhead" style="margin-top:12px">Two crops on one paddock</div>
          <div class="hint">Where a paddock was grown to more than one crop in a season (usually two old paddocks that are one paddock now), the crop on more hectares stands for it, and the hectares and tonnes are added together.</div>
          <div class="meta" style="margin-bottom:8px">${plan.seasons.map((s) => { const m = s.fields.filter((f) => f.mixed).map((f) => f.name); return m.length ? `<strong>${esc(s.label)}</strong>: ${m.map(esc).join(', ')}` : ''; }).filter(Boolean).join(' &middot; ')}</div>` : ''}
        ${parsed.errors.length ? `
          <div class="subhead" style="margin-top:12px">Rows left out</div>
          <div class="meta" style="margin-bottom:8px">${parsed.errors.slice(0, 12).map(esc).join('<br>')}${parsed.errors.length > 12 ? `<br>and ${parsed.errors.length - 12} more` : ''}</div>` : ''}
        ${fresh.length
    ? `<div class="save-bar solo"><button class="btn" id="ps-go">Import ${fresh.length} season${fresh.length === 1 ? '' : 's'}</button></div>`
    : '<div class="empty">Every season in the file is already in the app.</div>'}`;

      out.querySelector('#ps-go')?.addEventListener('click', () => {
        const commodities = farm.commodities;
        let made = 0;
        for (const s of fresh) {
          if (db.addPastSeason(s.label, seasonRecords(s, commodities, uid))) made += 1;
        }
        closeSheet();
        toast(`Imported ${made} season${made === 1 ? '' : 's'}`);
      });
    });
  });
}
