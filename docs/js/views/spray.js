// Spray requests: fill in a job for a spray contractor, tick the paddocks (here, or on the map), and send it as a PDF.
//
// The contractor gets either Aircair's own form written out, or our own form, and then a map page with the paddocks to
// spray marked. What is on the form and where is decided in spray.js; the PDF is drawn in spraypdf.js. The job is saved
// as it is filled in, so a request can be started in the paddock and finished at the desk.

import { db } from '../storage.js?v=456';
import { farmSwitch, canChangeArea } from '../nav.js?v=456';
import { openSheet, field, getVal, confirmDelete, toast, notify } from '../ui.js?v=456';
import { num, esc, todayLocal, dmy } from '../fmt.js?v=456';
import { mapLayout, PALETTE, NO_CROP, NO_FARM } from '../farmmap.js?v=456';
import {
  FORMS, RATE_UNITS, MAX_CHEMICALS, CHECKLIST, sprayDefaults, sprayProblems, sprayTotals, sprayTitle, usedChemicals, plain,
} from '../spray.js?v=456';
import { sharePdf, downloadFile, safeFileName, canShareFiles } from '../sharefile.js?v=456';
import { viewPdf } from '../pdfview.js?v=456';
import { loadMySignature } from '../mysignature.js?v=456';
import { signerNamesFor } from './signtoggle.js?v=456';
import { signatureSvg } from './signaturepad.js?v=456';
import { openMapSheet } from './farmmap.js?v=456';
import { buildSprayPdf } from '../spraypdf.js?v=456';

// A farm worker can write spray requests on a farm that has switched it on (see farmswitches.js); sending one on is for an owner or manager.
export const canSpray = (role) => canChangeArea(role, 'sprays', ['owner', 'manager'].includes(role) || (role === 'farm_worker' && farmSwitch('workersRaiseSprays')));
export const canSendSpray = (role) => ['owner', 'manager'].includes(role);

const STATUS = { draft: ['Draft', ''], sent: ['Sent', 'pos'], done: ['Done', 'pos'] };

/** The list of spray requests for this season. */
export function openSprayJobsSheet() {
  openSheet('Spray requests', (root) => {
    const draw = () => {
      const jobs = db.getSprayJobs().slice().sort((a, b) => String(b.dateRequired || '9999').localeCompare(String(a.dateRequired || '9999')) || String(b.jobNo).localeCompare(String(a.jobNo)));
      root.innerHTML = `
        ${jobs.length === 0 ? '<div class="empty" style="padding:10px 0">No spray requests yet. Make one, tick the paddocks, and send it to the contractor.</div>' : jobs.map((j, n) => {
          const t = sprayTotals(j); const [label, cls] = STATUS[j.status] || STATUS.draft;
          return `
          <div class="list-item stack band${n % 2 ? ' alt' : ''}" data-job="${esc(j.id)}">
            <div class="li-top"><div class="main">${esc(sprayTitle(j))}</div><div class="main">${num(t.ha, 0)} ha</div></div>
            <div class="meta">${esc([usedChemicals(j).map((c) => c.name).join(' + '), j.dateRequired && `needed ${dmy(j.dateRequired)}`].filter(Boolean).join(' · ')) || 'No product yet'}</div>
            <div class="li-foot"><span class="meta">${t.paddocks} paddock${t.paddocks === 1 ? '' : 's'}</span><span class="badges"><span class="badge ${cls}">${label}</span></span></div>
          </div>`;
        }).join('')}
        <button type="button" class="btn" id="sp-new" style="margin-top:10px">+ New spray request</button>`;
      root.querySelectorAll('[data-job]').forEach((el) => el.addEventListener('click', () => {
        const job = jobs.find((j) => j.id === el.dataset.job);
        // once it is sent it is a manager's: a worker's change would only be refused
        if (!canSendSpray(db.getRole()) && job.status && job.status !== 'draft') { toast('Sent to the contractor. A manager looks after it.'); return; }
        openSprayFormSheet(job);
      }));
      root.querySelector('#sp-new').addEventListener('click', () => openSprayFormSheet(null));
    };
    draw();
  });
}

