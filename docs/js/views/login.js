// The signed-out screen: sign in, create an account, and — for a brand new
// account with no farm yet — name the farm.
//
// Deliberately built from the app's existing .card / .field / .btn classes
// rather than new styling, so it looks like the rest of Grainflow rather than
// a login page bolted onto the front of it.

import { signIn, signUp, createFarm } from '../auth.js?v=69';

export function renderLogin(root, { mode = 'signin', onDone } = {}) {
  let busy = false;

  function draw(current, message, messageKind) {
    const isSignUp = current === 'signup';
    const isFarm = current === 'farm';

    root.innerHTML = `
      <div class="topbar">
        <div>
          <h1>Grainflow</h1>
          <div class="sub">${
            isFarm ? 'One last thing' : isSignUp ? 'Create an account' : 'Sign in to your farm'
          }</div>
        </div>
      </div>
      <div class="view">
        <div class="card">
          ${isFarm ? farmForm() : credentialsForm(isSignUp)}
          ${message ? `<div class="hint" style="margin-top:12px;color:${
            messageKind === 'error' ? 'var(--danger)' : 'var(--text-dim)'
          }">${message}</div>` : ''}
        </div>
        ${isFarm ? '' : `
          <div class="empty" style="padding:16px 10px">
            ${isSignUp
              ? 'Already have an account? <button class="link-btn" id="to-signin">Sign in</button>'
              : 'No account yet? <button class="link-btn" id="to-signup">Create one</button>'}
          </div>
          <!--
            On iOS a home-screen app has its own storage, sealed off from
            Safari. Anyone who used Grainflow before accounts existed has a
            season in that container which the signed-out app cannot show them
            and which Safari cannot see at all.

            A plain anchor, deliberately: it navigates within the app's scope,
            so it opens inside the home-screen app rather than kicking out to
            the browser — which would land in the wrong storage container and
            find nothing.
          -->
          <div class="empty" style="padding:4px 10px 20px">
            <a href="./legacy-export.html" class="link-btn"
               style="text-decoration:none">Recover data from an earlier version</a>
          </div>`}
      </div>
    `;

    if (isFarm) {
      wireFarm();
    } else {
      wireCredentials(isSignUp);
      root.querySelector('#to-signup')?.addEventListener('click', () => draw('signup'));
      root.querySelector('#to-signin')?.addEventListener('click', () => draw('signin'));
    }
  }

  function credentialsForm(isSignUp) {
    return `
      <div class="field">
        <label>Email</label>
        <input id="email" type="email" inputmode="email" autocomplete="email"
               autocapitalize="none" spellcheck="false" />
      </div>
      <div class="field">
        <label>Password</label>
        <input id="password" type="password"
               autocomplete="${isSignUp ? 'new-password' : 'current-password'}" />
        ${isSignUp ? '<div class="hint">At least 6 characters.</div>' : ''}
      </div>
      <button class="btn" id="submit">${isSignUp ? 'Create account' : 'Sign in'}</button>
    `;
  }

  function farmForm() {
    return `
      <div class="field">
        <label>Farm or business name</label>
        <input id="farm-name" type="text" autocapitalize="words" />
        <div class="hint">This is the entity that appears on your invoices. You can change it later in Settings.</div>
      </div>
      <button class="btn" id="create-farm">Create farm</button>
    `;
  }

  function wireCredentials(isSignUp) {
    const emailEl = root.querySelector('#email');
    const passEl = root.querySelector('#password');
    const btn = root.querySelector('#submit');

    async function submit() {
      if (busy) return;
      const email = emailEl.value.trim();
      const password = passEl.value;
      if (!email || !password) {
        draw(isSignUp ? 'signup' : 'signin', 'Enter both an email and a password.', 'error');
        return;
      }

      busy = true;
      btn.textContent = isSignUp ? 'Creating…' : 'Signing in…';
      try {
        if (isSignUp) {
          const { needsConfirmation } = await signUp(email, password);
          if (needsConfirmation) {
            busy = false;
            draw('signin',
              'Account created. Check your email for a confirmation link, then sign in.',
              'info');
            return;
          }
          busy = false;
          draw('farm');
          return;
        }
        await signIn(email, password);
        busy = false;
        onDone?.();
      } catch (err) {
        busy = false;
        draw(isSignUp ? 'signup' : 'signin', err.message, 'error');
      }
    }

    btn.addEventListener('click', submit);
    // Enter should submit — a login form that ignores the return key is the
    // kind of small wrongness people notice without being able to name it.
    [emailEl, passEl].forEach((el) =>
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  }

  function wireFarm() {
    const nameEl = root.querySelector('#farm-name');
    const btn = root.querySelector('#create-farm');

    async function submit() {
      if (busy) return;
      const name = nameEl.value.trim();
      if (!name) {
        draw('farm', 'Give the farm a name.', 'error');
        return;
      }
      busy = true;
      btn.textContent = 'Creating…';
      try {
        await createFarm(name);
        busy = false;
        onDone?.();
      } catch (err) {
        busy = false;
        draw('farm', err.message, 'error');
      }
    }

    btn.addEventListener('click', submit);
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  draw(mode);
}
