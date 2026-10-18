let backdrop = null;

export function closeSheet() {
  if (backdrop) {
    backdrop.remove();
    backdrop = null;
  }
}

/** HTML-escape for text dropped into a template string. */
export function escHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Open a bottom sheet. `buildBody(container)` receives the sheet's content div
 * to populate with fields/buttons. Returns the content container for convenience.
 */
export function openSheet(title, buildBody) {
  closeSheet();
  backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  // Tapping outside, or Close, used to throw away whatever had been typed
  // without a word. Saving closes the sheet through closeSheet() directly, so
  // only a deliberate walk-away is asked about, and only once something changed.
  let dirty = false;
  const leave = async () => {
    if (dirty && !(await askConfirm('Close without saving? What you have typed will be lost.', { confirmLabel: 'Discard', danger: true }))) return;
    closeSheet();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) leave();
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
  sheet.querySelector('[data-close]').addEventListener('click', leave);
  sheet.addEventListener('input', (e) => {
    // Search boxes and file pickers are not edits.
    if (e.target.matches?.('input[type="search"], input[type="file"]')) return;
    dirty = true;
  });
  backdrop.appendChild(sheet);
  document.body.appendChild(backdrop);

  const body = sheet.querySelector('.sheet-body');
  buildBody(body);
  return body;
}

function openDialog(message, buttons) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><p></p><div class="dialog-actions"></div></div>`;
    wrap.querySelector('p').textContent = message;
    const actions = wrap.querySelector('.dialog-actions');
    const done = (value) => { wrap.remove(); resolve(value); };
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn ${b.cls || ''}`.trim();
      el.textContent = b.label;
      el.addEventListener('click', () => done(b.value));
      actions.appendChild(el);
    });
    document.body.appendChild(wrap);
    actions.lastElementChild?.focus();
  });
}

/** A question that needs a yes or no. Resolves true / false. */
export function askConfirm(message, { confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return openDialog(message, [
    { label: cancelLabel, value: false, cls: 'secondary' },
    { label: confirmLabel, value: true, cls: danger ? 'danger' : '' },
  ]);
}

/** Something the person has to read before carrying on. Resolves when dismissed. */
export function notify(message) {
  return openDialog(message, [{ label: 'OK', value: true }]);
}

/** Delete confirmation. Same signature as it always had, without the browser's dialog. */
export function confirmDelete(message, onConfirm) {
  askConfirm(message, { confirmLabel: 'Delete', danger: true }).then((ok) => { if (ok) onConfirm(); });
}

/** A line that confirms something happened, then goes away on its own. */
export function toast(message, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function field({ label, id, type = 'text', value = '', options = null, step, hint, placeholder, allowNegative = false, list, rows = 2 }) {
  const val = value === undefined || value === null ? '' : value;
  if (type === 'select') {
    const opts = options.map((o) => `<option value="${escHtml(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('');
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <select id="${id}">${opts}</select>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>`;
  }
  if (type === 'textarea') {
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <textarea id="${id}" rows="${rows}" ${placeholder ? `placeholder="${placeholder}"` : ''}>${String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>`;
  }
  // inputmode="decimal" gives iOS a numeric keypad with no minus key, so fields
  // that need negative values (e.g. a discount) must fall back to the default
  // number keyboard instead, which does include one.
  const inputmode = type !== 'number' ? '' : (allowNegative ? '' : 'decimal');
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="${type}" value="${escHtml(val)}" ${step ? `step="${step}"` : ''} ${placeholder ? `placeholder="${placeholder}"` : ''} ${inputmode ? `inputmode="${inputmode}"` : ''} ${list ? `list="${list}" autocomplete="off"` : ''} />
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
