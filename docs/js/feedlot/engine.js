// The feedlot position engine: cattle on feed in, tonnes of each commodity and
// what they cost out, month by month.
//
// A straight port of the Grassdale position report (Position Report_2016_07_05
// _Grassdale.xls), with the spreadsheet's hand-typed sums replaced by loops.
// The chain is the workbook's own:
//
//   lots ─► head days per month ─┐
//   rations ─► avg DM ─► as-fed intake ─► committed tonnes
//   budget head on feed ─► non-committed tonnes ─┘
//   tonnes × average inclusion ─► requirement per commodity
//   contracts and inventory ─► covered, short/long, weighted price, ration cost
//
// Pure, no DOM and no storage, so tests/feedlot.test.mjs can run it against the
// spreadsheet's own answers. Anything that reads or paints lives in app.js.

/** Days between two ISO dates, b − a. */
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

function endOfMonth(iso, add) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add + 1, 0)).toISOString().slice(0, 10);
}

/**
 * The twelve reporting months from the inventory date. The first is part of a
 * month and counts the inventory day itself — 5 July to 31 July is 27 days,
 * as the spreadsheet has it.
 */
export function buildMonths(inventoryDate, count = 12) {
  const out = [];
  let prev = null;
  for (let i = 0; i < count; i++) {
    const end = endOfMonth(inventoryDate, i);
    const days = prev ? daysBetween(prev, end) : daysBetween(inventoryDate, end) + 1;
    out.push({ end, days });
    prev = end;
  }
  return out;
}

/**
 * Collapse a staged ration into one average diet.
 *
 * Each stage (hay, starter, step-ups, finisher) is weighted by its share of
 * total consumption. Tempered grain is fed wet: a grain with a positive
 * shrink/gain (barley 14%, wheat 13%) is bought dry at inclusion ÷ (1 + gain),
 * and the difference is water — kept as its own line so the tonnes still add
 * to one, priced at nothing.
 */
export function averageRation(ration, shrink) {
  const inclusion = {};
  let water = 0;
  for (const ing of ration.ingredients) {
    const gain = shrink[ing] || 0;
    let v = 0;
    for (const s of ration.stages) {
      const asFed = s.inclusions[ing] || 0;
      const bought = gain > 0 ? asFed / (1 + gain) : asFed;
      v += s.share * bought;
      water += s.share * (asFed - bought);
    }
    inclusion[ing] = v;
  }
  inclusion[WATER] = water;
  const dryMatter = ration.stages.reduce((t, s) => t + s.share * s.dryMatter, 0);
  return { inclusion, dryMatter };
}

export const WATER = 'Added Water (Inventory Gain Component Only)';

/**
 * The ration fed in month i. A program's rations are a schedule of changes —
 * each takes over from its `fromMonth` until the next one does — because a
 * yard changes its diet when the grain does, not once a year. A single ration
 * object (no array) is a schedule of one.
 */
export function rationFor(schedule, i) {
  const list = Array.isArray(schedule) ? schedule : [{ fromMonth: 0, ...schedule }];
  let pick = list[0];
  for (const r of list) if ((r.fromMonth || 0) <= i) pick = r;
  return pick;
}

/**
 * Stages whose ingredients do not add to 100%, or stage shares that do not.
 * Either one means every tonne downstream is off by the same proportion — the
 * Grassdale November ration has a stage at 150% — so it is said, not fixed.
 */
export function rationWarnings(cfg, months = []) {
  const out = [];
  for (const prog of ['SF', 'LF']) {
    const list = Array.isArray(cfg.rations[prog]) ? cfg.rations[prog] : [{ fromMonth: 0, ...cfg.rations[prog] }];
    for (const r of list) {
      const when = months[r.fromMonth || 0]?.end?.slice(0, 7) || `month ${(r.fromMonth || 0) + 1}`;
      const shares = r.stages.reduce((t, st) => t + st.share, 0);
      if (Math.abs(shares - 1) > 1e-6) out.push(`${prog} ration from ${when}: stage shares add to ${(shares * 100).toFixed(1)}%`);
      for (const st of r.stages) {
        if (!st.share) continue;
        const t = Object.values(st.inclusions).reduce((a, b) => a + b, 0);
        if (Math.abs(t - 1) > 1e-6) out.push(`${prog} ration from ${when}: ${st.name} adds to ${(t * 100).toFixed(1)}%`);
      }
    }
  }
  return out;
}

/** Which program a lot is fed on, and so which ration and intake it takes. */
export function programFor(lot, cfg) {
  return cfg.longFedClasses.includes(lot.cattleClass) ? 'LF' : 'SF';
}

