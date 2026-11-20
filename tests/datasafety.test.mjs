// Batch 1 of the review: edits made while a push is running, failed reads, quote marks in names, backups, dates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { touchesToQueue } from '../docs/js/dirty.js?v=496';
import { isDenial } from '../docs/js/denial.js?v=496';
import { addDaysTo } from '../docs/js/fmt.js?v=496';

const read = (p) => readFileSync(new URL(`../docs/${p}`, import.meta.url), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('PASS', name); };

t('a touch of something already queued adds nothing', () => {
  const entries = [{ seq: 1, type: 'dirty', kind: 'movement', id: 'a' }];
  assert.deepEqual(touchesToQueue(entries, new Set(), [{ kind: 'movement', id: 'a' }, { kind: 'movement', id: 'b' }]), [{ kind: 'movement', id: 'b' }]);
});
t('an edit to something a running push has taken is queued again, so it is not lost', () => {
  const entries = [{ seq: 1, type: 'dirty', kind: 'movement', id: 'a' }];
  assert.equal(touchesToQueue(entries, new Set([1]), [{ kind: 'movement', id: 'a' }]).length, 1);
});
t('the same thing touched twice in one go is queued once', () => {
  assert.equal(touchesToQueue([], new Set(), [{ kind: 'field', id: 'x' }, { kind: 'field', id: 'x' }]).length, 1);
});
t('a delete entry does not hide a touch', () => {
  assert.equal(touchesToQueue([{ seq: 2, type: 'delete', table: 'movements', id: 'a' }], new Set(), [{ kind: 'movement', id: 'a' }]).length, 1);
});

t('a refused or missing table is a denial; a failed read is not', () => {
  assert.ok(isDenial({ code: '42501', message: 'permission denied for table sale_terms' }));
  assert.ok(isDenial({ code: 'PGRST205', message: 'Could not find the table' }));
  assert.ok(isDenial({ message: 'relation "x" does not exist' }));
  assert.ok(!isDenial({ message: 'TypeError: Failed to fetch' }));
  assert.ok(!isDenial({ code: 'PGRST301', message: 'JWT expired' }));
  assert.ok(!isDenial({ code: '57014', message: 'canceling statement due to statement timeout' }));
  assert.ok(!isDenial(null));
});
t('hydrate stops on a failed read instead of treating it as an empty table', () => {
  const s = read('js/hydrate.js');
  assert.ok(s.includes('failed: true'));
  assert.ok(s.includes("throw err;"));
  assert.ok(s.includes('isDenial(error)'));
});
t('push marks the rows as taken and looks again afterwards', () => {
  const s = read('js/sync.js');
  assert.ok(s.includes('setSending(sentSeqs)') && s.includes('setSending([])'));
  assert.ok(s.includes('followUp()'));
});

t('esc() escapes quote marks, so a name cannot close an attribute', async () => {
  const { esc } = await import('../docs/js/fmt.js?v=496');
  assert.equal(esc(`x" onfocus="alert(1)`), 'x&quot; onfocus=&quot;alert(1)');
  assert.equal(esc(`it's <b>&`), 'it&#39;s &lt;b&gt;&amp;');
  assert.equal(esc(null), '');
});
t('a sheet title is escaped (it may hold a paddock or location name)', () => {
  const s = read('js/ui.js');
  assert.ok(!s.includes('<h2>${title}</h2>'));
  assert.ok(s.includes('<h2>${escHtml(title)}</h2>'));
});
t('the page headers fingerprint index.html\'s inline script and refuse inline handlers', () => {
  const html = read('index.html');
  const inline = [...html.matchAll(/<script>([^<]*)<\/script>/g)].map((m) => m[1]);
  assert.equal(inline.length, 1);
  const hash = createHash('sha256').update(inline[0]).digest('base64');
  const headers = read('_headers');
  assert.ok(headers.includes(`'sha256-${hash}'`), 'index.html\'s inline script changed: update docs/_headers');
  const csp = headers.split('\n').find((l) => l.includes('Content-Security-Policy'));
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.ok(csp.includes("script-src 'self'") && csp.includes("object-src 'none'"));
});

t('an invoice made early on a local morning takes the local day', () => {
  for (const f of ['js/views/invoice.js', 'js/storage.js', 'js/views/settingsexport.js']) {
    assert.ok(!/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(read(f)), `${f} still takes the UTC day`);
  }
  assert.equal(addDaysTo('2026-06-30', 1), '2026-07-01');
  assert.equal(addDaysTo('2026-12-31', 30), '2027-01-30');
  assert.equal(addDaysTo('', 5), '');
});

t('restoring a backup says what it removes, keeps a copy first, and is the owner\'s only', () => {
  const s = read('js/views/settings.js');
  const i = s.indexOf('db.previewImport(text)');
  assert.ok(i > 0);
  const confirmAt = s.indexOf('askConfirm(', i);
  const backupAt = s.indexOf('downloadBackup(db.exportJSON())', i);
  const importAt = s.indexOf('db.importJSON(text)', i);
  assert.ok(confirmAt > i && backupAt > confirmAt && importAt > backupAt, 'preview, then confirm, then copy, then import');
  const st = read('js/storage.js');
  assert.ok(/importJSON\(json\) \{\s*if \(role !== 'owner'\)/.test(st));
  assert.ok(/previewImport\(json\) \{\s*if \(role !== 'owner'\)/.test(st));
});

t('a device keeps nobody\'s farm after sign-out unless something is still unsent', () => {
  assert.ok(read('js/auth.js').includes('clearStateIfSettled()'));
  const l = read('js/local.js');
  assert.ok(/clearStateIfSettled[\s\S]*count\('outbox'\)\) > 0\) return false/.test(l));
  const s = read('js/storage.js');
  assert.ok(s.includes('localUser !== userId') && s.includes('pending === 0'));
  assert.ok(read('js/main.js').includes('userId: session?.user?.id'));
});

console.log(`${n} passed`);
