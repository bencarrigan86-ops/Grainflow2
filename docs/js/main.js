import { db } from './storage.js?v=93';
import { renderPosition } from './views/position.js?v=93';
import { renderProduction } from './views/production.js?v=93';
import { renderReports } from './views/reports.js?v=93';
import { renderSales } from './views/sales.js?v=93';
import { renderMovements } from './views/movements.js?v=93';
import { renderStorage } from './views/storage.js?v=93';
import { renderSettings } from './views/settings.js?v=93';
import { renderLogin } from './views/login.js?v=93';
import { renderAccount } from './views/account.js?v=93';
import {
  getSession, getMembership, onAuthChange, acceptInvitation, signOut, listMyInvitations,
} from './auth.js?v=93';
import { tabsForRole, landingTabFor, canOpen, gearTargetFor } from './nav.js?v=93';
import { tokenFromHash, roleLabel, expiryText } from './invites.js?v=93';
import { esc } from './fmt.js?v=93';
import { APP_VERSION } from './version.js?v=93';
import { takeSampleDataRequest, fetchSampleFarm } from './demo.js?v=93';

// Tab icons are hand-drawn rather than emoji: emoji render differently on
// every platform, and there is no silo (or barn) emoji at all, so the set
// could never be consistent. All seven share one idiom — 24x24 box, solid
// currentColor fill, no strokes, chunky enough to hold up at 21px.
const SILO_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><polygon points="12,1.5 21,8 3,8"/><rect x="4" y="8.6" width="16" height="2.6"/><rect x="4" y="11.7" width="16" height="2.6"/><rect x="4" y="14.8" width="16" height="2.6"/><polygon points="4,18 20,18 13.2,23 10.8,23"/></svg>`;

// A map pin on the ground — location marker, per the reference.
const POSITION_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M12 20c0 0-6-7-6-11.5a6 6 0 1 1 12 0C18 13 12 20 12 20z M12 6.1a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 1 0 0-4.8z"/><ellipse cx="12" cy="21.4" rx="7" ry="1.7"/></svg>`;

// Two crops, layered silhouettes rather than outlines — the fine branch
// lines in the reference close up at 21px, the stacked shape does not.
const PRODUCTION_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><polygon points="6.8,1.8 10.2,7.6 3.4,7.6"/><polygon points="6.8,5.9 11.5,12.1 2.1,12.1"/><polygon points="6.8,10.3 12.8,16.6 0.8,16.6"/><rect x="6" y="16.6" width="1.7" height="5.4"/><polygon points="18.6,7.3 21.7,12.4 15.5,12.4"/><polygon points="18.6,10.6 23.2,17.6 14,17.6"/><rect x="17.8" y="17.6" width="1.7" height="4.4"/></svg>`;

const REPORTS_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="13" width="4.8" height="9"/><rect x="9.6" y="6.5" width="4.8" height="15.5"/><rect x="16.7" y="10" width="4.8" height="12"/></svg>`;

// Banknote with a dollar sign cut out of it. The $ is built from
// non-overlapping segments so evenodd cuts cleanly — overlapping subpaths
// would flip back to filled and break the glyph.
const SALES_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M1.5 5h21v14h-21V5z M9.6 8h4.8v1.5H9.6V8z M9.6 9.5h1.5v1.25H9.6V9.5z M9.6 10.75h4.8v1.5H9.6v-1.5z M12.9 12.25h1.5v1.25h-1.5v-1.25z M9.6 13.5h4.8V15H9.6v-1.5z M11.25 6.4h1.5V8h-1.5V6.4z M11.25 15h1.5v1.6h-1.5V15z"/></svg>`;

const MOVEMENT_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="13" height="11"/><polygon points="15,8.5 19,8.5 23,12.5 23,16 15,16"/><circle cx="6" cy="18.6" r="2.6"/><circle cx="18" cy="18.6" r="2.6"/></svg>`;

// Sliders — the horizontal bands deliberately echo the silo at the other
// end of the tab bar.
const SETTINGS_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4.8" width="20" height="2.4"/><circle cx="8" cy="6" r="3.3"/><rect x="2" y="10.8" width="20" height="2.4"/><circle cx="16" cy="12" r="3.3"/><rect x="2" y="16.8" width="20" height="2.4"/><circle cx="10" cy="18" r="3.3"/></svg>`;

