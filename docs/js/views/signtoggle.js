// The "Sign this document" tickbox that sits above a printed document or a freight order.
//
// Ticking it fetches the signed-in person's saved signature and hands it to the document to draw. With no signature
// saved yet it says so and opens the pad, then the person ticks it again. The signature is theirs alone (see
// mysignature.js), so a document is only ever signed by the person looking at it.

import { loadMySignature, mySignatureOnDevice } from '../mysignature.js?v=472';
import { notify } from '../ui.js?v=472';
import { canSign, signerChoices } from '../signdoc.js?v=472';
import { esc } from '../fmt.js?v=472';
import { openMySignatureSheet } from './signaturepad.js?v=472';

export function signToggleHtml(id = 'sign-doc', label = 'Sign this document with my signature', checked = false) {
  return `<label class="row" style="gap:10px;align-items:center;cursor:pointer;margin:6px 0">
    <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} style="width:18px;height:18px" />
    <span>${label}</span></label>`;
}

/**
 * @param {HTMLElement} root
 * @param {string} id the tickbox's id
 * @param {(sig: {strokes: object[], name: string}|null) => void} onChange called with the signature when ticked, null when cleared
 */
export function wireSignToggle(root, id, onChange) {
  const box = root.querySelector(`#${id}`);
  if (!box) return;
  box.addEventListener('change', async () => {
    if (!box.checked) { onChange(null); return; }
    let sig = null;
    try { sig = await loadMySignature(); } catch { sig = null; }
    if (!canSign(sig)) {
      box.checked = false;
      await notify('You have not saved a signature yet. Draw it once and it signs any document you choose. Tick this again afterwards.');
      openMySignatureSheet();
      return;
    }
    onChange(sig);
  });
}

// --- the printed name under a signature -------------------------------------------------------------------------------------
// Every signed document shows who signed it in print. By default that is the signed-in person: the name saved with their signature.
// Where the business has listed other people who sign (Settings, Business details), or has a contact name, they are in a dropdown
// too, so a document can be signed for someone else. The last one chosen is remembered on this device.

const LAST_KEY = 'grainflow.signer.last';
const readLast = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };
const saveLast = (name) => { try { localStorage.setItem(LAST_KEY, name); } catch { /* not remembered */ } };

/** The names a document can be signed in: this person's own first, then the business's. Resolves to [] when there are none. */
export async function signerNamesFor(business = {}) {
  let mine = '';
  try { mine = (await mySignatureOnDevice())?.name || (await loadMySignature())?.name || ''; } catch { mine = ''; }
  return signerChoices({ mine, signers: business?.signers, contactName: business?.contactName });
}

/** The dropdown, empty and hidden until wireSignerPick() fills it (it is left out when there is no name to offer). */
export function signerPickHtml(id = 'signer-pick') {
  return `<div class="field" id="${id}-wrap" hidden style="margin:6px 0"><label for="${id}">Printed name</label><select id="${id}"></select></div>`;
}

/**
 * Fills the dropdown and calls onChange(name) when the person picks another. Returns { name() } for the document to read.
 * @param {HTMLElement} root
 */
export async function wireSignerPick(root, id, business, onChange = () => {}) {
  const sel = root.querySelector(`#${id}`);
  const names = await signerNamesFor(business);
  if (!sel || !names.length) return { name: () => '' };
  const last = readLast();
  sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  // the signed-in person is first, so they are the default; a name picked before on this device wins only where it is still on the list
  sel.value = names.includes(last) ? last : names[0];
  root.querySelector(`#${id}-wrap`).hidden = false;
  sel.addEventListener('change', () => { saveLast(sel.value); onChange(sel.value); });
  onChange(sel.value);
  return { name: () => sel.value };
}
