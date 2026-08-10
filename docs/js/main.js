import { renderPosition } from './views/position.js?v=7';
import { renderProduction } from './views/production.js?v=7';
import { renderSales } from './views/sales.js?v=7';
import { renderMovements } from './views/movements.js?v=7';
import { renderStorage } from './views/storage.js?v=7';
import { renderSettings } from './views/settings.js?v=7';

const TABS = [
  { id: 'position', label: 'Position', icon: '\u{1F33E}', render: renderPosition },
  { id: 'production', label: 'Production', icon: '\u{1F33F}', render: renderProduction },
  { id: 'sales', label: 'Sales', icon: '\u{1F4B5}', render: renderSales },
  { id: 'movement', label: 'Movement', icon: '\u{1F69A}', render: renderMovements },
  { id: 'storage', label: 'Storage', icon: '\u{1F6E2}', render: renderStorage },
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