// Six tabs in the bar. Settings is reached from the gear at top right —
// see .settings-btn in styles.css for why it is not down here.
const TABS = [
  { id: 'position', label: 'Position', icon: POSITION_ICON, render: renderPosition },
  { id: 'production', label: 'Production', icon: PRODUCTION_ICON, render: renderProduction },
  { id: 'sales', label: 'Sales', icon: SALES_ICON, render: renderSales },
  { id: 'movement', label: 'Movement', icon: MOVEMENT_ICON, render: renderMovements },
  { id: 'storage', label: 'Storage', icon: SILO_ICON, render: renderStorage },
  { id: 'reports', label: 'Reports', icon: REPORTS_ICON, render: renderReports },
];

// Every reachable view, including the ones not shown in the tab bar.
// Account has no icon because it is reached from Settings, not the bar — see
// the note at the top of views/account.js.
const ROUTES = [
  ...TABS,
  { id: 'settings', label: 'Settings', icon: SETTINGS_ICON, render: renderSettings },
  { id: 'account', label: 'Account', render: renderAccount },
];

// The signed-in role, held for as long as the session lasts. Everything the
// tab bar and the router decide comes from here; before sign-in it is null and
// the chrome is hidden anyway.
let currentRole = null;

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

function currentTabId() {
  const hash = location.hash.replace('#/', '');
  const known = ROUTES.some((t) => t.id === hash);
  // Hiding a tab is a courtesy; the address bar is still typeable, and a
  // half-loaded screen a role cannot fill is worse than not offering it. The
  // actual enforcement is the RLS policies, which refuse the data regardless.
  if (known && canOpen(currentRole, hash)) return hash;
  return landingTabFor(currentRole);
}

function renderTabbar() {
  const active = currentTabId();
  const allowed = tabsForRole(currentRole);
  const bar = allowed.map((id) => TABS.find((t) => t.id === id)).filter(Boolean);
  // A driver's bar holds a single tab, which is arguably a label rather than a
  // bar. It stays anyway: the layout reserves that strip at the bottom of the
  // screen, and removing it leaves a gap rather than reclaiming the space.
  // Worth revisiting alongside the driver screen itself.
  tabbar.innerHTML = bar.map((t) => `
    <button data-tab="${t.id}" class="${t.id === active ? 'active' : ''}">
      <span class="icon">${t.icon}</span>
      <span>${t.label}</span>
    </button>
  `).join('');
  tabbar.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = `#/${btn.dataset.tab}`;
    });
  });
}

const settingsBtn = document.getElementById('settings-btn');
settingsBtn.innerHTML = SETTINGS_ICON;
settingsBtn.addEventListener('click', () => {
  location.hash = `#/${gearTargetFor(currentRole)}`;
});

function renderActiveView() {
  const active = currentTabId();
  const route = ROUTES.find((t) => t.id === active);
  app.innerHTML = '';
  route.render(app);
  renderTabbar();
  // The gear stays for every role. It was hidden from a driver along with
  // Settings, which also removed the only route to Account — and so the only
  // way to sign out. It now goes wherever that role can actually get to.
  settingsBtn.classList.toggle('active', active === gearTargetFor(currentRole));
}

const yearPill = document.getElementById('year-pill');
function renderYearPill() {
  yearPill.textContent = db.getCurrentYear();
}
yearPill.addEventListener('click', () => {
  location.hash = '#/settings';
});
db.subscribe(renderYearPill);

// ---------------------------------------------------------------------------
// Session gate
//
// Three states, and the app has to render sensibly in all of them:
//
//   no session          -> the login screen
//   session, no farm    -> the farm-naming step, because a signed-in user with
//                          no membership row can see nothing at all
//   session and a farm  -> the app
//
// The chrome (tab bar, season pill, settings gear) is hidden while signed out.
// Leaving a tab bar visible behind a login screen looks broken and invites taps
// that go nowhere.
// ---------------------------------------------------------------------------

const chrome = [tabbar, yearPill, settingsBtn];
function setChromeVisible(visible) {
  chrome.forEach((el) => { el.hidden = !visible; });
}

// ---------------------------------------------------------------------------
// Invitation links
//
// An invitation arrives as https://…/#/join/<token>, and the person opening it
// usually has no account yet. So between arriving and being able to accept,
// they sign up, and — if Supabase is holding the account for email
// confirmation — they finish in a *different tab*, opened by their mail app,
// at the plain app address with no token in it.
//
// The token therefore has to be put somewhere that survives all of that, which
// rules out a variable and rules out sessionStorage. localStorage it is: on the
// invitee's own device, and useless to anyone else because the server refuses
// anyone signed in as a different address.
//
// It is read out of the address bar at load and taken straight back out again,
// so a reload after joining does not try to spend an invitation twice.
// ---------------------------------------------------------------------------

const INVITE_KEY = 'grainflow.pendingInvite';

