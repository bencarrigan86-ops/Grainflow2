#!/usr/bin/env node
//
// Build the public feedlot demo seed from the private Grassdale one.
//
//   node tools/make-feedlot-demo.mjs
//
// Same cattle, rations, budgets and tonnages, so the demo exercises exactly
// what the real report does — but with the yard, lot numbers, suppliers and
// contract numbers replaced. Those are what make the real seed somebody's
// book rather than an example, and this repo is public.

import { readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../docs/private/feedlot-seed.json', import.meta.url);
const out = new URL('../docs/demo/feedlot-demo.json', import.meta.url);

const seed = JSON.parse(readFileSync(src, 'utf8'));
const vendors = new Map();
const vendorFor = (v) => {
  if (!v) return '';
  if (!vendors.has(v)) vendors.set(v, `Supplier ${String.fromCharCode(65 + vendors.size)}`);
  return vendors.get(v);
};
let ref = 1000;

const demo = {
  ...seed,
  yard: 'Demo Feedyard',
  lots: seed.lots.map((l, i) => ({ ...l, id: `L${String(i + 1).padStart(3, '0')}` })),
  commodities: seed.commodities.map((c) => ({
    ...c,
    contracts: c.contracts.map((k) => ({
      ...k,
      ref: k.budget || /inventory|latest/i.test(k.ref) ? k.ref : `C${ref++}`,
      vendor: vendorFor(k.vendor),
    })),
  })),
};

writeFileSync(out, `${JSON.stringify(demo, null, 1)}\n`);
console.log(`Wrote ${out.pathname} — ${demo.lots.length} lots, ${vendors.size} suppliers renamed`);
