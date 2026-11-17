// Showing a long list in pages: the latest `limit` rows, extended to the end of the day they reach so a day is never cut in half.
// `rows` must already be in the order shown (newest first). The totals and filters are worked out on the whole list; this only
// decides how much of it is drawn.

export const PAGE_SIZE = 25;

/** The rows to draw, and how many are held back. `dateOf(row)` gives the day a row belongs to. */
export function pageOfRows(rows, limit = PAGE_SIZE, dateOf = (r) => r.date || '') {
  const list = rows || [];
  const want = Math.max(1, Number(limit) || PAGE_SIZE);
  if (list.length <= want) return { rows: list, hidden: 0 };
  let end = want;
  while (end < list.length && dateOf(list[end]) === dateOf(list[end - 1])) end += 1;
  return { rows: list.slice(0, end), hidden: list.length - end };
}
