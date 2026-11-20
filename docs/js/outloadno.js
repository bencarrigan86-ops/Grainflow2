// The outload number: the number a truck quotes at a third-party site (GrainCorp or similar). The site keeps it on its ticket, and
// the delivery file that comes back is matched to the load by it.
//
// It is the season, the person's own digit and that person's count: 26 1 001 is 261001, the first one for person 1 in the 2026
// season. Every person on the farm has a digit of their own (1 to 9, handed out by the server), so two phones that are both out of
// signal at once can never give out the same number, and nothing needs the server at the moment a number is wanted.
//
// The next number is worked out from the loads the phone already holds: one more than the highest count so far under the same
// season and digit. A person who leaves, and whose digit goes to someone new, is carried on from where they stopped.
// Pure: no state, no clock.

const num = (v) => Number(v);

/** The two digits for a season: its first four-digit year, or failing that the year of a date ("2026" is 26, "2025/26" is 25). */
export function seasonYY(label, dateIso = '') {
  const fromLabel = String(label ?? '').match(/(?:^|\D)(\d{4})(?:\D|$)/);
  const year = fromLabel ? fromLabel[1] : String(dateIso ?? '').slice(0, 4);
  return /^\d{4}$/.test(year) ? year.slice(2) : '';
}

/** Whatever was typed or came in a file, as digits only: "261 007", "26-1007" and "261007 " are all 261007. */
export const normaliseOutloadNo = (raw) => String(raw ?? '').replace(/\D+/g, '');

/** A number taken to pieces: its season, the person's digit and their count. Null when it is not one of ours. */
export function outloadParts(no) {
  const s = normaliseOutloadNo(no);
  if (!/^\d{6,}$/.test(s)) return null;
  return { yy: s.slice(0, 2), series: Number(s[2]), seq: Number(s.slice(3)), text: s };
}

/** Does the number's season agree with the load's? A mistyped number that lands in the wrong year does not. */
export const outloadSeasonOk = (no, yy) => { const p = outloadParts(no); return !p || !yy || p.yy === yy; };

/**
 * The next number for this person in this season.
 * @param {{series: number, yy: string, movements: object[]}} p  `series` is the person's digit (1 to 9)
 * @returns {string|null} null when there is no digit or no season to put on it
 */
export function nextOutloadNo({ series, yy, movements = [] } = {}) {
  const digit = num(series);
  if (!(digit >= 1 && digit <= 9) || !/^\d{2}$/.test(String(yy ?? ''))) return null;
  const prefix = `${yy}${digit}`;
  let top = 0;
  for (const m of movements || []) {
    const s = normaliseOutloadNo(m?.outloadNo);
    if (s.length < prefix.length + 1 || !s.startsWith(prefix)) continue;
    const seq = num(s.slice(prefix.length));
    if (Number.isInteger(seq) && seq > top) top = seq;
  }
  return `${prefix}${String(top + 1).padStart(3, '0')}`;
}

/** Is this one of the plain numbers loads were given before the season, person and count form (1, 2, 231...)? Nothing at all counts as plain too. */
export const isPlainNumber = (no) => normaliseOutloadNo(no).length < 6;

/**
 * Numbers for loads that have the old plain ones: the next ones in this person's series, in the order the loads happened (date, time,
 * then the number they have now), each one counting on from the last. Nothing is changed here; this is the list of what would be.
 * @param {{loads: object[], used: object[], series: number, yy: string}} p  "used" is every load the farm holds, as { outloadNo } (a ticket or an outload number)
 * @returns {{id: string, from: *, to: number}[]}  empty when there is no digit or season to put on the numbers
 */
export function renumberPlan({ loads = [], used = [], series, yy } = {}) {
  const first = nextOutloadNo({ series, yy, movements: used });
  if (!first) return [];
  const prefix = first.slice(0, 3);
  let seq = num(first.slice(3));
  const ordered = [...loads].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.loadTime || '').localeCompare(String(b.loadTime || '')) || (num(a.ticketNo) || 0) - (num(b.ticketNo) || 0));
  return ordered.map((m) => { const to = num(`${prefix}${String(seq).padStart(3, '0')}`); seq += 1; return { id: m.id, from: m.ticketNo, to }; });
}

/**
 * Numbers used by more than one load. Two people typing a number by hand, or one person on two phones, can do it; the app says
 * so and the import will not guess between them.
 * @returns {Map<string, object[]>} the number (digits only) and the loads that carry it
 */
export function duplicateOutloads(movements) {
  const by = new Map();
  for (const m of movements || []) {
    const s = normaliseOutloadNo(m?.outloadNo);
    if (!s) continue;
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(m);
  }
  for (const [k, list] of [...by]) if (list.length < 2) by.delete(k);
  return by;
}
