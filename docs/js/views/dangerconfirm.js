// The sheet that stands between a person and something that cannot be taken back: deleting a season, resetting the farm.
//
// It lists what will go, asks for a backup to be downloaded first (or one made in the last hour), and asks for the name of
// the thing to be typed. Only then does the red button work. The rules are in seasondelete.js.

import { db } from '../storage.js?v=298';
import { openSheet, closeSheet, toast } from '../ui.js?v=298';
import { esc } from '../fmt.js?v=298';
import { downloadBackup, lastBackup } from '../backup.js?v=298';
import { backedUpRecently, mayDelete } from '../seasondelete.js?v=298';

/**
 * @param {{title: string, warning: string, contents?: string, name: string, confirmLabel: string, done: string, onConfirm: () => void}} o
 *   name: what has to be typed. contents: a sentence of what will go. done: the toast afterwards.
 */
export function openDangerSheet({ title, warning, contents = '', name, confirmLabel, done, onConfirm }) {
  openSheet(title, (root) => {
    let backedUp = backedUpRecently(lastBackup());
    let typed = '';

    root.innerHTML = `
      <div class="card" style="border:1.5px solid var(--danger)">
        <h2 style="color:var(--danger)">This cannot be undone</h2>
        <div class="hint" style="margin-bottom:6px">${warning}</div>
        ${contents ? `<div class="main" style="margin-top:6px">Gone with it: ${esc(contents)}.</div>` : ''}
        <div class="hint" style="margin-top:8px">It is removed from the server and from every phone on this farm, and Recently deleted cannot bring it back. The only way back is a backup file.</div>
      </div>
      <div class="subhead" style="margin-top:14px">1. Keep a backup</div>
      <button type="button" class="btn secondary" id="dg-backup"></button>
      <div class="subhead" style="margin-top:14px">2. Type ${esc(name)} to confirm</div>
      <div class="field"><input id="dg-typed" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(name)}" /></div>
      <button type="button" class="btn danger" id="dg-go" style="margin-top:10px"></button>
      <button type="button" class="btn secondary" id="dg-cancel" style="margin-top:8px">Keep it</button>`;

    const backupBtn = root.querySelector('#dg-backup');
    const goBtn = root.querySelector('#dg-go');
    const paint = () => {
      backupBtn.textContent = backedUp ? 'Backup downloaded ✓' : 'Download a backup now';
      backupBtn.disabled = backedUp;
      goBtn.textContent = confirmLabel;
      goBtn.disabled = !mayDelete({ typed, name, backedUp });
    };
    paint();

    backupBtn.addEventListener('click', () => {
      downloadBackup(db.exportJSON());
      backedUp = true;
      paint();
    });
    root.querySelector('#dg-typed').addEventListener('input', (e) => { typed = e.target.value; paint(); });
    root.querySelector('#dg-cancel').addEventListener('click', closeSheet);
    goBtn.addEventListener('click', () => {
      // checked again here, so a button re-enabled by dev tools still does nothing
      if (!mayDelete({ typed, name, backedUp })) return;
      closeSheet();
      onConfirm();
      toast(done);
    });
  }, { askBeforeClose: false });
}
