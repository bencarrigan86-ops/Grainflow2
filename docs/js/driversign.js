// The driver's signature on a load.
//
// The driver draws it on the phone when the truck is loaded, under the words in SIGN_WORDS. It is kept with the load as the lines
// it was drawn with (see signature.js), the name printed under it, the moment it was made, and a short print of what the load said
// then: the date, the commodity, the weights, the truck and where it came from and went. If the load is changed afterwards the print
// no longer matches and the load says so ("changed since it was signed"). Nothing is locked: the load can still be corrected, and
// the driver signs again. Pure: no page, no storage.

import { cleanStrokes, hasSignature } from './signature.js?v=494';

/** What the driver confirms, printed over the pad and under the signature on the ticket. */
export const SIGN_WORDS = 'I confirm I loaded this and the details are correct';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const legsOf = (legs) => (legs || [])
  .map((l) => `${l.type}:${l.id}:${r2(l.tons)}`)
  .sort()
  .join(',');

/** The parts of a load the driver is signing for, as one short text. Two loads that read the same give the same text. */
export function loadPrint(m) {
  const text = JSON.stringify([
    String(m?.date || ''), String(m?.commodityId || ''), r2(m?.tons), m?.grossWeight == null || m?.grossWeight === '' ? '' : r2(m.grossWeight),
    m?.tareWeight == null || m?.tareWeight === '' ? '' : r2(m.tareWeight), String(m?.truckRego || '').trim().toLowerCase(),
    String(m?.driver || '').trim().toLowerCase(), legsOf(m?.froms), legsOf(m?.tos),
  ]);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A signature as it is kept: real strokes, a name, a moment, and the print. null when there is nothing drawn. */
export function cleanDriverSignature(sig) {
  if (!sig || typeof sig !== 'object') return null;
  const strokes = cleanStrokes(sig.strokes);
  if (!strokes.length) return null;
  const at = Number.isFinite(Date.parse(sig.at)) ? new Date(sig.at).toISOString() : '';
  return { strokes, name: String(sig.name || '').trim().slice(0, 80), at, print: String(sig.print || '').slice(0, 20) };
}

/** What the driver drew, made into a signature on this load: the print is taken from the load as it stands. */
export function signLoad({ strokes, name = '', at = new Date().toISOString() }, load) {
  return cleanDriverSignature({ strokes, name, at, print: loadPrint(load) });
}

/** 'none' (not signed), 'signed', or 'changed' (signed, then the load was changed). */
export function signState(m) {
  const sig = cleanDriverSignature(m?.driverSignature);
  if (!sig) return 'none';
  return sig.print && sig.print !== loadPrint(m) ? 'changed' : 'signed';
}

/** When it was signed, as "16-11-2026 14:35" in the phone's own time; '' when not signed. */
export function signedWhen(sig) {
  const d = sig?.at ? new Date(sig.at) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export { hasSignature };
