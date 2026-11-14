// Grades: the standards behind each one, and the farm's own.
//
// Two sheets, both reached from Settings:
//  - Grade standards: the published receival standards, a commodity at a time, as a table with the grades
//    across the top. It is a reference, so nothing on it can be edited.
//  - My grades: the farm's own grades for each commodity. They join the dropdowns wherever a grade is chosen.

import { db } from '../storage.js?v=242';
import { openSheet, notify } from '../ui.js?v=242';
import { esc } from '../fmt.js?v=242';
import { STANDARDS, standardFor, gradesFor, cleanCustomGrades } from '../grades.js?v=242';

/** The reference: pick a commodity, read its standard. `preferName` (a commodity name) opens that one first. */
export function openGradeStandardsSheet(preferName = '') {
  const { commodities } = db.get();
  // open on the commodity asked for, else the first the farm grows that has a standard, else the first
  const farmFirst = commodities.map((c) => standardFor(c.name)).find(Boolean);
  let current = (standardFor(preferName) || farmFirst || STANDARDS[0]).key;

  openSheet('Grade standards', (root) => {
    const draw = () => {
      const std = STANDARDS.find((s) => s.key === current);
      const own = commodities
        .filter((c) => standardFor(c.name)?.key === std.key && c.customGrades?.length)
        .flatMap((c) => c.customGrades);
      root.innerHTML = `
        <div class="hint" style="margin-bottom:10px">Receival standards as published for the season shown. Your contract and your receiver's current standard are what count.</div>
        <div class="chips" role="tablist" style="margin-bottom:12px">
          ${STANDARDS.map((s) => `<button type="button" class="chip ${s.key === current ? 'active' : ''}" data-std="${s.key}" role="tab">${esc(s.title)}</button>`).join('')}
        </div>
        <div class="card report bare">
          <h2 style="margin:0 0 2px">${esc(std.title)}</h2>
          <div class="hint" style="margin-bottom:8px">${esc(std.source)}</div>
          ${std.intro ? `<div class="hint" style="margin-bottom:10px;font-size:13px">${esc(std.intro)}</div>` : ''}
          <div class="table-scroll tight-wrap">
            <table class="tight std">
              <thead><tr><th>Parameter</th>${std.grades.map((g) => `<th>${esc(g.label || g.code)}${g.star ? '*' : ''}</th>`).join('')}</tr></thead>
              <tbody>
                ${std.params.map((p) => `<tr><td>${esc(p.label)}</td>${p.values.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${std.notes.length ? `<ul class="std-notes">${std.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${own.length ? `<div class="hint" style="margin-top:10px"><strong>Your own grades:</strong> ${own.map(esc).join(', ')}. They are in the dropdowns, but have no published standard.</div>` : ''}
        </div>`;
      root.querySelectorAll('[data-std]').forEach((b) => b.addEventListener('click', () => { current = b.dataset.std; draw(); }));
    };
    draw();
  });
}

/** The farm's own grades, a commodity at a time. Each add or remove is saved straight away. */
export function openMyGradesSheet() {
  openSheet('My grades', (root) => {
    const draw = () => {
      const { commodities } = db.get();
      root.innerHTML = `
        <div class="hint" style="margin-bottom:10px">Add a grade of your own, such as a buyer's house grade, to any commodity. It joins that commodity's published grades in the dropdowns on contracts, loads and storage. Changes are saved as you make them.</div>
        ${commodities.length === 0 ? '<div class="empty">Add a commodity first.</div>' : commodities.map((c) => {
          const published = gradesFor(c.name, []).map((g) => g.code);
          const own = cleanCustomGrades(c.customGrades);
          return `
            <div class="group-label"><span>${esc(c.name)}</span></div>
            <div class="hint" style="margin-bottom:6px">${published.length ? `Published: ${published.map(esc).join(' · ')}` : 'No published grades for this commodity, so the grades you add are the whole list.'}</div>
            <div class="my-grades">
              ${own.map((g) => `<span class="chip own">${esc(g)}<button type="button" aria-label="Remove ${esc(g)}" data-del="${esc(g)}" data-c="${c.id}">&times;</button></span>`).join('') || '<span class="hint">None added yet.</span>'}
            </div>
            <div style="display:flex;gap:8px;margin:8px 0 4px">
              <input type="search" id="mg-${c.id}" placeholder="Add a grade" autocomplete="off" style="flex:1" />
              <button type="button" class="btn small" data-add="${c.id}" style="width:auto">Add</button>
            </div>`;
        }).join('')}`;
    };
    const save = (id, list) => db.upsertCommodity({ id, customGrades: cleanCustomGrades(list) });
    const add = (id) => {
      const input = root.querySelector(`#mg-${id}`);
      const value = (input?.value || '').trim();
      if (!value) { input?.focus(); return; }
      const c = db.get().commodities.find((x) => x.id === id);
      const taken = [...gradesFor(c.name, c.customGrades)].some((g) => g.code.toLowerCase() === value.toLowerCase());
      if (taken) { notify(`${value} is already on the ${c.name} list.`); return; }
      save(id, [...(c.customGrades || []), value]);
      draw();
    };
    root.addEventListener('click', (e) => {
      const addBtn = e.target.closest('[data-add]');
      if (addBtn) { add(addBtn.dataset.add); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const c = db.get().commodities.find((x) => x.id === del.dataset.c);
        save(c.id, (c.customGrades || []).filter((g) => g !== del.dataset.del));
        draw();
      }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest?.('input[id^="mg-"]');
      if (input) { e.preventDefault(); add(input.id.slice(3)); }
    });
    draw();
  });
}
