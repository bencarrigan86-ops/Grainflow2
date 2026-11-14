// Vendor declaration: make one from a contract, or from an order against it, and send it to the buyer.
//
// Choosing the contract fills in most of it (the buyer, the grain, the delivery dates, your details); choosing an
// order narrows the tonnes and the dates to that order. Anything can be changed before it is sent. The quality
// assurance program is remembered with the business details so it is typed once. The form itself is in
// vendordec.js; getting the PDF out is in sharefile.js.

import { db } from '../storage.js?v=242';
import { openSheet, field, getVal, toast, notify } from '../ui.js?v=242';
import { todayLocal, tightDate, dmy } from '../fmt.js?v=242';
import { loadMySignature } from '../mysignature.js?v=242';
import { fileSentCopy } from '../sentcopy.js?v=242';
import { mountSignaturePad, signatureSvg } from './signaturepad.js?v=242';
import { orderTitle, windowText } from '../orders.js?v=242';
import { activeSales } from '../paidsales.js?v=242';
import {
  buildDeclaration, declarationPdf, declarationProblems, GMO_OPTIONS, MAX_VARIETIES, LAYOUTS, CVD_SOURCES, CVD_GMO_OPTIONS, CVD_BYPRODUCT,
} from '../vendordec.js?v=242';
import { sharePdf, downloadFile, safeFileName, mailtoLink, canShareFiles } from '../sharefile.js?v=242';

const LAYOUT_KEY = 'grainflow.vendordec.layout';
const lastLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'cvd' ? 'cvd' : 'gta'; } catch { return 'gta'; } };
const rememberLayout = (v) => { try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* not kept; it still works */ } };
const YES_NO = [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }];
const yn = (b) => (b ? 'yes' : 'no');

