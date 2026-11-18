// How to use Commodity Mate: what the signed-in person can do, a short guide for each part of the app, and who can do what.
//
// The words are in helpcontent.js, checked against nav.js and the database policies by tests/help.test.mjs. This only lays
// them out, and offers each guide only to the roles that have it.

import { db } from '../storage.js?v=416';
import { esc } from '../fmt.js?v=416';
import { canOpen } from '../nav.js?v=416';
import { ROLE_INFO, ACCESS, LEVELS, effectiveAccess, guidesForRole, startProgress } from '../helpcontent.js?v=416';
import { readSwitches } from '../farmswitches.js?v=416';
import { openSetupWalk } from './setupwalk.js?v=416';
import { figureFor, tabsSvg, rolesSvg } from '../helpvisuals.js?v=416';

import { pill, ROLE_SHORT } from './levelpill.js?v=416';

const SHORT = ROLE_SHORT;

export function renderHelp(root) {
  const role = db.getRole();
  const me = ROLE_INFO.find((r) => r.role === role) || ROLE_INFO[ROLE_INFO.length - 1];
  const guides = guidesForRole(role);

  const guideHtml = (g) => `
    <details class="fold" id="guide-${esc(g.id)}">
      <summary><div><h2>${esc(g.title)}</h2><div class="sub">${esc(g.blurb)}</div></div></summary>
      ${g.shot ? `<div class="help-shot"><img src="${esc(g.shot)}" alt="${esc(g.shotAlt || '')}" loading="lazy" /></div>` : figureFor(g.id) ? `<div style="margin:10px 0 4px">${figureFor(g.id)}</div>` : ''}
      <ol style="margin:8px 0 8px 22px;padding:0;line-height:1.5">${g.steps.map((s) => `<li style="margin-bottom:6px">${esc(s)}</li>`).join('')}</ol>
      ${g.tips.length ? `<div class="hint" style="margin:6px 0 8px"><strong>Good to know</strong><br/>${g.tips.map(esc).join('<br/>')}</div>` : ''}
      ${g.open && canOpen(role, g.open) ? `<button type="button" class="btn secondary small" data-go="${esc(g.open)}">${esc(g.openLabel || 'Open')}</button>` : ''}
    </details>`;

  const accessRow = (r) => `
    <tr>
      <td style="text-align:left;white-space:normal;min-width:170px"><strong>${esc(r.area)}</strong><div class="meta" style="font-size:11px">${esc(r.hint)}</div>${r.note ? `<div class="meta" style="font-size:11px;font-style:italic">${esc(r.note)}</div>` : ''}</td>
      ${Object.keys(SHORT).map((k) => `<td style="text-align:center;${k === role ? 'background:var(--accent-summary-bg)' : ''}">${pill(r[k])}</td>`).join('')}
    </tr>`;

  // the walk-through is for the roles that set a farm up; it opens at the first step not done
  const canWalk = startProgress(role, {}).steps.length > 0;

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>How to use Commodity Mate</h1>
        <div class="sub">You are signed in as ${esc(me.label)}</div>
      </div>
    </div>
    <div class="view">
      ${canWalk ? `<div class="card"><h2>Setup walk-through</h2><div class="hint" style="margin-bottom:8px">One question at a time: business, season, crops, paddocks, silos, a contract, a load and an invoice. Skip what you like, and come back to it here.</div><button type="button" class="btn" id="help-walk">Open the walk-through</button></div>` : ''}
      <div class="card summary">
        <h2><span class="dot summary"></span>What you can do</h2>
        <div class="hint" style="margin-bottom:6px">${esc(me.summary)}</div>
        <div class="hint" style="margin-bottom:10px">${esc(me.only)}</div>
        <div class="meta" style="margin-bottom:4px">This is the bar along the bottom of your screen:</div>
        ${tabsSvg(role)}
      </div>

      <div class="card">
        <h2>Guides</h2>
        <div class="hint" style="margin-bottom:6px">A few steps for each part of the app you can use. Tap one to open it.</div>
        ${guides.map(guideHtml).join('')}
      </div>

      <div class="card">
        <h2>Who can do what</h2>
        <div class="hint" style="margin-bottom:8px">There are five kinds of login, and a read-only Advisor. An owner chooses which one each person gets, under People in Settings. Your column is shaded. The table is this farm's rules. An owner can change some of them under Who can do what in Settings.</div>
        <div class="meta" style="margin-bottom:4px">What each kind of login sees along the bottom of the screen (it opens on the green one):</div>
        ${rolesSvg()}
        ${ROLE_INFO.map((r) => `<div class="row" style="align-items:flex-start"><span class="label" style="min-width:92px"><strong>${esc(r.label)}</strong></span><span class="value" style="font-weight:400;font-size:13px">${esc(r.summary)}</span></div>`).join('')}
        <div class="table-scroll" style="margin-top:12px">
          <table>
            <thead><tr><th style="text-align:left">Area</th>${Object.values(SHORT).map((s) => `<th style="text-align:center">${esc(s)}</th>`).join('')}</tr></thead>
            <tbody>${effectiveAccess(readSwitches(db.getBusinessDetails().switches)).map(accessRow).join('')}</tbody>
          </table>
        </div>
        <div class="hint" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">${Object.keys(LEVELS).map((k) => `<span>${pill(k)} ${esc(LEVELS[k].label)}</span>`).join('')}</div>
        <div class="hint" style="margin-top:6px">Whatever the screen shows, the server holds the real rules. A person is never sent the data they are not allowed to see.</div>
      </div>
    </div>`;

  // a screenshot that is not there (offline, never opened online) is left out rather than shown broken
  root.querySelectorAll('.help-shot img').forEach((img) => img.addEventListener('error', () => img.parentNode.remove()));
  root.querySelector('#help-walk')?.addEventListener('click', () => openSetupWalk());
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.go}`; }));
}
