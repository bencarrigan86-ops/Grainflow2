// Dev server for docs/ that disables all caching. A straight port of serve.py
// for machines without Python — same port, same behaviour, no npm packages.
//
// Plain static servers send no Cache-Control header, so browsers fall back to
// heuristic caching, which is exactly what made this app's own JS/CSS edits
// keep showing up stale on a phone that had loaded it before. Every response
// here is forced to revalidate.
//
//   node serve.js

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8756;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'docs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const noCache = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  };

  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Refuse anything that tries to climb out of docs/.
    const full = join(ROOT, normalize(path));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403, noCache);
      return res.end('Forbidden');
    }

    const info = await stat(full);
    const file = await readFile(info.isDirectory() ? join(full, 'index.html') : full);

    res.writeHead(200, {
      ...noCache,
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
    });
    res.end(file);
  } catch {
    res.writeHead(404, noCache);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT} (no-cache)`);
  console.log('Press Ctrl+C to stop.');
});