/**
 * Kilograms as fed per head per day. Short-fed cattle going out at or past
 * `bullockExitDays` are bullocks and eat at the bullock rate; anything earlier
 * is trade.
 */
export function intakeFor(lot, cfg, asFed) {
  if (programFor(lot, cfg) === 'LF') return asFed.lf;
  return lot.exitDays >= cfg.bullockExitDays ? asFed.sfBullock : asFed.sfTrade;
}

/**
 * A lot's remaining head days, split across the months.
 *
 * The lot is in the yard from today (or from its placement date, for a
 * negative days-on-feed) until it reaches its exit days. The spreadsheet does
 * the same by carrying a running remainder across twelve columns; it only
 * offsets the start in the first month, which agrees with this for any
 * placement that lands inside the first month.
 */
export function lotHeadDays(lot, months) {
  const start = Math.max(0, -lot.daysOnFeed);
  const remaining = lot.daysOnFeed < 0 ? lot.exitDays : Math.max(0, lot.exitDays - lot.daysOnFeed);
  const end = start + remaining;
  const out = [];
  let a = 0;
  for (const m of months) {
    const b = a + m.days;
    out.push(Math.max(0, Math.min(b, end) - Math.max(a, start)) * lot.head);
    a = b;
  }
  return out;
}

/** Weighted average price of what is delivered in one month. */
function weightedPrice(rows) {
  const t = rows.reduce((s, r) => s + r.tonnes, 0);
  if (t < 1) return 0;
  return rows.reduce((s, r) => s + r.tonnes * r.price, 0) / t;
}

/**
 * The whole report.
 *
 * `opts.excludeFromRationCost` drops commodities from the ration cost average
 * while still counting their tonnes — the spreadsheet does this to Cotton Seed
 * in every month, and the test uses it to show the two agree otherwise.
 */
