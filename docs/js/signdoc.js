// Signing a document with the signed-in person's saved signature.
//
// The signature is the person's own (see mysignature.js). Documents that print from the browser (the confirmation of
// sale, the invoice) draw it as an inline picture; the freight order is a PDF and draws it as lines (see freight.js).
// This holds the parts that do not need a screen: the picture, the signed block, and what to print under it. Pure.

import { cleanStrokes, hasSignature, strokesToSvgPath, ASPECT } from './signature.js?v=437';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The signature as a picture in dark ink on the paper, for a printed document. Empty when there is nothing to draw. */
export function inkSvg(strokes, width = 150) {
  if (!hasSignature(strokes)) return '';
  const h = width / ASPECT;
  return `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Signature" style="display:block"><path d="${strokesToSvgPath(cleanStrokes(strokes), width)}" fill="none" stroke="#14171a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * The lines for a signed block: the signature, then the name and the date under it.
 * @param {{strokes: object[], name?: string}|null} sig the signer's saved signature
 * @param {{date?: string, role?: string}} [opts] the date as it should be written, and who is signing ("Seller")
 * @returns {string} HTML, or '' when there is no signature to show
 */
export function signedBlockHTML(sig, { date = '', role = '' } = {}) {
  if (!sig || !hasSignature(sig.strokes)) return '';
  return `
    <div class="line" style="margin-top:8px">${role ? `${esc(role)} signed` : 'Signed'}</div>
    ${inkSvg(sig.strokes, 150)}
    <div class="line" style="margin-top:4px;border-top:1px solid #999;padding-top:3px">${sig.name ? esc(sig.name) : ''}${date ? `${sig.name ? ' &middot; ' : ''}${esc(date)}` : ''}</div>`;
}

/** Whether a signature can be drawn on a document: it has real strokes. */
export const canSign = (sig) => !!sig && hasSignature(sig.strokes);

/** The name to print under a signature: the one saved with it, else the business contact, else nothing. */
export const signerName = (sig, business = {}) => String(sig?.name || business?.contactName || '').trim();

/** The names typed in "who signs for the business" (one to a line, or separated by commas) as a list, each once. */
export function parseSigners(text) {
  const seen = new Set();
  return String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The names a document can be signed in, each once: the signed-in person's own (the name saved with their signature) first, then the
 * ones the business lists as people who sign, then the business contact.
 */
export function signerChoices({ mine = '', signers = '', contactName = '' } = {}) {
  return parseSigners([mine, ...parseSigners(signers), contactName].join('\n'));
}
