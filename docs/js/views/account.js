// Account screen: who you are, which farm, what role, and the way out.
//
// This lives on its own route rather than inside Settings because Settings is
// a 26KB view that Phase 1 has no business touching yet. Step 1.6 rebuilds the
// navigation per role, and that is when this gets a proper home in the
// interface. Until then it is reachable at #/account.

import { notify } from '../ui.js?v=398';
import { db } from '../storage.js?v=398';
import {
  getSession, getMembership, signOut, listMyInvitations, acceptInvitation, listMyFarms, setPreferredFarm,
} from '../auth.js?v=398';
import { roleLabel, expiryText } from '../invites.js?v=398';
import { esc } from '../fmt.js?v=398';
import { openReportProblemSheet } from './support.js?v=398';
import {
  platformOf, isStandalone, installSteps, installState, requestPersistence, storageStatus, storageText, canPromptInstall, promptInstall,
} from '../pwa.js?v=398';
import { toast } from '../ui.js?v=398';

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Farm manager',
  bookkeeper: 'Bookkeeper',
  farm_worker: 'Farm worker',
  driver: 'Driver',
  support: 'Support (read only)',
};

export async function renderAccount(root) {
  root.innerHTML = `
    <div class="topbar"><div><h1>Account</h1></div></div>
    <div class="view"><div class="empty">Loading…</div></div>
  `;

  // getMembership() takes the user id now — it used to fetch it itself, and
  // doing that inside an auth callback deadlocks supabase-js. This screen was
  // still calling it with no arguments, so it returned null every time and
  // Account told everybody they had no farm. Sequential rather than
  // Promise.all, because the second call needs the first one's answer.
  //
  // getSession() rather than getUser(): it reads the session already in local
  // storage instead of asking the server, so it cannot hang, and it carries
  // the same email and id.
  const session = await getSession();
  const user = session?.user ?? null;
  const membership = await getMembership(user?.id);

  // Also checked here, not only on the way in. Somebody who already belongs to
  // a farm never sees the join screen — which is exactly the state the first
  // real invitee ended up in, sitting in an empty farm of his own with an
  // invitation to a full one that nothing on any screen mentioned. Account is
  // where a person looks when they cannot work out what is going on.

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Account</h1>
        <div class="sub">${membership?.farmName || 'No farm'}</div>
      </div>
    </div>
    <div class="view">
      <button type="button" class="btn secondary" id="open-help" style="margin-bottom:12px">How to use Commodity Mate</button>
      <div class="card">
        <h2><span class="dot summary"></span>Signed in</h2>
        <div class="row"><span class="label">Email</span><span class="value">${user?.email ?? '—'}</span></div>
        <div class="row"><span class="label">Farm</span><span class="value">${membership?.farmName ?? '—'}</span></div>
        <div class="row"><span class="label">Role</span><span class="value">${
          membership ? (ROLE_LABELS[membership.role] ?? membership.role) : '—'
        }</span></div>
        ${membership && (membership.role === 'farm_worker' || membership.role === 'driver') ? `
          <div class="row">
            <span class="label">Can record production</span>
            <span class="value">${membership.canWriteProduction ? 'Yes' : 'No'}</span>
          </div>` : ''}
      </div>

      ${!membership ? `
        <div class="card input">
          <h2><span class="dot input"></span>No farm yet</h2>
          <div class="hint">You are signed in but do not belong to a farm. Either an
            owner needs to invite you, or you can create one.</div>
        </div>` : ''}

      <div id="my-farms"></div>

      <div class="card" id="device-card"><h2>This device</h2><div id="device-body"><div class="meta">Checking…</div></div></div>

      <div id="pending-invites"></div>

      <button type="button" class="btn secondary" id="report-problem" style="margin-top:12px">Report a problem</button>
      <button class="btn secondary" id="sign-out" style="margin-top:12px">Sign out</button>
    </div>
  `;

  showPendingInvitations(root, membership);
  showMyFarms(root, user?.id, membership);
  paintDeviceCard(root);

  root.querySelector('#report-problem')?.addEventListener('click', () => openReportProblemSheet());
  root.querySelector('#open-help')?.addEventListener('click', () => { location.hash = '#/help'; });
  root.querySelector('#sign-out').addEventListener('click', async () => {
    await signOut();
    // The auth listener in main.js picks this up and re-renders to the login
    // screen — no manual navigation needed here.
  });
}

/**
 * More than one farm on this login: say so, name each, and let this device choose which one it opens. Only shown when there is a choice.
 * The choice is remembered on this device; the other devices keep their own.
 */
async function showMyFarms(root, userId, membership) {
  const slot = root.querySelector('#my-farms');
  if (!slot || !userId) return;
  let farms = [];
  try { farms = await listMyFarms(userId, membership?.farmId); } catch { return; }
  if (farms.length < 2 || !slot.isConnected) return;
  slot.innerHTML = `<div class="card input">
    <h2><span class="dot input"></span>Your farms</h2>
    <div class="hint" style="margin-bottom:8px">This login is on ${farms.length} farms. Each has its own people, records and invitations. This device opens the one marked open now; each of your devices remembers its own choice.</div>
    ${farms.map((f, i) => `<div class="row" style="align-items:center"><span class="label">${esc(f.farmName)}<br><span class="meta">${esc(ROLE_LABELS[f.role] ?? f.role)}${f.current ? ' &middot; open now' : ''}</span></span><span class="value">${f.current ? '' : `<button type="button" class="btn secondary small" data-open-farm="${i}">Open</button>`}</span></div>`).join('')}
  </div>`;
  slot.querySelectorAll('[data-open-farm]').forEach((b) => b.addEventListener('click', async () => {
    // the farm on this device is replaced by the one chosen, so anything not yet sent would be left behind: wait until it has gone
    let pending = 0;
    try { pending = (await db.getSyncStatus()).pending; } catch { /* treated as none */ }
    if (pending > 0) { notify('Some changes on this device have not been sent yet. Wait until the dot beside the season is white, then try again.'); return; }
    setPreferredFarm(farms[Number(b.dataset.openFarm)].farmId);
    location.reload();
  }));
}

/**
 * Any farm still waiting for this person to join it.
 *
 * Loaded after the screen has painted rather than blocking it — an invitation
 * lookup is a nicety and must never be the reason Account will not open, which
 * is the screen somebody reaches for when they want the Sign out button.
 */
async function showPendingInvitations(root, membership) {
  const slot = root.querySelector('#pending-invites');
  if (!slot) return;

  let invitations = [];
  try { invitations = await listMyInvitations(); } catch { return; }
  // Only the ones for farms they are not already in.
  invitations = invitations.filter((i) => i.farmId !== membership?.farmId);
  if (!invitations.length || !slot.isConnected) return;

  slot.innerHTML = invitations.map((inv, i) => `
    <div class="card input">
      <h2><span class="dot input"></span>Invitation to ${esc(inv.farmName)}</h2>
      <div class="field hint" style="margin-bottom:10px">You have been invited to join
        ${esc(inv.farmName)} as ${esc(roleLabel(inv.role))}. ${esc(expiryText(inv.expiresAt))}.
        ${membership ? 'Joining opens that farm instead of this one.' : ''}</div>
      <button class="btn" data-accept="${i}">Join ${esc(inv.farmName)}</button>
    </div>`).join('');

  slot.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const inv = invitations[Number(btn.dataset.accept)];
      btn.disabled = true;
      btn.textContent = 'Joining…';
      try {
        await acceptInvitation(inv.token);
        // A full reload rather than a re-render: the farm underneath the whole
        // app has changed, and every view is holding data from the old one.
        location.hash = '#/';
        location.reload();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `Join ${inv.farmName}`;
        notify(`Could not join.\n\n${e.message}`);
      }
    });
  });
}

/**
 * This phone: is the app on the home screen, and has the phone promised to keep what is saved on it. A farm worker's
 * phone is the one place their loads live until there is signal, so this is on Account, which every role has.
 */
async function paintDeviceCard(root) {
  const body = root.querySelector('#device-body');
  if (!body) return;
  const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const standalone = isStandalone();
  const inst = installState({ standalone, platform, canPrompt: canPromptInstall() });
  const st = await storageStatus();
  if (!body.isConnected) return;
  body.innerHTML = `
    <div class="row"><span class="label">${esc(inst.text)}</span></div>
    ${inst.state === 'prompt' ? '<button type="button" class="btn secondary" id="dev-install">Install Commodity Mate</button>' : ''}
    ${inst.state === 'steps' ? `<ol class="steps" style="margin:6px 0 10px 18px;padding:0">${installSteps(platform).map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
    <div class="row" style="margin-top:8px"><span class="label">${esc(storageText(st, standalone))}</span></div>
    ${st.persisted === false ? '<button type="button" class="btn secondary" id="dev-keep">Keep my saved data</button>' : ''}
    ${st.usageMb !== null ? `<div class="meta" style="margin-top:6px">Using ${st.usageMb} MB of the ${st.quotaMb} MB this browser allows.</div>` : ''}`;
  body.querySelector('#dev-install')?.addEventListener('click', async () => {
    const r = await promptInstall();
    if (r === 'accepted') toast('Installed. Open it from your home screen.');
    paintDeviceCard(root);
  });
  body.querySelector('#dev-keep')?.addEventListener('click', async () => {
    const r = await requestPersistence();
    toast(r === 'kept' ? 'The phone will keep your saved data' : r === 'refused' ? 'The phone said no for now. Add Commodity Mate to the home screen and try again.' : 'This browser cannot do that');
    paintDeviceCard(root);
  });
}
