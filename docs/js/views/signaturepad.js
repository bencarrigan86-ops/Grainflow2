// The signature pad: draw a signature with a finger or a pen, and the saved one shown back.
//
// mountSignaturePad() puts a pad into any container (the vendor declaration uses it in place, so what has been
// typed is not lost); openMySignatureSheet() is the same thing on a screen of its own, for Settings.
// The strokes are kept as lines, see signature.js; where they are saved is mysignature.js.

import { openSheet, field, getVal, toast } from '../ui.js?v=244';
import { esc } from '../fmt.js?v=244';
import { ASPECT, cleanStrokes, hasSignature, strokesToSvgPath } from '../signature.js?v=244';
import { loadMySignature, saveMySignature, clearMySignature } from '../mysignature.js?v=244';

/** The saved signature as a picture, for showing on screen. */
export function signatureSvg(strokes, width = 150) {
  const h = width / ASPECT;
  return `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Your signature" style="display:block;background:var(--surface);border:1px solid var(--border);border-radius:8px"><path d="${strokesToSvgPath(strokes, width)}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * A pad inside `container`. `onSaved({strokes, name})` is called once it has been saved.
 * @param {HTMLElement} container
 * @param {{name?: string, onSaved?: Function}} [opts]
 */
export function mountSignaturePad(container, { name = '', onSaved = () => {} } = {}) {
  container.innerHTML = `
    <div class="hint" style="margin-bottom:6px">Sign inside the box with your finger or a pen.</div>
    <div style="position:relative;width:100%;aspect-ratio:${ASPECT} / 1;background:var(--surface);border:1px solid var(--border);border-radius:8px;touch-action:none">
      <canvas class="sig-canvas" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none"></canvas>
    </div>
    ${field({ label: 'Name to print under it', id: 'sig-name', value: name, placeholder: 'e.g. Ben Carrigan' })}
    <div class="row" style="gap:8px;margin-top:8px">
      <button type="button" class="btn secondary" data-sig="clear" style="flex:1">Clear</button>
      <button type="button" class="btn" data-sig="save" style="flex:1">Save signature</button>
    </div>
    <div class="hint sig-problem" style="color:var(--danger);margin-top:6px"></div>`;

  const canvas = container.querySelector('.sig-canvas');
  const problem = container.querySelector('.sig-problem');
  const ctx = canvas.getContext('2d');
  let strokes = [];
  let current = null;

  const size = () => {
    const r = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * ratio));
    canvas.height = Math.max(1, Math.round(r.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  };
  const redraw = () => {
    const r = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.strokeStyle = getComputedStyle(container).color || '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach((p, i) => {
        const x = p[0] * r.width;
        const y = p[1] * r.height;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      if (s.length === 1) ctx.lineTo(s[0][0] * r.width + 0.1, s[0][1] * r.height);
      ctx.stroke();
    }
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    current = [point(e)];
    strokes.push(current);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    current.push(point(e));
    redraw();
  });
  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  container.querySelector('[data-sig="clear"]').addEventListener('click', () => { strokes = []; problem.textContent = ''; redraw(); });
  container.querySelector('[data-sig="save"]').addEventListener('click', async (e) => {
    const clean = cleanStrokes(strokes);
    if (!clean.length) { problem.textContent = 'Draw your signature first.'; return; }
    e.target.disabled = true;
    problem.textContent = '';
    try {
      const saved = await saveMySignature(clean, getVal(container, 'sig-name') || '');
      toast('Signature saved');
      onSaved(saved);
    } catch (err) {
      problem.textContent = err.message;
      e.target.disabled = false;
    }
  });

  size();
  window.addEventListener('resize', size);
  return { redraw: size };
}

/** "My signature" on a screen of its own: what is saved, with a way to draw it again or remove it. */
export function openMySignatureSheet({ onChange = () => {} } = {}) {
  openSheet('My signature', (root) => {
    const draw = async () => {
      root.innerHTML = '<div class="empty">Loading…</div>';
      const saved = await loadMySignature();
      const showSaved = (s) => {
        root.innerHTML = `
          <div class="hint" style="margin-bottom:8px">Your signature belongs to you. Nobody else on the farm can see or use it, and it goes with you to any farm you work on. It is drawn on documents you choose to sign.</div>
          ${hasSignature(s?.strokes) ? `
            ${signatureSvg(s.strokes, 240)}
            <div class="meta" style="margin:6px 0 10px">${s.name ? esc(s.name) : 'No name printed under it'}</div>
            <button type="button" class="btn secondary" id="sig-redraw">Draw it again</button>
            <button type="button" class="btn ghost-danger" id="sig-remove" style="margin-top:8px">Remove my signature</button>
            <div class="hint sig-problem" style="color:var(--danger);margin-top:6px"></div>`
            : '<div id="sig-pad"></div>'}`;
        root.querySelector('#sig-redraw')?.addEventListener('click', () => pad(s?.name || ''));
        root.querySelector('#sig-remove')?.addEventListener('click', async () => {
          try { await clearMySignature(); toast('Signature removed'); onChange(null); draw(); } catch (err) { root.querySelector('.sig-problem').textContent = err.message; }
        });
        if (!hasSignature(s?.strokes)) pad('');
      };
      const pad = (name) => {
        root.innerHTML = '<div id="sig-pad"></div>';
        mountSignaturePad(root.querySelector('#sig-pad'), { name, onSaved: (s2) => { onChange(s2); showSaved(s2); } });
      };
      showSaved(saved);
    };
    draw();
  });
}
