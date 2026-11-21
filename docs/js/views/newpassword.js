// "Choose a new password": the screen a password reset link opens on. The link has already signed the person in, for this one job.
// Same plain card as the sign-in screen. When it is done (or set aside) the app carries on as normal.

import { setNewPassword } from '../auth.js?v=506';
import { checkNewPassword } from '../recovery.js?v=506';
import { addShowPassword } from '../showpassword.js?v=506';

export function renderNewPassword(root, { onDone } = {}) {
  let busy = false;
  root.innerHTML = `
    <div class="topbar"><div><h1>Commodity Mate</h1><div class="sub">Choose a new password</div></div></div>
    <div class="view">
      <div class="card">
        <div class="field">
          <label for="np-new">New password</label>
          <input id="np-new" type="password" autocomplete="new-password" />
          <div class="hint">At least 6 characters.</div>
        </div>
        <div class="field">
          <label for="np-again">Type it again</label>
          <input id="np-again" type="password" autocomplete="new-password" />
        </div>
        <button class="btn" id="np-save">Save password</button>
        <div class="hint" id="np-problem" style="margin-top:12px;color:var(--danger)"></div>
      </div>
      <div class="empty" style="padding:16px 10px"><button class="link-btn" id="np-skip">Not now</button></div>
    </div>`;

  addShowPassword(root);
  const newEl = root.querySelector('#np-new');
  const againEl = root.querySelector('#np-again');
  const btn = root.querySelector('#np-save');
  const problem = root.querySelector('#np-problem');

  async function save() {
    if (busy) return;
    const why = checkNewPassword(newEl.value, againEl.value);
    if (why) { problem.textContent = why; return; }
    busy = true; btn.textContent = 'Saving…'; problem.textContent = '';
    try {
      await setNewPassword(newEl.value);
      busy = false;
      onDone?.({ changed: true });
    } catch (err) {
      busy = false; btn.textContent = 'Save password';
      problem.textContent = err.message;
    }
  }
  btn.addEventListener('click', save);
  [newEl, againEl].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
  root.querySelector('#np-skip').addEventListener('click', () => onDone?.({ changed: false }));
  newEl.focus();
}
