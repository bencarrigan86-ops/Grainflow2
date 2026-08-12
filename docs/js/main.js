import { db } from './storage.js?v=31';
import { renderPosition } from './views/position.js?v=31';
import { renderProduction } from './views/production.js?v=31';
import { renderReports } from './views/reports.js?v=31';
import { renderSales } from './views/sales.js?v=31';
import { renderMovements } from './views/movements.js?v=31';
import { renderStorage } from './views/storage.js?v=31';
import { renderSettings } from './views/settings.js?v=31';

const SILO_ICON = `<svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><polygon points="12,1.5 21,8 3,8"/><rect x="4" y="8.6" width="16" height="2.6"/><rect x="4" y="11.7" width="16" height="2.6"/><rect x="4" y="14.8" width="16" height="2.6"/><polygon points="4,18 20,18 13.2,23 10.8,23"/></svg>`;

const TABS = [
  { id: 'position', label: 'Position', icon: '\u{1F33E}', render: renderPosition },
  { id: 'production', label: 'Production', icon: '\u{1F33F}', render: renderProduction },
  { id: 'reports', label: 'Reports', icon: '\u{1F4CA}', render: renderReports },
  { id: 'sales', label: 'Sales', icon: '\u{1F4B5}', render: renderSales },
  { id: 'movement', label: 'Movement', icon: '\u{1F69A}', render: renderMovements },
  { id: 'storage', label: 'Storage', icon: SILO_ICON, render: renderStorage },
  { id: 'settings', label: 'Settings', icon: '⚙️', render: renderSettings },
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
