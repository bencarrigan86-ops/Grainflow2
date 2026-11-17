// The farm's logo, and where it goes on a PDF.
//
// The logo is kept as a small JPEG in the business details (a data address, so it is a piece of text like the rest of the farm's
// details and travels with them). The PDF writer takes a JPEG as it is, so this reads the picture's size out of the file and hands
// it over. Every PDF asks here for the logo; the app tells this module which one is current each time the business details are read,
// so no export needs to be told. With no logo set, nothing is drawn and no PDF changes. Pure.

const PREFIX = /^data:image\/jpe?g;base64,/i;
let current = { source: '', img: null };

/** A JPEG data address as { data (binary string), width, height, comps }, or null when it is not a JPEG that can be read. */
export function jpegInfo(dataUrl) {
  const s = String(dataUrl || '');
  if (!PREFIX.test(s)) return null;
  let data;
  try { data = atob(s.replace(PREFIX, '')); } catch { return null; }
  if (data.charCodeAt(0) !== 0xFF || data.charCodeAt(1) !== 0xD8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data.charCodeAt(i) !== 0xFF) { i += 1; continue; }
    const marker = data.charCodeAt(i + 1);
    if (marker === 0xFF) { i += 1; continue; }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = (data.charCodeAt(i + 2) << 8) | data.charCodeAt(i + 3);
    // a start-of-frame marker (baseline or progressive) carries the size
    if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const height = (data.charCodeAt(i + 5) << 8) | data.charCodeAt(i + 6);
      const width = (data.charCodeAt(i + 7) << 8) | data.charCodeAt(i + 8);
      const comps = data.charCodeAt(i + 9);
      return width > 0 && height > 0 ? { data, width, height, comps } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** Sets the logo every PDF uses (a JPEG data address, or '' for none). Cheap to call again with the same one. */
export function setBrandLogo(dataUrl) {
  const source = String(dataUrl || '');
  if (source === current.source) return;
  current = { source, img: jpegInfo(source) };
}

export const brandLogo = () => current.img;

/** The size the logo is drawn at: as large as fits in maxW by maxH, in its own proportions. */
export function logoSize(img, maxW, maxH) {
  const k = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * k, h: img.height * k };
}

/**
 * Draws the logo with its right edge at `right` and its top at `top`, and returns the x the text beside it should stop at (the logo's
 * left edge less a gap), or `right` when there is no logo. `tile` puts it on a white tile, for a coloured band.
 * @param {import('./pdf.js').Pdf} pdf
 */
export function drawBrandLogo(pdf, { right, top, maxW = 110, maxH = 46, tile = false } = {}) {
  const img = brandLogo();
  if (!img) return right;
  const { w, h } = logoSize(img, maxW, maxH);
  const x = right - w;
  if (tile) pdf.rect(x - 4, top - 4, w + 8, h + 8, { stroke: null, fill: 1 });
  pdf.image(img, x, top, w, h);
  return x - (tile ? 12 : 10);
}
