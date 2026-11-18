// Run with:
//   node tests/reportshub.test.mjs
//
// The Reports screen is tiles in groups. Simple shows the reports most people open (and always Fert, Seed and Silo room);
// Full adds the rest. What a person sees follows their role and what the farm has.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubGroups, reportTitle, toggledFavs, TILE_ICONS } from '../docs/js/reportshub.js';
import { canOpen } from '../docs/js/nav.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ids = (groups) => groups.flatMap((g) => g.tiles.map((t) => t.id));
const owner = (extra = {}) => hubGroups({ role: 'owner', can: (tab) => canOpen('owner', tab), ...extra });

check('Simple has Yield, Harvest progress, Fert, Seed, the map, Position, Money owed, Silo room and Load report', () => {
  const got = ids(owner({ mode: 'simple' }));
  for (const id of ['yield', 'harvest', 'fert', 'seed', 'map', 'position', 'owed', 'room', 'loads']) assert.ok(got.includes(id), id);
  for (const id of ['rotation', 'averages', 'eofy', 'excel', 'xero']) assert.ok(!got.includes(id), `${id} is Full only`);
});

check('Full has everything Simple has, and more', () => {
  const simple = ids(owner({ mode: 'simple' }));
  const full = ids(owner({ mode: 'full' }));
  for (const id of simple) assert.ok(full.includes(id), id);
  for (const id of ['rotation', 'averages', 'eofy', 'excel', 'xero']) assert.ok(full.includes(id), id);
});

check('the tiles keep short names, with Harvest progress in full', () => {
  const tiles = owner({ mode: 'full' }).flatMap((g) => g.tiles);
  const name = (id) => tiles.find((t) => t.id === id).label;
  assert.equal(name('harvest'), 'Harvest progress');
  assert.equal(name('yield'), 'Yield');
  assert.equal(name('fert'), 'Fert');
  assert.equal(name('seed'), 'Seed');
  assert.equal(name('position'), 'Position');
  for (const t of tiles) assert.ok(t.label.length <= 17, `${t.label} is short`);
});

check('Modules only show on a farm with cotton', () => {
  assert.ok(!ids(owner({ hasCotton: false })).includes('modules'));
  assert.ok(ids(owner({ hasCotton: true })).includes('modules'));
});

check('a role that is not shown yields has no Yield or Averages tile, but keeps Harvest progress, Fert, Seed and Silo room', () => {
  const got = ids(hubGroups({ mode: 'full', role: 'farm_worker', showYield: false, can: (tab) => canOpen('farm_worker', tab) }));
  assert.ok(!got.includes('yield') && !got.includes('averages'));
  for (const id of ['harvest', 'fert', 'seed', 'room']) assert.ok(got.includes(id), id);
});

check('a farm worker sees no money, no Xero and no exports', () => {
  const got = ids(hubGroups({ mode: 'full', role: 'farm_worker', can: (tab) => canOpen('farm_worker', tab) }));
  for (const id of ['position', 'owed', 'eofy', 'excel', 'xero']) assert.ok(!got.includes(id), id);
});

check('a bookkeeper has Xero; a manager and an owner too; a support person does not', () => {
  for (const role of ['owner', 'manager', 'bookkeeper']) assert.ok(ids(hubGroups({ mode: 'full', role, can: () => true })).includes('xero'), role);
  assert.ok(!ids(hubGroups({ mode: 'full', role: 'support', can: () => true })).includes('xero'));
});

check('with no paddocks there is no map or rotation, and a group with nothing in it is left out', () => {
  const g = owner({ mode: 'simple', hasFields: false });
  assert.ok(!ids(g).includes('map') && !ids(g).includes('rotation'));
  const exportsOnly = hubGroups({ mode: 'simple', role: 'owner', can: () => true });
  assert.ok(!exportsOnly.some((x) => x.title === 'Exports'), 'Exports is Full only');
});

check('every report has a name for its heading, and every sheet tile is wired on the screen', () => {
  for (const v of ['yield', 'harvest', 'fert', 'seed', 'modules']) assert.ok(reportTitle(v), v);
  const src = read('docs/js/views/reports.js');
  const sheets = owner({ mode: 'full', hasCotton: true }).flatMap((g) => g.tiles).filter((t) => t.kind === 'sheet').map((t) => t.id);
  for (const id of sheets) assert.ok(new RegExp(`\\b${id}: \\(\\) =>`).test(src), `${id} opens a sheet`);
});

