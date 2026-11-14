// Files attached to an order, an invoice or a bill: the buyer's order, a copy of the invoice, a remittance, the
// supplier's bill, a receipt. One control, used by all three.
//
// On a record that is already saved, attaching or removing a file saves straight away: a file uploaded and then
// lost because the sheet was closed would be the same fault as the sale documents had. On a new record there is
// nothing to hang the file on yet, so the sheet mints the record's id up front, holds the files, and hands them
// over with the rest when Save is pressed.

import { db } from '../storage.js?v=241';
import {
  RECORD_DOCUMENT_KINDS, kindLabel, uploadRecordDocument, signedUrlFor, removeSaleDocument, checkFile,
} from '../documents.js?v=241';
import { esc } from '../fmt.js?v=241';
import { confirmDelete, getVal } from '../ui.js?v=241';

/** The markup. `open` keeps the fold open when there is already something attached. */
export function attachmentsHtml(parentType, docs = [], { title = 'Documents', sub = 'Files kept with this record' } = {}) {
  const kinds = RECORD_DOCUMENT_KINDS[parentType] || [];
  return `
    <details class="fold" ${docs.length ? 'open' : ''}>
      <summary><div><h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div></div></summary>
      <div id="att-list"></div>
      <div class="field"><label for="att-kind">What is it</label>
        <select id="att-kind">${kinds.map((k) => `<option value="${esc(k.value)}">${esc(k.label)}</option>`).join('')}</select></div>
      <input type="file" id="att-file" accept="application/pdf,image/*" style="display:none" />
      <button type="button" class="btn secondary small" id="att-attach">Attach a file&hellip;</button>
      <div id="att-problem"></div>
    </details>`;
}

/**
 * Bring the control to life.
 *
 * @param {HTMLElement} root
 * @param {object} o
 * @param {'order'|'invoice'|'payable'} o.parentType
 * @param {string} o.parentId     the record's id (minted up front for a new one)
 * @param {object[]} o.docs       what is already attached
 * @param {(docs: object[]) => void} [o.persist]  saves the record's documents; omit for a record not yet saved
 * @returns {{ docs: () => object[] }}
 */
export function wireAttachments(root, { parentType, parentId, docs: initial = [], persist }) {
  let docs = (initial || []).slice();
  const listEl = root.querySelector('#att-list');
  const problemEl = root.querySelector('#att-problem');
  const fileEl = root.querySelector('#att-file');
  const attachBtn = root.querySelector('#att-attach');
  if (!listEl || !attachBtn) return { docs: () => docs };

  const sayProblem = (msg) => {
    problemEl.innerHTML = msg ? `<div class="hint" style="color:var(--danger);margin-top:8px">${esc(msg)}</div>` : '';
  };

  const render = () => {
    if (!docs.length) {
      listEl.innerHTML = '<div class="field hint" style="margin-bottom:8px">Nothing attached yet.</div>';
      return;
    }
    listEl.innerHTML = docs.map((d) => `
      <div class="list-item" style="padding:8px 4px">
        <div>
          <div class="main">${esc(d.fileName || 'Document')}</div>
          <div class="meta">${esc(kindLabel(d.kind))}${d.byteSize ? ` &middot; ${Math.round(d.byteSize / 1024)} KB` : ''}</div>
        </div>
        <div class="right swipe-actions">
          <button type="button" class="btn secondary small" data-open-att="${esc(d.id)}">Open</button>
          <button type="button" class="btn danger small" data-remove-att="${esc(d.id)}">&times;</button>
        </div>
      </div>`).join('');

    listEl.querySelectorAll('[data-open-att]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const d = docs.find((x) => x.id === btn.dataset.openAtt);
        btn.textContent = 'Opening…';
        const url = await signedUrlFor(d?.storagePath);
        btn.textContent = 'Open';
        if (!url) { sayProblem('That document could not be opened. It may still be uploading.'); return; }
        window.open(url, '_blank', 'noopener');
      });
    });

    listEl.querySelectorAll('[data-remove-att]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = docs.find((x) => x.id === btn.dataset.removeAtt);
        confirmDelete(`Remove ${d?.fileName || 'this document'}? The file is deleted for good.`, async () => {
          docs = docs.filter((x) => x.id !== d.id);
          render();
          db.deleteDocument('record_documents', d.id);      // the row too, or it comes back on the next refresh
          persist?.(docs);
          await removeSaleDocument(d?.storagePath);
        });
      });
    });
  };

  render();
  attachBtn.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const file = fileEl.files?.[0];
    fileEl.value = '';                                       // so the same file can be re-picked
    if (!file) return;
    const problem = checkFile(file);
    if (problem) { sayProblem(problem); return; }

    sayProblem('');
    attachBtn.disabled = true;
    attachBtn.textContent = 'Uploading…';
    try {
      const stored = await uploadRecordDocument(file, { farmId: db.getFarmId(), parentType, parentId });
      docs.push({
        id: crypto.randomUUID(),
        kind: getVal(root, 'att-kind') || 'other',
        uploadedAt: new Date().toISOString(),
        ...stored,
      });
      render();
      persist?.(docs);
    } catch (e) {
      sayProblem(e.message);
    } finally {
      attachBtn.disabled = false;
      attachBtn.textContent = 'Attach a file…';
    }
  });

  return { docs: () => docs };
}
