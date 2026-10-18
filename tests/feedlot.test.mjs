#!/usr/bin/env node
//
// Does the feedlot engine give the spreadsheet's answers?
//
//   node tests/feedlot.test.mjs
//
// Two halves. The first runs everywhere, on the public demo seed: the
// arithmetic has to hang together (rations add to one, head days come back as
// head × days, every tonne is accounted for). The second needs the private
// Grassdale seed and the answers pulled out of the workbook beside it, in
// docs/private and tests/private, and checks the engine against the
// spreadsheet cell by cell. Neither file is in git — see .gitignore — so on a
// clean checkout that half says it was skipped rather than passing quietly.

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import {
  computePosition, averageRation, lotHeadDays, buildMonths, WATER,
} from '../docs/js/feedlot/engine.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};
const near = (a, b, tol, what) => {
  const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  assert(ok, `${what}: engine ${a} vs spreadsheet ${b}`);
};
const load = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

console.log('\n=== the arithmetic, on the demo seed ===');

const demo = load('../docs/demo/feedlot-demo.json');
const d = computePosition(demo);

check('July is 27 days from the inventory date, then whole months', () => {
  const m = buildMonths('2016-07-05');
  assert.deepStrictEqual(m.slice(0, 3).map((x) => x.days), [27, 31, 30]);
  assert.strictEqual(m[7].days, 28);
});

check('each average ration adds to one, water included', () => {
  for (const p of ['SF', 'LF']) {
    const t = Object.values(d.diet[p].inclusion).reduce((s, x) => s + x, 0);
    near(t, 1, 1e-9, `${p} inclusions`);
  }
});

check('a ration that does not add to 100% is named', () => {
  // The workbook's November short-fed ration is a half-made edit: wheat raised
  // in two stages without barley coming down.
  assert(d.warnings.some((w) => /SF ration from 2016-11: Ration 1 adds to 126.5%/.test(w)), d.warnings.join('; '));
  assert(d.warnings.some((w) => /SF ration from 2016-11: Ration 3 adds to 150.0%/.test(w)), d.warnings.join('; '));
});

check('a lot past its exit days is named and counts as nothing left', () => {
  const late = d.lots.filter((l) => l.overdue);
  assert.strictEqual(late.length, 2);
  assert(late.every((l) => l.totalHeadDays === 0));
  assert.strictEqual(d.warnings.filter((w) => /past its exit/.test(w)).length, 2);
});

check('tempered grain is bought dry and the difference is water', () => {
  const r = { ingredients: ['Barley'], stages: [{ share: 1, dryMatter: 0.8, inclusions: { Barley: 0.57 } }] };
  const a = averageRation(r, { Barley: 0.14 });
  near(a.inclusion.Barley, 0.5, 1e-12, 'dry barley');
  near(a.inclusion[WATER], 0.07, 1e-12, 'water');
});

check('a lot on feed runs out at its exit days, and not before', () => {
  const months = [{ days: 27 }, { days: 31 }, { days: 30 }];
  assert.deepStrictEqual(lotHeadDays({ head: 10, daysOnFeed: 2, exitDays: 88 }, months), [270, 310, 280]);
  assert.deepStrictEqual(lotHeadDays({ head: 10, daysOnFeed: 80, exitDays: 88 }, months), [80, 0, 0]);
});

check('a lot placed later starts when it arrives', () => {
  const months = [{ days: 27 }, { days: 31 }];
  // Arrives in 40 days: nothing in the first month, 18 days of the second.
  assert.deepStrictEqual(lotHeadDays({ head: 1, daysOnFeed: -40, exitDays: 100 }, months), [0, 18]);
});

check('every committed tonne is a lot tonne', () => {
  const lotsT = d.lots.reduce((s, l) => s + l.totalTonnes, 0);
  const monthsT = d.months.reduce((s, m) => s + m.sfCommittedT + m.lfCommittedT, 0);
  near(monthsT, lotsT, 1e-9, 'committed tonnes');
});

check('commodity requirements are the month total times the ration', () => {
  // Equal to the month total wherever the ration adds to one — and over it by
  // exactly the ration's excess where it does not.
  d.months.forEach((m, i) => {
    const t = Object.values(m.commodities).reduce((s, c) => s + c.requirement, 0);
    const sum = (p) => Object.values(d.diets[i][p].inclusion).reduce((a, b) => a + b, 0);
    near(t, m.sfTotalT * sum('SF') + m.lfTotalT * sum('LF'), 1e-9, `${m.end} requirement`);
  });
});

check('the demo carries no real names', () => {
  const vendors = demo.commodities.flatMap((c) => c.contracts.map((k) => k.vendor)).filter(Boolean);
  assert(vendors.every((v) => /^Supplier [A-Z]$/.test(v)), `unexpected vendor: ${vendors.find((v) => !/^Supplier/.test(v))}`);
  assert(!/grassdale/i.test(JSON.stringify(demo)), 'yard name leaked');
});

console.log('\n=== against the Grassdale workbook ===');

const seedPath = new URL('../docs/private/feedlot-seed.json', import.meta.url);
const expPath = new URL('./private/feedlot-expected.json', import.meta.url);

