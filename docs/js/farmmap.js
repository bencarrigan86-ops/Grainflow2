// The farm map: paddock outlines from a shapefile (John Deere Operations Center and most farm software export one), kept
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
  if (![5, 15, 25].includes(type)) throw new Error('That shapefile holds lines or points, not paddock outlines.');
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
    return { id: i.id, name: i.name, color: i.color || NO_CROP, d, cx: cx - ox, cy: cy - oy, areaHa: ringArea(biggest) / 10000 };
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
