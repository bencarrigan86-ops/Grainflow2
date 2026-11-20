// Reads back the PDFs this app writes (pdf.js, class Pdf) and draws them on a canvas, so a report can be looked at before it is sent.
//
// Why not a PDF library: every PDF in the app is made by Pdf, which writes a handful of drawing commands (text in Helvetica,
// lines, boxes, a JPEG or two). Reading those back is a few dozen lines, works offline, and looks the same on an iPhone, an
// Android phone, an iPad and a computer, none of which agree on how to show a PDF. It reads only what Pdf writes.
// Pure: no DOM here, only the calls it makes on the drawing context it is given.

// Windows-1252 characters in the 128-159 range, as Pdf writes them (see CP1252 in pdf.js).
const FROM_CP1252 = { 128: '€', 133: '…', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—' };
const unicode = (s) => Array.from(s, (ch) => FROM_CP1252[ch.charCodeAt(0)] || ch).join('');

/**
 * The pages of a PDF written by Pdf: each page's size in points and its drawing commands, and the pictures in the file.
 * @param {Uint8Array} bytes
 * @returns {{pages: {width: number, height: number, content: string}[], images: {width: number, height: number, comps: number, data: Uint8Array}[]}}
 */
export function parsePdf(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  const objects = new Map();   // id -> { dict, stream }
  const header = /(\d+) 0 obj\n/g;
  let at = 0;
  for (;;) {
    header.lastIndex = at;
    const m = header.exec(text);
    if (!m) break;
    const start = m.index + m[0].length;
    const streamAt = text.indexOf('\nstream\n', start);
    const endAt = text.indexOf('\nendobj\n', start);
    if (streamAt !== -1 && (endAt === -1 || streamAt < endAt)) {
      const dict = text.slice(start, streamAt);
      const length = Number((/\/Length (\d+)/.exec(dict) || [])[1]) || 0;
      objects.set(Number(m[1]), { dict, stream: text.slice(streamAt + 8, streamAt + 8 + length) });
      at = streamAt + 8 + length;
    } else {
      if (endAt === -1) break;
      objects.set(Number(m[1]), { dict: text.slice(start, endAt), stream: null });
      at = endAt + 8;
    }
  }
  const pages = [];
  const images = [];
  for (const [, o] of [...objects].sort((a, b) => a[0] - b[0])) {
    if (/\/Subtype \/Image/.test(o.dict) && o.stream != null) {
      const data = new Uint8Array(o.stream.length);
      for (let i = 0; i < o.stream.length; i += 1) data[i] = o.stream.charCodeAt(i) & 255;
      images.push({
        width: Number((/\/Width (\d+)/.exec(o.dict) || [])[1]) || 1,
        height: Number((/\/Height (\d+)/.exec(o.dict) || [])[1]) || 1,
        comps: /\/DeviceGray/.test(o.dict) ? 1 : /\/DeviceCMYK/.test(o.dict) ? 4 : 3,
        data,
      });
    } else if (/\/Type \/Page\b(?!s)/.test(o.dict)) {
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(o.dict);
      const ref = /\/Contents (\d+) 0 R/.exec(o.dict);
      const content = ref && objects.get(Number(ref[1]));
      // a compressed page is not one of ours (the spray request and the farm map are written by another library): left out
      if (box && content && content.stream != null && !/\/Filter/.test(content.dict)) pages.push({ width: Number(box[1]), height: Number(box[2]), content: content.stream });
    }
  }
  return { pages, images };
}

/** The drawing commands as tokens: numbers, names (/F1), strings and operators. */
function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i += 1; continue; }
    if (c === '(') {
      let depth = 1; let s = ''; i += 1;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === '\\') { s += src[i + 1] ?? ''; i += 2; continue; }
        if (d === '(') depth += 1;
        if (d === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
        s += d; i += 1;
      }
      out.push({ t: 's', v: s });
      continue;
    }
    let j = i;
    while (j < src.length && !' \n\r\t('.includes(src[j])) j += 1;
    const word = src.slice(i, j);
    out.push(word[0] === '/' ? { t: 'n', v: word.slice(1) } : /^-?[\d.]+$/.test(word) ? { t: 'd', v: Number(word) } : { t: 'o', v: word });
    i = j;
  }
  return out;
}

