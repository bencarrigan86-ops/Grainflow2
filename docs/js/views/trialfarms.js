// Settings > Trial farms: only for the support login. Invite somebody to try the app, and open any trial farm (or go back to your own).

import { db } from '../storage.js?v=384';
import { setPreferredFarm } from '../auth.js?v=384';
import { toast, notify, openSheet, closeSheet, field, getVal } from '../ui.js?v=384';
import { esc } from '../fmt.js?v=384';
import {
  isSupportAdmin, createTrialInvite, withdrawTrialInvite, listTrialInvites, listSupportFarms,
  trialInviteMessage, trialLink, farmLabel, validEmail, trialFarmStatus, recordStartOwn, ownSeasonGuess, startOwnWarning, startedLine,
} from '../trials.js?v=384';

// Settings repaints on every change; who the support login is does not change, so it is asked once (a "no" is asked again after a while).
let adminAnswer = null;
async function supportAdmin() {
  if (adminAnswer && (adminAnswer.yes || Date.now() - adminAnswer.at < 5 * 60 * 1000)) return adminAnswer.yes;
  const yes = await isSupportAdmin();
  adminAnswer = { yes, at: Date.now() };
  return yes;
}

export const trialFarmsSlotHtml = () => '<div id="trial-farms-slot"></div>';

/** Fills the slot when this login is the support login; leaves it empty for everybody else. */
export async function wireTrialFarms(root) {
  const slot = root.querySelector('#trial-farms-slot');
  if (!slot || !await supportAdmin() || !slot.isConnected) return;
  slot.innerHTML = `<div class="card input" id="trial-farms-card">
    <h2><span class="dot input"></span>Trial farms</h2>
    <div class="hint" style="margin-bottom:8px">Invite somebody to try Commodity Mate on a farm of their own. Nobody you invite can see anybody else's. When they create their farm you can open it here, read only.</div>
    <div class="field"><label for="tf-email">Their email</label><input id="tf-email" type="email" inputmode="email" autocapitalize="off" /></div>
    <div class="field"><label for="tf-note">Note for yourself (optional)</label><input id="tf-note" type="text" placeholder="e.g. Smith Farming, met at field day" /></div>
    <button type="button" class="btn secondary" id="tf-invite">Invite to try it</button>
    <div id="tf-sent"></div>
    <div id="tf-body" style="margin-top:12px"><div class="meta">Loading…</div></div>
  </div>`;
  const body = slot.querySelector('#tf-body');
  const sent = slot.querySelector('#tf-sent');
  let busy = false;

  const paint = async () => {
    let invites = []; let farms = [];
    try { [invites, farms] = await Promise.all([listTrialInvites(), listSupportFarms()]); }
    catch (e) { if (body.isConnected) body.innerHTML = `<div class="hint">Could not load: ${esc(e.message)}. If this says a function is missing, run the Build 311 SQL.</div>`; return; }
    if (!body.isConnected) return;
    const current = db.getFarmId();
    const open = invites.filter((i) => !i.used_at);
    const started = invites.filter((i) => i.started_at);
    const when = (iso) => { try { return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); } catch { return ''; } };
    body.innerHTML = `
      ${open.length ? `<div class="subhead">Waiting to sign up</div>${open.map((i) => `<div class="row" style="align-items:center"><span class="label">${esc(i.email)}${i.note ? `<br><span class="meta">${esc(i.note)} &middot; invited ${esc(when(i.created_at))}</span>` : `<br><span class="meta">invited ${esc(when(i.created_at))}</span>`}</span>
        <span class="value" style="display:flex;gap:6px"><button type="button" class="btn secondary small" data-tf-copy="${esc(i.email)}">Copy message</button><button type="button" class="btn secondary small" data-tf-withdraw="${esc(i.id)}">Withdraw</button></span></div>`).join('')}` : ''}
      ${started.length ? `<div class="subhead" style="margin-top:10px">Started their own farm</div>${started.map((i) => `<div class="row"><span class="label">${esc(i.email)}<br><span class="meta">${esc(startedLine(i))}${farms.some((f) => f.farm_id === i.farm_id) ? '' : ' &middot; you no longer have access'}</span></span></div>`).join('')}` : ''}
      <div class="subhead" style="margin-top:10px">Farms you can open</div>
      ${farms.length === 0 ? '<div class="meta">None yet.</div>' : farms.map((f) => `<div class="row" style="align-items:center"><span class="label">${esc(farmLabel(f))}<br><span class="meta">${f.role === 'support' ? 'trial farm, read only' : 'your farm'}${f.started_at ? ` &middot; ${esc(startedLine(f))}` : ''}${f.farm_id === current ? ' &middot; open now' : ''}</span></span>
        <span class="value">${f.farm_id === current ? '' : `<button type="button" class="btn secondary small" data-tf-open="${esc(f.farm_id)}">Open</button>`}</span></div>`).join('')}`;
    body.querySelectorAll('[data-tf-copy]').forEach((b) => b.addEventListener('click', () => copyMessage(b.dataset.tfCopy)));
    body.querySelectorAll('[data-tf-withdraw]').forEach((b) => b.addEventListener('click', async () => {
      try { await withdrawTrialInvite(b.dataset.tfWithdraw); toast('Invitation withdrawn'); paint(); } catch (e) { notify(e.message); }
    }));
    body.querySelectorAll('[data-tf-open]').forEach((b) => b.addEventListener('click', () => openFarm(b.dataset.tfOpen)));
  };

  // Copy what to send. If the phone will not let the page copy, the text is put in a box to select instead.
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch { sent.innerHTML = `<textarea readonly rows="9" style="width:100%;margin-top:8px">${esc(text)}</textarea>`; }
  }
  const copyMessage = (email) => copyText(trialInviteMessage(email), 'Message copied');

  // The farm on this phone is replaced by the one chosen, so anything not yet sent would be left behind: wait until it has gone.
  async function openFarm(farmId) {
    let pending = 0;
    try { pending = (await db.getSyncStatus()).pending; } catch { /* treated as none */ }
    if (pending > 0) { notify('Some changes on this phone have not been sent yet. Wait until the dot beside the season is white, then try again.'); return; }
    setPreferredFarm(farmId);
    location.reload();
  }

  slot.querySelector('#tf-invite').addEventListener('click', async () => {
    if (busy) return;
    const email = slot.querySelector('#tf-email').value;
    if (!validEmail(email)) { notify('Enter their email address first.'); return; }
    busy = true;
    try {
      await createTrialInvite(email, slot.querySelector('#tf-note').value);
      slot.querySelector('#tf-email').value = ''; slot.querySelector('#tf-note').value = '';
      sent.innerHTML = `<div class="hint" style="margin-top:8px">Invited. Nothing has been sent to them yet: copy this and send it yourself by text or email.</div>
        <div style="display:flex;gap:8px;margin-top:6px"><button type="button" class="btn secondary small" id="tf-copy-msg" style="flex:1">Copy message</button><button type="button" class="btn secondary small" id="tf-copy-link" style="flex:1">Copy link only</button></div>`;
      sent.querySelector('#tf-copy-msg').addEventListener('click', () => copyMessage(email));
      sent.querySelector('#tf-copy-link').addEventListener('click', () => copyText(trialLink(email), 'Link copied'));
      paint();
    } catch (e) { notify(e.message); }
    busy = false;
  });

  paint();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The trial owner's side: "Start your own farm", shown only on a trial farm that has not started yet.

