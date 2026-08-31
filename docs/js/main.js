import { db } from './storage.js?v=49';
import { renderPosition } from './views/position.js?v=49';
import { renderProduction } from './views/production.js?v=49';
import { renderReports } from './views/reports.js?v=49';
import { renderSales } from './views/sales.js?v=49';
import { renderMovements } from './views/movements.js?v=49';
import { renderStorage } from './views/storage.js?v=49';
import { renderSettings } from './views/settings.js?v=49';

// Tab icons are hand-drawn rather than emoji: emoji render differently on
// every platform, and there is no silo (or barn) emoji at all, so the set
// could never be consistent. All seven share one idiom — 24x24 box, solid
// currentColor fill, no strokes, chunky enough to hold up at 21px.
const SILO_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><polygon points="12,1.5 21,8 3,8"/><rect x="4" y="8.6" width="16" height="2.6"/><rect x="4" y="11.7" width="16" height="2.6"/><rect x="4" y="14.8" width="16" height="2.6"/><polygon points="4,18 20,18 13.2,23 10.8,23"/></svg>`;

// A heap on a floor — grain on hand, the thing Position actually reports.
const POSITION_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><polygon points="12,3.5 22,16 2,16"/><rect x="2" y="17.6" width="20" height="2.8"/></svg>`;

// Stem and two leaves — the paddock side.
const PRODUCTION_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="10.7" y="9" width="2.6" height="13"/><polygon points="10.7,12 2,9.5 3.5,3.5 10.7,7.5"/><polygon points="13.3,12 22,9.5 20.5,3.5 13.3,7.5"/></svg>`;

const REPORTS_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="13" width="4.8" height="9"/><rect x="9.6" y="6.5" width="4.8" height="15.5"/><rect x="16.7" y="10" width="4.8" height="12"/></svg>`;

// Banknote. The centre is cut out with fill-rule, not a second colour.
const SALES_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M1.5 5h21v14h-21V5zm10.5 3.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6z"/></svg>`;

const MOVEMENT_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="5" width="13" height="11"/><polygon points="15,8.5 19,8.5 23,12.5 23,16 15,16"/><circle cx="6" cy="18.6" r="2.6"/><circle cx="18" cy="18.6" r="2.6"/></svg>`;

// Sliders — the horizontal bands deliberately echo the silo at the other
// end of the tab bar.
const SETTINGS_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4.8" width="20" height="2.4"/><circle cx="8" cy="6" r="3.3"/><rect x="2" y="10.8" width="20" height="2.4"/><circle cx="16" cy="12" r="3.3"/><rect x="2" y="16.8" width="20" height="2.4"/><circle cx="10" cy="18" r="3.3"/></svg>`;

const TABS = [
  { id: 'position', label: 'Position', icon: POSITION_ICON, render: renderPosition },
  { id: 'production', label: 'Production', icon: PRODUCTION_ICON, render: renderProduction },
  { id: 'reports', label: 'Reports', icon: REPORTS_ICON, render: renderReports },
  { id: 'sales', label: 'Sales', icon: SALES_ICON, render: renderSales },
  { id: 'movement', label: 'Movement', icon: MOVEMENT_ICON, render: renderMovements },
  { id: 'storage', label: 'Storage', icon: SILO_ICON, render: renderStorage },
  { id: 'settings', label: 'Settings', icon: SETTINGS_ICON, render: renderSettings },
];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

function currentTabId() {
  const hash = location.hash.replace('#/', '');
  return TABS.some((t) => t.id === hash) ? hash : 'position';
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

function renderActiveView() {
  const active = currentTabId();
  const tab = TABS.find((t) => t.id === active);
  app.innerHTML = '';
  tab.render(app);
  renderTabbar();
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
