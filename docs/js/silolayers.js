// What a silo holds, by grade, and a picture of it.
//
// A silo is a stack: the grain that was already there at the bottom, then each load
// on top of the last. Each layer can be its own grade. This turns that stack into
// the things the screen shows — which grades are in it and in what proportion, the
// grade that most of it is, and a drawing of the silo with its layers in it.
//
// Pure. The stack itself comes from outload.js (layersForStorage).

export const NO_GRADE = 'No grade';
const NO_GRADE_COLOR = '#9aa3ad';

// Colours that stay apart from each other, and from the green the app uses for
// everything else. A grade always gets the same colour, on every silo.
const PALETTE = ['#d95f02', '#1f78b4', '#7570b3', '#e7298a', '#b8860b', '#16a085', '#a6761d', '#c0392b', '#6a3d9a', '#2c3e50'];

export const gradeKey = (g) => String(g ?? '').trim().toLowerCase();

/** The colour a grade is drawn in; the same grade is the same colour everywhere. */
export function gradeColor(grade) {
  const key = gradeKey(grade);
  if (!key) return NO_GRADE_COLOR;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const tonsOf = (l) => Number(l?.tons) || 0;

/**
 * The grades in a stack of layers, most grain first.
 *
 * @param {object[]} layers  from layersForStorage; each { tons, spec: { grade } }
 * @returns {{grade: string, key: string, tons: number, pct: number, color: string}[]}
 */
export function gradeMix(layers) {
  const total = (layers || []).reduce((a, l) => a + tonsOf(l), 0);
  const by = new Map();
  for (const l of layers || []) {
    const key = gradeKey(l.spec?.grade);
    if (!by.has(key)) by.set(key, { grade: key ? String(l.spec.grade).trim() : NO_GRADE, key, tons: 0 });
    by.get(key).tons += tonsOf(l);
  }
  return [...by.values()]
    .map((g) => ({ ...g, pct: total > 0 ? g.tons / total : 0, color: gradeColor(g.key ? g.grade : '') }))
    .sort((a, b) => b.tons - a.tons);
}

/** The grades worth showing: a sliver under 1% of the silo (a rounding crumb) is left out. */
export const visibleMix = (mix) => (mix || []).filter((g) => g.tons > 0 && Math.round(g.pct * 100) >= 1);

/** Does any layer say what grade it is? */
export const hasGrades = (layers) => (layers || []).some((l) => gradeKey(l.spec?.grade));

/** The grade most of the silo is, or '' when nothing in it has a grade. */
export function dominantGrade(layers) {
  const graded = gradeMix(layers).filter((g) => g.key);
  return graded.length ? graded[0].grade : '';
}

/**
 * "APH1 60% · AUH2 40%". A silo of one grade is just that grade — a percentage of
 * everything adds nothing — and a long tail is cut to the biggest few.
 */
export function mixText(mix, limit = 3) {
  const shown = visibleMix(mix);
  if (shown.length === 0) return '';
  if (shown.length === 1) return shown[0].grade;
  const parts = shown.slice(0, limit).map((g) => `${g.grade} ${Math.round(g.pct * 100)}%`);
  return parts.join(' · ') + (shown.length > limit ? ` · +${shown.length - limit} more` : '');
}

const BAND_SPECS = ['proteinPct', 'moisturePct', 'screeningsPct', 'testWeightKgHl', 'fallingNumber', 'oilPct'];

/**
 * Grade bands as they are saved: tonnes above zero, a trimmed grade, and a number for
 * each measurement that was given. A band with tonnes and nothing else is kept — it is a
 * stretch of grain that has not been sampled yet, and it still takes up its place.
 */
export function cleanBands(rows) {
  const out = [];
  for (const r of rows || []) {
    const tons = Number(r?.tons);
    if (!(tons > 0)) continue;
    const band = { tons: Math.round(tons * 1000) / 1000, grade: String(r.grade ?? '').trim() };
    for (const key of BAND_SPECS) {
      const v = r[key] === '' || r[key] == null ? NaN : Number(r[key]);
      if (Number.isFinite(v)) band[key] = v;
    }
    out.push(band);
  }
  return out;
}

/** What the layers add up to, in tonnes. */
export const layersTotal = (rows) => (rows || []).reduce((a, r) => a + (Number(r?.tons) || 0), 0);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A silo with its layers in it, as SVG markup: grain from the bottom up, each layer
 * as tall as its tonnes are of the silo's capacity, so the empty space at the top
 * is the room left. With no capacity the silo is drawn exactly full.
 *
 * Colours are fixed per grade; the outline takes the page's text colour, so it
 * reads in light and dark.
 */
export function siloSvg(layers, capacityTons, { width = 96, height = 170 } = {}) {
  const list = (layers || []).filter((l) => tonsOf(l) > 0);
  const total = list.reduce((a, l) => a + tonsOf(l), 0);
  const cap = Number(capacityTons) > 0 ? Math.max(Number(capacityTons), total) : total;
  const bodyX = 16; const bodyW = width - 32;
  const top = 26; const bottom = height - 8;
  const bodyH = bottom - top;
  let y = bottom;
  const bars = [];
  for (const l of list) {
    const h = cap > 0 ? (tonsOf(l) / cap) * bodyH : 0;
    y -= h;
    const grade = gradeKey(l.spec?.grade) ? String(l.spec.grade).trim() : '';
    bars.push(`<rect x="${bodyX}" y="${y.toFixed(2)}" width="${bodyW}" height="${Math.max(h, 0.5).toFixed(2)}" fill="${gradeColor(grade)}"><title>${esc(grade || NO_GRADE)} · ${Math.round(tonsOf(l) * 10) / 10} t</title></rect>`);
    // a thin line between layers so two of the same grade can be told apart
    bars.push(`<line x1="${bodyX}" x2="${bodyX + bodyW}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}" stroke="rgba(255,255,255,.55)" stroke-width="1"/>`);
  }
  const label = list.length
    ? `Silo holding ${Math.round(total)} tonnes: ${gradeMix(list).map((g) => `${g.grade} ${Math.round(g.tons)} t`).join(', ')}`
    : 'Empty silo';
  const clip = `silo-clip-${Math.abs(Math.round(total * 100)) % 100000}-${list.length}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" style="color:var(--text)">
    <defs><clipPath id="${clip}"><rect x="${bodyX}" y="${top}" width="${bodyW}" height="${bodyH}" rx="6"/></clipPath></defs>
    <path d="M${bodyX} ${top} L${width / 2} 6 L${bodyX + bodyW} ${top} Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <rect x="${bodyX}" y="${top}" width="${bodyW}" height="${bodyH}" rx="6" fill="rgba(128,138,150,.10)"/>
    <g clip-path="url(#${clip})">${bars.join('')}</g>
    <rect x="${bodyX}" y="${top}" width="${bodyW}" height="${bodyH}" rx="6" fill="none" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}

/**
 * A bunker (or shed) seen from the side: a long heap with sloping ends, a flat top and softly rounded shoulders. The loads that went in lie end to end, the first at the back (left) and the latest nearest the front
 * (right), each as long as its tonnes are of the bunker's capacity, so the empty length at the front is the room
 * left. Outloading starts at the front by default (last in, first out), the end marked START; a bunker that can be
 * opened at the back too can be emptied from there instead (`outloadEnd: 'first'`), and the marker moves to the back.
 */
export function bunkerSvg(layers, capacityTons, { width = 300, height = 120, outloadEnd = 'last' } = {}) {
  const list = (layers || []).filter((l) => tonsOf(l) > 0);
  const total = list.reduce((a, l) => a + tonsOf(l), 0);
  const cap = Number(capacityTons) > 0 ? Math.max(Number(capacityTons), total) : total;
  const fromBack = outloadEnd === 'first';
  const left = 14; const right = width - 14;          // the foot of the heap
  const baseY = 84; const topY = 38;
  const span = right - left;
  let x = left;
  const bars = [];
  for (const l of list) {
    const w = cap > 0 ? (tonsOf(l) / cap) * span : 0;
    const grade = gradeKey(l.spec?.grade) ? String(l.spec.grade).trim() : '';
    bars.push(`<rect x="${x.toFixed(2)}" y="${topY - 12}" width="${Math.max(w, 0.5).toFixed(2)}" height="${baseY - topY + 12}" fill="${gradeColor(grade)}"><title>${esc(grade || NO_GRADE)} · ${Math.round(tonsOf(l) * 10) / 10} t</title></rect>`);
    // a thin line between layers so two of the same grade can be told apart
    bars.push(`<line x1="${x.toFixed(2)}" x2="${x.toFixed(2)}" y1="${topY - 12}" y2="${baseY}" stroke="rgba(255,255,255,.55)" stroke-width="1"/>`);
    x += w;
  }
  // the heap seen from the side: sloping ends, a flat top, and the shoulders softly rounded where the top turns down
  const inset = 30; const k = 12;
  const run = Math.hypot(inset, baseY - topY);
  const bx = (inset / run) * k; const by = ((baseY - topY) / run) * k;
  const n = (v) => Math.round(v * 10) / 10;
  const shape = `M${left} ${baseY} L${n(left + inset - bx)} ${n(topY + by)} Q${left + inset} ${topY} ${left + inset + k} ${topY} L${right - inset - k} ${topY} Q${right - inset} ${topY} ${n(right - inset + bx)} ${n(topY + by)} L${right} ${baseY} Z`;
  const startX = fromBack ? left + inset : right - inset;
  const startSide = fromBack ? 'back' : 'front';
  const label = list.length
    ? `Bunker holding ${Math.round(total)} tonnes, back to front: ${gradeMix(list).map((g) => `${g.grade} ${Math.round(g.tons)} t`).join(', ')}. Outloading starts at the ${startSide} end.`
    : `Empty bunker. Outloading starts at the ${startSide} end.`;
  const clip = `bunker-clip-${Math.abs(Math.round(total * 100)) % 100000}-${list.length}`;
  const startText = 'START: outload from here';
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}" style="color:var(--text);max-width:100%;height:auto">
    <defs><clipPath id="${clip}"><path d="${shape}"/></clipPath></defs>
    <path d="${shape}" fill="rgba(128,138,150,.10)"/>
    <g clip-path="url(#${clip})">${bars.join('')}</g>
    <path d="${shape}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <line x1="4" x2="${width - 4}" y1="${baseY}" y2="${baseY}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M${startX} ${topY - 30} L${startX} ${topY - 8} M${startX - 7} ${topY - 15} L${startX} ${topY - 7} L${startX + 7} ${topY - 15}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${left}" y="${baseY + 18}" font-size="11" ${fromBack ? 'font-weight="700"' : 'opacity=".7"'} fill="currentColor">${fromBack ? startText : 'Back, filled first'}</text>
    <text x="${right}" y="${baseY + 18}" font-size="11" ${fromBack ? 'opacity=".7"' : 'font-weight="700"'} fill="currentColor" text-anchor="end">${fromBack ? 'Front, filled last' : startText}</text>
  </svg>`;
}

/** The right picture for the kind of storage: a bunker or shed lies down; a silo stands up. */
export function storageSvg(kind, layers, capacityTons, { outloadEnd = 'last' } = {}) {
  return kind === 'bunker' ? bunkerSvg(layers, capacityTons, { outloadEnd }) : siloSvg(layers, capacityTons);
}