export const trialOwnSlotHtml = () => '<div id="trial-own-slot"></div>';

export async function wireTrialOwner(root) {
  const slot = root.querySelector('#trial-own-slot');
  if (!slot || db.getRole() !== 'owner') return;
  const status = await trialFarmStatus(db.getFarmId());
  if (!status.trial || status.startedAt || !slot.isConnected) return;
  slot.innerHTML = `<div class="card input" id="trial-own-card">
    <h2><span class="dot input"></span>Start your own farm</h2>
    <div class="hint" style="margin-bottom:8px">You are trying Commodity Mate on a sample farm. When you are ready, clear the sample and start your own. Your account and login stay the same.</div>
    <button type="button" class="btn" id="trial-own-btn">I am ready to start my own farm</button>
  </div>`;
  slot.querySelector('#trial-own-btn').addEventListener('click', () => openStartOwnSheet());
}

function openStartOwnSheet() {
  openSheet('Start your own farm', (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:10px">${esc(startOwnWarning())}</div>
      ${field({ label: 'Name of your first season', id: 'own-season', value: ownSeasonGuess(), placeholder: 'e.g. 2026' })}
      ${field({ label: 'Keep the person who set up your trial able to look at your farm?', id: 'own-keep', type: 'select', value: 'no',
        options: [{ value: 'no', label: 'No, switch it off' }, { value: 'yes', label: 'Yes, read only' }],
        hint: 'Your farm will have your real records in it. You can change this later in Support access.' })}
      <button class="btn danger" id="own-go">Clear the sample and start</button>`;
    root.querySelector('#own-go').addEventListener('click', async () => {
      const season = (getVal(root, 'own-season') || '').trim();
      if (!season) { root.querySelector('#own-season').focus(); return; }
      if (db.getYears().includes(season)) { notify(`You already have a season called "${season}". Pick another name.`); return; }
      // the server is told first, and it needs a connection: better to stop here than to clear the sample and fail to say so
      if (!navigator.onLine) { notify('You need a connection for this, so that it can be recorded. Try again when you have signal.'); return; }
      try { await recordStartOwn(db.getFarmId(), getVal(root, 'own-keep') === 'yes'); }
      catch (e) { notify(`Could not do that: ${e.message}`); return; }
      if (!db.startOwnFarm({ season })) { notify('Could not start the new season. Nothing was cleared.'); return; }
      // the invented business details that came with the sample
      db.updateBusinessDetails({ entityName: '', abn: '', ngr: '', contactName: '', address: '', paymentTermsDays: 14 });
      closeSheet();
      toast('Your own farm is ready');
    });
  });
}
