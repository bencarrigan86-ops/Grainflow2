import { renderPosition } from './views/position.js';
import { renderProduction } from './views/production.js';
import { renderSales } from './views/sales.js';
import { renderStorage } from './views/storage.js';
import { renderSettings } from './views/settings.js';

const TABS = [
  { id: 'position', label: 'Position', icon: '\u{1F33E}', render: renderPosition },
  { id: 'production', label: 'Production', icon: '\u{1F33F}', render: renderProduction },
  { id: 'sales', label: 'Sales', icon: '\u{1F4B5}', render: renderSales },
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
