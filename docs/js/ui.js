let backdrop = null;

export function closeSheet() {
  if (backdrop) {
    backdrop.remove();
    backdrop = null;
  }
}

/**
 * Open a bottom sheet. `buildBody(container)` receives the sheet's content div
 * to populate with fields/buttons. Returns the content container for convenience.
 */
export function openSheet(title, buildBody) {
  closeSheet();
  backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h2>${title}</h2>
      <button class="link-btn" data-close>Close</button>
    </div>
    <div class="sheet-body"></div>
  `;
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet);
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  const body = sheet.querySelector('.sheet-body');
  buildBody(body);
  return body;
}

export function confirmDelete(message, onConfirm) {
  // eslint-disable-next-line no-alert
  if (window.confirm(message)) onConfirm();
}

export function field({ label, id, type = 'text', value = '', options = null, step, hint, placeholder, allowNegative = false }) {
  const val = value === undefined || value === null ? '' : value;
  if (type === 'select') {
    const opts = options.map((o) => `<option value="${o.value}" ${String(o.value) === String(val) ? 'selected' : ''}>${o.label}</option>`).join('');
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <select id="${id}">${opts}</select>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>`;
  }
  // inputmode="decimal" gives iOS a numeric keypad with no minus key, so fields
  // that need negative values (e.g. a discount) must fall back to the default
  // number keyboard instead, which does include one.
  const inputmode = type !== 'number' ? 'text' : (allowNegative ? '' : 'decimal');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" value="${val}" ${step ? `step="${step}"` : ''} ${placeholder ? `placeholder="${placeholder}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} />
      ${hint ? `<div class="hint">${hint}</div>` : ''}
    </div>`;
}

export function getVal(root, id) {
  const el = root.querySelector(`#${id}`);
  if (!el) return null;
  return el.value;
}

export function getNum(root, id) {
  const v = getVal(root, id);
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}
