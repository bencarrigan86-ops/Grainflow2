// A small PDF writer: enough to lay out a one or two page form with text, lines, boxes and tick boxes.
//
// Why not a library: the app has no build step and works offline, and the paperwork it makes (a vendor
// declaration, a freight order) is plain text in boxes. Helvetica is one of the fonts every PDF reader has, so
// nothing is embedded; the cost is that only Latin text can be written (anything else prints as "?").
//
// Coordinates are in points (1/72 inch) from the top left of the page, y going down, which is how a form is
// laid out. A4 is 595 x 842. Pure: it builds bytes and touches nothing else.

const A4 = { width: 595.28, height: 841.89 };

// Character widths in 1/1000 em for the printable ASCII range (space to ~), from the Helvetica font metrics.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Windows-1252 codes for the typographic characters people paste in.
const CP1252 = { '€': 128, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151 };

const byteOf = (ch) => {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code < 127) return code;
  if (CP1252[ch]) return CP1252[ch];
  if (code >= 160 && code < 256) return code;
  return 63; // ?
};

/** Text as the single-byte characters the PDF fonts expect. */
const encode = (str) => Array.from(String(str ?? '').replace(/[\r\n\t]+/g, ' ')).map((ch) => String.fromCharCode(byteOf(ch))).join('');

const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const f2 = (n) => (Math.round(n * 100) / 100).toString();

/** How wide a string is, in points, at a font size. */
export function textWidth(str, size = 10, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of encode(str)) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code < 127 ? table[code - 32] : 556;
  }
  return (w * size) / 1000;
}

/** Breaks a string into lines no wider than `width`, at spaces where it can (a long word is cut). */
export function wrapText(str, width, size = 10, bold = false) {
  const lines = [];
  for (const para of String(str ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, size, bold) <= width) { line = tryLine; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (textWidth(rest, size, bold) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export class Pdf {
  constructor({ width = A4.width, height = A4.height } = {}) {
    this.width = width;
    this.height = height;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.pages.push([]);
    return this;
  }

  get ops() { return this.pages[this.pages.length - 1]; }

  /**
   * One line of text with its top at y. align: 'left' (x is the left edge), 'right' (x is the right edge) or
   * 'center' (x is the middle). Returns the width used. `gray` is 0 (black) to 1 (white).
   */
  text(x, y, str, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    const w = textWidth(str, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const baseline = this.height - (y + size * 0.8);
    this.ops.push(`${f2(gray)} g BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf ${f2(left)} ${f2(baseline)} Td (${escapeText(encode(str))}) Tj ET 0 g`);
    return w;
  }

  /** Wrapped text from (x, y) in a column `width` wide. Returns the y below the last line. */
  paragraph(x, y, str, width, { size = 10, bold = false, lineHeight = size * 1.3, gray = 0 } = {}) {
    let at = y;
    for (const line of wrapText(str, width, size, bold)) {
      if (line) this.text(x, at, line, { size, bold, gray });
      at += lineHeight;
    }
    return at;
  }

  line(x1, y1, x2, y2, { width = 0.75, gray = 0 } = {}) {
    this.ops.push(`${f2(gray)} G ${f2(width)} w ${f2(x1)} ${f2(this.height - y1)} m ${f2(x2)} ${f2(this.height - y2)} l S 0 G`);
    return this;
  }

  /** A line through several points ([[x, y], ...]); one point is drawn as a dot. Round ends and joins, like ink. */
  polyline(points, { width = 1, gray = 0 } = {}) {
    if (!points || !points.length) return this;
    const pts = points.length === 1 ? [points[0], [points[0][0] + 0.2, points[0][1]]] : points;
    const path = pts.map((p, i) => `${f2(p[0])} ${f2(this.height - p[1])} ${i ? 'l' : 'm'}`).join(' ');
    this.ops.push(`${f2(gray)} G ${f2(width)} w 1 J 1 j ${path} S 0 G 0 J 0 j`);
    return this;
  }

  /** A rectangle with its top left at (x, y). `fill` and `stroke` are gray levels (0 black to 1 white), or null. */
  rect(x, y, w, h, { stroke = 0, fill = null, lineWidth = 0.75 } = {}) {
    const parts = [];
    if (fill !== null) parts.push(`${f2(fill)} g`);
    if (stroke !== null) parts.push(`${f2(stroke)} G ${f2(lineWidth)} w`);
    parts.push(`${f2(x)} ${f2(this.height - y - h)} ${f2(w)} ${f2(h)} re`);
    parts.push(fill !== null && stroke !== null ? 'B' : fill !== null ? 'f' : 'S');
    parts.push('0 g 0 G');
    this.ops.push(parts.join(' '));
    return this;
  }

  /** A tick box, crossed when checked. */
  checkbox(x, y, size = 9, checked = false) {
    this.rect(x, y, size, size, { lineWidth: 0.8 });
    if (checked) {
      const p = size * 0.2;
      this.line(x + p, y + p, x + size - p, y + size - p, { width: 1.2 });
      this.line(x + size - p, y + p, x + p, y + size - p, { width: 1.2 });
    }
    return this;
  }

  /** The finished file as bytes. */
  bytes() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');                                   // 1
    add('');                                                                   // 2: pages, filled in below
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');       // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');  // 4
    const kids = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(this.width)} ${f2(this.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
      kids.push(`${pageId} 0 R`);
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}
