import { db } from './storage.js?v=53';
import { renderPosition } from './views/position.js?v=53';
import { renderProduction } from './views/production.js?v=53';
import { renderReports } from './views/reports.js?v=53';
import { renderSales } from './views/sales.js?v=53';
import { renderMovements } from './views/movements.js?v=53';
import { renderStorage } from './views/storage.js?v=53';
import { renderSettings } from './views/settings.js?v=53';

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
const ROUTES = [
  ...TABS,
  { id: 'settings', label: 'Settings', icon: SETTINGS_ICON, render: renderSettings },
];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

function currentTabId() {
  const hash = location.hash.replace('#/', '');
  return ROUTES.some((t) => t.id === hash) ? hash : 'position';
}

function renderTabbar() {
  const active = currentTabId();
  tabbar.innerHTML = TABS.map((t) => `
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
  location.hash = '#/settings';
});

function renderActiveView() {
  const active = currentTabId();
  const route = ROUTES.find((t) => t.id === active);
  app.innerHTML = '';
  route.render(app);
  renderTabbar();
  settingsBtn.classList.toggle('active', active === 'settings');
}

const yearPill = document.getElementById('year-pill');
function renderYearPill() {
  yearPill.textContent = db.getCurrentYear();
}
yearPill.addEventListener('click', () => {
  location.hash = '#/settings';
});
db.subscribe(renderYearPill);
renderYearPill();

window.addEventListener('hashchange', renderActiveView);
window.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) location.hash = '#/position';
  renderActiveView();
});
if (document.readyState !== 'loading') {
  if (!location.hash) location.hash = '#/position';
  renderActiveView();
}

// The service worker is off while this app is under active development —
// an installed SW is exactly what makes a device get stuck on stale code,
// which defeats the "force refresh" button meant to fix that. Self-heal any
// device that already has one registered from an earlier build, and re-enable
// registration (see git history) once the app is ready to ship for real.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  });
}