function stashInviteFromHash() {
  const token = tokenFromHash(location.hash);
  if (!token) return;
  try { localStorage.setItem(INVITE_KEY, token); } catch { /* private mode */ }
  // Same document, different fragment — this does not reload the page, and
  // replace() rather than assignment so Back does not walk into a spent link.
  location.replace(`${location.pathname}${location.search}#/`);
}

function readInvite() {
  try { return localStorage.getItem(INVITE_KEY); } catch { return null; }
}

function clearInvite() {
  try { localStorage.removeItem(INVITE_KEY); } catch { /* nothing to do */ }
}

stashInviteFromHash();

/**
 * The invitation was refused by the server, and the reason is worth showing.
 *
 * Both buttons matter. "Sign out" is the way through the common case — someone
 * already signed in as themselves opening a link sent to a work address — and
 * it keeps the token, so signing back in as the right person finishes the job.
 * "Continue" is the way out for an invitation that is genuinely dead, so nobody
 * is stuck on this screen with a link they cannot use and cannot dismiss.
 */
function renderInviteRefused(message) {
  setChromeVisible(false);
  app.innerHTML = `
    <div class="topbar"><div><h1>Grainflow</h1><div class="sub">Invitation</div></div></div>
    <div class="view">
      <div class="card">
        <h2>That invitation was not accepted</h2>
        <div class="hint" style="margin-top:6px">${esc(message)}</div>
        <button class="btn" id="inv-signout" style="margin-top:14px">Sign out and try again</button>
        <button class="btn secondary" id="inv-continue" style="margin-top:8px">Continue as I am</button>
      </div>
    </div>
  `;
  app.querySelector('#inv-signout').addEventListener('click', () => signOut());
  app.querySelector('#inv-continue').addEventListener('click', () => {
    clearInvite();
    boot();
  });
}

/**
 * "You have been invited to Sunnyridge" — shown instead of the farm-naming
 * screen to somebody who has an invitation outstanding.
 *
 * Creating a farm is still offered, underneath, because a person can genuinely
 * have both: invited to somebody else's farm and wanting one of their own. But
 * it is no longer the only thing on offer, which is what turned one mis-tap
 * into a second farm, two memberships, and an app that kept opening the empty
 * one.
 */
function renderInvitationsWaiting(invitations) {
  setChromeVisible(false);
  app.innerHTML = `
    <div class="topbar"><div><h1>Grainflow</h1><div class="sub">You have been invited</div></div></div>
    <div class="view">
      ${invitations.map((inv, i) => `
        <div class="card input">
          <h2><span class="dot input"></span>${esc(inv.farmName)}</h2>
          <div class="field hint" style="margin-bottom:10px">You have been invited to join as
            ${esc(roleLabel(inv.role))}. ${esc(expiryText(inv.expiresAt))}.</div>
          <button class="btn" data-join="${i}">Join ${esc(inv.farmName)}</button>
        </div>`).join('')}
      <div class="card">
        <h2>Or start your own</h2>
        <div class="field hint" style="margin-bottom:10px">Only if you are setting up a
          separate farm. You do not need to do this to join the one above.</div>
        <button class="btn secondary" id="make-own">Create my own farm&hellip;</button>
      </div>
      <div id="join-problem"></div>
    </div>
  `;

  app.querySelectorAll('[data-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const inv = invitations[Number(btn.dataset.join)];
      btn.disabled = true;
      btn.textContent = 'Joining…';
      try {
        clearInvite();          // whichever route brought them here, it is spent
        await acceptInvitation(inv.token);
        boot();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `Join ${inv.farmName}`;
        app.querySelector('#join-problem').innerHTML =
          `<div class="card"><div class="hint" style="color:var(--danger)">${esc(e.message)}</div></div>`;
      }
    });
  });

  app.querySelector('#make-own').addEventListener('click', () => {
    renderLogin(app, { mode: 'farm', onDone: boot });
  });
}