if (!existsSync(seedPath) || !existsSync(expPath)) {
  console.log('  SKIP  private Grassdale seed not present — spreadsheet comparison not run');
} else {
  const seed = load('../docs/private/feedlot-seed.json');
  const x = load('./private/feedlot-expected.json');
  // The spreadsheet's ration cost leaves Cotton Seed out of the average in
  // every month (the H35 sum skips row 30). Reproduce that to compare; the app
  // itself counts it.
  const r = computePosition(seed, { excludeFromRationCost: ['Cotton Seed'] });

  check('as-fed intakes: bullock, trade and long-fed', () => {
    near(r.asFed.sfBullock, x.asFed.sfBullock, 1e-9, 'bullock');
    near(r.asFed.sfTrade, x.asFed.sfTrade, 1e-9, 'trade');
    near(r.asFed.lf, x.asFed.lf, 1e-9, 'long fed');
  });

  check('average dry matter and every average inclusion', () => {
    near(r.diet.SF.dryMatter, x.avgDM.SF, 1e-9, 'SF DM');
    near(r.diet.LF.dryMatter, x.avgDM.LF, 1e-9, 'LF DM');
    for (const p of ['SF', 'LF']) {
      for (const [k, v] of Object.entries(x.avgInclusion[p])) near(r.diet[p].inclusion[k] || 0, v || 0, 1e-9, `${p} ${k}`);
    }
  });

  // Two lots are past their exit days, and the spreadsheet gives them negative
  // head days — all of it in the first month, since the running remainder
  // leaves nothing for the rest. The engine counts them as zero. Add the
  // negatives back to the spreadsheet's July and everything else must agree.
  const totals = Object.values(x.lotTotals);
  const late = { headDays: { SF: 0, LF: 0 }, tonnes: { SF: 0, LF: 0 } };
  r.lots.forEach((l, i) => {
    if (!l.overdue) return;
    late.headDays[l.program] += totals[i].headDays;
    late.tonnes[l.program] += totals[i].tonnes;
  });

  check('every lot: remaining head days and tonnes', () => {
    assert.strictEqual(totals.length, r.lots.length, 'lot count');
    r.lots.forEach((l, i) => {
      if (l.overdue) { assert(totals[i].headDays < 0, `${l.id} expected negative in the sheet`); return; }
      near(l.totalHeadDays, totals[i].headDays, 1e-9, `${l.id} head days`);
      near(l.totalTonnes, totals[i].tonnes, 1e-9, `${l.id} tonnes`);
    });
  });

  check('twelve months of committed head days and tonnes, SF and LF', () => {
    r.months.forEach((m, i) => {
      const e = x.months[i];
      const adj = (kind, p) => (i === 0 ? -late[kind][p] : 0);
      near(m.sfHeadDays, e.sfHeadDays + adj('headDays', 'SF'), 1e-9, `${m.end} SF head days`);
      near(m.lfHeadDays, e.lfHeadDays + adj('headDays', 'LF'), 1e-9, `${m.end} LF head days`);
      near(m.sfCommittedT, e.sfCommittedT + adj('tonnes', 'SF'), 1e-9, `${m.end} SF committed t`);
      near(m.lfCommittedT, e.lfCommittedT + adj('tonnes', 'LF'), 1e-9, `${m.end} LF committed t`);
    });
  });

  check('total ration demand including budgeted placements', () => {
    r.months.forEach((m, i) => {
      const e = x.months[i];
      if (e.totalT == null) return;
      near(m.sfTotalT, e.sfTotalT, 1e-9, `${m.end} SF total`);
      near(m.lfTotalT, e.lfTotalT, 1e-9, `${m.end} LF total`);
      near(m.totalT, e.totalT, 1e-9, `${m.end} total`);
    });
  });

  check('requirement for each of the 14 commodities, every month', () => {
    r.months.forEach((m, i) => {
      for (const [k, v] of Object.entries(x.months[i].requirement)) {
        if (v == null) continue;
        near(m.commodities[k].requirement, v, 1e-9, `${m.end} ${k}`);
      }
    });
  });

  // Barley's weighted price is a hand-typed sum that skips contract rows 56–64,
  // so it is expected to differ. Everything priced by SUMPRODUCT must match.
  const priceDiffs = [];
  check('weighted contract price, every commodity but Barley', () => {
    r.months.forEach((m, i) => {
      for (const [k, v] of Object.entries(x.months[i].price)) {
        if (v == null) continue;
        if (k === 'Barley') { if (Math.abs(m.commodities[k].price - v) > 0.01) priceDiffs.push([m.end, v, m.commodities[k].price]); continue; }
        near(m.commodities[k].price, v, 1e-9, `${m.end} ${k} price`);
      }
    });
  });

  check('ration cost per tonne, with the spreadsheet\'s Barley price', () => {
    // Swap the spreadsheet's barley price in, so this checks the ration cost
    // calculation and nothing else.
    r.months.forEach((m, i) => {
      const e = x.months[i];
      if (e.rationCost == null) return;
      let v = 0; let t = 0;
      for (const [k, c] of Object.entries(m.commodities)) {
        const p = k === 'Barley' ? e.price.Barley : c.price;
        if (k !== 'Cotton Seed') v += c.requirement * p;
        t += c.requirement;
      }
      near(v / t, e.rationCost, 1e-9, `${m.end} ration cost`);
    });
  });

  if (priceDiffs.length) {
    console.log('  NOTE  Barley price where the spreadsheet sum skips contracts (month, spreadsheet, engine):');
    for (const [mo, s, e] of priceDiffs) console.log(`          ${mo}  $${s.toFixed(2)}  $${e.toFixed(2)}`);
  }
  const full = computePosition(seed);
  console.log(`  NOTE  July ration cost: spreadsheet $${x.months[0].rationCost.toFixed(2)}/t, engine with Cotton Seed and all Barley contracts $${full.months[0].rationCost.toFixed(2)}/t`);
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
