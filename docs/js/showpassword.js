// A "Show" button on the end of each password box, so a long or awkward password can be checked as it is typed.
// Tap it to see the letters; tap again to hide them. Used on sign in, create account, choose a new password and change password.

/** Wrap every password box under `root` with a Show / Hide button. Safe to call again on the same root. */
export function addShowPassword(root) {
  for (const input of root.querySelectorAll('input[type="password"]')) {
    if (input.closest('.pw-wrap')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      btn.textContent = showing ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(showing));
      input.focus();
    });
    wrap.appendChild(btn);
  }
}