const gray = (g) => { const v = Math.round(Math.min(1, Math.max(0, g)) * 255); return `rgb(${v},${v},${v})`; };
const rgb = (r, g, b) => `rgb(${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

/**
 * Draws one page on a canvas context. `scale` is canvas pixels per point. `pictures` are the page's images already decoded
 * (anything ctx.drawImage takes), in the order parsePdf returned them; a missing one is left out.
 */
export function drawPage(ctx, page, scale, pictures = []) {
  const H = page.height;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.width, H);
  let fill = '#000'; let stroke = '#000'; let lineWidth = 1; let cap = 'butt'; let join = 'miter';
  let font = { bold: false, size: 10 }; let pos = { x: 0, y: 0 };
  let path = [];                        // sub-paths, each a list of [x, y] in PDF coordinates
  let rects = [];
  let matrix = { a: 1, d: 1, e: 0, f: 0 };
  const stack = [];
  const nums = [];

  const trace = () => {
    ctx.beginPath();
    for (const r of rects) ctx.rect(r[0], H - r[1] - r[3], r[2], r[3]);
    for (const sub of path) sub.forEach((p, k) => (k ? ctx.lineTo(p[0], H - p[1]) : ctx.moveTo(p[0], H - p[1])));
  };
  const paint = (doFill, doStroke) => {
    trace();
    if (doFill) { ctx.fillStyle = fill; ctx.fill(); }
    if (doStroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.lineCap = cap; ctx.lineJoin = join; ctx.stroke(); }
    path = []; rects = [];
  };

  for (const tk of tokens(page.content)) {
    if (tk.t === 'd' || tk.t === 'n' || tk.t === 's') { nums.push(tk); continue; }
    const a = nums.map((n) => n.v);
    switch (tk.v) {
      case 'g': fill = gray(a[0]); break;
      case 'G': stroke = gray(a[0]); break;
      case 'rg': fill = rgb(a[0], a[1], a[2]); break;
      case 'RG': stroke = rgb(a[0], a[1], a[2]); break;
      case 'w': lineWidth = a[0]; break;
      case 'J': cap = a[0] === 1 ? 'round' : 'butt'; break;
      case 'j': join = a[0] === 1 ? 'round' : 'miter'; break;
      case 'm': path.push([[a[0], a[1]]]); break;
      case 'l': (path[path.length - 1] || (path.push([]), path[0])).push([a[0], a[1]]); break;
      case 're': rects.push([a[0], a[1], a[2], a[3]]); break;
      case 'f': paint(true, false); break;
      case 'S': paint(false, true); break;
      case 'B': paint(true, true); break;
      case 'BT': pos = { x: 0, y: 0 }; break;
      case 'Tf': font = { bold: a[0] === 'F2', size: a[1] }; break;
      case 'Td': pos = { x: a[0], y: a[1] }; break;
      case 'Tj':
        ctx.font = `${font.bold ? 'bold ' : ''}${font.size}px Helvetica, Arial, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.fillStyle = fill;
        ctx.fillText(unicode(a[0]), pos.x, H - pos.y);
        break;
      case 'q': stack.push({ ...matrix }); break;
      case 'Q': matrix = stack.pop() || { a: 1, d: 1, e: 0, f: 0 }; break;
      case 'cm': matrix = { a: a[0], d: a[3], e: a[4], f: a[5] }; break;
      case 'Do': {
        const picture = pictures[Number(String(a[0]).replace(/^Im/, ''))];
        if (picture) ctx.drawImage(picture, matrix.e, H - matrix.f - matrix.d, matrix.a, matrix.d);
        break;
      }
      default: break;   // ET and anything else Pdf does not write
    }
    nums.length = 0;
  }
  ctx.restore();
}
