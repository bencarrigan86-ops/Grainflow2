// Taking a logo from a picture file: shrunk to fit a small box and kept as a JPEG data address.
//
// A logo only has to look right at the top of a page, so it is cut down to at most 480 x 240 pixels, laid on white (a picture
// with a clear background would turn black as a JPEG otherwise) and saved at good quality. That is a few tens of kilobytes, small
// enough to sit with the farm's other details. The sizing is pure; reading the file needs the browser.

export const LOGO_MAX = { width: 480, height: 240 };
/** The biggest data address kept, so a stray huge file cannot bloat the farm's details. */
export const LOGO_MAX_CHARS = 220000;

/** The size to draw a w by h picture at so it fits in maxW by maxH, in its own proportions and never enlarged. */
export function fitWithin(w, h, maxW = LOGO_MAX.width, maxH = LOGO_MAX.height) {
  const k = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** The picture file as a JPEG data address, or rejects with a message to show. */
export async function logoFromFile(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Choose a picture file (PNG or JPG).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That picture could not be read. Try a PNG or JPG.'));
      el.src = url;
    });
    const { width, height } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    let out = canvas.toDataURL('image/jpeg', 0.9);
    if (out.length > LOGO_MAX_CHARS) out = canvas.toDataURL('image/jpeg', 0.7);
    if (out.length > LOGO_MAX_CHARS) throw new Error('That picture is too detailed to keep as a logo. Try a simpler one.');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
