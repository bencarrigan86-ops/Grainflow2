import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GUIDES } from '../docs/js/helpcontent.js?v=407';

let failed = 0;
function check(name, fn) { try { fn(); console.log('  PASS  ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } }

check('every screenshot a guide names is in docs/help, with a description, and the guide page shows it', () => {
  const shots = GUIDES.filter((g) => g.shot);
  assert.ok(shots.length >= 6, 'the main guides have screenshots');
  for (const g of shots) {
    assert.ok(fs.existsSync(`docs/${g.shot}`), `${g.id}: docs/${g.shot} is missing`);
    assert.ok(fs.statSync(`docs/${g.shot}`).size < 200 * 1024, `${g.id}: the screenshot is too heavy`);
    assert.ok(g.shotAlt && g.shotAlt.length > 8, `${g.id}: no description for the picture`);
  }
  assert.ok(fs.readFileSync('docs/js/views/help.js', 'utf8').includes('class="help-shot"'));
});

check('the guides are short: few steps, few tips, each line brief', () => {
  for (const g of GUIDES) {
    assert.ok(g.steps.length <= 5 && g.tips.length <= 2, `${g.id} has grown`);
    for (const s of [...g.steps, ...g.tips]) assert.ok(s.length <= 260, `${g.id}: a line is long: ${s.slice(0, 50)}`);
  }
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
