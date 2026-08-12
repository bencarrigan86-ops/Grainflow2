/**
 * Compresses a captured/selected photo to a small JPEG data URL and stamps
 * the current date/time in the corner — so a movement photo (e.g. a truck
 * rego) carries a visible timestamp without needing a separate camera app.
 * Resized client-side because these are stored as data URLs in localStorage,
 * which has a small (few MB) quota shared with the rest of the app's data.
 */
export function compressAndStampImage(file, { maxWidth = 1280, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const stamp = new Date().toLocaleString('en-AU', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        const fontSize = Math.max(14, Math.round(w * 0.032));
        const pad = Math.max(6, Math.round(fontSize * 0.4));
        ctx.font = `600 ${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(stamp).width;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(w - textWidth - pad * 3, h - fontSize - pad * 3, textWidth + pad * 3, fontSize + pad * 3);
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'bottom';
        ctx.fillText(stamp, w - textWidth - pad * 1.5, h - pad * 1.5);

        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