export function computePosition(cfg, opts = {}) {
  const months = cfg.months?.length ? cfg.months : buildMonths(cfg.inventoryDate).map((m) => ({ ...m }));
  // Dry matter intake is what the cattle eat; as-fed is what gets loaded, and
  // it moves with the month's diet.
  const diets = months.map((_, i) => ({
    SF: averageRation(rationFor(cfg.rations.SF, i), cfg.shrink),
    LF: averageRation(rationFor(cfg.rations.LF, i), cfg.shrink),
  }));
  const asFeds = diets.map((d) => ({
    sfBullock: cfg.intakeDM.sfBullock / d.SF.dryMatter,
    sfTrade: cfg.intakeDM.sfTrade / d.SF.dryMatter,
    lf: cfg.intakeDM.lf / d.LF.dryMatter,
  }));
  const warnings = rationWarnings(cfg, months);

  const lots = cfg.lots.map((lot) => {
    const program = programFor(lot, cfg);
    const headDays = lotHeadDays(lot, months);
    const tonnes = headDays.map((hd, i) => (hd * intakeFor(lot, cfg, asFeds[i])) / 1000);
    // The spreadsheet counts a lot past its exit days as negative head days,
    // which quietly takes feed off everybody else. They are still in the yard
    // and still eating; here they count as nothing remaining, and are named.
    const overdue = lot.daysOnFeed > lot.exitDays;
    if (overdue) warnings.push(`Lot ${lot.id} is ${lot.daysOnFeed - lot.exitDays} days past its exit (${lot.head} head)`);
    return {
      ...lot, program, intake: intakeFor(lot, cfg, asFeds[0]), headDays, tonnes, overdue,
      totalHeadDays: headDays.reduce((s, x) => s + x, 0),
      totalTonnes: tonnes.reduce((s, x) => s + x, 0),
    };
  });

  const names = cfg.commodities.map((c) => c.name);
  const excluded = new Set(opts.excludeFromRationCost || []);

  const monthly = months.map((m, i) => {
    const diet = diets[i];
    const asFed = asFeds[i];
    const sum = (prog, key) => lots.filter((l) => l.program === prog).reduce((s, l) => s + l[key][i], 0);
    const sfHeadDays = sum('SF', 'headDays');
    const lfHeadDays = sum('LF', 'headDays');
    const sfCommittedT = sum('SF', 'tonnes');
    const lfCommittedT = sum('LF', 'tonnes');
    const sfCommittedHead = sfHeadDays / m.days;
    const lfCommittedHead = lfHeadDays / m.days;

    // Budgeted head the lots do not already account for. A budget under what
    // is committed would go negative in the spreadsheet; here it is held at
    // zero and said out loud instead.
    const sfTrade = m.sfTradeHead || 0;
    let sfBullockOpen = (m.sfTotalHead || 0) - sfCommittedHead - sfTrade;
    let lfOpen = (m.lfTotalHead || 0) - lfCommittedHead;
    if (sfBullockOpen < 0) { warnings.push(`${m.end}: short-fed budget is ${Math.round(-sfBullockOpen)} head under cattle already on feed`); sfBullockOpen = 0; }
    if (lfOpen < 0) { warnings.push(`${m.end}: long-fed budget is ${Math.round(-lfOpen)} head under cattle already on feed`); lfOpen = 0; }

    const sfOpenT = (sfBullockOpen * asFed.sfBullock * m.days) / 1000 + (sfTrade * asFed.sfTrade * m.days) / 1000;
    const lfOpenT = (lfOpen * asFed.lf * m.days) / 1000;
    const sfTotalT = sfCommittedT + sfOpenT;
    const lfTotalT = lfCommittedT + lfOpenT;

    const commodities = {};
    let costT = 0; let costV = 0;
    for (const c of cfg.commodities) {
      const requirement = sfTotalT * (diet.SF.inclusion[c.name] || 0) + lfTotalT * (diet.LF.inclusion[c.name] || 0);
      const rows = c.contracts.flatMap((k) => k.deliveries.filter((d) => d.month === i).map((d) => ({ ...d, budget: k.budget })));
      const covered = rows.filter((r) => !r.budget).reduce((s, r) => s + r.tonnes, 0);
      const budgeted = rows.filter((r) => r.budget).reduce((s, r) => s + r.tonnes, 0);
      const price = weightedPrice(rows);
      commodities[c.name] = { requirement, covered, budgeted, balance: covered + budgeted - requirement, price };
      if (!excluded.has(c.name)) costV += requirement * price;
      costT += requirement;
    }
    const rationCost = costT ? costV / costT : 0;

    return {
      ...m, sfHeadDays, lfHeadDays, sfCommittedHead, lfCommittedHead,
      sfBullockOpenHead: sfBullockOpen, sfTradeHead: sfTrade, lfOpenHead: lfOpen,
      sfCommittedT, lfCommittedT, sfOpenT, lfOpenT, sfTotalT, lfTotalT,
      totalT: sfTotalT + lfTotalT,
      totalHead: sfCommittedHead + sfBullockOpen + sfTrade + lfCommittedHead + lfOpen,
      commodities, rationCost, asFed, dryMatter: { SF: diet.SF.dryMatter, LF: diet.LF.dryMatter },
      costPerHeadDay: { sfBullock: rationCost * asFed.sfBullock / 1000, sfTrade: rationCost * asFed.sfTrade / 1000, lf: rationCost * asFed.lf / 1000 },
    };
  });

  // Tempering water is made in the mill, not bought, so it has no cover.
  const position = names.filter((n) => n !== WATER).map((name) => coverFor(name, monthly, cfg.inventoryDate));

  return { months: monthly, diet: diets[0], asFed: asFeds[0], diets, lots, position, warnings };
}

/**
 * How far inventory and contracts carry one commodity.
 *
 * Open tonnes is everything bought and not yet fed, budget fills excluded.
 * It is walked forward against each month's requirement; "covered to" is the
 * day it runs out, interpolated within the month it runs out in.
 */
function coverFor(name, monthly, inventoryDate) {
  const open = monthly.reduce((s, m) => s + m.commodities[name].covered, 0);
  const budgeted = monthly.reduce((s, m) => s + m.commodities[name].budgeted, 0);
  const value = monthly.reduce((s, m) => {
    const c = m.commodities[name];
    return s + c.covered * c.price;  // budget fills priced in with the rest; see weightedPrice
  }, 0);
  const totalReq = monthly.reduce((s, m) => s + m.commodities[name].requirement, 0);
  const firstDaily = monthly[0].commodities[name].requirement / monthly[0].days;

  let left = open;
  let elapsed = 0;
  let coveredDays = null;
  for (const m of monthly) {
    const req = m.commodities[name].requirement;
    if (req <= 0) { elapsed += m.days; continue; }
    if (left < req) { coveredDays = elapsed + (left / req) * m.days; break; }
    left -= req;
    elapsed += m.days;
  }
  const coveredTo = coveredDays === null ? null
    : new Date(Date.parse(`${inventoryDate}T00:00:00Z`) + Math.floor(coveredDays) * 864e5).toISOString().slice(0, 10);

  return {
    name, open, budgeted, avgPrice: open ? value / open : 0, value,
    dailyUse: firstDaily, totalRequirement: totalReq,
    daysCovered: coveredDays === null ? null : coveredDays,
    coveredTo, coversHorizon: coveredDays === null && totalReq > 0,
  };
}
