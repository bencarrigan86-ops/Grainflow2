// Reading every row of a table, however many there are.
//
// Supabase answers one request with at most its "max rows" setting (1,000 unless the project changed it) and says
// nothing when it stops there: the rest of the table is simply not in the reply. A farm with seven years of loads has
// more than that, so a table too long for one reply is asked for in pages.
//
// The first request is the plain one the app always made, with the server asked to say how many rows the table has. When
// that reply holds all of them (nearly every table, nearly every time) it is used as it came, in the order the server
// gave it, so the lists on screen stay in the order they always had. Only when the table is longer than one reply is it
// read again in a fixed order, a page at a time: paging has to be sorted, or rows could repeat or go missing between
// pages, and the sort (when it was made, then the id) is the closest thing to the order the rows were saved in.

export const PAGE_SIZE = 1000;
const MAX_PAGES = 500;   // 500,000 rows: a stop for a fault, not a limit anyone should meet

/**
 * All the rows a query matches.
 * @param {() => object} build  makes a fresh query: select with { count: 'exact' } and the filters, but no order or range
 * @param {{pageSize?: number, keys?: string[]}} [opts]  keys are the columns that put the rows in a fixed order, the last one unique
 * @returns {Promise<{data: object[]|null, error: object|null}>}
 */
export async function readAllPages(build, { pageSize = PAGE_SIZE, keys = ['created_at', 'id'] } = {}) {
  const first = await build();
  if (first.error) return { data: null, error: first.error };
  const got = first.data || [];
  // the whole table came in one reply: keep it exactly as the server sent it
  if (typeof first.count === 'number' && got.length >= first.count) return { data: got, error: null };

  // too long for one reply (or the server did not say how long it is): read it again, sorted, a page at a time
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = build();
    for (const k of keys) query = query.order(k);
    const { data, error } = await query.range(all.length, all.length + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) return { data: all, error: null };
    all.push(...data);
  }
  return { data: all, error: { message: `More than ${MAX_PAGES * pageSize} rows; stopped reading` } };
}

/**
 * All the rows whose `column` is one of `ids`, asked for a slice of the ids at a time so the request stays short.
 * @param {(slice: string[]) => object} build  makes a query for one slice of the ids
 */
export async function readAllIn(build, ids, { chunk = 100, ...opts } = {}) {
  const all = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const { data, error } = await readAllPages(() => build(ids.slice(i, i + chunk)), opts);
    if (error) return { data: null, error };
    all.push(...data);
  }
  return { data: all, error: null };
}
