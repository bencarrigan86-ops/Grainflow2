// Past sales from the farm's own records.
//
// A farm that kept a contract register before it used the app has, for each season, a list of contracts: who bought,
// what, how much, at what price, and how much has gone. This reads that list from a CSV (one row per contract) and
// plans what it adds to each season, so the position for those years (production, sold, unsold) can be read.
//
// Columns (the heading names below, in any order; other columns are ignored):
//   Season, Commodity, Tonnes, Price         required
//   Date, Buyer, Contract No, Grade, Delivered, Freight, Premium / Discount, Levies, Delivery from, Delivery to,
//   Destination, Broker, Contract type, Our ref, Notes     optional
//
// Price is the delivered price in $/t. Freight and Levies are costs to the seller, so either sign reads the same
// (a freight of -25 and of 25 are both $25 a tonne off). Premium / Discount keeps its sign: -5.61 is a discount.
// Levies are $/t, or a percentage under the heading "Levies (%)". Pure.

import { parseCsv, detectDelimiter, matchCommodity, parseDate } from './loadimport.js?v=319';
import { saleEconomics } from './derived.js?v=319';

const ALIASES = {
  season: ['season', 'year', 'crop year'],
  date: ['date', 'contract date', 'sale date'],
  buyer: ['buyer'],
  contractNo: ['contract no', 'contract number', 'contract #', 'contract'],
  commodity: ['commodity', 'crop'],
  grade: ['grade'],
  tons: ['tonnes', 'tons', 'contract tonnes', 'contract tons', 'quantity'],
  price: ['price', 'price ($/t)', 'price (delivered)', 'delivered price', 'price delivered'],
  freight: ['freight', 'freight ($/t)'],
  premium: ['premium / discounts', 'premium/discounts', 'premium / discount', 'premium/discount', 'premium', 'discount', 'premium ($/t)'],
  levies: ['levies', 'levies ($/t)'],
  leviesPct: ['levies (%)', 'levies %'],
  delivered: ['delivered', 'delivered (t)', 'tonnes delivered', 'tons delivered'],
  deliveryStart: ['delivery from', 'delivery start'],
  deliveryEnd: ['delivery to', 'delivery end'],
  destination: ['destination', 'location', 'delivery point'],
  broker: ['broker'],
  contractType: ['contract type', 'type'],
  ourRef: ['our ref', 'sale no', 'sale number'],
  notes: ['notes', 'comments'],
};

const clean = (v) => String(v ?? '').trim();
const collapse = (v) => clean(v).replace(/\s+/g, ' ');
const numberOrNull = (v) => {
  const t = clean(v).replace(/[,$\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const round = (n, dp) => { const f = 10 ** dp; return Math.round((Number(n) || 0) * f) / f; };
const exactKey = (s) => collapse(s).toLowerCase();

/**
 * @param {string} text the CSV
 * @returns {{rows: object[], errors: string[], warnings: string[]}}  errors are rows left out, warnings are rows kept with something not read
 */
export function parsePastSales(text) {
  const table = parseCsv(text, detectDelimiter(text));
  const errors = [];
  const warnings = [];
  if (table.length < 2) return { rows: [], errors: ['The file has no rows.'], warnings };
  const head = table[0].map((h) => clean(h).toLowerCase());
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) col[key] = head.findIndex((h) => names.includes(h));
  const label = { season: 'Season', commodity: 'Commodity', tons: 'Tonnes', price: 'Price' };
  const missing = ['season', 'commodity', 'tons', 'price'].filter((k) => col[k] < 0);
  if (missing.length) return { rows: [], errors: [`The first row needs these headings: ${missing.map((k) => label[k]).join(', ')}.`], warnings };

  const rows = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (k) => (col[k] >= 0 ? r[col[k]] : '');
    const season = collapse(get('season'));
    const commodity = collapse(get('commodity'));
    if (!season && !commodity && !clean(get('tons'))) return;
    if (!season || !commodity) { errors.push(`Row ${line}: needs a season and a commodity.`); return; }
    if (season.length > 20) { errors.push(`Row ${line}: "${season}" is not a season name.`); return; }
    const who = collapse(get('buyer')) || collapse(get('contractNo')) || commodity;
    const tons = numberOrNull(get('tons'));
    if (tons === null || Number.isNaN(tons) || tons <= 0) { errors.push(`Row ${line}: ${who} needs the tonnes sold.`); return; }
    const price = numberOrNull(get('price'));
    if (price === null || Number.isNaN(price) || price < 0) { errors.push(`Row ${line}: ${who} needs a price in $/t.`); return; }
    const num = (k, fallback = 0) => { const v = numberOrNull(get(k)); return v === null || Number.isNaN(v) ? fallback : v; };
    const bad = (k) => { const v = numberOrNull(get(k)); return v !== null && Number.isNaN(v); };
    for (const k of ['freight', 'premium', 'levies', 'leviesPct', 'delivered']) {
      if (bad(k)) { warnings.push(`Row ${line}: ${who} has a ${k === 'leviesPct' ? 'levies %' : k} that is not a number, so it was left as 0.`); }
    }

    const freight = Math.abs(num('freight'));
    const net = price - freight;
    let leviesPct = 0;
    if (clean(get('leviesPct')) !== '') leviesPct = Math.abs(num('leviesPct')) / 100;
    else if (num('levies') !== 0 && net > 0) leviesPct = Math.abs(num('levies')) / net;

    const dateOf = (k) => {
      const raw = clean(get(k));
      if (!raw) return '';
      const iso = parseDate(raw, 'dmy');
      if (!iso) warnings.push(`Row ${line}: ${who} has a ${k === 'date' ? 'date' : 'delivery date'} (${raw}) that could not be read, so it was left empty. Write dates as day/month/year.`);
      return iso || '';
    };

    rows.push({
      line, season, commodity,
      date: dateOf('date'), buyer: collapse(get('buyer')), contractNo: collapse(get('contractNo')), grade: collapse(get('grade')),
      tons: round(tons, 3), price: round(price, 4), freight: round(freight, 4), premiumDiscount: round(num('premium'), 4),
      leviesPct: round(leviesPct, 6), tonsDelivered: round(Math.max(0, num('delivered')), 3),
      deliveryStart: dateOf('deliveryStart'), deliveryEnd: dateOf('deliveryEnd'),
      location: collapse(get('destination')), broker: collapse(get('broker')), contractType: collapse(get('contractType')),
      ourRef: collapse(get('ourRef')), notes: clean(get('notes')),
    });
  });
  return { rows, errors, warnings };
}

