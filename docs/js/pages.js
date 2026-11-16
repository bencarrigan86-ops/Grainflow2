// Reading every row of a table, however many there are.
//
// Supabase answers one request with at most its "max rows" setting (1,000 unless the project changed it) and says
// nothing when it stops there: the rest of the table is simply not in the reply. A farm with seven years of loads has
// more than that, so each table is asked for in pages, until a page comes back empty. Ending on an empty page rather
// than a short one means it still works if the project's limit is ever set below the page size.

export const PAGE_SIZE = 1000;
const MAX_PAGES = 500;   // 500,000 rows: a stop for a fault, not a limit anyone should meet

/**
 * All the rows a query matches.
 * @param {() => object} build  makes a fresh query (select and filters, no order or range): one is made per page
 * @param {{pageSize?: number, key?: string}} [opts]  key is a column that is unique, so the pages never overlap
 * @returns {Promise<{data: object[]|null, error: object|null}>}
 */
export async function readAllPages(build, { pageSize = PAGE_SIZE, key = 'id' } = {}) {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await build().order(key).range(all.length, all.length + pageSize - 1);
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
