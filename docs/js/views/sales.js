import { db } from '../storage.js?v=204';
import {
  DOCUMENT_KINDS, kindLabel, uploadSaleDocument, signedUrlFor, removeSaleDocument, checkFile,
} from '../documents.js?v=204';
import { salesByCommodity, saleEconomics, contractTolerance, movementTonsToSale, DEFAULT_TOLERANCE_PCT, DEFAULT_TOLERANCE_CAP_TONS } from '../derived.js?v=204';
import { num, tons, money, moneyMillions, esc, shortDate, todayLocal } from '../fmt.js?v=204';
import { openSheet, closeSheet, field, getVal, getNum, confirmDelete, toast, askConfirm, notify } from '../ui.js?v=204';
import { previousYear, carryCandidates, openingEffect, openingChange } from '../carryover.js?v=204';
import { renderRelatedMovements } from './movements.js?v=204';
import { openInvoiceListSheet } from './invoice.js?v=204';
import { openContractDocSheet } from './contract.js?v=204';
import { wireJumps } from '../jump.js?v=204';

let unsub = null;

export function renderSales(root) {
  if (unsub) unsub();
  paint(root);
  unsub = db.subscribe(() => paint(root));
}

function paint(root) {
  const { commodities, sales, movements } = db.get();
  const rollup = salesByCommodity(commodities, sales, movements).filter((r) => r.contractCount > 0);
  const groups = groupSalesByCommodity(commodities, sales, movements);
  const salesTotals = rollup.reduce((acc, r) => ({
    tons: acc.tons + r.tons,
    tonsDue: acc.tonsDue + Math.max(0, r.tonsDue),
    totalValue: acc.totalValue + r.totalValue,
  }), { tons: 0, tonsDue: 0, totalValue: 0 });
  salesTotals.avgPrice = salesTotals.tons > 0 ? salesTotals.totalValue / salesTotals.tons : 0;
  // Once the total reaches eight digits the Total column would outgrow a phone, so the whole
  // column is shown in millions ($12.35m). Below that it is the full figure, to the dollar.
  const inMillions = salesTotals.totalValue >= 10000000;
  const totalText = (v) => (inMillions ? moneyMillions(v) : money(v, 0));

  // Contracts from last season that still have grain to deliver, offered to be brought in.
  const prevLabel = previousYear(db.getYears(), db.getCurrentYear());
  const carryList = prevLabel && ['owner', 'manager'].includes(db.getRole())
    ? carryCandidates(db.getYearData(prevLabel), db.get(), prevLabel).filter((c) => !c.alreadyBrought)
    : [];

  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Sales</h1>
        <div class="sub">Contracts, rolled up by commodity</div>
      </div>
    </div>
    <div class="view">
      ${rollup.length === 0 ? '' : `
      <div class="card report">
        <h2><span class="dot report"></span>By commodity</h2>
        <div class="table-scroll tight-wrap">
          <table class="tight">
            <thead><tr><th>Commodity</th><th>Sold t</th><th>Due t</th><th>Avg $/t</th><th>Total $</th></tr></thead>
            <tbody>
              ${rollup.map((r) => `
                <tr class="jump-row" data-jump="grp-${esc(r.commodity.id)}">
                  <td><button type="button" class="jump-link">${esc(r.commodity.name)}</button></td>
                  <td>${num(r.tons, 0)}</td>
                  <td>${num(Math.max(0, r.tonsDue), 0)}</td>
                  <td>${money(r.avgPrice, 0)}</td>
                  <td>${totalText(r.totalValue)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td>${num(salesTotals.tons, 0)}</td>
              <td>${num(salesTotals.tonsDue, 0)}</td>
              <td>${money(salesTotals.avgPrice, 0)}</td>
              <td>${totalText(salesTotals.totalValue)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`}

      <div class="card input">
        <h2><span class="dot input"></span>Contracts</h2>
        ${carryList.length ? `<button type="button" class="btn secondary small" id="carry-contracts" style="margin-bottom:10px">Bring in ${esc(prevLabel)} contracts&hellip; (${carryList.length})</button>` : ''}
        ${groups.length === 0 ? `<div class="empty">No contracts yet.<br/><button class="btn" id="empty-add">Add your first sale</button></div>` : groups.map((g) => `
          <div class="group-label" id="grp-${esc(g.id ?? 'none')}"><span>${esc(g.name)}</span><span class="n">${money(g.totalValue, 0)}</span></div>
          ${g.sales.map((s) => saleRow(s, movements, commodities)).join('')}
        `).join('')}
      </div>
    </div>
    <button class="fab" id="add-sale">+</button>
  `;

  // The commodity rows in the table at the top jump to that commodity's contracts below.
  wireJumps(root);

  root.querySelectorAll('[data-edit-sale]').forEach((el) => {
    el.addEventListener('click', () => openSaleSheet(sales.find((s) => s.id === el.dataset.editSale)));
  });
  root.querySelector('#add-sale').addEventListener('click', () => openSaleSheet(null));
  root.querySelector('#empty-add')?.addEventListener('click', () => openSaleSheet(null));
  root.querySelector('#carry-contracts')?.addEventListener('click', () => openCarrySheet(prevLabel));
}

/**
 * Last season's contracts with grain still to go. Nothing is chosen for the person: they tick
 * each contract to bring across (and may bring fewer tonnes than are left), see what it will do
 * to the opening stock, and confirm once more before anything is written.
 */
function openCarrySheet(prevLabel) {
  const here = db.getCurrentYear();
  const list = carryCandidates(db.getYearData(prevLabel), db.get(), prevLabel).filter((c) => !c.alreadyBrought);
  openSheet(`Bring in ${prevLabel} contracts`, (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:10px">These ${esc(prevLabel)} contracts still have grain to deliver. Tick the ones to bring
        into ${esc(here)}. Each becomes a ${esc(here)} contract for the tonnes still to go, with the same price and terms, so you can deliver against
        it here. The ${esc(prevLabel)} contract is left as it is.</div>
      ${list.map((c, i) => `
        <div class="card" data-row="${i}" style="margin:0 0 8px">
          <label style="display:flex;gap:10px;align-items:flex-start">
            <input type="checkbox" class="co-pick" ${c.problem ? 'disabled' : ''} style="width:auto;margin-top:3px" />
            <span style="flex:1;min-width:0">
              <strong>${esc(c.sale.buyer || 'No buyer')}</strong> &middot; ${esc(c.commodityName)}${c.sale.contractNo ? ` &middot; #${esc(c.sale.contractNo)}` : ''}
              <div class="meta">${num(c.contracted, 1)} t contracted &middot; ${num(c.delivered, 1)} t delivered &middot; <strong>${num(c.toGo, 1)} t to go</strong></div>
              <div class="meta">${money(c.priceExFarm, 2)}/t net &middot; ${money(c.value, 0)} still to come</div>
              ${c.possibleDuplicate ? `<div class="meta" style="color:var(--danger)">A ${esc(here)} contract with this buyer and number already exists. Bringing it across would make a second one.</div>` : ''}
              ${c.problem ? `<div class="meta" style="color:var(--danger)">${esc(c.problem)}</div>` : ''}
            </span>
          </label>
          <div class="field" style="margin:8px 0 0 30px"><label>Tonnes to bring across</label>
            <input type="number" class="co-tons" step="0.1" min="0" max="${c.toGo}" value="${c.toGo}" disabled /></div>
        </div>`).join('')}
      <div class="field" style="margin-top:10px">
        <label><strong>Is this grain already in your opening stock?</strong></label>
        <div class="hint" style="margin-bottom:6px">${esc(prevLabel)} already counted the income from these contracts. How the opening stock is set decides
          whether ${esc(here)} counts it again, so choose how yours was worked out.</div>
        <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px"><input type="radio" name="co-mode" value="value" style="width:auto;margin-top:3px" />
          <span><strong>Yes, it's already in the tonnes.</strong> Adjust the value only, to the contract price.
            <span class="meta" style="display:block">For an opening stock taken from what is physically in the silos. Grain committed to a contract is worth the contract price, not the market price.</span></span></label>
        <label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px"><input type="radio" name="co-mode" value="add" style="width:auto;margin-top:3px" />
          <span><strong>No, add the tonnes and their value.</strong>
            <span class="meta" style="display:block">For an opening stock of unsold grain only, such as "Use ${esc(prevLabel)} closing" gives, which leaves out grain already sold.</span></span></label>
        <label style="display:flex;gap:10px;align-items:flex-start"><input type="radio" name="co-mode" value="none" style="width:auto;margin-top:3px" />
          <span><strong>Leave the opening stock alone.</strong>
            <span class="meta" style="display:block">You have already set it for these contracts yourself.</span></span></label>
      </div>
      <div class="card" id="co-summary" style="margin:10px 0"></div>
      <button class="btn" id="co-go" type="button" disabled>Bring across&hellip;</button>`;

    const rows = [...root.querySelectorAll('[data-row]')];
    const picked = () => rows.map((r, i) => {
      const c = list[i];
      const on = r.querySelector('.co-pick').checked;
      const tons = Math.min(c.toGo, Math.max(0, Number(r.querySelector('.co-tons').value) || 0));
      return { c, on, tons, value: tons * c.priceExFarm };
    }).filter((p) => p.on && p.tons > 0);

    const mode = () => root.querySelector('input[name="co-mode"]:checked')?.value || '';
    // what each picked contract does to the opening stock, in the way chosen
    const changeOf = (p) => openingChange({ tons: p.tons, priceExFarm: p.c.priceExFarm, closingMtm: p.c.closingMtm }, mode());
    // adjusting the value needs the price the stock was valued at; without one there is nothing to compare the contract with
    const missingMtm = (picks) => (mode() === 'value' ? picks.filter((p) => !(p.c.closingMtm > 0)) : []);

    const refresh = () => {
      rows.forEach((r) => { r.querySelector('.co-tons').disabled = !r.querySelector('.co-pick').checked; });
      const picks = picked();
      const summary = root.querySelector('#co-summary');
      const go = root.querySelector('#co-go');
      const noMtm = missingMtm(picks);
      go.disabled = picks.length === 0 || !mode() || noMtm.length > 0;
      if (picks.length === 0) { summary.innerHTML = '<div class="field hint">Nothing ticked yet.</div>'; return; }
      const total = picks.reduce((a, p) => ({ tons: a.tons + p.tons, value: a.value + p.value }), { tons: 0, value: 0 });
      const commodities = db.get().commodities;
      const effect = openingEffect(picks.map((p) => ({ commodityId: p.c.targetCommodityId, ...changeOf(p) })));
      const effectLines = !mode()
        ? '<div class="field hint" style="margin:6px 0 0">Choose whether this grain is already in your opening stock.</div>'
        : [...effect.entries()].map(([id, e]) => {
          const c = commodities.find((x) => x.id === id);
          const t0 = Number(c?.openingStock) || 0; const v0 = Number(c?.openingValue) || 0;
          const name = esc(c?.name ?? 'Commodity');
          if (mode() === 'none') return `<div class="meta">${name} opening stock is not changed.</div>`;
          const tonsPart = e.tons ? `opening stock ${num(t0, 1)} &rarr; ${num(t0 + e.tons, 1)} t &middot; ` : `opening stock stays ${num(t0, 1)} t &middot; `;
          return `<div class="meta">${name} ${tonsPart}value ${money(v0, 0)} &rarr; ${money(v0 + e.value, 0)}</div>`;
        }).join('');
      const mtmWarning = noMtm.length
        ? `<div class="meta" style="color:var(--danger);margin-top:6px">${[...new Set(noMtm.map((p) => p.c.commodityName))].map(esc).join(', ')} has no closing MTM price in ${esc(prevLabel)}, so there is nothing to compare the contract price with. Set it in ${esc(prevLabel)}'s commodity settings first, or choose a different option.</div>`
        : '';
      const detail = mode() === 'value'
        ? picks.map((p) => `<div class="meta">${esc(p.c.sale.buyer || 'No buyer')}: ${num(p.tons, 1)} t at ${money(p.c.priceExFarm, 2)}/t against ${money(p.c.closingMtm, 2)}/t MTM</div>`).join('')
        : '';
      summary.innerHTML = `
        <div class="row"><span class="label"><strong>${picks.length} contract${picks.length === 1 ? '' : 's'}</strong></span><span class="value">${num(total.tons, 1)} t &middot; ${money(total.value, 0)}</span></div>
        ${detail}${effectLines}${mtmWarning}`;
    };
    root.addEventListener('input', refresh);
    root.addEventListener('change', refresh);
    refresh();

    root.querySelector('#co-go').addEventListener('click', async () => {
      const picks = picked();
      if (picks.length === 0) return;
      if (!mode() || missingMtm(picks).length) return;
      const total = picks.reduce((a, p) => ({ tons: a.tons + p.tons, value: a.value + p.value }), { tons: 0, value: 0 });
      const change = picks.reduce((a, p) => { const c = changeOf(p); return { tons: a.tons + c.tons, value: a.value + c.value }; }, { tons: 0, value: 0 });
      const openingLine = mode() === 'none' ? 'The opening stock is not changed.'
        : mode() === 'add' ? `The opening stock goes up by ${num(change.tons, 1)} t and ${money(change.value, 0)}, since these tonnes were not in it.`
          : `The opening stock tonnes stay as they are, because this grain is already in them. Its value changes by ${money(change.value, 0)}, from market price to contract price.`;
      const ok = await askConfirm(
        `Bring ${picks.length} contract${picks.length === 1 ? '' : 's'} into ${here}?\n\n`
        + picks.map((p) => `• ${p.c.sale.buyer || 'No buyer'} (${p.c.commodityName}${p.c.sale.contractNo ? ` #${p.c.sale.contractNo}` : ''}): ${num(p.tons, 1)} t, ${money(p.value, 0)}`).join('\n')
        + `\n\nTotal ${num(total.tons, 1)} t, ${money(total.value, 0)}. Each becomes a ${here} contract with the same price and terms; the ${prevLabel} contracts stay as they are, with a note.\n\n${openingLine}`,
        { confirmLabel: 'Bring across' });
      if (!ok) return;
      const { made, skipped } = db.carryContracts({
        fromYear: prevLabel,
        picks: picks.map((p) => { const c = changeOf(p); return { saleId: p.c.sale.id, tons: p.tons, openingTons: c.tons, openingValue: c.value }; }),
      });
      closeSheet();
      toast(`${made.length} contract${made.length === 1 ? '' : 's'} brought into ${here}`);
      if (skipped) notify(`${skipped} contract${skipped === 1 ? ' was' : 's were'} not brought across because ${skipped === 1 ? 'it' : 'they'} had no matching commodity in ${here}.`);
    });
  });
}

function groupSalesByCommodity(commodities, sales, movements) {
  const groups = commodities
    .map((c) => {
      const rows = sales.filter((s) => s.commodityId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return { id: c.id, name: c.name, sales: rows, totalValue: rows.reduce((sum, s) => sum + saleEconomics(s, movements).totalValue, 0) };
    })
    .filter((g) => g.sales.length > 0);

  const noCommodity = sales.filter((s) => !commodities.some((c) => c.id === s.commodityId))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (noCommodity.length > 0) {
    groups.push({ id: null, name: 'No commodity', sales: noCommodity, totalValue: noCommodity.reduce((sum, s) => sum + saleEconomics(s, movements).totalValue, 0) });
  }
  return groups;
}

function fillBadge(econ, unit) {
  if (econ.isOverDelivered) {
    const overBy = econ.tonsDelivered - econ.maxTons;
    return `<span class="badge neg">Over by ${num(overBy, 1)} ${unit}</span>`;
  }
  if (econ.isFull) return `<span class="badge pos">Full</span>`;
  // Open is the normal state of a contract in progress, so amber, not red.
  return `<span class="badge warn">${num(econ.tonsToFill, 0)} ${unit} to go</span>`;
}

/** Delivered against contract as a bar: the shape of a contract reads faster than its numbers. */
function fillGauge(econ, contractTons) {
  const total = Number(contractTons) || 0;
  const pct = total > 0 ? Math.min(100, Math.max(0, (econ.tonsDelivered / total) * 100)) : 0;
  return `<div class="gauge ${econ.isOverDelivered ? 'over' : ''}" role="img" aria-label="${Math.round(pct)} percent delivered"><i style="width:${pct}%"></i></div>`;
}

function deliveryWindow(s) {
  if (s.deliveryStart && s.deliveryEnd) return `${shortDate(s.deliveryStart)} → ${shortDate(s.deliveryEnd)}`;
  if (s.deliveryStart) return `from ${shortDate(s.deliveryStart)}`;
  if (s.deliveryEnd) return `by ${shortDate(s.deliveryEnd)}`;
  return '';
}

function saleRow(s, movements, commodities) {
  const econ = saleEconomics(s, movements);
  const window = deliveryWindow(s);
  const invoices = db.getInvoicesForSale(s.id);
  const outstandingInvoices = invoices.filter((inv) => inv.status !== 'paid');
  const isBales = commodities.find((c) => c.id === s.commodityId)?.unit === 'bale';
  const unit = isBales ? 'bales' : 't';
  const amount = isBales ? `${num(s.tons || 0, 1)} bales` : tons(s.tons || 0);
  return `
    <div class="list-item stack" data-edit-sale="${s.id}">
      <div class="li-top">
        <div class="main">${s.buyer ? esc(s.buyer) : 'No buyer'}</div>
        <div class="main">${money(econ.totalValue, 0)}</div>
      </div>
      <div class="meta">${[s.grade, s.contractNo ? `#${s.contractNo}` : '', s.brokerNote].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
      <div class="meta">${amount} @ ${money(econ.priceExFarm, 2)}/${isBales ? 'bale' : 't'} net</div>
      <div class="meta">${[s.location, window].filter(Boolean).map(esc).join(' · ') || 'No delivery location/date set'}</div>
      ${fillGauge(econ, s.tons)}
      <div class="li-foot">
        <span class="meta">${num(econ.tonsDelivered, 0)} of ${num(s.tons || 0, 0)} ${unit} delivered${econ.movementDelivered > 0 ? ` (${num(econ.movementDelivered, 0)} trucked)` : ''}</span>
        <span class="badges">
          ${fillBadge(econ, unit)}
          ${outstandingInvoices.length > 0 ? `<span class="badge neg">${outstandingInvoices.length} unpaid</span>` : invoices.length > 0 ? `<span class="badge pos">Paid</span>` : ''}
        </span>
      </div>
    </div>
  `;
}

function invoiceButtonLabel(sale) {
  const invoices = db.getInvoicesForSale(sale.id);
  if (invoices.length === 0) return 'Invoices';
  const outstanding = invoices.filter((inv) => inv.status !== 'paid').length;
  return `Invoices (${invoices.length}${outstanding > 0 ? `, ${outstanding} outstanding` : ', all paid'})`;
}

function openSaleSheet(existing) {
  const { commodities, movements } = db.get();
  const commodityOptions = commodities.map((c) => ({ value: c.id, label: c.name }));
  const movementDelivered = existing ? movementTonsToSale(existing.id, movements) : 0;
  const allSales = db.get().sales;
  const distinct = (key) => [...new Set(allSales.map((x) => (x[key] || '').trim()).filter(Boolean))].sort((m, n) => m.localeCompare(n));
  const buyerList = distinct('buyer');
  const brokerList = distinct('broker');
  const locationList = distinct('location');
  // Folds start closed on a new contract and open on an edit that has something in them.
  const openTerms = !!existing && ['cropYear', 'contractType', 'pricingPoint', 'deliveryTerms', 'buyerContact', 'tradeRules'].some((k) => existing[k]);
  const openAdjust = !!existing && (!!existing.premiumDiscount || !!existing.ginning || Math.abs((existing.leviesPct ?? 0) * 100 - 1.02) > 1e-6);
  const openDelivered = !!existing && (!!existing.tonsDelivered || !!existing.notes || !!existing.buyerAbn || !!existing.buyerAddress);
  const openAdvanced = !!existing && (!!existing.carryRate || !!existing.carryFrom
    || (existing.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS) !== DEFAULT_TOLERANCE_CAP_TONS);

  openSheet(existing ? 'Edit sale' : 'Add sale', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:0">Fill in the top section and Save — the folds
        underneath are optional detail.</div>
      <datalist id="dl-buyers">${buyerList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-brokers">${brokerList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-locations">${locationList.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>

      <div class="subhead">Deal</div>
      <div class="grid-2">
        ${field({ label: 'Date', id: 'date', type: 'date', value: existing?.date ?? todayLocal() })}
        ${field({ label: 'Contract no.', id: 'contractNo', value: existing?.contractNo })}
      </div>
      ${field({ label: 'Buyer', id: 'buyer', value: existing?.buyer, placeholder: 'e.g. CBH, Cargill', list: 'dl-buyers' })}
      <div class="copy-last" id="copy-last"></div>

      <div class="subhead">Quantity &amp; price</div>
      <div class="grid-2">
        ${field({ label: 'Commodity', id: 'commodity', type: 'select', value: existing?.commodityId ?? commodities[0]?.id, options: commodityOptions })}
        ${field({ label: 'Grade', id: 'grade', value: existing?.grade, placeholder: 'e.g. APW1, H2' })}
      </div>
      ${field({ label: 'Tons', id: 'tons', type: 'number', step: '0.01', value: existing?.tons })}
      <div class="grid-2">
        ${field({ label: 'Tolerance (%)', id: 'tolPct', type: 'number', step: '0.1', value: existing?.tolerancePct ?? DEFAULT_TOLERANCE_PCT })}
        <div class="field"><label>Tolerance range</label><div class="readout" id="tol-preview">—</div></div>
      </div>
      ${field({ label: 'Price ($/t)', id: 'price', type: 'number', step: '0.01', value: existing?.price })}
      <div class="row"><span class="label">Contract value</span><span class="value" id="value-preview">—</span></div>

      <div class="subhead">Delivery</div>
      ${field({ label: 'Location', id: 'location', value: existing?.location, placeholder: 'Delivery site', list: 'dl-locations' })}
      <div class="grid-2">
        ${field({ label: 'Delivery start', id: 'deliveryStart', type: 'date', value: existing?.deliveryStart })}
        ${field({ label: 'Delivery finish', id: 'deliveryEnd', type: 'date', value: existing?.deliveryEnd })}
      </div>
      ${field({ label: 'Weights to govern', id: 'weightsToGovern', type: 'select', value: existing?.weightsToGovern ?? '', options: [
        { value: '', label: '—' },
        { value: 'destination', label: 'Destination' },
        { value: 'origin', label: 'Origin' },
      ], hint: 'Whose weighbridge settles it' })}

      <div class="subhead">Payment, broker &amp; freight</div>
      <div class="grid-2">
        ${field({ label: 'Payment terms (days)', id: 'paymentTermsDays', type: 'number', step: '1', value: existing?.paymentTermsDays ?? '' })}
        ${field({ label: 'Counted from', id: 'paymentTermsBasis', type: 'select', value: existing?.paymentTermsBasis ?? '', options: [
          { value: '', label: '—' },
          { value: 'end of week of delivery', label: 'End of week of delivery' },
          { value: 'end of week of transfer', label: 'End of week of transfer' },
          { value: 'date of delivery', label: 'Date of delivery' },
          { value: 'invoice date', label: 'Invoice date' },
        ], hint: '"30 days" and "30 days from end of week" are up to six days apart' })}
      </div>
      ${field({ label: 'Broker note', id: 'brokerNote', type: 'textarea', value: existing?.brokerNote })}
      <div class="grid-2">
        ${field({ label: 'Broker', id: 'broker', value: existing?.broker, placeholder: 'e.g. Knight Commodities', list: 'dl-brokers' })}
        ${field({ label: 'Broker reference', id: 'brokerRef', value: existing?.brokerRef, placeholder: 'Their contract ref' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Brokerage paid by', id: 'brokeragePaidBy', type: 'select', value: existing?.brokeragePaidBy ?? '', options: [
          { value: '', label: '—' },
          { value: 'seller', label: 'Seller (you)' },
          { value: 'buyer', label: 'Buyer' },
        ] })}
        ${field({ label: 'Freight ($/t)', id: 'freight', type: 'number', step: '0.01', value: existing?.freight ?? 0 })}
      </div>

      <details class="fold" ${openTerms ? 'open' : ''}>
        <summary><div><h2>Contract terms</h2>
          <div class="sub">Crop year, type, pricing point, delivery terms, contact, trade rules</div></div></summary>
        <div class="field hint" style="margin-bottom:10px">What the buyer's contract confirmation
          says. Fill in what you have — anything left blank is simply not shown.</div>
        <div class="grid-2">
          ${field({ label: 'Crop year', id: 'cropYear', value: existing?.cropYear, placeholder: 'e.g. 2025/2026', hint: 'As the contract writes it' })}
          ${field({ label: 'Contract type', id: 'contractType', value: existing?.contractType, placeholder: 'e.g. Ex Farm' })}
        </div>
        ${field({ label: 'Pricing point', id: 'pricingPoint', value: existing?.pricingPoint, placeholder: 'e.g. Goondiwindi - 45km S/W', hint: 'Where the price is struck' })}
        ${field({ label: 'Delivery terms', id: 'deliveryTerms', value: existing?.deliveryTerms, placeholder: "e.g. Buyer's call, 5 business days notice" })}
        ${field({ label: 'Buyer contact / trader', id: 'buyerContact', value: existing?.buyerContact, placeholder: 'Who to ring about a load' })}
        ${field({ label: 'Trade rules', id: 'tradeRules', value: existing?.tradeRules, placeholder: 'e.g. GTA contract 3' })}
      </details>

      <details class="fold" ${openAdjust ? 'open' : ''}>
        <summary><div><h2>Price adjustments</h2>
          <div class="sub">Premium/discount, levies, ginning</div></div></summary>
        <div class="field hint" style="margin-bottom:10px">Taken off (or added to) the price above to
          get the net price ex-farm.</div>
        <div class="grid-2">
          ${field({ label: 'Premium/discount ($/t)', id: 'premium', type: 'number', step: '0.01', value: existing?.premiumDiscount ?? 0, allowNegative: true, hint: 'Negative for a discount' })}
          ${field({ label: 'Levies (%)', id: 'levies', type: 'number', step: '0.01', value: existing ? +(existing.leviesPct * 100).toFixed(4) : 1.02, hint: 'e.g. GRDC + state levy' })}
        </div>
        ${field({ label: 'Ginning cost ($)', id: 'ginning', type: 'number', step: '0.01', value: existing?.ginning ?? 0, hint: 'Net ginning deduction, e.g. cotton seed. A total, not a rate.' })}
      </details>

      <details class="fold" ${openDelivered ? 'open' : ''}>
        <summary><div><h2>Delivered &amp; other</h2>
          <div class="sub">Tons delivered, notes, buyer ABN and address</div></div></summary>
        ${field({ label: 'Tons delivered (manual)', id: 'tonsDelivered', type: 'number', step: '0.01', value: existing?.tonsDelivered ?? 0, hint: 'For deliveries not tracked as a Movement' })}
        ${movementDelivered > 0 ? `<div class="row"><span class="label">+ Delivered via movements</span><span class="value" id="movement-delivered-value">${num(movementDelivered, 1)} t</span></div>` : ''}
        ${field({ label: 'Notes', id: 'notes', type: 'textarea', value: existing?.notes })}
        <div class="grid-2">
          ${field({ label: 'Buyer ABN (optional)', id: 'buyerAbn', value: existing?.buyerAbn, hint: 'For invoices' })}
          ${field({ label: 'Buyer address (optional)', id: 'buyerAddress', value: existing?.buyerAddress })}
        </div>
      </details>

      <details class="fold" ${openAdvanced ? 'open' : ''}>
        <summary><div><h2>Advanced</h2>
          <div class="sub">Tolerance cap, carry</div></div></summary>
        ${field({ label: 'Tolerance cap (t)', id: 'tolCap', type: 'number', step: '0.1', value: existing?.toleranceCapTons ?? DEFAULT_TOLERANCE_CAP_TONS, hint: 'The lesser of the % and this cap applies' })}
        <div class="grid-2">
          ${field({ label: 'Carry ($/t/month)', id: 'carryRate', type: 'number', step: '0.01', value: existing?.carryRate ?? 0, hint: 'Paid to leave grain on farm' })}
          ${field({ label: 'Carry starts', id: 'carryFrom', type: 'date', value: existing?.carryFrom })}
        </div>
      </details>
      ${existing ? `
        <details class="fold" ${(existing.documents || []).length ? 'open' : ''}>
          <summary><div><h2>Documents</h2>
            <div class="sub">The buyer's contract and the broker's note, kept with the sale</div></div></summary>
          <div id="doc-list"></div>
          ${field({ label: 'What is it', id: 'doc-kind', type: 'select', value: 'contract',
            options: DOCUMENT_KINDS.map((k) => ({ value: k.value, label: k.label })) })}
          <input type="file" id="doc-file" accept="application/pdf,image/*" style="display:none" />
          <button class="btn secondary small" id="doc-attach">Attach a file&hellip;</button>
          <div id="doc-problem"></div>
        </details>
      ` : `
        <div class="field hint" style="margin-top:14px">Save the sale first, then you can
          attach the buyer's contract and the broker's note to it.</div>
      `}
      ${existing ? `<div id="related-movements" style="margin:12px 0"></div>` : ''}
      ${existing ? `<button class="btn secondary" id="view-invoice" style="margin-top:12px">${invoiceButtonLabel(existing)}</button>` : ''}
      ${existing ? `<button class="btn secondary" id="view-contract" style="margin-top:8px">Confirmation of sale (PDF)&hellip;</button>` : ''}
      ${existing ? `<button class="btn ghost-danger" id="del" style="margin-top:8px">Delete sale</button>` : ''}
      <div class="save-bar">
        <div class="total"><div class="l">Contract value</div><div class="v" id="total-preview">—</div></div>
        <button class="btn" id="save">Save</button>
      </div>
    `;
    if (existing) renderRelatedMovements(root.querySelector('#related-movements'), 'sale', existing.id);
    const invoiceBtn = root.querySelector('#view-invoice');
    if (invoiceBtn) invoiceBtn.addEventListener('click', () => openInvoiceListSheet(existing));
    const contractBtn = root.querySelector('#view-contract');
    // Reads the saved sale rather than the form, so the document can never show
    // a figure that has not been saved yet.
    if (contractBtn) {
      contractBtn.addEventListener('click', () => {
        const fresh = db.get().sales.find((x) => x.id === existing.id) || existing;
        openContractDocSheet(fresh);
      });
    }

    const tolPreview = root.querySelector('#tol-preview');
    let currentUnit = 't';
    const recomputeTolerance = () => {
      const { minTons, maxTons } = contractTolerance(getNum(root, 'tons'), getNum(root, 'tolPct'), getNum(root, 'tolCap'));
      tolPreview.textContent = `${num(minTons, 1)} – ${num(maxTons, 1)} ${currentUnit}`;
    };
    ['tons', 'tolPct', 'tolCap'].forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeTolerance));

    // What the figures above come to, as you type — the same arithmetic the
    // sales list uses, run on the form's values rather than a saved record.
    const valuePreview = root.querySelector('#value-preview');
    const totalPreview = root.querySelector('#total-preview');
    const recomputeValue = () => {
      const e = saleEconomics({
        tons: getNum(root, 'tons'),
        price: getNum(root, 'price'),
        freight: getNum(root, 'freight'),
        premiumDiscount: getNum(root, 'premium'),
        ginning: getNum(root, 'ginning'),
        leviesPct: getNum(root, 'levies') / 100,
      });
      valuePreview.textContent = `${money(e.totalValue, 0)} · ${money(e.priceExFarm, 2)}/${currentUnit === 'bales' ? 'bale' : 't'} net`;
      totalPreview.textContent = money(e.totalValue, 0);
    };
    ['tons', 'price', 'freight', 'premium', 'ginning', 'levies']
      .forEach((id) => root.querySelector(`#${id}`).addEventListener('input', recomputeValue));

    // A new contract with a buyer you have sold to before: offer their last
    // one's standing terms (site, payment, broker, delivery rules) so only the
    // numbers that change are typed. Fills blanks only — never overwrites.
    const copyEl = root.querySelector('#copy-last');
    const lastForBuyer = (name) => {
      const k = (name || '').trim().toLowerCase();
      if (!k) return null;
      return allSales
        .filter((x) => (x.buyer || '').trim().toLowerCase() === k)
        .sort((m, n) => String(n.date || '').localeCompare(String(m.date || '')))[0] || null;
    };
    const COPY_FIELDS = [
      'location', 'paymentTermsDays', 'paymentTermsBasis', 'weightsToGovern', 'broker', 'brokeragePaidBy',
      'freight', 'deliveryTerms', 'contractType', 'pricingPoint', 'buyerContact', 'tradeRules', 'buyerAbn', 'buyerAddress',
    ];
    const isBlank = (el) => el.value === '' || el.value === '0';
    const offerCopy = () => {
      if (existing || !copyEl) return;
      const prev = lastForBuyer(getVal(root, 'buyer'));
      if (!prev) { copyEl.innerHTML = ''; return; }
      copyEl.innerHTML = '<button type="button" class="btn secondary small"></button>';
      const btn = copyEl.querySelector('button');
      btn.textContent = `Fill from your last ${prev.buyer} contract${prev.date ? ` (${prev.date})` : ''}`;
      btn.addEventListener('click', () => {
        let filled = 0;
        COPY_FIELDS.forEach((key) => {
          const el = root.querySelector('#' + key);
          const v = prev[key];
          if (!el || v === undefined || v === null || v === '' || v === 0) return;
          if (isBlank(el)) { el.value = v; filled += 1; }
        });
        root.querySelectorAll('details.fold').forEach((d) => {
          if ([...d.querySelectorAll('input,select,textarea')].some((i) => i.value !== '' && i.value !== '0' && i.id !== 'levies' && i.id !== 'tolCap')) d.open = true;
        });
        recomputeValue();
        copyEl.innerHTML = filled
          ? '<div class="hint">Filled ' + filled + ' blank field' + (filled === 1 ? '' : 's') + ' from that contract — check they still apply.</div>'
          : '<div class="hint">Nothing to fill — those fields already have values.</div>';
      });
    };
    root.querySelector('#buyer').addEventListener('input', offerCopy);
    root.querySelector('#buyer').addEventListener('change', offerCopy);
    offerCopy();

    const tonsLabelEl = root.querySelector('label[for="tons"]');
    const tonsDeliveredLabelEl = root.querySelector('label[for="tonsDelivered"]');
    const priceLabelEl = root.querySelector('label[for="price"]');
    const freightLabelEl = root.querySelector('label[for="freight"]');
    const tolCapLabelEl = root.querySelector('label[for="tolCap"]');
    const movementDeliveredValueEl = root.querySelector('#movement-delivered-value');
    const syncUnitLabels = () => {
      const c = commodities.find((cc) => cc.id === getVal(root, 'commodity'));
      const isBales = c?.unit === 'bale';
      currentUnit = isBales ? 'bales' : 't';
      const perUnit = isBales ? '$/bale' : '$/t';
      tonsLabelEl.textContent = isBales ? 'Bales' : 'Tons';
      tonsDeliveredLabelEl.textContent = isBales ? 'Bales delivered (manual)' : 'Tons delivered (manual)';
      priceLabelEl.textContent = `Price (${perUnit})`;
      freightLabelEl.textContent = `Freight (${perUnit})`;
      tolCapLabelEl.textContent = isBales ? 'Tolerance cap (bales)' : 'Tolerance cap (t)';
      if (movementDeliveredValueEl) movementDeliveredValueEl.textContent = `${num(movementDelivered, 1)} ${currentUnit}`;
      recomputeTolerance();
      recomputeValue();
    };
    root.querySelector('#commodity').addEventListener('change', syncUnitLabels);
    syncUnitLabels();

    // --- documents -------------------------------------------------------
    //
    // Attaching saves immediately rather than waiting for the Save button.
    // Uploading a 2MB contract and then losing it because you closed the sheet
    // is the same fault as the fertiliser application that was discarded
    // unless you pressed "Add" first, and it is worse here because the file
    // has already gone to the server by then.
    let documents = (existing?.documents || []).slice();
    const docListEl = root.querySelector('#doc-list');
    const docProblemEl = root.querySelector('#doc-problem');
    const fileEl = root.querySelector('#doc-file');

    const saveDocuments = () => db.upsertSale({ id: existing.id, documents });

    const sayProblem = (msg) => {
      if (docProblemEl) {
        docProblemEl.innerHTML = msg
          ? `<div class="hint" style="color:var(--danger);margin-top:8px">${esc(msg)}</div>` : '';
      }
    };

    const renderDocuments = () => {
      if (!docListEl) return;
      if (!documents.length) {
        docListEl.innerHTML = '<div class="field hint" style="margin-bottom:8px">Nothing attached yet.</div>';
        return;
      }
      docListEl.innerHTML = documents.map((d) => `
        <div class="list-item" style="padding:8px 4px">
          <div>
            <div class="main">${esc(d.fileName || 'Document')}</div>
            <div class="meta">${esc(kindLabel(d.kind))}${d.byteSize ? ` &middot; ${Math.round(d.byteSize / 1024)} KB` : ''}</div>
          </div>
          <div class="right swipe-actions">
            <button type="button" class="btn secondary small" data-open-doc="${esc(d.id)}">Open</button>
            <button type="button" class="btn danger small" data-remove-doc="${esc(d.id)}">&times;</button>
          </div>
        </div>`).join('');

      docListEl.querySelectorAll('[data-open-doc]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const d = documents.find((x) => x.id === btn.dataset.openDoc);
          btn.textContent = 'Opening…';
          const url = await signedUrlFor(d?.storagePath);
          btn.textContent = 'Open';
          if (!url) { sayProblem('That document could not be opened. It may still be uploading.'); return; }
          window.open(url, '_blank', 'noopener');
        });
      });

      docListEl.querySelectorAll('[data-remove-doc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const d = documents.find((x) => x.id === btn.dataset.removeDoc);
          confirmDelete(`Remove ${d?.fileName || 'this document'} from the sale? The file is deleted for good.`, async () => {
            documents = documents.filter((x) => x.id !== d.id);
            renderDocuments();
            saveDocuments();
            await removeSaleDocument(d?.storagePath);
          });
        });
      });
    };

    const attachBtn = root.querySelector('#doc-attach');
    if (attachBtn) {
      renderDocuments();
      attachBtn.addEventListener('click', () => fileEl.click());
      fileEl.addEventListener('change', async () => {
        const file = fileEl.files?.[0];
        fileEl.value = '';                       // so the same file can be re-picked
        if (!file) return;
        const problem = checkFile(file);
        if (problem) { sayProblem(problem); return; }

        sayProblem('');
        attachBtn.disabled = true;
        attachBtn.textContent = 'Uploading…';
        try {
          const stored = await uploadSaleDocument(file, {
            farmId: db.getFarmId(), saleId: existing.id,
          });
          documents.push({
            id: crypto.randomUUID(),
            kind: getVal(root, 'doc-kind') || 'contract',
            uploadedAt: new Date().toISOString(),
            ...stored,
          });
          renderDocuments();
          saveDocuments();
        } catch (e) {
          sayProblem(e.message);
        } finally {
          attachBtn.disabled = false;
          attachBtn.textContent = 'Attach a file…';
        }
      });
    }

    root.querySelector('#save').addEventListener('click', () => {
      db.upsertSale({
        id: existing?.id,
        date: getVal(root, 'date'),
        commodityId: getVal(root, 'commodity'),
        grade: getVal(root, 'grade')?.trim(),
        buyer: getVal(root, 'buyer')?.trim(),
        contractNo: getVal(root, 'contractNo')?.trim(),
        location: getVal(root, 'location')?.trim(),
        deliveryStart: getVal(root, 'deliveryStart'),
        deliveryEnd: getVal(root, 'deliveryEnd'),
        tons: getNum(root, 'tons'),
        tonsDelivered: getNum(root, 'tonsDelivered'),
        price: getNum(root, 'price'),
        freight: getNum(root, 'freight'),
        premiumDiscount: getNum(root, 'premium'),
        ginning: getNum(root, 'ginning'),
        leviesPct: getNum(root, 'levies') / 100,
        tolerancePct: getNum(root, 'tolPct'),
        toleranceCapTons: getNum(root, 'tolCap'),
        brokerNote: getVal(root, 'brokerNote')?.trim(),
        notes: getVal(root, 'notes')?.trim(),
        buyerAbn: getVal(root, 'buyerAbn')?.trim(),
        buyerAddress: getVal(root, 'buyerAddress')?.trim(),
        cropYear: getVal(root, 'cropYear')?.trim(),
        contractType: getVal(root, 'contractType')?.trim(),
        pricingPoint: getVal(root, 'pricingPoint')?.trim(),
        weightsToGovern: getVal(root, 'weightsToGovern'),
        deliveryTerms: getVal(root, 'deliveryTerms')?.trim(),
        buyerContact: getVal(root, 'buyerContact')?.trim(),
        broker: getVal(root, 'broker')?.trim(),
        brokerRef: getVal(root, 'brokerRef')?.trim(),
        brokeragePaidBy: getVal(root, 'brokeragePaidBy'),
        paymentTermsDays: getNum(root, 'paymentTermsDays'),
        paymentTermsBasis: getVal(root, 'paymentTermsBasis'),
        carryRate: getNum(root, 'carryRate'),
        carryFrom: getVal(root, 'carryFrom'),
        tradeRules: getVal(root, 'tradeRules')?.trim(),
        documents,
      });
      closeSheet(); toast('Saved');
    });
    const del = root.querySelector('#del');
    if (del) {
      del.addEventListener('click', () => {
        confirmDelete('Delete this sale?', () => {
          db.deleteSale(existing.id);
          closeSheet();
        });
      });
    }
  });
}