/** Everything the PDF needs of the map: the mapped paddocks laid out, coloured by crop. */
function farmLayout() {
  const { fields, commodities } = db.get();
  const mapped = fields.filter((f) => f.boundary?.length);
  if (!mapped.length) return null;
  const inUse = commodities.filter((c) => mapped.some((f) => f.commodityId === c.id));
  const colour = (f) => { const i = inUse.findIndex((c) => c.id === f.commodityId); return i < 0 ? NO_CROP : PALETTE[i % PALETTE.length]; };
  return mapLayout(mapped.map((f) => ({ id: f.id, name: f.name, farm: f.property, color: colour(f), rings: f.boundary })));
}

const asPaddock = (f, commodities) => ({
  id: f.id, name: f.name, areaHa: Number(f.areaHa) || 0,
  crop: commodities.find((c) => c.id === f.commodityId)?.name || '', farm: String(f.property || '').trim(),
});

/**
 * One request. `existing` is a saved request (or null for a new one); `start.ids` are the paddocks already chosen
 * (from the map); `start.draft` is a half-filled request coming back from the map's paddock picker.
 */
export async function openSprayFormSheet(existing, start = {}) {
  const { fields, commodities } = db.get();
  const business = db.getBusinessDetails();
  const jobs = db.getSprayJobs();
  let mySig = null;
  try { mySig = await loadMySignature(); } catch { mySig = null; }
  const signerNames = await signerNamesFor(business);   // who it can be signed by: this person, the people the business lists

  // the last request to anyone seeds the contractor and who supplies the chemical
  const lastJob = jobs.filter((j) => j.id !== existing?.id).sort((a, b) => String(b.jobNo).localeCompare(String(a.jobNo)))[0] || null;
  const padOf = (ids) => ids.map((id) => fields.find((f) => f.id === id)).filter(Boolean).map((f) => asPaddock(f, commodities));
  let d;
  if (start.draft) d = start.draft;
  else if (existing) d = JSON.parse(JSON.stringify(existing));
  else d = sprayDefaults({ business, paddocks: padOf(start.ids || []), today: todayLocal(), jobs, previous: lastJob });
  if (!existing && !start.draft && mySig?.name) d.signedBy = mySig.name;   // a new request is signed in the signed-in person's own name
  // a new request does not start on Aircair's form, because the last one was, on a farm that has switched it off
  if (!existing && d.form === 'aircair' && !business.showAircair) d.form = 'standard';
  if (!d.chemicals?.length) d.chemicals = [{ name: '', rate: '', unit: 'L' }];
  let ticked = new Set((d.paddocks || []).map((p) => p.id));
  let savedId = existing?.id || d.id || null;
  const hasMap = fields.some((f) => f.boundary?.length);
  // property and crop follow the paddocks ticked, until they are typed over
  let autoProp = existing ? null : d.property; let autoCrop = existing ? null : d.crop;

  openSheet(existing ? `Spray request ${existing.jobNo || ''}` : 'New spray request', (root) => {
    const val = (id) => getVal(root, id) ?? '';

    function snapshot() {
      return fields.filter((f) => ticked.has(f.id)).map((f) => asPaddock(f, commodities));
    }

    /** Reads the form into `d`. */
    function collect() {
      if (!root.querySelector('#sp-contractor')) return;
      d.contractor = val('sp-contractor').trim(); d.contractorEmail = val('sp-email').trim(); d.form = val('sp-form') || 'standard';
      d.dateRequired = val('sp-date'); d.property = val('sp-property').trim(); d.crop = val('sp-crop').trim();
      d.poNumber = val('sp-po').trim(); d.chemicalSuppliedBy = val('sp-supplier').trim(); d.locatedAt = val('sp-located').trim();
      d.chemicals = Array.from({ length: Math.max(1, d.chemicals.length) }, (_, i) => ({ name: val(`sp-chem-${i}-name`).trim(), rate: val(`sp-chem-${i}-rate`), unit: val(`sp-chem-${i}-unit`) || 'L' }));
      d.waterRate = val('sp-water'); d.otherInstructions = val('sp-other');
      d.paddocks = snapshot();
      if (root.querySelector('#sp-ovr')) {
        // a paddock's own rate, kept only where it was typed; the others follow the product's rate
        const keep = {};
        root.querySelectorAll('#sp-ovr input[data-pad]').forEach((el) => {
          if (Number(el.value) > 0) { (keep[el.dataset.pad] ||= {})[el.dataset.chem] = el.value; }
        });
        d.rateOverrides = keep;
      }
      if (root.querySelector('#sp-trading')) {
        d.tradingName = val('sp-trading').trim(); d.address = val('sp-address').trim();
        d.phone = val('sp-phone').trim(); d.fax = val('sp-fax').trim(); d.mobile = val('sp-mobile').trim(); d.uhf = val('sp-uhf').trim();
        d.contacts = [0, 1].map((i) => ({ name: val(`sp-c${i}-name`).trim(), phone: val(`sp-c${i}-phone`).trim(), uhf: val(`sp-c${i}-uhf`).trim() }));
      }
      if (root.querySelector('#sp-signed')) {
        d.signedBy = val('sp-signed').trim(); d.useSignature = !!mySig && !!root.querySelector('#sp-usesig')?.checked;
        d.neighbours = [0, 1, 2].map((i) => ({ name: val(`sp-n${i}-name`).trim(), phone: val(`sp-n${i}-phone`).trim(), contacted: root.querySelector(`#sp-n${i}-done`)?.checked ? 'yes' : '' }));
      }
    }

    function paddockCard() {
      const groups = new Map();
      for (const f of fields.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))) {
        const farm = String(f.property || '').trim() || NO_FARM;
        if (!groups.has(farm)) groups.set(farm, []);
        groups.get(farm).push(f);
      }
      const named = [...groups.keys()].filter((k) => k !== NO_FARM).sort();
      const order = [...named, ...(groups.has(NO_FARM) ? [NO_FARM] : [])];
      const showHeads = named.length > 0;
      return `
        <div class="card">
          <h2>Paddocks to spray</h2>
          ${fields.length === 0 ? '<div class="empty">Add your paddocks in Production first.</div>' : order.map((farm) => {
            const list = groups.get(farm);
            const all = list.every((f) => ticked.has(f.id));
            return `${showHeads ? `<label class="row sp-band sp-farmhead" style="cursor:pointer"><span class="label"><input type="checkbox" class="sp-farm" data-farm="${esc(farm)}" ${all ? 'checked' : ''} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" /><strong>${esc(farm)}</strong></span><span class="value">${list.filter((f) => ticked.has(f.id)).length} of ${list.length}</span></label>` : ''}
              ${list.map((f, n) => `<label class="row sp-band${n % 2 ? ' alt' : ''}" style="cursor:pointer"><span class="label"><input type="checkbox" class="sp-pad" data-id="${esc(f.id)}" ${ticked.has(f.id) ? 'checked' : ''} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />${esc(f.name)}</span><span class="value">${num(Number(f.areaHa) || 0, 1)} ha</span></label>`).join('')}`;
          }).join('')}
          <div class="hint" id="sp-padtotal" style="margin-top:8px"></div>
          ${hasMap ? '<button type="button" class="btn secondary small" id="sp-pick" style="margin-top:8px;width:auto">Pick on the map</button>' : ''}
        </div>`;
    }

    function chemicalsCard() {
      return `
        <div class="card">
          <h2>Products</h2>
          ${d.chemicals.map((c, i) => `
            <div class="sp-block${i % 2 ? ' alt' : ''}" style="display:grid;grid-template-columns:1fr 84px 76px;gap:8px;align-items:end">
              ${field({ label: i === 0 ? 'Product' : `Product ${i + 1} (tank mix)`, id: `sp-chem-${i}-name`, value: c.name, placeholder: 'e.g. Glyphosate 450' })}
              ${field({ label: 'Rate / ha', id: `sp-chem-${i}-rate`, type: 'number', step: 'any', value: c.rate })}
              ${field({ label: 'Unit', id: `sp-chem-${i}-unit`, type: 'select', value: c.unit || 'L', options: RATE_UNITS.map((u) => ({ value: u, label: u })) })}
            </div>`).join('')}
          ${d.chemicals.length < MAX_CHEMICALS ? '<button type="button" class="btn secondary small" id="sp-addchem" style="width:auto;margin-bottom:8px">+ Add a product to the mix</button>' : ''}
          ${field({ label: 'Water rate (L per ha)', id: 'sp-water', type: 'number', step: 'any', value: d.waterRate, placeholder: 'e.g. 50' })}
          <div id="sp-ovr"></div>
          <div id="sp-totals" class="hint"></div>
        </div>`;
    }

    function checklistCard() {
      return `
        <div class="card">
          <h2>Contractor's questions</h2>
          <div class="hint" style="margin-bottom:6px">Answer what you know. Anything left blank is left blank on the form.</div>
          ${CHECKLIST.map((q, n) => `
            <div class="sp-block${n % 2 ? ' alt' : ''}" style="padding-bottom:10px">
              <div style="font-size:14px;margin-bottom:4px">${esc(q.text)}</div>
              <div class="segmented" data-q="${q.key}">
                <button type="button" data-a="yes" class="${d.checklist?.[q.key] === 'yes' ? 'active' : ''}">Yes</button>
                <button type="button" data-a="no" class="${d.checklist?.[q.key] === 'no' ? 'active' : ''}">No</button>
              </div>
            </div>`).join('')}
          <h2 style="margin-top:14px">Neighbours told</h2>
          ${[0, 1, 2].map((i) => `
            <div class="sp-block${i % 2 ? ' alt' : ''}" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
              ${field({ label: i === 0 ? 'Neighbour' : '&nbsp;', id: `sp-n${i}-name`, value: d.neighbours?.[i]?.name })}
              ${field({ label: i === 0 ? 'Phone' : '&nbsp;', id: `sp-n${i}-phone`, value: d.neighbours?.[i]?.phone })}
              <label style="display:flex;align-items:center;gap:6px;padding-bottom:18px"><input type="checkbox" id="sp-n${i}-done" ${d.neighbours?.[i]?.contacted === 'yes' ? 'checked' : ''} style="width:18px;height:18px" /> Told</label>
            </div>`).join('')}
          ${field({ label: 'Signed by (printed)', id: 'sp-signed', value: d.signedBy, list: 'dl-signers', hint: signerNames.length > 1 ? 'Pick another name from the list, or type one.' : '' })}
          <datalist id="dl-signers">${signerNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          ${d.form === 'aircair' ? (mySig ? `
            <label class="row" style="cursor:pointer;margin-top:4px"><span class="label"><input type="checkbox" id="sp-usesig" ${d.useSignature ? 'checked' : ''} style="width:18px;height:18px;vertical-align:middle;margin-right:8px" />Sign with my saved signature</span><span class="value"></span></label>
            <div style="margin:8px 0">${signatureSvg(mySig.strokes, 180)}</div>` : '<div class="hint">Save a signature under your profile to sign the form here. Until then, print and sign it.</div>') : ''}
        </div>`;
    }

    function aircairCard() {
      const c = d.contacts?.length ? d.contacts : [{}, {}];
      return `
        <div class="card">
          <h2>Your details on Aircair's form</h2>
          ${field({ label: 'Trading name', id: 'sp-trading', value: d.tradingName })}
          ${field({ label: 'Address', id: 'sp-address', type: 'textarea', value: d.address })}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 8px">
            ${field({ label: 'Phone', id: 'sp-phone', value: d.phone })}${field({ label: 'Fax', id: 'sp-fax', value: d.fax })}
            ${field({ label: 'Mobile', id: 'sp-mobile', value: d.mobile })}${field({ label: 'UHF channel', id: 'sp-uhf', value: d.uhf })}
          </div>
          <h2 style="margin-top:10px">Contacts on the day</h2>
          ${[0, 1].map((i) => `
            <div class="sp-block${i % 2 ? ' alt' : ''}" style="display:grid;grid-template-columns:1.2fr 1fr 70px;gap:8px">
              ${field({ label: i === 0 ? 'Name' : '&nbsp;', id: `sp-c${i}-name`, value: c[i]?.name })}
              ${field({ label: i === 0 ? 'Phone' : '&nbsp;', id: `sp-c${i}-phone`, value: c[i]?.phone })}
              ${field({ label: i === 0 ? 'UHF' : '&nbsp;', id: `sp-c${i}-uhf`, value: c[i]?.uhf })}
            </div>`).join('')}
        </div>`;
    }

    function paint() {
      const share = canShareFiles();
      root.innerHTML = `
        <datalist id="dl-spray-contractors">${[...new Set(jobs.map((j) => j.contractor).filter(Boolean))].map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        <div class="card">
          <h2>Who and when</h2>
          ${field({ label: 'Contractor', id: 'sp-contractor', value: d.contractor, list: 'dl-spray-contractors', placeholder: business.showAircair ? 'e.g. Aircair' : 'e.g. your spray contractor' })}
          ${field({ label: 'Their email', id: 'sp-email', type: 'email', value: d.contractorEmail })}
          ${field({ label: 'Send it on', id: 'sp-form', type: 'select', value: d.form, options: FORMS.filter((f) => f.key !== 'aircair' || business.showAircair || d.form === 'aircair').map((f) => ({ value: f.key, label: f.label })), hint: d.form === 'aircair' ? "Aircair's own form is filled in and the map added after it." : 'Our own form, with the map after it.' })}
          ${field({ label: 'Date required', id: 'sp-date', type: 'date', value: d.dateRequired })}
        </div>
        ${paddockCard()}
        ${chemicalsCard()}
        <div class="card">
          <h2>The job</h2>
          ${field({ label: 'Property', id: 'sp-property', value: d.property })}
          ${field({ label: 'Crop', id: 'sp-crop', value: d.crop })}
          ${field({ label: 'Purchase order number', id: 'sp-po', value: d.poNumber })}
          ${field({ label: 'Chemical supplied by', id: 'sp-supplier', value: d.chemicalSuppliedBy, placeholder: 'e.g. us, or the agronomist' })}
          ${field({ label: 'Located at', id: 'sp-located', value: d.locatedAt, placeholder: 'e.g. the shed at Home farm' })}
          ${field({ label: 'Other instructions', id: 'sp-other', type: 'textarea', value: d.otherInstructions, placeholder: 'Wind limits, gates, buffers, anything they should know', rows: 3 })}
        </div>
        ${d.form === 'aircair' ? aircairCard() : ''}
        ${checklistCard()}
        <div id="sp-problems" class="hint" style="color:var(--danger);margin:8px 0"></div>
        <button class="btn secondary" id="sp-view" style="margin-bottom:8px">View PDF</button>
        ${canSendSpray(db.getRole()) ? `<button class="btn" id="sp-send">${share ? 'Save and send' : 'Save, download and email'}</button>
        <button class="btn secondary" id="sp-download" style="margin-top:8px">Save and download the PDF</button>` : '<div class="hint">A manager checks it and sends it to the contractor.</div>'}
        <button class="btn${canSendSpray(db.getRole()) ? ' secondary' : ''}" id="sp-save" style="margin-top:8px">Save as a draft</button>
        ${savedId && canSendSpray(db.getRole()) ? `<button class="btn secondary" id="sp-done" style="margin-top:8px">${d.status === 'done' ? 'Mark as not done' : 'Mark as done'}</button><button class="btn ghost-danger" id="sp-delete" style="margin-top:8px">Delete this request</button>` : ''}`;
      wire(); overrides(); totals();
    }

    /**
     * A paddock that needs more or less of a product than the rest: a box for each ticked paddock and product, empty
     * meaning "the same as the rate above". Only shown once there are two paddocks and a named product.
     */
    function overrides() {
      const box = root.querySelector('#sp-ovr'); if (!box) return;
      collect();
      const chems = usedChemicals(d); const pads = d.paddocks || [];
      if (pads.length < 2 || !chems.length) { box.innerHTML = ''; return; }
      const set = d.rateOverrides || {};
      const any = pads.some((p) => Object.keys(set[p.id] || {}).length);
      box.innerHTML = `
        <details class="sp-ovr" ${any ? 'open' : ''} style="margin:4px 0 10px">
          <summary style="cursor:pointer;font-weight:600;padding:6px 0">Different rate on some paddocks${any ? '' : ' (optional)'}</summary>
          <div class="hint" style="margin-bottom:6px">Leave a box empty to use the rate above.</div>
          ${pads.map((p, n) => `
            <div class="sp-block${n % 2 ? ' alt' : ''}">
              <div style="font-weight:600;margin-bottom:6px">${esc(p.name)} <span class="meta">${num(p.areaHa, 1)} ha</span></div>
              ${chems.map((c) => `
                <div style="display:grid;grid-template-columns:1fr 110px;gap:8px;align-items:center;margin-bottom:8px">
                  <span>${esc(c.name)}</span>
                  <input type="number" step="any" inputmode="decimal" data-pad="${esc(p.id)}" data-chem="${c.i}" value="${esc(set[p.id]?.[c.i] ?? '')}" placeholder="${c.rate ? plain(c.rate, 3) : 'rate'} ${esc(c.unit || 'L')}/ha" aria-label="${esc(c.name)} rate on ${esc(p.name)}" />
                </div>`).join('')}
            </div>`).join('')}
        </details>`;
    }

    /** The grey rate in each paddock's own box follows the product's rate as it is typed. */
    function ratePlaceholders() {
      root.querySelectorAll('#sp-ovr input[data-chem]').forEach((el) => {
        const r = val(`sp-chem-${el.dataset.chem}-rate`); const u = val(`sp-chem-${el.dataset.chem}-unit`) || 'L';
        el.placeholder = Number(r) > 0 ? `${plain(r, 3)} ${u}/ha` : 'rate';
      });
    }

    /** The live line under the products and under the paddock list. */
    function totals() {
      collect();
      const t = sprayTotals(d);
      const pad = root.querySelector('#sp-padtotal');
      if (pad) pad.textContent = t.paddocks ? `${t.paddocks} paddock${t.paddocks === 1 ? '' : 's'}, ${plain(t.ha, 1)} ha` : 'None ticked yet.';
      const box = root.querySelector('#sp-totals');
      if (box) {
        // a product at two rates is shown as each rate and what it takes
        const bits = t.chemicals.filter((c) => c.text).map((c) => (c.groups.length > 1 ? `${c.name}: ${c.groups.map((g) => `${g.amount} at ${g.rateText}`).join(', ')}` : `${c.name}: ${c.text}`));
        if (t.waterL) bits.push(`water: ${num(t.waterL, 0)} L`);
        box.textContent = t.ha && bits.length ? `For ${plain(t.ha, 1)} ha: ${bits.join(' · ')}` : 'Tick the paddocks and give a rate to see what to mix.';
      }
    }

    function followTicks() {
      collect();
      const t = sprayDefaults({ business, paddocks: d.paddocks, today: '', jobs });
      const prop = root.querySelector('#sp-property'); const crop = root.querySelector('#sp-crop');
      if (prop && (!prop.value.trim() || prop.value === autoProp)) { prop.value = t.property; d.property = t.property; }
      if (crop && (!crop.value.trim() || crop.value === autoCrop)) { crop.value = t.crop; d.crop = t.crop; }
      autoProp = t.property; autoCrop = t.crop;
      totals();
    }

    function wire() {
      root.querySelectorAll('.sp-pad').forEach((b) => b.addEventListener('change', () => {
        if (b.checked) ticked.add(b.dataset.id); else ticked.delete(b.dataset.id);
        collect(); paint(); followTicks();
      }));
      root.querySelectorAll('.sp-farm').forEach((b) => b.addEventListener('change', () => {
        fields.filter((f) => (String(f.property || '').trim() || NO_FARM) === b.dataset.farm).forEach((f) => { if (b.checked) ticked.add(f.id); else ticked.delete(f.id); });
        collect(); paint(); followTicks();
      }));
      root.querySelector('#sp-form').addEventListener('change', () => { collect(); paint(); });
      root.querySelectorAll('input[id^="sp-chem-"][id$="-name"]').forEach((el) => el.addEventListener('change', () => { collect(); overrides(); totals(); }));
      root.querySelector('#sp-addchem')?.addEventListener('click', () => { collect(); d.chemicals.push({ name: '', rate: '', unit: 'L' }); paint(); });
      root.querySelectorAll('[data-q]').forEach((seg) => seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        collect();
        d.checklist = d.checklist || {};
        d.checklist[seg.dataset.q] = d.checklist[seg.dataset.q] === b.dataset.a ? '' : b.dataset.a;
        paint();
      }));
      root.querySelector('#sp-pick')?.addEventListener('click', () => {
        collect();
        openMapSheet({
          pick: {
            ids: [...ticked],
            onDone: (ids) => { ticked = new Set(ids); d.paddocks = snapshot(); openSprayFormSheet(existing, { draft: d }); },
            onCancel: () => openSprayFormSheet(existing, { draft: d }),
          },
        });
      });
      root.querySelector('#sp-save').addEventListener('click', () => { if (persist()) { toast('Saved'); } });
      root.querySelector('#sp-view').addEventListener('click', async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        collect();
        d.today = todayLocal();
        try {
          const bytes = await buildSprayPdf(d, farmLayout(), { signature: d.form === 'aircair' && d.useSignature && mySig ? mySig.strokes : null });
          viewPdf(bytes, { title: 'Spray request', fileName: safeFileName(`Spray request ${d.jobNo} ${d.contractor} ${dmy(d.dateRequired)}`), share: false });
        } catch (err) { toast(`It could not be shown: ${err.message}`); } finally { btn.disabled = false; }
      });
      root.querySelector('#sp-send')?.addEventListener('click', () => send(false));
      root.querySelector('#sp-download')?.addEventListener('click', () => send(true));
      root.querySelector('#sp-done')?.addEventListener('click', () => { collect(); d.status = d.status === 'done' ? 'sent' : 'done'; if (persist()) toast(d.status === 'done' ? 'Marked as done' : 'Back to sent'); paint(); });
      root.querySelector('#sp-delete')?.addEventListener('click', () => confirmDelete('Delete this spray request?', () => { db.deleteSprayJob(savedId); toast('Deleted'); openSprayJobsSheet(); }));
    }

    function persist() {
      collect();
      if (!d.jobNo) d.jobNo = sprayDefaults({ jobs }).jobNo;
      const id = db.upsertSprayJob({ ...stripDraft(d), id: savedId || undefined });
      savedId = id; d.id = id;
      return true;
    }

    async function send(downloadOnly = false) {
      collect();
      d.today = todayLocal();
      const problems = sprayProblems(d);
      const box = root.querySelector('#sp-problems');
      if (problems.length) { box.textContent = `Needed before it goes: ${problems.join(' ')}`; return; }
      box.textContent = '';
      persist();
      const btn = root.querySelector('#sp-send'); const dl = root.querySelector('#sp-download');
      [btn, dl].forEach((b) => { if (b) b.disabled = true; });
      try {
        const bytes = await buildSprayPdf(d, farmLayout(), { signature: d.form === 'aircair' && d.useSignature && mySig ? mySig.strokes : null });
        const fileName = safeFileName(`Spray request ${d.jobNo} ${d.contractor} ${dmy(d.dateRequired)}`);
        const subject = `Spray request ${d.jobNo}${d.property ? ` - ${d.property}` : ''}`;
        const t = sprayTotals(d);
        const body = `Hi,\n\nPlease find spray request ${d.jobNo} attached: ${t.paddocks} paddock${t.paddocks === 1 ? '' : 's'}, ${plain(t.ha, 1)} ha, needed ${dmy(d.dateRequired)}. The map showing the paddocks is on the last page.\n\nPlease call to confirm a date.\n\nRegards,\n${business.contactName || business.entityName || ''}`;
        // on a computer there is no share sheet: sharePdf saves the file and opens an email to attach it to
        if (downloadOnly) { downloadFile(bytes, fileName); toast('Saved and downloaded'); markSent(); return; }
        const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: d.contractorEmail, subject, body } });
        if (result === 'cancelled') { toast('Saved'); return; }
        toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
        markSent();
      } catch (e) {
        notify(`The PDF could not be made: ${e.message}`);
      } finally {
        [btn, dl].forEach((b) => { if (b) b.disabled = false; });
      }
    }

    function markSent() { if (d.status === 'draft' || !d.status) { d.status = 'sent'; persist(); } }

    root.addEventListener('input', (e) => { if (e.target.matches('input[id^="sp-chem-"], #sp-water, #sp-ovr input')) { ratePlaceholders(); totals(); } });
    root.addEventListener('change', (e) => { if (e.target.matches('select[id^="sp-chem-"]')) ratePlaceholders(); });
    paint();
  });
}

/** What is kept on the saved request: everything on the form, but not the helpers. */
function stripDraft(d) {
  const { today, ...rest } = d;
  return rest;
}
