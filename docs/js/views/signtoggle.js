// The "Sign this document" tickbox that sits above a printed document or a freight order.
//
// Ticking it fetches the signed-in person's saved signature and hands it to the document to draw. With no signature
// saved yet it says so and opens the pad, then the person ticks it again. The signature is theirs alone (see
// mysignature.js), so a document is only ever signed by the person looking at it.

import { loadMySignature } from '../mysignature.js?v=282';
import { notify } from '../ui.js?v=282';
import { canSign } from '../signdoc.js?v=282';
import { openMySignatureSheet } from './signaturepad.js?v=282';

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