check('the mode is remembered and Simple is the start', () => {
  const src = read('docs/js/reportshub.js');
  assert.ok(src.includes("=== 'full' ? 'full' : 'simple'"));
  assert.ok(read('docs/js/views/reports.js').includes('saveMode(btn.dataset.mode)'));
});

check('starring a report in Full puts it in Simple; un-starring takes it out; the standard set starts starred', () => {
  const full = owner({ mode: 'full' });
  assert.ok(full.flatMap((g) => g.tiles).find((t) => t.id === 'fert').fav, 'Fert starts starred');
  assert.ok(!full.flatMap((g) => g.tiles).find((t) => t.id === 'eofy').fav, 'End of year does not');
  const afterStar = toggledFavs(full, null, 'eofy');
  assert.ok(afterStar.includes('eofy') && afterStar.includes('fert') && afterStar.includes('room'), 'the standard set stays and the new one joins it');
  assert.ok(ids(owner({ mode: 'simple', favs: afterStar })).includes('eofy'));
  const afterUnstar = toggledFavs(full, afterStar, 'fert');
  assert.ok(!afterUnstar.includes('fert'));
  assert.ok(!ids(owner({ mode: 'simple', favs: afterUnstar })).includes('fert'));
  assert.ok(ids(owner({ mode: 'full', favs: afterUnstar })).includes('fert'), 'Full still has it');
});

check('a star on a report this person cannot open, or the farm does not have, shows nothing', () => {
  assert.ok(!ids(hubGroups({ mode: 'simple', role: 'farm_worker', can: (tab) => canOpen('farm_worker', tab), favs: ['xero', 'owed', 'fert'] })).some((id) => id === 'xero' || id === 'owed'));
  assert.ok(!ids(owner({ mode: 'simple', hasCotton: false, favs: ['modules'] })).includes('modules'));
});

check('with every star taken off, Simple is empty and says how to get reports back', () => {
  assert.equal(owner({ mode: 'simple', favs: [] }).length, 0);
  const src = read('docs/js/views/reports.js');
  assert.ok(src.includes('Nothing starred') && src.includes('data-star='));
});

check('every tile has a picture, drawn on the tile above its short name', () => {
  const all = owner({ mode: 'full', hasCotton: true }).flatMap((g) => g.tiles);
  for (const t of all) assert.ok(TILE_ICONS[t.id] && TILE_ICONS[t.id].includes('<'), `${t.id} has a picture`);
  const src = read('docs/js/views/reports.js');
  assert.ok(src.includes('class="rep-ico"') && src.includes('TILE_ICONS[t.id]'));
});

check('the tiles are small and light: a picture and a short name, no extra wording', () => {
  const src = read('docs/js/views/reports.js');
  assert.ok(!src.includes('rep-hint') && !read('docs/js/reportshub.js').includes('TILE_HINTS'));
  const css = read('docs/css/styles.css');
  assert.ok(css.includes('.rep-tile .rep-ico { flex: none; color: var(--accent-summary)') && css.includes('min-height: 76px'));
});

check('Deliveries and the Outload plan are Full tiles, and are gone from the tops of Sales and Storage', () => {
  const full = ids(owner({ mode: 'full' }));
  assert.ok(full.includes('deliveries') && full.includes('optimiser'));
  assert.ok(!ids(owner({ mode: 'simple' })).some((id) => id === 'deliveries' || id === 'optimiser'));
  assert.ok(!ids(hubGroups({ mode: 'full', role: 'farm_worker', can: (tab) => canOpen('farm_worker', tab) })).includes('deliveries'), 'deliveries are for the roles that work the contracts');
  assert.ok(ids(hubGroups({ mode: 'full', role: 'farm_worker', can: (tab) => canOpen('farm_worker', tab) })).includes('optimiser'), 'the outload plan is for anyone who sees Storage');
  const sales = read('docs/js/views/sales.js');
  assert.ok(!sales.includes('id="open-deliveries"') && !sales.includes('id="open-money"'));
  const storage = read('docs/js/views/storage.js');
  assert.ok(!storage.includes('id="open-optimiser"') && !storage.includes('openOptimiserSheet'));
  assert.ok(read('docs/js/views/reports.js').includes('optimiser: () => openOptimiserSheet()'));
  for (const id of ['deliveries', 'optimiser']) assert.ok(TILE_ICONS[id], id);
});

check('the Farm map stays at the top of Production as well', () => {
  const p = read('docs/js/views/production.js');
  assert.ok(p.indexOf('id="open-map"') > 0 && p.indexOf('id="open-map"') < p.indexOf('id="open-inputs"'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
