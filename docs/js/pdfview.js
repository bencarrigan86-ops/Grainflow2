// A look at a PDF before it is sent: the pages drawn on screen, with zoom, and the same Share (or Download) button.
//
// It draws from the finished file's own bytes (pdfparse.js), so what is on screen is what would be sent. No PDF viewer is
// needed on the device, which matters: Android Chrome cannot show a PDF, and an iPhone shows only the first page of one in a frame.

import { openSheet, openOver, toast, escHtml } from './ui.js?v=452';
import { sharePdf, canShareFiles, downloadFile, safeFileName } from './sharefile.js?v=452';
import { parsePdf, drawPage } from './pdfparse.js?v=452';

const ZOOMS = [1, 1.5, 2, 3, 4];   // 1 is the page fitted to the width of the screen
const MAX_SIDE = 4096;             // a canvas bigger than this is refused by some phones

/** The pictures in the file, decoded; a picture the device cannot decode (a CMYK photo) is left out. */
async function decodePictures(images) {
  return Promise.all(images.map(async (img) => {
    try { return await createImageBitmap(new Blob([img.data], { type: 'image/jpeg' })); } catch { return null; }
  }));
}

/**
 * A PDF this viewer cannot draw (the spray request and the farm map are written by a different library, compressed): a sheet
 * with a button that opens it in the device's own PDF viewer. A link, so it is a tap on the page and no pop-up blocker stops it.
 */
function openOutside(bytes, { title, fileName, share }) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  const can = canShareFiles();
  openOver(() => openSheet(escHtml(title), (root) => {
    root.innerHTML = `
      <div class="hint" style="margin-bottom:12px">This one is made by a different part of the app, so it cannot be drawn here. Open it in your device's PDF viewer to look at it.</div>
      <div class="pv-actions"><a class="btn secondary" href="${url}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Open PDF</a>${share === false ? '' : `<button type="button" class="btn" data-share>${can ? 'Share PDF' : 'Download PDF'}</button>`}</div>`;
    root.querySelector('[data-share]')?.addEventListener('click', async () => {
      const name = safeFileName(fileName);
      if (!can) { downloadFile(bytes, name); toast('Downloaded'); return; }
      await sharePdf(bytes, name, { title: title === 'Preview' ? name : title, ...share });
    });
  }, { askBeforeClose: false }), null);
}

/**
 * Opens the preview. `share` is what sharePdf is given (title, text, mail), so Share from here does what Share did before.
 * `share: false` makes it look-only (no Share button), for a document whose Send does more than share it: saves it, files a copy, marks it sent.
 * Opens over the sheet it was tapped in, and that sheet is back when the preview is closed.
 * @param {Uint8Array} bytes the finished PDF
 * @param {{title?: string, fileName?: string, share?: object}} [opts]
 */
export function viewPdf(bytes, { title = 'Preview', fileName = 'report.pdf', share = {} } = {}) {
  const lookOnly = share === false;
  let parsed;
  try { parsed = parsePdf(bytes); } catch { parsed = { pages: [], images: [] }; }
  if (!parsed.pages.length) { openOutside(bytes, { title, fileName, share }); return; }
  openOver(() => openSheet(escHtml(title), (root) => {
    let zoom = 0;
    const can = canShareFiles();
    root.innerHTML = `
      <div class="pv-bar">
        <div class="pv-zoom"><button type="button" class="btn secondary small" data-zoom="-1" aria-label="Smaller">&minus;</button><button type="button" class="btn secondary small" data-zoom="0">Fit</button><button type="button" class="btn secondary small" data-zoom="1" aria-label="Bigger">+</button></div>
        ${lookOnly ? '' : `<button type="button" class="btn small" data-share>${can ? 'Share PDF' : 'Download PDF'}</button>`}
      </div>
      <div class="pv-scroll"><div class="pv-pages"></div></div>`;
    const holder = root.querySelector('.pv-pages');
    const scroller = root.querySelector('.pv-scroll');
    let pictures = [];

    const paint = () => {
      const fit = Math.max(240, scroller.clientWidth - 2);
      holder.innerHTML = '';
      parsed.pages.forEach((page) => {
        const cssWidth = fit * ZOOMS[zoom];
        const ratio = Math.min(window.devicePixelRatio || 1, 3, MAX_SIDE / cssWidth, MAX_SIDE / (cssWidth * page.height / page.width));
        const canvas = document.createElement('canvas');
        canvas.className = 'pv-page';
        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssWidth * ratio * page.height / page.width);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssWidth * page.height / page.width}px`;
        drawPage(canvas.getContext('2d'), page, canvas.width / page.width, pictures);
        holder.appendChild(canvas);
      });
    };
    const setZoom = (z) => { zoom = Math.min(ZOOMS.length - 1, Math.max(0, z)); paint(); };

    root.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const d = Number(b.dataset.zoom);
      setZoom(d === 0 ? 0 : zoom + d);
    }));
    root.querySelector('[data-share]')?.addEventListener('click', async () => {
      const name = safeFileName(fileName);
      if (!can) { downloadFile(bytes, name); toast('Downloaded'); return; }
      const result = await sharePdf(bytes, name, { title: title === 'Preview' ? name : title, ...share });
      if (result === 'shared') toast('Sent');
    });

    paint();                                           // the text and boxes at once, the pictures when they have decoded
    if (parsed.images.length) decodePictures(parsed.images).then((p) => { pictures = p; paint(); });
  }, { wide: true, askBeforeClose: false }), null);
}