async function boot() {
  const session = await getSession();
  const pendingInvite = readInvite();

  if (!session) {
    currentRole = null;
    setChromeVisible(false);
    // The login screen says why they are looking at it. Arriving on an
    // invitation link and being shown a bare sign-in form reads as a dead link.
    renderLogin(app, { onDone: boot, invited: !!pendingInvite });
    return;
  }

  let joined = null;
  if (pendingInvite) {
    setChromeVisible(false);
    app.innerHTML = '<div class="empty">Joining the farm…</div>';
    try {
      joined = await acceptInvitation(pendingInvite);
      clearInvite();
    } catch (e) {
      // The token is deliberately kept. Every failure here except a genuinely
      // dead link is fixed by signing in as somebody else.
      renderInviteRefused(e.message);
      return;
    }
  }

  const membership = await getMembership(session?.user?.id);
  if (!membership) {
    setChromeVisible(false);

    // Before offering to create a farm, ask whether one is already waiting for
    // this address. The link is a convenience, not the mechanism — and the
    // first real invitee proved it, by signing up at the app's address, being
    // shown this screen, and dutifully creating a farm he did not want.
    app.innerHTML = '<div class="empty">Checking for invitations…</div>';
    const invitations = await listMyInvitations();
    if (invitations.length) {
      renderInvitationsWaiting(invitations);
      return;
    }

    renderLogin(app, { mode: 'farm', onDone: boot });
    return;
  }

  // Joining a second farm is not something this app can show yet: one farm is
  // open at a time and pickMembership() opens the oldest, so accepting would
  // otherwise look like nothing happened at all. Say so instead.
  if (joined && joined.farmId && joined.farmId !== membership.farmId) {
    setChromeVisible(false);
    app.innerHTML = `
      <div class="topbar"><div><h1>Grainflow</h1><div class="sub">Invitation accepted</div></div></div>
      <div class="view"><div class="card">
        <h2>You have joined ${esc(joined.farmName || 'that farm')}</h2>
        <div class="hint" style="margin-top:6px">Grainflow shows one farm at a time, and this
          account is already on ${esc(membership.farmName || 'another farm')} — which is the one
          that will open. Switching between farms is not built yet.</div>
        <button class="btn" id="inv-ok" style="margin-top:14px">Open ${esc(membership.farmName || 'Grainflow')}</button>
      </div></div>`;
    await new Promise((resolve) => {
      app.querySelector('#inv-ok').addEventListener('click', resolve, { once: true });
    });
  }

  // Load the farm before anything renders. A view that paints against an
  // empty store and then repaints is a flash of wrong numbers, which on a
  // position screen is worse than a moment of nothing.
  setChromeVisible(true);
  app.innerHTML = '<div class="empty">Loading your farm…</div>';
  try {
    currentRole = membership.role;
    await db.init({ farmId: membership.farmId, role: membership.role });
  } catch (e) {
    app.innerHTML = `<div class="view"><div class="card">
      <h2>Could not load the farm</h2>
      <div class="hint">${e.message}</div></div></div>`;
    return;
  }

  // A brand new trial that asked for sample data. After db.init, deliberately:
  // the farm has to exist and be loaded before there is anywhere to put a
  // season, and importing through the ordinary path means it reconciles and
  // pushes exactly like a restored backup rather than by some private route.
  if (takeSampleDataRequest()) {
    app.innerHTML = '<div class="empty">Setting up your sample farm…</div>';
    try {
      const state = await fetchSampleFarm(membership.farmName);
      db.importJSON(JSON.stringify(state));
    } catch (e) {
      // Not fatal. They asked for a demonstration and will get an empty farm
      // instead, which is disappointing rather than broken — and far better
      // than a new account that will not open at all.
      console.error('Could not load the sample farm', e);
    }
  }

  // Land where this role can actually work — a driver opening onto an empty
  // Position screen is a poor first impression of an app they did not ask for.
  const landing = landingTabFor(currentRole);
  if (!location.hash || !canOpen(currentRole, location.hash.replace('#/', ''))) {
    location.hash = `#/${landing}`;
  }
  renderActiveView();
  renderYearPill();
}

// Signing in or out anywhere in the app re-runs the gate rather than trying to
// patch the current screen into shape.
onAuthChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') boot();
});

window.addEventListener('hashchange', () => {
  // Ignore hash changes while signed out — otherwise a stale #/position in the
  // address bar renders a view over the top of the login screen. Keyed on the
  // role rather than on tabbar.hidden, which used to mean "signed out" and now
  // also means "this role has one tab".
  if (!currentRole) return;
  renderActiveView();
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// The service worker is back on, and the app works with no signal again.
//
// It was off because the first one served version 74 for hours after 75
// shipped. The new one is built so that cannot happen: its cache is named after
// the build, so a new version cannot read the old one's, and index.html is
// never answered from cache while there is a network — it is the only file
// whose own URL carries no ?v=, so it is the only thing that can tell a device
// a new build exists.
//
// The version goes in the registration URL rather than being read inside the
// worker. That keeps version.js as the single source of truth, and it means the
// script itself is a new URL every release, which is what makes the browser
// notice there is something to install.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`)
      .catch((e) => console.error('Service worker did not register', e));
  });
}
