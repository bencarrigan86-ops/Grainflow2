// Account screen: who you are, which farm, what role, and the way out.
//
// This lives on its own route rather than inside Settings because Settings is
// a 26KB view that Phase 1 has no business touching yet. Step 1.6 rebuilds the
// navigation per role, and that is when this gets a proper home in the
// interface. Until then it is reachable at #/account.

import { getSession, getMembership, signOut } from '../auth.js?v=86';

const ROLE_LABELS = {
  owner: 'Owner',
  manager: 'Farm manager',
  bookkeeper: 'Bookkeeper',
  farm_worker: 'Farm worker',
  driver: 'Driver',
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

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Account</h1>
        <div class="sub">${membership?.farmName || 'No farm'}</div>
      </div>
    </div>
    <div class="view">
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

      <button class="btn secondary" id="sign-out" style="margin-top:12px">Sign out</button>
    </div>
  `;

  root.querySelector('#sign-out').addEventListener('click', async () => {
    await signOut();
    // The auth listener in main.js picks this up and re-renders to the login
    // screen — no manual navigation needed here.
  });
}
