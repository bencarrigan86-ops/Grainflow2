// Settings > Trial farms: only for the support login. Invite somebody to try the app, and open any trial farm (or go back to your own).

import { db } from '../storage.js?v=311';
import { setPreferredFarm } from '../auth.js?v=311';
import { toast, notify } from '../ui.js?v=311';
import { esc } from '../fmt.js?v=311';
import {
  isSupportAdmin, createTrialInvite, withdrawTrialInvite, listTrialInvites, listSupportFarms,
  trialInviteMessage, farmLabel, validEmail,
} from '../trials.js?v=311';

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
    const when = (iso) => { try { return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }); } catch { return ''; } };
    body.innerHTML = `
      ${open.length ? `<div class="subhead">Waiting to sign up</div>${open.map((i) => `<div class="row" style="align-items:center"><span class="label">${esc(i.email)}${i.note ? `<br><span class="meta">${esc(i.note)} &middot; invited ${esc(when(i.created_at))}</span>` : `<br><span class="meta">invited ${esc(when(i.created_at))}</span>`}</span>
        <span class="value" style="display:flex;gap:6px"><button type="button" class="btn secondary small" data-tf-copy="${esc(i.email)}">Copy message</button><button type="button" class="btn secondary small" data-tf-withdraw="${esc(i.id)}">Withdraw</button></span></div>`).join('')}` : ''}
      <div class="subhead" style="margin-top:10px">Farms you can open</div>
      ${farms.length === 0 ? '<div class="meta">None yet.</div>' : farms.map((f) => `<div class="row" style="align-items:center"><span class="label">${esc(farmLabel(f))}<br><span class="meta">${f.role === 'support' ? 'trial farm, read only' : 'your farm'}${f.farm_id === current ? ' &middot; open now' : ''}</span></span>
        <span class="value">${f.farm_id === current ? '' : `<button type="button" class="btn secondary small" data-tf-open="${esc(f.farm_id)}">Open</button>`}</span></div>`).join('')}`;
    body.querySelectorAll('[data-tf-copy]').forEach((b) => b.addEventListener('click', () => copyMessage(b.dataset.tfCopy)));
    body.querySelectorAll('[data-tf-withdraw]').forEach((b) => b.addEventListener('click', async () => {
      try { await withdrawTrialInvite(b.dataset.tfWithdraw); toast('Invitation withdrawn'); paint(); } catch (e) { notify(e.message); }
    }));
    body.querySelectorAll('[data-tf-open]').forEach((b) => b.addEventListener('click', () => openFarm(b.dataset.tfOpen)));
  };

  async function copyMessage(email) {
    const text = trialInviteMessage(email);
    try { await navigator.clipboard.writeText(text); toast('Message copied'); }
    catch { sent.innerHTML = `<textarea readonly rows="9" style="width:100%;margin-top:8px">${esc(text)}</textarea>`; }
  }

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
      sent.innerHTML = `<div class="hint" style="margin-top:8px">Invited. Send them this, or tap Copy message below.</div><textarea readonly rows="9" style="width:100%;margin-top:6px">${esc(trialInviteMessage(email))}</textarea>`;
      paint();
    } catch (e) { notify(e.message); }
    busy = false;
  });

  paint();
}
