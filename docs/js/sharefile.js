// Getting a made-up file to someone: the phone's own share sheet where it can take a file, a download otherwise.
//
// A web page cannot attach a file to an email by itself. The share sheet can: on a phone it offers Mail, Messages,
// WhatsApp and the rest with the PDF already attached. On a computer there is no share sheet, so the file is
// downloaded and a pre-addressed email is opened for it to be attached to.

const PDF = 'application/pdf';

/** A file name safe on every system: letters, digits, spaces, dots and dashes. */
export function safeFileName(name, ext = 'pdf') {
  const base = String(name || 'document').replace(/[^A-Za-z0-9 ._-]+/g, '').replace(/\s+/g, ' ').trim() || 'document';
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/** A mailto: link with the address, subject and message filled in. */
export function mailtoLink({ to = '', subject = '', body = '' } = {}) {
  const q = [];
  if (subject) q.push(`subject=${encodeURIComponent(subject)}`);
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encodeURIComponent(String(to).trim()).replace(/%40/g, '@').replace(/%2C/g, ',')}${q.length ? `?${q.join('&')}` : ''}`;
}

/** Saves the bytes as a file on this device. */
export function downloadFile(bytes, fileName, type = PDF) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** True when this device's share sheet can take a PDF file. */
export function canShareFiles() {
  try {
    const probe = new File([new Uint8Array(1)], 'x.pdf', { type: PDF });
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch { return false; }
}

/**
 * Sends a PDF on its way. Resolves to 'shared' (the share sheet took it), 'cancelled' (the person closed the sheet)
 * or 'downloaded' (no share sheet here: the file is saved and `mail`, if given, is opened to attach it to).
 */
export async function sharePdf(bytes, fileName, { title = '', text = '', mail = null } = {}) {
  const name = safeFileName(fileName);
  if (canShareFiles()) {
    try {
      const file = new File([bytes], name, { type: PDF });
      await navigator.share({ files: [file], title: title || name, text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // anything else (a share target that refused it): fall through to the download
    }
  }
  downloadFile(bytes, name);
  if (mail) window.location.href = mailtoLink(mail);
  return 'downloaded';
}
