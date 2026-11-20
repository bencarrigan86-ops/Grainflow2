// Writes docs/precache.json: every file the app needs to open with no signal, at this build's stamp.
//
// The service worker downloads exactly this list when it installs a new build and does not take over until all of it is in. Before,
// it cached only the page and the stylesheet, so a phone that updated and was then opened in a paddock with no signal found
// index.html but none of the build's scripts: a blank page until one more launch with signal.
//
// Run it after changing the build number or adding or removing a file under docs/:
//     node tools/make-precache.mjs
// tests/precache.test.mjs fails when the list is out of step with docs/, so forgetting is caught, not shipped.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/', import.meta.url));

export function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function buildPrecache(docsRoot = root) {
  const version = /APP_VERSION\s*=\s*'[^']*\.(\d+)'/.exec(readFileSync(join(docsRoot, 'js/version.js'), 'utf8'))[1];
  const rel = (f) => relative(docsRoot, f).split('\\').join('/');
  const required = ['./', './index.html', './manifest.webmanifest', `./css/styles.css?v=${version}`];
  for (const f of listFiles(join(docsRoot, 'js'))) if (f.endsWith('.js')) required.push(`./${rel(f)}?v=${version}`);
  // Nice to have offline, but a missing one must not stop an update.
  const optional = [];
  for (const dir of ['icons', 'help', 'forms']) {
    for (const f of listFiles(join(docsRoot, dir))) optional.push(`./${rel(f)}`);
  }
  return { build: version, required, optional };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifest = buildPrecache();
  writeFileSync(join(root, 'precache.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`precache.json: build ${manifest.build}, ${manifest.required.length} required, ${manifest.optional.length} optional`);
}
