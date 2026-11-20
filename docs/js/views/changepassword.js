// Change password, from the Account screen: the current one, then the new one twice.

import { openSheet, closeSheet, field, getVal, toast } from '../ui.js?v=451';
import { changePassword } from '../auth.js?v=451';
import { checkNewPassword } from '../recovery.js?v=451';
import { addShowPassword } from '../showpassword.js?v=451';

export function openChangePasswordSheet() {
  openSheet('Change password', (root) => {
    root.innerHTML = `
      <div class="field"><label for="cp-current">Current password</label><input id="cp-current" type="password" autocomplete="current-password" /></div>
      ${field({ label: 'New password', id: 'cp-new', type: 'password', hint: 'At least 6 characters.' })}
      ${field({ label: 'Type the new one again', id: 'cp-again', type: 'password' })}
      <div class="hint" id="cp-problem" style="color:var(--danger);margin:6px 0"></div>
      <button class="btn" id="cp-save">Change password</button>`;
    // password boxes get the right autofill hints, so a phone offers to remember the new one
    root.querySelector('#cp-new')?.setAttribute('autocomplete', 'new-password');
    root.querySelector('#cp-again')?.setAttribute('autocomplete', 'new-password');
    addShowPassword(root);
    const btn = root.querySelector('#cp-save');
    const problem = root.querySelector('#cp-problem');
    let busy = false;
    btn.addEventListener('click', async () => {
      if (busy) return;
      const current = getVal(root, 'cp-current') || '';
      if (!current) { problem.textContent = 'Type your current password.'; return; }
      const why = checkNewPassword(getVal(root, 'cp-new') || '', getVal(root, 'cp-again') || '');
      if (why) { problem.textContent = why; return; }
      busy = true; btn.textContent = 'Changing…'; problem.textContent = '';
      try {
        await changePassword(current, getVal(root, 'cp-new'));
        busy = false;
        closeSheet(); toast('Password changed');
      } catch (err) {
        busy = false; btn.textContent = 'Change password';
        problem.textContent = err.message;
      }
    });
  }, { askBeforeClose: false });
}