const contractName = (s, commodities) => {
  const c = commodities.find((cc) => cc.id === s.commodityId);
  return [c?.name, s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') || 'Contract';
};

/**
 * @param {{saleId?: string, orderId?: string}} [start] the contract or order to start from
 */
export async function openVendorDecSheet(start = {}) {
  const { sales, commodities, fields } = db.get();
  const orders = db.getOrders();
  if (!sales.length) { notify('Add a contract first. A declaration is made from a contract.'); return; }

  // the signed-in person's own saved signature, if they have one (it is theirs, not the farm's)
  let mySig = null;
  try { mySig = await loadMySignature(); } catch { mySig = null; }

  const startOrder = start.orderId ? orders.find((o) => o.id === start.orderId) : null;
  const startSale = sales.find((s) => s.id === (start.saleId || startOrder?.saleId)) || sales[0];

  const make = (sale, order) => buildDeclaration({
    sale, order,
    business: db.getBusinessDetails(),
    commodityName: commodities.find((c) => c.id === sale.commodityId)?.name || '',
    fields,
    today: todayLocal(),
    signature: mySig,
  });
  let d = make(startSale, startOrder && startOrder.saleId === startSale.id ? startOrder : null);
  d.layout = lastLayout();
  let toEmail = d.buyer.email;

  openSheet('Vendor declaration', (root) => {
    const sheetBody = () => {
      const sale = sales.find((s) => s.id === d.saleId) || startSale;
      const saleOrders = orders.filter((o) => o.saleId === sale.id);
      const varieties = [...d.varieties];
      while (varieties.length < MAX_VARIETIES && varieties.length < 4) varieties.push({ name: '', tons: '' });
      const chems = d.chemicals.length ? d.chemicals : [];

      const cvd = d.layout === 'cvd';
      const cv = d.cvd;
      const chemRows = (withWhp) => chems.map((c, i) => `
        <div class="list-item stack">
          ${field({ label: 'Chemical applied', id: `vd-c-p-${i}`, value: c.product })}
          <div class="grid-2">
            ${field({ label: withWhp ? 'Rate (tonne/ha)' : 'Rate', id: `vd-c-r-${i}`, value: c.rate, placeholder: 'e.g. 2 L/ha' })}
            ${field({ label: 'Application date', id: `vd-c-d-${i}`, type: 'date', value: c.date })}
          </div>
          ${withWhp ? field({ label: 'WHP / ESI / EAFI', id: `vd-c-w-${i}`, value: c.whp || '', placeholder: 'e.g. 14 days' }) : ''}
          <button type="button" class="btn ghost-danger small" data-remove-chem="${i}" style="width:auto">Remove</button>
        </div>`).join('');

      root.innerHTML = `
        <div class="segmented" id="vd-layout" style="margin-bottom:12px">
          ${LAYOUTS.map((l) => `<button data-layout="${l.value}" class="${d.layout === l.value ? 'active' : ''}">${l.label}</button>`).join('')}
        </div>
        ${field({ label: 'Contract', id: 'vd-sale', type: 'select', value: d.saleId,
          options: activeSales(sales, [d.saleId]).map((s) => ({ value: s.id, label: contractName(s, commodities) })) })}
        ${field({ label: 'Order (optional)', id: 'vd-order', type: 'select', value: d.orderId,
          options: [{ value: '', label: 'The whole contract' }, ...saleOrders.map((o) => ({ value: o.id, label: [orderTitle(o), windowText(o, tightDate)].filter(Boolean).join(' · ') }))],
          hint: 'Choosing one fills in its tonnes and dates.' })}

        <div class="subhead">Buyer</div>
        <div class="grid-2">
          ${field({ label: 'Name', id: 'vd-b-name', value: d.buyer.name })}
          ${field({ label: 'Company', id: 'vd-b-company', value: d.buyer.company })}
        </div>
        ${field({ label: 'Address', id: 'vd-b-address', value: d.buyer.address })}
        <div class="grid-2">
          ${field({ label: 'Phone', id: 'vd-b-tel', type: 'tel', value: d.buyer.tel })}
          ${field({ label: 'Email (to send it to)', id: 'vd-b-email', type: 'email', value: toEmail })}
        </div>
        ${cvd ? `<div class="grid-2">
          ${field({ label: 'Buyer NGR', id: 'vd-b-ngr', value: d.buyer.ngr })}
          ${field({ label: 'Buyer PIC', id: 'vd-b-pic', value: d.buyer.pic })}
        </div>` : ''}

        <div class="subhead">Grain</div>
        ${field({ label: 'Commodity', id: 'vd-commodity', value: d.commodity })}
        <div class="grid-2">
          ${field({ label: "Buyer's contract no.", id: 'vd-contractno', value: d.contractNo })}
          ${field({ label: 'Our contract no.', id: 'vd-ourno', value: d.ourContractNo })}
        </div>
        ${field({ label: 'Delivery address', id: 'vd-address', value: d.deliveryAddress, placeholder: 'Where the grain is delivered' })}
        ${varieties.map((v, i) => `
        <div class="grid-2">
          ${field({ label: i === 0 ? 'Variety' : `Variety ${i + 1}`, id: `vd-v-${i}`, value: v.name })}
          ${field({ label: 'Tonnes', id: `vd-t-${i}`, type: 'number', step: '0.1', value: v.tons })}
        </div>`).join('')}
        <div class="grid-2">
          ${field({ label: 'Delivery from', id: 'vd-from', type: 'date', value: d.deliveryFrom })}
          ${field({ label: 'Delivery to', id: 'vd-to', type: 'date', value: d.deliveryTo })}
        </div>

        ${cvd ? `
        <div class="subhead">Your details</div>
        <div class="grid-2">
          ${field({ label: 'Your NGR', id: 'vd-v-ngr', value: d.vendor.ngr })}
          ${field({ label: 'Your PIC', id: 'vd-v-pic', value: d.vendor.pic, hint: 'Saved with your business details.' })}
        </div>

        <div class="subhead">Part A: product integrity</div>
        ${field({ label: '1. Commodity source', id: 'vd-cvd-source', type: 'select', value: cv.source, options: CVD_SOURCES })}
        ${field({ label: '2. Does it contain restricted animal materials (eg meat and bone meal)?', id: 'vd-cvd-ram', type: 'select', value: yn(cv.ram), options: YES_NO })}
        ${field({ label: '3. Genetically modified organisms', id: 'vd-gmo', type: 'select', value: d.gmo, options: CVD_GMO_OPTIONS })}

        <div class="subhead">Part B: chemical use</div>
        ${field({ label: '4. Within a withholding period (WHP), export slaughter interval (ESI) or export animal feed interval (EAFI) after any chemical, pickle, seed treatment, fumigant, pesticide or insecticide?', id: 'vd-cvd-whp', type: 'select', value: yn(cv.whpYes), options: YES_NO })}
        ${cv.whpYes ? `${chemRows(true)}
        <button type="button" class="btn secondary small" id="vd-add-chem" style="width:auto;margin:6px 0 10px">+ Add a chemical</button>` : ''}
        <div class="hint" style="margin:6px 0">5. Grown or stored under an independently audited QA program that includes chemical residue management?</div>
        <div class="segmented" id="vd-basis" style="margin-bottom:10px">
          <button data-basis="qa" class="${d.basis === 'qa' ? 'active' : ''}">Yes, QA program</button>
          <button data-basis="declared" class="${d.basis === 'declared' ? 'active' : ''}">No</button>
        </div>
        ${d.basis === 'qa' ? `
        <div class="grid-2">
          ${field({ label: 'QA program', id: 'vd-qa', value: d.qaProgram, placeholder: 'e.g. Graincorp Quality Assurance' })}
          ${field({ label: 'Accreditation number', id: 'vd-qanum', value: d.qaNumber })}
        </div>
        <div class="hint">Saved with your business details, so you only type it once. Questions 6 to 9 are skipped under a QA program.</div>` : `
        ${field({ label: '6. Aware of the full chemical treatment history, or hold a CVD containing it?', id: 'vd-cvd-hist', type: 'select', value: yn(cv.knowsHistory), options: YES_NO })}
        ${field({ label: '7. Adjacent crops grown within 100 m (single source only)', id: 'vd-cvd-adj', value: cv.adjacentCrops, placeholder: 'e.g. Wheat, canola' })}
        ${field({ label: '8. If a by-product, has a risk assessment been completed?', id: 'vd-cvd-by', type: 'select', value: cv.byProduct, options: CVD_BYPRODUCT })}
        ${field({ label: '9. Analysed for residues or toxins by a NATA accredited lab?', id: 'vd-cvd-nata', type: 'select', value: yn(cv.nataTested), options: YES_NO })}`}
        ` : `
        <div class="subhead">What the grain has been through</div>
        <div class="segmented" id="vd-basis" style="margin-bottom:10px">
          <button data-basis="qa" class="${d.basis === 'qa' ? 'active' : ''}">Accredited QA program</button>
          <button data-basis="declared" class="${d.basis === 'declared' ? 'active' : ''}">Treatments declared</button>
        </div>
        ${d.basis === 'qa' ? `
        <div class="grid-2">
          ${field({ label: 'QA program', id: 'vd-qa', value: d.qaProgram, placeholder: 'e.g. Graincorp Quality Assurance' })}
          ${field({ label: 'Accreditation number', id: 'vd-qanum', value: d.qaNumber })}
        </div>
        <div class="hint">Saved with your business details, so you only type it once.</div>` : `
        <label class="list-item" style="cursor:pointer"><div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="vd-seed" ${d.seedUntreated ? 'checked' : ''} style="width:18px;height:18px" />
          <div class="main">Not treated with a pickling compound or other seed treatment</div></div></label>
        <label class="list-item" style="cursor:pointer"><div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="vd-fum" ${d.notFumigated ? 'checked' : ''} style="width:18px;height:18px" />
          <div class="main">Not treated with any fumigant, pesticide or insecticide</div></div></label>
        <div class="hint" style="margin:8px 0">If it was treated, list each chemical. Tick the boxes above only for what is true.</div>
        ${chems.map((c, i) => `
        <div class="list-item stack">
          ${field({ label: 'Chemical applied', id: `vd-c-p-${i}`, value: c.product })}
          <div class="grid-2">
            ${field({ label: 'Rate', id: `vd-c-r-${i}`, value: c.rate, placeholder: 'e.g. 2 L/ha' })}
            ${field({ label: 'Application date', id: `vd-c-d-${i}`, type: 'date', value: c.date })}
          </div>
          <button type="button" class="btn ghost-danger small" data-remove-chem="${i}" style="width:auto">Remove</button>
        </div>`).join('')}
        <button type="button" class="btn secondary small" id="vd-add-chem" style="width:auto;margin-top:6px">+ Add a chemical</button>`}

        ${field({ label: 'GMO', id: 'vd-gmo', type: 'select', value: d.gmo, options: GMO_OPTIONS.map((o) => ({ value: o.value, label: o.label })) })}
        `}
        <div class="subhead">Signature</div>
        ${mySig ? `
        <label class="list-item" style="cursor:pointer"><div style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="vd-usesig" ${d.useSignature ? 'checked' : ''} style="width:18px;height:18px" />
          <div><div class="main">Sign with my saved signature</div><div class="meta">Leave it off to print the form and sign it by hand.</div></div></div></label>
        <div style="margin:8px 0">${signatureSvg(mySig.strokes, 180)}</div>` : `
        <div class="hint" style="margin-bottom:6px">You have not saved a signature yet. Draw it once and it signs your documents from then on. It is only yours.</div>
        <div id="vd-sigpad"></div>`}
        <div class="grid-2">
          ${field({ label: 'Signed by', id: 'vd-by', value: d.signedBy })}
          ${field({ label: 'Date', id: 'vd-date', type: 'date', value: d.signedDate })}
        </div>
        ${field({ label: 'Document ID', id: 'vd-id', value: d.documentId })}

        <div id="vd-problems" class="hint" style="color:var(--danger);margin:8px 0"></div>
        <button class="btn" id="vd-share" style="margin-top:6px">${canShareFiles() ? 'Share PDF' : 'Download PDF and email'}</button>
        <button class="btn secondary" id="vd-download" style="margin-top:8px">Download PDF</button>
        <div class="hint" style="margin-top:8px">${canShareFiles()
          ? 'Share opens your phone\'s share sheet with the PDF attached: choose Mail or another app.'
          : 'This device cannot attach the file for you: it is downloaded, and an email to the buyer is opened to attach it to.'}</div>`;

      wire();
    };

    // read what is on the screen back into d
    const collect = () => {
      const val = (id) => getVal(root, id) ?? '';
      const readChemicals = (withWhp) => {
        const out = [];
        for (let i = 0; root.querySelector(`#vd-c-p-${i}`); i += 1) {
          out.push({ product: val(`vd-c-p-${i}`).trim(), rate: val(`vd-c-r-${i}`).trim(), date: val(`vd-c-d-${i}`), ...(withWhp ? { whp: val(`vd-c-w-${i}`).trim() } : {}) });
        }
        return out;
      };
      d.buyer = { ...d.buyer, name: val('vd-b-name').trim(), company: val('vd-b-company').trim(), address: val('vd-b-address').trim(), tel: val('vd-b-tel').trim() };
      if (d.layout === 'cvd') {
        d.buyer.ngr = val('vd-b-ngr').trim();
        d.buyer.pic = val('vd-b-pic').trim();
        d.vendor = { ...d.vendor, ngr: val('vd-v-ngr').trim(), pic: val('vd-v-pic').trim() };
        d.cvd = {
          source: val('vd-cvd-source') || d.cvd.source,
          ram: val('vd-cvd-ram') === 'yes',
          whpYes: val('vd-cvd-whp') === 'yes',
          knowsHistory: root.querySelector('#vd-cvd-hist') ? val('vd-cvd-hist') === 'yes' : d.cvd.knowsHistory,
          adjacentCrops: root.querySelector('#vd-cvd-adj') ? val('vd-cvd-adj').trim() : d.cvd.adjacentCrops,
          byProduct: val('vd-cvd-by') || d.cvd.byProduct,
          nataTested: root.querySelector('#vd-cvd-nata') ? val('vd-cvd-nata') === 'yes' : d.cvd.nataTested,
        };
      }
      toEmail = val('vd-b-email').trim();
      d.buyer.email = toEmail;
      d.commodity = val('vd-commodity').trim();
      d.contractNo = val('vd-contractno').trim();
      d.ourContractNo = val('vd-ourno').trim();
      d.deliveryAddress = val('vd-address').trim();
      d.useSignature = !!mySig && !!root.querySelector('#vd-usesig')?.checked;
      d.varieties = [];
      for (let i = 0; i < MAX_VARIETIES; i += 1) {
        if (!root.querySelector(`#vd-v-${i}`)) break;
        d.varieties.push({ name: val(`vd-v-${i}`).trim(), tons: val(`vd-t-${i}`) === '' ? '' : Number(val(`vd-t-${i}`)) });
      }
      d.deliveryFrom = val('vd-from');
      d.deliveryTo = val('vd-to');
      if (d.basis === 'qa') {
        d.qaProgram = val('vd-qa').trim();
        d.qaNumber = val('vd-qanum').trim();
      }
      if (d.layout === 'cvd') {
        if (d.cvd.whpYes) d.chemicals = readChemicals(true);
      } else if (d.basis !== 'qa') {
        d.seedUntreated = !!root.querySelector('#vd-seed')?.checked;
        d.notFumigated = !!root.querySelector('#vd-fum')?.checked;
        d.chemicals = readChemicals(false);
      }
      d.gmo = Number(val('vd-gmo')) || 1;
      d.signedBy = val('vd-by').trim();
      d.signedDate = val('vd-date');
      d.documentId = val('vd-id').trim();
    };

    const wire = () => {
      root.querySelector('#vd-sale').addEventListener('change', () => {
        collect();
        const sale = sales.find((s) => s.id === getVal(root, 'vd-sale'));
        keepChoices(make(sale, null));
        sheetBody();
      });
      root.querySelector('#vd-order').addEventListener('change', () => {
        collect();
        const sale = sales.find((s) => s.id === getVal(root, 'vd-sale'));
        const order = orders.find((o) => o.id === getVal(root, 'vd-order')) || null;
        keepChoices(make(sale, order));
        sheetBody();
      });
      root.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => {
        collect();
        d.layout = b.dataset.layout;
        rememberLayout(d.layout);
        sheetBody();
      }));
      root.querySelector('#vd-cvd-whp')?.addEventListener('change', () => {
        collect();
        if (d.cvd.whpYes && !d.chemicals.length) d.chemicals.push({ product: '', rate: '', date: '', whp: '' });
        sheetBody();
      });
      root.querySelectorAll('[data-basis]').forEach((b) => b.addEventListener('click', () => {
        collect();
        d.basis = b.dataset.basis;
        sheetBody();
      }));
      root.querySelector('#vd-add-chem')?.addEventListener('click', () => {
        collect();
        d.chemicals.push({ product: '', rate: '', date: '', whp: '' });
        if (d.layout !== 'cvd') d.notFumigated = false;
        sheetBody();
      });
      root.querySelectorAll('[data-remove-chem]').forEach((b) => b.addEventListener('click', () => {
        collect();
        d.chemicals.splice(Number(b.dataset.removeChem), 1);
        sheetBody();
      }));
      const pad = root.querySelector('#vd-sigpad');
      if (pad) {
        mountSignaturePad(pad, {
          name: d.signedBy,
          onSaved: (saved) => { collect(); mySig = saved; d.signature = saved.strokes; d.useSignature = true; if (!d.signedBy) d.signedBy = saved.name; sheetBody(); },
        });
      }
      root.querySelector('#vd-share').addEventListener('click', () => send(true));
      root.querySelector('#vd-download').addEventListener('click', () => send(false));
    };

    // changing the contract or order refills the details that come from them, and keeps what was chosen by hand
    const keepChoices = (fresh) => {
      fresh.layout = d.layout;
      fresh.cvd = d.cvd;
      fresh.basis = d.basis;
      fresh.seedUntreated = d.seedUntreated;
      fresh.notFumigated = d.notFumigated;
      fresh.chemicals = d.chemicals;
      fresh.gmo = d.gmo;
      fresh.signedBy = d.signedBy || fresh.signedBy;
      fresh.useSignature = fresh.signature.length ? d.useSignature || !d.signature.length : false;
      fresh.signedDate = d.signedDate || fresh.signedDate;
      fresh.qaProgram = d.qaProgram || fresh.qaProgram;
      fresh.qaNumber = d.qaNumber || fresh.qaNumber;
      d = fresh;
      toEmail = d.buyer.email;
    };

    const send = async (share) => {
      collect();
      const problems = declarationProblems(d);
      const box = root.querySelector('#vd-problems');
      if (problems.length) {
        box.textContent = `Needed before it goes: ${problems.join('; ')}.`;
        return;
      }
      box.textContent = '';
      // remember the QA program with the business details so it is typed once
      if (d.basis === 'qa' && (d.qaProgram !== (db.getBusinessDetails().qaProgram || '') || d.qaNumber !== (db.getBusinessDetails().qaNumber || ''))) {
        db.updateBusinessDetails({ qaProgram: d.qaProgram, qaNumber: d.qaNumber });
      }
      if (d.layout === 'cvd' && d.vendor.pic !== (db.getBusinessDetails().pic || '')) db.updateBusinessDetails({ pic: d.vendor.pic });
      if (d.layout === 'cvd' && d.vendor.ngr !== (db.getBusinessDetails().ngr || '')) db.updateBusinessDetails({ ngr: d.vendor.ngr });
      const bytes = declarationPdf(d);
      const fileName = safeFileName(`Vendor declaration ${d.contractNo || d.documentId} ${dmy(d.signedDate)}`);
      const subject = `Vendor declaration${d.contractNo ? ` - contract ${d.contractNo}` : ''}`;
      const body = `Hi${d.buyer.name ? ` ${d.buyer.name.split(' ')[0]}` : ''},\n\nPlease find the vendor declaration attached${d.contractNo ? ` for contract ${d.contractNo}` : ''}.\n\nRegards,\n${d.signedBy || d.vendor.company}`;
      if (!share) { downloadFile(bytes, fileName); toast('Downloaded'); return; }
      const result = await sharePdf(bytes, fileName, { title: subject, text: body, mail: { to: toEmail, subject, body } });
      if (result === 'cancelled') return;
      toast(result === 'shared' ? 'Sent' : 'Downloaded. Attach it to the email that opened.');
      // keep a copy with the contract, so what was sent can be seen later
      try {
        await fileSentCopy({ saleId: d.saleId, bytes, fileName, kind: 'vendor_dec' });
        toast('Copy filed with the contract');
      } catch (e) {
        notify(`It went, but a copy was not filed with the contract: ${e.message}`);
      }
    };

    sheetBody();
  });
}

