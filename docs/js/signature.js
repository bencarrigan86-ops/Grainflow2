// A signature kept as the strokes it was drawn with.
//
// A handwritten signature is saved once, drawn with a finger or a pen on the signature pad, and then drawn onto
// each document that needs signing. It is kept as lines (each stroke a list of points, each point between 0 and 1
// across a box three times as wide as it is tall) rather than as a picture: it is a few hundred bytes, it scales to
// any size, and a PDF can draw lines without needing an image decoder.
//
// Pure: no page, no storage.

/** The box a signature is drawn in, as width : height. The pad and the PDF use the same shape. */
export const ASPECT = 3;

const MAX_POINTS = 1500;
const MAX_STROKES = 40;

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Tidies strokes from the pad or from storage: only real points, kept inside the box, rounded, with the points
 * that sit almost on top of each other dropped, and a limit on how much can be kept.
 * @param {Array<Array<[number, number]>>} strokes
 * @returns {Array<Array<[number, number]>>}
 */
export function cleanStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  const out = [];
  let total = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || out.length >= MAX_STROKES) continue;
    const pts = [];
    for (const p of stroke) {
      if (!Array.isArray(p)) continue;
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const pt = [round3(clamp01(x)), round3(clamp01(y))];
      const last = pts[pts.length - 1];
      if (last && Math.abs(last[0] - pt[0]) < 0.002 && Math.abs(last[1] - pt[1]) < 0.002) continue;
      pts.push(pt);
    }
    if (!pts.length) continue;
    if (total + pts.length > MAX_POINTS) break;
    total += pts.length;
    out.push(pts);
  }
  return out;
}

/** True when there is something drawn: a stroke that goes somewhere, or a dot. */
export const hasSignature = (strokes) => cleanStrokes(strokes).length > 0;

/** The strokes as the text kept in the database ('' when there is no signature). */
export const strokesToText = (strokes) => {
  const clean = cleanStrokes(strokes);
  return clean.length ? JSON.stringify(clean) : '';
};

/** The strokes back from text; [] for anything that is not a signature. */
export function strokesFromText(text) {
  if (!text) return [];
  try { return cleanStrokes(JSON.parse(text)); } catch { return []; }
}

/** An SVG path for the strokes in a box `width` wide, for showing a saved signature on screen. */
export function strokesToSvgPath(strokes, width = 150) {
  const height = width / ASPECT;
  const f = (n) => (Math.round(n * 10) / 10).toString();
  return cleanStrokes(strokes).map((s) => (s.length === 1
    ? `M${f(s[0][0] * width)} ${f(s[0][1] * height)}l0.1 0`
    : s.map((p, i) => `${i ? 'L' : 'M'}${f(p[0] * width)} ${f(p[1] * height)}`).join(''))).join(' ');
}

/** Each stroke as points in a box of `width` x `height` at (x, y), ready for a PDF to draw. */
export function strokesInBox(strokes, x, y, width, height) {
  return cleanStrokes(strokes).map((s) => s.map((p) => [x + p[0] * width, y + p[1] * height]));
}
