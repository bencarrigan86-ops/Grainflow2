// Fumigation of a silo, bunker or shed: when it was done, what with, and the date the withholding period ends.
//
// Grain that has been fumigated can't be loaded out until the withholding period is over, so each storage keeps its
// fumigations as a record (newest first when shown), and the latest one says whether the grain is clear to go.
// Pure, so it can be tested without the app: the form is in views/storage.js, the saving in mapping.js.

const clean = (v) => String(v ?? '').trim();
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(clean(v));

/** Add whole days to a yyyy-mm-dd date without going through the time zone. */
export function addDays(date, days) {
  if (!isDate(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + Math.round(Number(days) || 0)));
  return t.toISOString().slice(0, 10);
}

/** The first day the grain is clear to load out: the fumigation date plus the withholding days. */
export const withholdingEnd = (date, days) => (isDate(date) && Number(days) >= 0 && clean(days) !== '' ? addDays(date, days) : '');

/** The date a record clears: the one typed over if there is one, else worked out from the date and days. */
export const clearOn = (f) => (isDate(f?.endsOn) ? f.endsOn : withholdingEnd(f?.date, f?.days));

/** A record as it is kept: only what was filled in, with a date it can be sorted by. Null when it has no date. */
export function cleanFumigation(f) {
  if (!f || !isDate(f.date)) return null;
  const days = clean(f.days) === '' || !(Number(f.days) >= 0) ? '' : Math.round(Number(f.days));
  const out = { id: clean(f.id) || `f${f.date}-${Math.random().toString(36).slice(2, 7)}`, date: f.date };
  if (clean(f.product)) out.product = clean(f.product);
  if (days !== '') out.days = days;
  const end = clearOn({ ...f, days });
  if (end) out.endsOn = end;
  if (clean(f.notes)) out.notes = clean(f.notes);
  return out;
}

/** The record cleaned, dated ones only, newest first. */
export const fumigationLog = (list) => (Array.isArray(list) ? list : [])
  .map(cleanFumigation).filter(Boolean)
  .sort((a, b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));

const utc = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const daysBetween = (from, to) => Math.round((utc(to) - utc(from)) / 86400000);

/**
 * Where a storage stands today: `withheld` while the latest fumigation's period is still running, with the date it
 * clears and the days left; otherwise clear, with when it last cleared. `last` is that latest record, if any.
 */
export function fumigationState(storage, today) {
  const log = fumigationLog(storage?.fumigations);
  const last = log[0] || null;
  if (!last) return { last: null, withheld: false, clearOn: '', daysLeft: 0, count: 0 };
  const end = last.endsOn || '';
  const withheld = !!end && isDate(today) && today < end;
  return { last, withheld, clearOn: end, daysLeft: withheld ? daysBetween(today, end) : 0, count: log.length };
}

/** A load out of this storage on `date` that falls in a withholding period (after the fumigation, before it clears). */
export function withholdingClash(storage, date) {
  if (!isDate(date)) return null;
  return fumigationLog(storage?.fumigations).find((f) => f.endsOn && date >= f.date && date < f.endsOn) || null;
}

/** The short line for a list or a header, or '' when nothing was ever recorded. */
export function fumigationLine(state, fmtDate = (d) => d) {
  if (!state?.last) return '';
  return state.withheld
    ? `Withholding until ${fmtDate(state.clearOn)} (${state.daysLeft} day${state.daysLeft === 1 ? '' : 's'} left)`
    : state.clearOn ? `Clear since ${fmtDate(state.clearOn)}` : `Fumigated ${fmtDate(state.last.date)}`;
}
