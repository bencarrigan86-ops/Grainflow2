// Line up paddock names (CSV): rename, split and join the paddocks of earlier seasons so they match the names in use now,
// and give them the farm map. Choose the file of old name / new name rows, see what each season would become, then apply.
// A backup beforehand is the way back: this changes names in the past seasons.

import { db } from '../storage.js?v=339';
import { openSheet, closeSheet, toast } from '../ui.js?v=339';
import { esc } from '../fmt.js?v=339';
import { parseLineup, planLineup, mapCopyReport } from '../lineup.js?v=339';

export function openLineupSheet() {
  openSheet('Line up paddock names', (root) => {
    const labels = db.getYears();
    const seasons = labels.map((label) => ({ label, ...db.getYearData(label) }));
    const nowFields = db.get().fields;

    // how many paddocks in the other seasons could take an outline from the season in view, and why not if none
    const view = db.getCurrentYear();
    const report = mapCopyReport(seasons, view, nowFields);
    const mapCount = report.copyable;
    const names = (list) => [...new Set(list.map((x) => x.name))].slice(0, 12).map(esc).join(', ');
    const mapNote = mapCount
      ? `<strong>${mapCount}</strong> paddock${mapCount === 1 ? '' : 's'} would get an outline now.`
      : !report.withOutline
        ? `The season you are viewing (<strong>${esc(view)}</strong>) has no paddock outlines, so there is nothing to copy from. Switch to the season that has the farm map (the season at the top of the screen), then open this again.`
        : report.noMatch.length
          ? `Nothing to copy from <strong>${esc(view)}</strong>. ${report.noMatch.length} paddock${report.noMatch.length === 1 ? '' : 's'} in other seasons have no outline and no paddock of the same name with one here: ${names(report.noMatch)}.`
          : `Nothing to copy: every paddock in the other seasons already has an outline.${report.alreadyHave ? '' : ' (There are no other seasons.)'}`;

    root.innerHTML = `
      <div class="hint" style="margin-bottom:10px">Earlier seasons often name the same ground differently, so the rotation and yield history shows it as separate paddocks.
        Choose a CSV with a row for each change: the headings <strong>Old name</strong> and <strong>New name</strong>, and optionally <strong>Farm</strong>,
        <strong>Share (%)</strong> (for one old paddock that is now several) and <strong>Seasons</strong> (for example 2020-2025; otherwise every season but this one).
        Several old names to one new name joins them: the hectares and tonnes add up. Paddocks with loads are never split.
        <strong>Back up first</strong> (Settings), because this changes the earlier seasons.</div>
      <input type="file" id="lu-file" />
      <div id="lu-out" style="margin-top:12px"></div>
      <div class="card" style="margin-top:14px">
        <h2>Farm map for earlier seasons</h2>
        <div class="hint">Gives each paddock in the other seasons the outline of the paddock with the same name in this season, where it has none. Do this after the names line up.
          ${mapNote}</div>
        ${mapCount ? '<button type="button" class="btn secondary" id="lu-map">Copy the farm map to earlier seasons</button>' : ''}
      </div>`;
    const out = root.querySelector('#lu-out');

    root.querySelector('#lu-map')?.addEventListener('click', () => {
      const r = db.copyMapToOtherSeasons();
      closeSheet();
      toast(r.paddocks ? `Gave ${r.paddocks} paddock${r.paddocks === 1 ? '' : 's'} in ${r.seasons} season${r.seasons === 1 ? '' : 's'} their outline` : 'Nothing to copy');
    });

    root.querySelector('#lu-file').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const parsed = parseLineup(await file.text());
      if (!parsed.rules.length) { out.innerHTML = `<div class="empty">${parsed.errors.map(esc).join('<br>') || 'Nothing to do.'}</div>`; return; }
      const plan = planLineup(parsed.rules, seasons, db.getCurrentYear(), nowFields);
      const errors = [...parsed.errors, ...plan.errors];
      const changing = plan.seasons.filter((s) => s.renamed.length || s.split.length || s.joined.length);

      const line = (s) => [
        s.renamed.length ? `${s.renamed.length} renamed` : '',
        s.split.length ? `${s.split.length} split` : '',
        s.joined.length ? `${s.joined.length} joined` : '',
      ].filter(Boolean).join(' &middot; ');
      const mixed = changing.flatMap((s) => s.joined.filter((j) => j.mixed).map((j) => `${s.label}: ${j.name}`));
      const skipped = plan.seasons.flatMap((s) => s.skipped.map((k) => `${s.label}: ${k.name} (${k.why})`));

      out.innerHTML = `
        <div class="subhead">What would change</div>
        ${changing.length ? changing.map((s) => `
          <div class="row"><span class="label"><strong>${esc(s.label)}</strong></span>
            <span class="value">${line(s)} &middot; ${s.fieldsBefore} to ${s.fieldsAfter} paddocks</span></div>`).join('') : '<div class="empty">No season has a paddock with an old name in this file.</div>'}
        ${plan.notNow.length ? `
          <div class="subhead" style="margin-top:12px">New names that are not paddocks you have now</div>
          <div class="meta" style="margin-bottom:8px">${plan.notNow.map(esc).join(' &middot; ')}</div>` : ''}
        ${plan.unused.length ? `
          <div class="subhead" style="margin-top:12px">Old names not found in any season</div>
          <div class="meta" style="margin-bottom:8px">${plan.unused.map(esc).join(' &middot; ')}</div>` : ''}
        ${mixed.length ? `
          <div class="subhead" style="margin-top:12px">Joined paddocks with two crops</div>
          <div class="hint">The crop on more hectares stands for the joined paddock; the hectares and tonnes are added together.</div>
          <div class="meta" style="margin-bottom:8px">${mixed.map(esc).join(' &middot; ')}</div>` : ''}
        ${skipped.length ? `
          <div class="subhead" style="margin-top:12px">Left as they are</div>
          <div class="meta" style="margin-bottom:8px">${skipped.map(esc).join('<br>')}</div>` : ''}
        ${errors.length ? `
          <div class="subhead" style="margin-top:12px">Rows to fix</div>
          <div class="meta" style="margin-bottom:8px">${errors.slice(0, 12).map(esc).join('<br>')}</div>` : ''}
        ${changing.length && !plan.errors.length
    ? `<div class="save-bar solo"><button class="btn" id="lu-go">Line up ${changing.length} season${changing.length === 1 ? '' : 's'}</button></div>`
    : ''}`;

      out.querySelector('#lu-go')?.addEventListener('click', () => {
        const r = db.applyLineup(parsed.rules);
        closeSheet();
        toast(r.seasons ? `Lined up ${r.seasons} season${r.seasons === 1 ? '' : 's'}: ${r.renamed} renamed, ${r.split} split, ${r.joined} joined` : 'Nothing changed');
      });
    });
  });
}
