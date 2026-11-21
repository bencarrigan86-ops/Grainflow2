// An address in its parts: line 1, line 2, town, state and postcode.
//
// The parts are what a person fills in and what Xero wants. The one joined line ("12 Smith Rd, Wagin WA 6315") is what
// the invoice, the vendor declaration and the spray request print, and what every address was before it was split, so it
// stays in the old column and the parts ride beside it. An address that has never been split is read into parts when
// it is next edited.

import { field } from './ui.js?v=506';

export const STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
export const PART_KEYS = ['line1', 'line2', 'town', 'state', 'postcode'];

const str = (v) => String(v ?? '').trim();

/** The parts as clean strings: every key present, state in capitals. */
export function cleanParts(p) {
  const o = p && typeof p === 'object' ? p : {};
  return { line1: str(o.line1), line2: str(o.line2), town: str(o.town), state: str(o.state).toUpperCase(), postcode: str(o.postcode) };
}

export const hasParts = (p) => PART_KEYS.some((k) => str(p?.[k]) !== '');

/** "12 Smith Rd, Unit 4, Wagin WA 6315": the lines joined, with the town, state and postcode on one. */
export function joinAddress(p) {
  const c = cleanParts(p);
  return [c.line1, c.line2, [c.town, c.state, c.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

/** The lines of an address to print one under another: line 1, line 2, then town, state and postcode. */
export function addressLines(p) {
  const c = cleanParts(p);
  return [c.line1, c.line2, [c.town, c.state, c.postcode].filter(Boolean).join(' ')].filter(Boolean);
}

/** The lines to print for an address held as text with parts beside it. */
export const addressLinesOf = (text, parts) => addressLines(partsOf(text, parts));

const STATE_END = new RegExp(`^(.*?)[\\s,]+(${STATES.join('|')})[\\s,]+(\\d{4})$`, 'i');

/**
 * An address written as one line, taken into parts as well as it can be. Where it ends in a state and a four digit
 * postcode those are split off, and the town is the last comma-separated piece before them. Anything it cannot read
 * with confidence goes whole into line 1, so nothing is lost and nothing is guessed at.
 */
export function parseAddress(text) {
  const t = str(String(text ?? '').replace(/\s*[\r\n]+\s*/g, ', '));
  const none = cleanParts({});
  if (!t) return none;
  const m = STATE_END.exec(t);
  if (!m) return { ...none, line1: t };
  const state = m[2].toUpperCase();
  const postcode = m[3];
  const segs = m[1].split(',').map(str).filter(Boolean);
  if (segs.length >= 2) {
    const town = segs.pop();
    const line1 = segs.shift();
    return { line1, line2: segs.join(', '), town, state, postcode };
  }
  // "Wagin WA 6315" is a town; "12 Smith Rd Wagin WA 6315" has no comma to say where the street ends, so it stays whole in line 1
  if (segs.length === 1 && !/\d/.test(segs[0])) return { ...none, town: segs[0], state, postcode };
  return { ...none, line1: t };
}

/**
 * The parts to show for an address that is stored as text with parts beside it. The stored parts are used while they
 * still say what the text says; if the text was changed some other way (an older copy of the app saving just the line),
 * the text wins and is read into parts again.
 */
export function partsOf(text, parts) {
  const t = str(text);
  if (hasParts(parts) && joinAddress(parts) === t) return cleanParts(parts);
  return parseAddress(t);
}

/** The five boxes for an address, ids `${prefix}-line1` and so on. */
export function addressFields(prefix, p, { label = 'Address', optional = false } = {}) {
  const c = cleanParts(p);
  const sfx = optional ? ' (optional)' : '';
  return `
    ${field({ label: `${label}${sfx}: line 1`, id: `${prefix}-line1`, value: c.line1, placeholder: 'Street, PO Box or property name' })}
    ${field({ label: `${label}: line 2`, id: `${prefix}-line2`, value: c.line2, placeholder: 'Unit, lot or building (if any)' })}
    <div class="grid-3 addr-row">
      ${field({ label: 'Town or suburb', id: `${prefix}-town`, value: c.town })}
      ${field({ label: 'State', id: `${prefix}-state`, type: 'select', value: c.state, options: [{ value: '', label: '' }, ...STATES.map((s) => ({ value: s, label: s }))] })}
      ${field({ label: 'Postcode', id: `${prefix}-postcode`, value: c.postcode })}
    </div>`;
}

/** The parts typed into the boxes that addressFields drew. */
export function readAddress(root, prefix) {
  const v = (k) => root.querySelector(`#${prefix}-${k}`)?.value ?? '';
  return cleanParts(Object.fromEntries(PART_KEYS.map((k) => [k, v(k)])));
}