/** The record stored for a contract row, with the commodity id it was matched to. */
export function saleRecord(row, commodityId, makeId) {
  return {
    id: makeId(), date: row.date, commodityId, grade: row.grade, gradeOptions: [],
    buyer: row.buyer, contractNo: row.contractNo, ourRef: row.ourRef, location: row.location,
    deliveryStart: row.deliveryStart, deliveryEnd: row.deliveryEnd,
    tons: row.tons, tonsDelivered: row.tonsDelivered, price: row.price, freight: row.freight,
    premiumDiscount: row.premiumDiscount, leviesPct: row.leviesPct, ginning: 0,
    broker: row.broker, contractType: row.contractType, notes: row.notes, freightPaidBy: 'we',
    ...(row.ourRef ? { __hasOurRef: true } : {}),
  };
}

/**
 * Plan what each season in the file would get: the contracts, tonnes delivered and value, which crops already exist in
 * that season and which would be added, and whether the season can take them (it must exist, and have no contracts yet,
 * so a second import never doubles them).
 * @param {ReturnType<typeof parsePastSales>['rows']} rows
 * @param {{label: string, commodities: {id?: string, name: string}[], salesCount: number}[]} seasons  what the farm has
 */
export function planPastSales(rows, seasons = []) {
  const haveSeason = new Map(seasons.map((s) => [exactKey(s.label), s]));
  const bySeason = new Map();
  for (const r of rows) {
    const k = exactKey(r.season);
    if (!bySeason.has(k)) bySeason.set(k, { label: r.season, rows: [] });
    bySeason.get(k).rows.push(r);
  }
  const out = [];
  for (const s of [...bySeason.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))) {
    const have = haveSeason.get(exactKey(s.label));
    const known = have ? have.commodities.map((c) => ({ ...c })) : [];
    const added = [];                                   // crops this season does not have yet
    const items = s.rows.map((r) => {
      let c = matchCommodity(r.commodity, known);
      if (!c) {
        c = added.find((a) => exactKey(a.name) === exactKey(r.commodity));
        if (!c) { c = { name: r.commodity }; added.push(c); known.push(c); }
      }
      return { row: r, commodityName: c.name };
    });
    const value = items.reduce((a, it) => a + saleEconomics({ ...it.row, id: 'x' }, []).totalValue, 0);
    out.push({
      label: s.label, exists: !!have, hasSales: !!have && have.salesCount > 0,
      items, added: added.map((a) => a.name),
      contracts: items.length, tons: round(items.reduce((a, it) => a + it.row.tons, 0), 0),
      delivered: round(items.reduce((a, it) => a + it.row.tonsDelivered, 0), 0), value: Math.round(value),
      ready: !!have && have.salesCount === 0,
    });
  }
  return out;
}

/**
 * The records to store for one planned season: the contracts, and any crops the season did not have yet.
 * @param {ReturnType<typeof planPastSales>[number]} plan
 * @param {{id: string, name: string}[]} seasonCommodities  the season's own crops
 * @param {() => string} makeId
 * @param {(name: string) => object} [propsFor]  the properties a new crop starts with
 */
export function salesRecords(plan, seasonCommodities, makeId, propsFor = () => ({})) {
  const commodities = [];
  const all = seasonCommodities.map((c) => ({ ...c }));
  const idFor = (name) => {
    const c = all.find((x) => exactKey(x.name) === exactKey(name));
    if (c) return c.id;
    const made = { id: makeId(), name, ...propsFor(name), mtmPrice: 0, openingStock: 0, retainedSeed: 0, grossMarginCost: 0 };
    all.push(made);
    commodities.push(made);
    return made.id;
  };
  const sales = plan.items.map((it) => saleRecord(it.row, idFor(it.commodityName), makeId));
  return { sales, commodities };
}
