// The grade dropdown, the same wherever a grade is chosen: contracts, loads, storage.
//
// A list of the commodity's grades (the published ones and the farm's own), "No grade", and "Other" for a
// one-off, which reveals a box to type it in. A grade already on the record that is not on the list stays
// selectable, so opening an old contract never loses what it says.

import { gradeOptions, OTHER_GRADE } from './grades.js?v=230';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const optionsHtml = (opts, selected) => opts
  .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`)
  .join('');

/** The field's HTML. `commodity` is the commodity record (name and customGrades), or nothing if none is chosen yet. */
export function gradeFieldHtml({ id = 'grade', label = 'Grade', commodity = null, value = '', hint = '' } = {}) {
  const opts = gradeOptions(commodity?.name, commodity?.customGrades, value);
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <select id="${id}">${optionsHtml(opts, value ?? '')}</select>
      <input id="${id}-other" type="text" placeholder="Type the grade" autocomplete="off" style="display:none;margin-top:6px" />
      ${hint ? `<div class="hint">${hint}</div>` : ''}
    </div>`;
}

/**
 * Make the field work once it is on the page.
 * @param {() => object|null} getCommodity  the commodity record the form currently has chosen
 * @returns {{ read: () => string, refresh: () => void }}
 */
export function wireGradeField(root, id, getCommodity) {
  const sel = root.querySelector(`#${id}`);
  const other = root.querySelector(`#${id}-other`);
  const showOther = () => {
    const on = sel.value === OTHER_GRADE;
    other.style.display = on ? 'block' : 'none';
    if (on) other.focus();
  };
  const read = () => (sel.value === OTHER_GRADE ? other.value.trim() : sel.value);
  sel.addEventListener('change', showOther);

  // The commodity changed: its grades replace the list, and what was chosen stays chosen.
  const refresh = () => {
    const keep = read();
    const c = getCommodity();
    const opts = gradeOptions(c?.name, c?.customGrades, keep);
    sel.innerHTML = optionsHtml(opts, keep);
    sel.value = keep;
    if (sel.value !== keep) sel.value = '';
    showOther();
  };
  return { read, refresh };
}
