// The farm map: paddock outlines from a shapefile (any mapping or farm software can export one), kept
// with each paddock and drawn as one map.
//
// A shapefile is three or more files. The .shp holds the outlines and the .dbf the names that go with them. They are read
// here without a library: the outlines come out as rings of [longitude, latitude] points, which is also how a paddock keeps
// its boundary. Outlines are thinned to about a metre, so a whole farm stays a small thing to store and sync.
//
// Pure: the sheet (views/farmmap.js) picks the files, shows the result and saves.

const METRES_PER_DEG_LAT = 110574;
const METRES_PER_DEG_LON_AT_EQUATOR = 111320;

// --- reading the files ---------------------------------------------------------------------------------------

const bytesOf = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

/** The table of a .dbf: one object per row, keyed by column name. */
export function parseDbf(buf) {
  const b = bytesOf(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recordLen = dv.getUint16(10, true);
  const dec = new TextDecoder('utf-8');
  const cols = [];
  for (let o = 32; o < headerLen - 1 && b[o] !== 0x0d; o += 32) {
    cols.push({ name: dec.decode(b.subarray(o, o + 11)).replace(/\0.*$/, '').trim(), len: b[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    let p = headerLen + i * recordLen + 1;                  // the first byte of a record says whether it is deleted
    if (p + recordLen > b.length + 1) break;
    const row = {};
    for (const c of cols) { row[c.name] = dec.decode(b.subarray(p, p + c.len)).trim(); p += c.len; }
    rows.push(row);
  }
  return rows;
}

/** The outlines in a .shp: for each record, its rings of [lon, lat]. Only polygon files are outlines of land. */
export function parseShp(buf) {
  const b = bytesOf(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 100 || dv.getInt32(0, false) !== 9994) throw new Error('That is not a shapefile (.shp).');
  const type = dv.getInt32(32, true);
  if (![5, 15, 25].includes(type)) throw new Error('That shapefile holds lines or points, not field outlines.');
  const out = [];
  let off = 100;
  while (off + 12 <= b.length) {
    const len = dv.getInt32(off + 4, false) * 2;
    const c = off + 8;                                      // the record's content
    const t = dv.getInt32(c, true);
    if (t === 0) { out.push([]); } else {
      const nParts = dv.getInt32(c + 36, true);
      const nPts = dv.getInt32(c + 40, true);
      const parts = [];
      for (let i = 0; i < nParts; i += 1) parts.push(dv.getInt32(c + 44 + i * 4, true));
      const ptsAt = c + 44 + nParts * 4;
      const rings = [];
      for (let i = 0; i < nParts; i += 1) {
        const from = parts[i];
        const to = i + 1 < nParts ? parts[i + 1] : nPts;
        const ring = [];
        for (let k = from; k < to; k += 1) ring.push([dv.getFloat64(ptsAt + k * 16, true), dv.getFloat64(ptsAt + k * 16 + 8, true)]);
        if (ring.length >= 4) rings.push(ring);
      }
      out.push(rings);
    }
    off += 8 + len;
  }
  return out;
}

const NAME_KEYS = ['FIELD_NAME', 'FIELDNAME', 'FIELD', 'PADDOCK', 'PADDOCK_NAME', 'NAME'];

/**
 * The paddocks in a shapefile and its table together.
 * @returns {{features: {name: string, farm: string, attrs: object, rings: number[][][]}[], nameKey: string}}
 */
export function readBoundaries(shp, dbf) {
  const shapes = parseShp(shp);
  const rows = dbf ? parseDbf(dbf) : [];
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const nameKey = NAME_KEYS.map((k) => keys.find((x) => x.toUpperCase() === k)).find(Boolean) || keys[0] || '';
  const farmKey = keys.find((x) => x.toUpperCase() === 'FARM_NAME') || '';
  const features = shapes.map((rings, i) => ({
    name: String(rows[i]?.[nameKey] ?? '').trim() || `Outline ${i + 1}`,
    farm: farmKey ? String(rows[i]?.[farmKey] ?? '').trim() : '',
    attrs: rows[i] || {},
    rings,
  })).filter((f) => f.rings.length);
  return { features, nameKey };
}

/** The files inside a .zip, by name. Uses the browser's own inflate, so no library. */
export async function unzipFiles(buf) {
  const b = bytesOf(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error('That does not look like a zip file.');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder('utf-8');
  const files = {};
  for (let i = 0; i < count; i += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = b.subarray(start, start + compSize);
    if (method === 0) files[name] = data.slice();
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      files[name] = new Uint8Array(await new Response(stream).arrayBuffer());
    }
  }
  return files;
}

// --- the shapes ----------------------------------------------------------------------------------------------

/** Thins a ring to within `tol` degrees of the original (0.00001 is about a metre), keeping it closed. */
export function simplifyRing(ring, tol = 0.00001) {
  if (ring.length <= 5) return ring.map(([x, y]) => [round6(x), round6(y)]);
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring : [...ring, ring[0]];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop();
    let far = -1; let farD = tol;
    for (let i = a + 1; i < z; i += 1) {
      const d = segDist(pts[i], pts[a], pts[z]);
      if (d > farD) { far = i; farD = d; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, z]); }
  }
  const out = pts.filter((_, i) => keep[i]).map(([x, y]) => [round6(x), round6(y)]);
  return out.length >= 4 ? out : pts.map(([x, y]) => [round6(x), round6(y)]);
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;
function segDist(p, a, z) {
  const dx = z[0] - a[0]; const dy = z[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** All the rings of a paddock, thinned. */
export const simplifyRings = (rings, tol) => rings.map((r) => simplifyRing(r, tol));

/**
 * The area of an outline in hectares. A hole in a paddock turns the other way round to the paddock itself, so adding the
 * signed areas takes holes off.
 */
export function ringsAreaHa(rings) {
  const lats = rings.flat().map((p) => p[1]);
  if (!lats.length) return 0;
  const lat0 = lats.reduce((a, b) => a + b, 0) / lats.length;
  const kx = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  let sum = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) sum += (ring[i][0] * kx) * (ring[i + 1][1] * METRES_PER_DEG_LAT) - (ring[i + 1][0] * kx) * (ring[i][1] * METRES_PER_DEG_LAT);
  }
  return Math.abs(sum / 2) / 10000;
}

/** A paddock's name for matching: case, spaces and punctuation do not count ("A 3-4" is "a34"). */
export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Which outline belongs to which paddock, by name.
 * @returns {{matched: {feature: object, field: object}[], unmatched: object[], unusedFields: object[]}}
 */
export function matchBoundaries(features, fields) {
  const free = new Map();
  for (const f of fields) { const k = normName(f.name); if (!free.has(k)) free.set(k, []); free.get(k).push(f); }
  const matched = []; const unmatched = [];
  for (const feature of features) {
    const list = free.get(normName(feature.name));
    if (list && list.length) matched.push({ feature, field: list.shift() });
    else unmatched.push(feature);
  }
  const unusedFields = [...free.values()].flat();
  return { matched, unmatched, unusedFields };
}

// --- the map -------------------------------------------------------------------------------------------------

/** Colours for the commodities, in order; paddocks with none are grey. */
export const PALETTE = ['#2e7d32', '#c77d00', '#1b6ca8', '#8e44ad', '#c0392b', '#16807a', '#7d6608', '#b8467a'];
export const NO_CROP = '#8a8f87';

/**
 * Lays paddocks out as one map in metres, north up: a viewBox, and for each paddock an SVG path, its middle and its area.
 * @param {{id: string, name: string, color?: string, rings: number[][][]}[]} items
 */
export function mapLayout(items, { pad = 0.04 } = {}) {
  const shown = items.filter((i) => i.rings?.length);
  if (!shown.length) return null;
  const lats = shown.flatMap((i) => i.rings.flat().map((p) => p[1]));
  const lat0 = lats.reduce((a, b) => a + b, 0) / lats.length;
  const kx = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const proj = ([lon, lat]) => [lon * kx, -lat * METRES_PER_DEG_LAT];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const laid = shown.map((i) => {
    const rings = i.rings.map((r) => r.map(proj));
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return { ...i, projected: rings };
  });
  const w = maxX - minX; const h = maxY - minY;
  const px = Math.max(w, h) * pad;
  const ox = minX - px; const oy = minY - px;
  const out = laid.map((i) => {
    const d = i.projected.map((r) => `M${r.map(([x, y]) => `${Math.round((x - ox) * 10) / 10} ${Math.round((y - oy) * 10) / 10}`).join('L')}Z`).join('');
    const biggest = i.projected.reduce((a, r) => (ringArea(r) > ringArea(a) ? r : a), i.projected[0]);
    const [cx, cy] = centroid(biggest);
    const xs = i.projected.flatMap((r) => r.map((p) => p[0] - ox)); const ys = i.projected.flatMap((r) => r.map((p) => p[1] - oy));
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    return { id: i.id, name: i.name, farm: String(i.farm || '').trim(), color: i.color || NO_CROP, d, cx: cx - ox, cy: cy - oy, areaHa: ringArea(biggest) / 10000, bbox };
  });
  return { viewBox: { x: 0, y: 0, w: w + px * 2, h: h + px * 2 }, items: out };
}

function ringArea(r) {
  let s = 0;
  for (let i = 0; i < r.length - 1; i += 1) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(s / 2);
}
function centroid(r) {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < r.length - 1; i += 1) {
    const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    a += f; cx += (r[i][0] + r[i + 1][0]) * f; cy += (r[i][1] + r[i + 1][1]) * f;
  }
  if (!a) return r[0] || [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * The farms on the map: each farm's name, how many paddocks and hectares it has, and where to write its name (the
 * middle of its paddocks, weighted by their size) and the box around it. `hidden` is a list of farm names switched off.
 * Paddocks with no farm name are one group, called "No farm set".
 */
export const NO_FARM = 'No farm set';
export function farmGroups(items, hidden = []) {
  const off = new Set(hidden);
  const map = new Map();
  for (const i of items) {
    const name = i.farm || NO_FARM;
    const g = map.get(name) || { name, paddocks: 0, ha: 0, wx: 0, wy: 0, w: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    const w = Math.max(i.areaHa, 0.0001);
    g.paddocks += 1; g.ha += i.areaHa; g.wx += i.cx * w; g.wy += i.cy * w; g.w += w;
    g.bbox = [Math.min(g.bbox[0], i.bbox[0]), Math.min(g.bbox[1], i.bbox[1]), Math.max(g.bbox[2], i.bbox[2]), Math.max(g.bbox[3], i.bbox[3])];
    map.set(name, g);
  }
  return [...map.values()]
    .map((g) => ({ name: g.name, paddocks: g.paddocks, ha: g.ha, cx: g.wx / g.w, cy: g.wy / g.w, bbox: g.bbox, hidden: off.has(g.name) }))
    .sort((a, b) => (a.name === NO_FARM) - (b.name === NO_FARM) || a.name.localeCompare(b.name));
}

/** The box around the paddocks of the farms that are switched on (or all of them if none are). */
export function visibleBox(items, hidden = []) {
  const off = new Set(hidden);
  const shown = items.filter((i) => !off.has(i.farm || NO_FARM));
  const use = shown.length ? shown : items;
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of use) { b[0] = Math.min(b[0], i.bbox[0]); b[1] = Math.min(b[1], i.bbox[1]); b[2] = Math.max(b[2], i.bbox[2]); b[3] = Math.max(b[3], i.bbox[3]); }
  return b;
}

/**
 * How big to write a paddock's name on screen, in pixels: as large as fits inside the paddock (its box is `wPx` by
 * `hPx`, the writing `chars` wide and `lines` high), no larger than `max`. 0 when even `min` would not fit, so the name
 * is left out. Zoomed in the paddock is big and the name grows; zoomed out it shrinks until it cannot be read.
 */
export function labelFontPx(wPx, hPx, chars, lines, { min = 6.5, max = 15 } = {}) {
  if (!chars || !lines) return 0;
  // within its width, and never more than a share of the paddock's smaller side, so a short name in a modest paddock
  // is not blown up to fill it
  const px = Math.min(max, (wPx * 0.7) / (chars * 0.58), Math.min(wPx, hPx) * (lines > 1 ? 0.26 : 0.38));
  return px >= min ? px : 0;
}

/**
 * How big to write a farm's name, in pixels: wide enough to read but in proportion to the farm (its box is `wPx` wide on
 * screen), so zoomed out the farm names shrink with the farms and do not swamp the paddocks. 0 when it would be
 * smaller than `min`.
 */
export function farmLabelPx(wPx, chars, { min = 8, max = 16 } = {}) {
  if (!chars) return 0;
  const px = Math.min(max, (wPx * 1.05) / (chars * 0.78));
  return px >= min ? px : 0;
}

/**
 * The one size names are written in across the view, from the paddocks in it: a third of the typical paddock's smaller
 * side on screen, kept between `min` and `max`. Zoom in and the paddocks are bigger, so the lettering follows; zoom out
 * and it comes down. A name only goes smaller than this when its own paddock is too small to hold it (labelFontPx).
 * @param {number[]} minSidesPx  for each paddock in view, its smaller side in pixels
 */
export function commonLabelPx(minSidesPx, { min = 8, max = 16 } = {}) {
  const s = minSidesPx.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return min;
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return Math.max(min, Math.min(max, mid * 0.34));
}
