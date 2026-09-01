#!/usr/bin/env node
//
// Does every module actually get what it uses?
//
//   node tests/modules.test.mjs
//
// Written after auth.js shipped calling pickMembership() without importing it.
// The app loaded, the login screen rendered, and signing in died with
// "pickMembership is not defined" — after the password had been accepted, so
// the only symptom was a blank screen and a button stuck on "Signing in…".
// Every unit test passed, because every unit test imports the module directly
// and never exercises the wiring between them.
//
// The cause was a string replacement that matched nothing and said nothing.
// This file is the check that would have caught it before it left the machine:
// it reads the import graph the browser will actually walk, and fails on
//
//   - an import of a file that does not exist
//   - an import of a name that file does not export
//   - a call to something another module exports that this file never imported
//   - a ?v= query that disagrees with APP_VERSION, which is how a browser ends
//     up holding two builds at once
//
// None of it runs the app. It reads the source, which is the only thing here
// that cannot agree with my assumptions about the source.

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS = join(ROOT, 'docs', 'js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

// --- read every module ------------------------------------------------------

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(JS).map((path) => ({
  path,
  name: path.slice(ROOT.length + 1).replace(/\\/g, '/'),
  src: readFileSync(path, 'utf8'),
}));

/** Strip comments and string literals so a mention in prose is not a usage. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

const IMPORT_RE = /import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;

function importsOf(file) {
  const out = [];
  for (const m of file.src.matchAll(IMPORT_RE)) {
    const names = m[1]
      ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [m[2]];
    out.push({ names, spec: m[3] });
  }
  return out;
}

function exportsOf(file) {
  const names = new Set();
  const c = code(file.src);
  for (const m of c.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) names.add(m[1]);
  for (const m of c.matchAll(/export\s+(?:const|let|var|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of c.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const as = part.trim().split(/\s+as\s+/);
      const last = as[as.length - 1]?.trim();
      if (last) names.add(last);
    }
  }
  return names;
}

const exportsByFile = new Map(files.map((f) => [f.name, exportsOf(f)]));

console.log('\n=== every import points at something real ===');

check('the scan found the modules', () => {
  assert.ok(files.length > 10, `only found ${files.length} modules`);
  assert.ok(files.some((f) => f.name.endsWith('auth.js')), 'auth.js not found');
});

check('every relative import resolves to a file that exists', () => {
  const missing = [];
  for (const f of files) {
    for (const { spec } of importsOf(f)) {
      if (!spec.startsWith('.')) continue;                  // CDN imports
      const target = resolve(dirname(f.path), spec.split('?')[0]);
      if (!existsSync(target)) missing.push(`${f.name} -> ${spec}`);
    }
  }
  assert.deepEqual(missing, [], `\n         ${missing.join('\n         ')}`);
});

check('every imported name is actually exported', () => {
  const bad = [];
  for (const f of files) {
    for (const { names, spec } of importsOf(f)) {
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(f.path), spec.split('?')[0]).slice(ROOT.length + 1).replace(/\\/g, '/');
      const exp = exportsByFile.get(target);
      if (!exp) continue;
      for (const n of names) {
        if (!exp.has(n)) bad.push(`${f.name} imports ${n} from ${spec}, which does not export it`);
      }
    }
  }
  assert.deepEqual(bad, [], `\n         ${bad.join('\n         ')}`);
});

console.log('\n=== nothing is used without being imported ===');

check('no module calls another module\'s export without importing it', () => {
  // The check that would have caught pickMembership. If a name is exported
  // somewhere in docs/js, and this file calls it, and this file neither
  // imports nor declares it, the browser will throw ReferenceError the first
  // time that line runs — which may be long after the page has loaded.
  const everyExport = new Map();
  for (const [file, names] of exportsByFile) {
    for (const n of names) if (!everyExport.has(n)) everyExport.set(n, file);
  }

  const problems = [];
  for (const f of files) {
    const c = code(f.src);
    const imported = new Set(importsOf(f).flatMap((i) => i.names));
    const declared = new Set([
      ...[...c.matchAll(/(?:^|\s)(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]),
      ...[...c.matchAll(/(?:^|\s)(?:const|let|var|class)\s+(\w+)/g)].map((m) => m[1]),
    ]);
    const called = new Set([...c.matchAll(/(?:^|[^\w.$])(\w+)\s*\(/g)].map((m) => m[1]));

    for (const name of called) {
      if (!everyExport.has(name)) continue;          // not one of ours
      if (imported.has(name) || declared.has(name)) continue;
      if (everyExport.get(name) === f.name) continue; // its own export
      problems.push(`${f.name} calls ${name}() — exported by ${everyExport.get(name)}, not imported here`);
    }
  }
  assert.deepEqual(problems, [], `\n         ${problems.join('\n         ')}`);
});

console.log('\n=== one build, not several ===');

check('every ?v= query matches APP_VERSION', () => {
  // A browser caches by URL. Two version numbers in the import graph means two
  // builds loaded side by side, which is how an afternoon disappears.
  const version = readFileSync(join(JS, 'version.js'), 'utf8');
  const build = version.match(/APP_VERSION\s*=\s*'[\d-]+\.(\d+)'/)?.[1];
  assert.ok(build, 'could not read the build number out of version.js');

  const wrong = [];
  for (const f of [...files, { name: 'docs/index.html', src: readFileSync(join(ROOT, 'docs', 'index.html'), 'utf8') }]) {
    for (const m of f.src.matchAll(/\?v=(\d+)/g)) {
      if (m[1] !== build) wrong.push(`${f.name} asks for ?v=${m[1]}, build is ${build}`);
    }
  }
  assert.deepEqual([...new Set(wrong)], [], `\n         ${[...new Set(wrong)].join('\n         ')}`);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
