import { db } from '../storage.js?v=436';
import { num, esc, todayLocal } from '../fmt.js?v=436';
import { openSheet } from '../ui.js?v=436';
import { cleanDriverSignature, signedWhen } from '../driversign.js?v=436';
import { exportRowsAsCSV } from '../csv.js?v=436';
import { fieldTons, fieldUrea, ureaAppliedKgHaFor, fieldSeed, storageLedgerStock, saleEconomics } from '../derived.js?v=436';
import { endpointLabel } from './movements.js?v=436';
import { layersForStorage } from '../outload.js?v=436';
import { traceLoads, traceText } from '../trace.js?v=436';
import { holdings, totalHeld } from '../offfarm.js?v=436';
import { kindLabel, billTotal } from '../payables.js?v=436';
import { orderState, STATE_LABEL } from '../orders.js?v=436';
import { fieldHarvest } from '../harvest.js?v=436';
import { capacityFor } from '../storagecapacity.js?v=436';
import { qualityColumns, loadQuality, averageQuality, fieldQuality } from '../exportquality.js?v=436';
import { isAdjustment, noteLabel } from '../adjustment.js?v=436';

function commodityName(commodities, id) {
  return commodities.find((c) => c.id === id)?.name || '';
}

function endpointsLabel(entries, ctx) {
  return (entries || [])
    .map((e) => `${endpointLabel(e.type, e.id, ctx)} (${num(e.tons, 2)}t)`)
    .join('; ');
}

export function openExportCsvSheet() {
  const year = db.getCurrentYear();
  const stamp = new Date().toISOString().slice(0, 10);

  openSheet('Export CSV', (root) => {
    root.innerHTML = `
      <div class="field hint" style="margin-bottom:12px">Each downloads as a .csv file for the "${esc(year)}" season — opens straight into Excel, Numbers or Google Sheets.</div>
      <button class="btn secondary" id="exp-fields" style="margin-bottom:8px">Fields (Production)</button>
      <button class="btn secondary" id="exp-sales" style="margin-bottom:8px">Sales</button>
      <button class="btn secondary" id="exp-movements" style="margin-bottom:8px">Movements</button>
      <button class="btn secondary" id="exp-storage" style="margin-bottom:8px">Storage (silos &amp; bunkers)</button>
      <button class="btn secondary" id="exp-invoices" style="margin-bottom:8px">Invoices</button>
      <button class="btn secondary" id="exp-payables" style="margin-bottom:8px">Payables (bills owed)</button>
      <button class="btn secondary" id="exp-orders">Orders</button>
    `;

    root.querySelector('#exp-fields').addEventListener('click', () => exportFieldsCSV(year, stamp));
    root.querySelector('#exp-sales').addEventListener('click', () => exportSalesCSV(year, stamp));
    root.querySelector('#exp-movements').addEventListener('click', () => exportMovementsCSV(year, stamp));
    root.querySelector('#exp-storage').addEventListener('click', () => exportStorageCSV(year, stamp));
    root.querySelector('#exp-invoices').addEventListener('click', () => exportInvoicesCSV(year, stamp));
    root.querySelector('#exp-payables').addEventListener('click', () => exportPayablesCSV(year, stamp));
    root.querySelector('#exp-orders').addEventListener('click', () => exportOrdersCSV(year, stamp));
  });
}

function exportFieldsCSV(year, stamp) {
  const { commodities, fields, movements } = db.get();
  exportRowsAsCSV(`grainflow-fields-${year}-${stamp}.csv`, fields, [
    { label: 'Name', get: (f) => f.name },
    { label: 'Commodity', get: (f) => commodityName(commodities, f.commodityId) },
    { label: 'Area (ha)', get: (f) => f.areaHa ?? '' },
    { label: 'Yield mode', get: (f) => (f.yieldMode === 'actual' ? 'Actual (from movements)' : f.yieldMode === 'recorded' ? 'Recorded (past season)' : 'Estimate') },
    { label: 'Yield (t/ha)', get: (f) => f.yieldTHa ?? '' },
    { label: 'Tonnes', get: (f) => num(fieldTons(f, movements), 2) },
    // Grade and measurements: the weighted average of the loads carted off the field
    ...qualityColumns((f) => fieldQuality(f, movements)),
    { label: 'Urea required (kg/ha)', get: (f) => f.ureaRequiredKgHa ?? '' },
    { label: 'Urea applied (kg/ha)', get: (f) => ureaAppliedKgHaFor(f) },
    { label: 'Urea left (t)', get: (f) => num(fieldUrea(f).leftTons, 2) },
    { label: 'Seed variety', get: (f) => f.seedVariety ?? '' },
    { label: 'Seed rate (kg/ha)', get: (f) => f.seedRateKgHa ?? '' },
    { label: 'Seed required (t)', get: (f) => num(fieldSeed(f).requiredTons, 2) },
    { label: 'Harvested so far (t)', get: (f) => num(fieldHarvest(f, movements).inT, 2) },
    { label: 'Still to harvest (t)', get: (f) => num(fieldHarvest(f, movements).toComeT, 2) },
    { label: 'Harvest finished', get: (f) => (f.harvestDone ? 'Yes' : 'No') },
    { label: 'Hectares still to harvest', get: (f) => (f.harvestHaLeft != null && !f.harvestDone ? num(f.harvestHaLeft, 2) : '') },
    { label: 'Yield for hectares left (t/ha)', get: (f) => (f.harvestHaLeft != null && !f.harvestDone && f.harvestLeftYield != null ? num(f.harvestLeftYield, 2) : '') },
    { label: 'Comments', get: (f) => f.notes ?? '' },
  ]);
}

function exportSalesCSV(year, stamp) {
  const { commodities, sales, movements } = db.get();
  exportRowsAsCSV(`grainflow-sales-${year}-${stamp}.csv`, sales, [
    { label: 'Date', get: (s) => s.date ?? '' },
    { label: 'Commodity', get: (s) => commodityName(commodities, s.commodityId) },
    { label: 'Grade', get: (s) => s.grade ?? '' },
    { label: 'Buyer', get: (s) => s.buyer ?? '' },
    { label: 'Contract No', get: (s) => s.contractNo ?? '' },
    { label: 'Location', get: (s) => s.location ?? '' },
    { label: 'Delivery start', get: (s) => s.deliveryStart ?? '' },
    { label: 'Delivery end', get: (s) => s.deliveryEnd ?? '' },
    { label: 'Tons contracted', get: (s) => s.tons ?? '' },
    { label: 'Tons delivered', get: (s) => num(saleEconomics(s, movements).tonsDelivered, 2) },
    { label: 'Tons due', get: (s) => num(saleEconomics(s, movements).tonsDue, 2) },
    { label: 'Price ($/t)', get: (s) => s.price ?? '' },
    { label: 'Freight ($/t)', get: (s) => s.freight ?? '' },
    { label: 'Premium/Discount ($/t)', get: (s) => s.premiumDiscount ?? '' },
    { label: 'Levies (%)', get: (s) => num((s.leviesPct ?? 0) * 100, 2) },
    { label: 'Net price ex-farm ($/t)', get: (s) => num(saleEconomics(s, movements).priceExFarm, 2) },
    { label: 'Total value ($)', get: (s) => num(saleEconomics(s, movements).totalValue, 2) },
    { label: 'Broker note', get: (s) => s.brokerNote ?? '' },
    { label: 'Comments', get: (s) => s.notes ?? '' },
    // The contract's own terms. On the end rather than interleaved, so anyone
    // with a spreadsheet built on the old column order keeps it.
    { label: 'Crop year', get: (s) => s.cropYear ?? '' },
    { label: 'Contract type', get: (s) => s.contractType ?? '' },
    { label: 'Pricing point', get: (s) => s.pricingPoint ?? '' },
    { label: 'Weights to govern', get: (s) => s.weightsToGovern ?? '' },
    { label: 'Delivery terms', get: (s) => s.deliveryTerms ?? '' },
    { label: 'Buyer contact', get: (s) => s.buyerContact ?? '' },
    { label: 'Broker', get: (s) => s.broker ?? '' },
    { label: 'Broker reference', get: (s) => s.brokerRef ?? '' },
    { label: 'Brokerage paid by', get: (s) => s.brokeragePaidBy ?? '' },
    { label: 'Payment terms (days)', get: (s) => s.paymentTermsDays ?? '' },
    { label: 'Payment counted from', get: (s) => s.paymentTermsBasis ?? '' },
    { label: 'Carry ($/t/month)', get: (s) => s.carryRate ?? '' },
    { label: 'Carry starts', get: (s) => s.carryFrom ?? '' },
    { label: 'Trade rules', get: (s) => s.tradeRules ?? '' },
    // The grades a contract lists, each with its $/t adjustment, and what the loads delivered so far have added
    { label: 'Grade premiums/discounts ($/t)', get: (s) => (s.gradeOptions || []).map((o) => `${o.grade} ${o.adjust >= 0 ? '+' : ''}${o.adjust}`).join('; ') },
    { label: 'Brokerage ($/t)', get: (s) => s.brokerageRate || '' },
    { label: 'Grade adjustment to date ($)', get: (s) => (s.gradeOptions?.length ? num(saleEconomics(s, movements).gradeAdjustment, 2) : '') },
    // Canola priced for oil: the base, the % of price per 1%, and what the loads delivered so far have added
    { label: 'Oil base (%)', get: (s) => (s.oilAdjustPct ? s.oilBasePct : '') },
    { label: 'Oil adjustment (% of price per 1%)', get: (s) => (s.oilAdjustPct ? s.oilAdjustPct : '') },
    { label: 'Oil adjustment to date ($)', get: (s) => (s.oilAdjustPct ? num(saleEconomics(s, movements).oilAdjustment, 2) : '') },
  ]);
}

function exportMovementsCSV(year, stamp) {
  const data = db.get();
  const { movements } = data;
  const traced = traceLoads(data.storages, movements);
  exportRowsAsCSV(`grainflow-movements-${year}-${stamp}.csv`, movements, [
    { label: 'Ticket No', get: (m) => m.ticketNo ?? '' },
    { label: 'Delivery no.', get: (m) => m.externalTicketNo ?? '' },
    { label: "Buyer's order no.", get: (m) => (m.orderId ? (db.getOrders().find((o) => o.id === m.orderId)?.orderNo ?? '') : '') },
    { label: 'Date', get: (m) => m.date ?? '' },
    { label: 'From', get: (m) => endpointsLabel(m.froms, data) },
    { label: 'To', get: (m) => endpointsLabel(m.tos, data) },
    { label: 'Tons', get: (m) => m.tons ?? '' },
    { label: 'Truck rego', get: (m) => m.truckRego ?? '' },
    { label: 'Transport company', get: (m) => m.truckCompany ?? '' },
    { label: 'Driver signed', get: (m) => signedWhen(cleanDriverSignature(m.driverSignature)) },
    { label: 'Driver', get: (m) => m.driver ?? '' },
    { label: 'Driver phone', get: (m) => m.driverPhone ?? '' },
    { label: 'Gross weight (t)', get: (m) => m.grossWeight ?? '' },
    { label: 'Tare weight (t)', get: (m) => m.tareWeight ?? '' },
    { label: 'Weight status', get: (m) => m.weightStatus ?? '' },
    // Load by load: this ticket's own grade and measurements
    ...qualityColumns(loadQuality),
    // Which paddocks the grain on this load came from, worked back through the silos it passed through (a silo emptied last in, first out or the other way)
    { label: 'Paddocks it came from (t)', get: (m) => traceText(traced.get(m.id), data) },
    { label: 'Comments', get: (m) => m.notes ?? '' },
  ]);
}

function exportStorageCSV(year, stamp) {
  const data = db.get();
  const { commodities, storages, movements } = data;
  exportRowsAsCSV(`grainflow-storage-${year}-${stamp}.csv`, storages, [
    { label: 'Name', get: (s) => s.name },
    { label: 'Kind', get: (s) => (s.offFarm ? 'Off-farm' : s.kind === 'bunker' ? 'Bunker / shed' : 'Silo') },
    { label: 'Commodity', get: (s) => commodityName(commodities, s.commodityId) },
    { label: 'Opening stock (t)', get: (s) => s.openingStock ?? '' },
    // an off-farm location is held by grade: its tracked stock is what it holds, all grades
    { label: 'Tracked stock (t)', get: (s) => num(s.offFarm ? totalHeld(holdings(s, movements, { fields: data.fields, storages: data.storages, sales: data.sales })) : storageLedgerStock(s, movements), 2) },
    { label: 'Held by grade (off-farm)', get: (s) => (s.offFarm ? holdings(s, movements, { fields: data.fields, storages: data.storages, sales: data.sales }).map((h) => `${commodityName(commodities, h.commodityId) || 'Unknown'} ${h.grade || 'No grade'} ${num(h.tons, 2)} t`).join('; ') : '') },
    { label: 'Run by (off-farm)', get: (s) => s.offFarm?.operator ?? '' },
    { label: 'Crop year', get: (s) => s.cropYear ?? '' },
    // Grade and measurements: the weighted average of what is in the silo now, layer by layer
    ...qualityColumns((s) => averageQuality(s.offFarm ? [] : layersForStorage(s, movements).layers.map((l) => ({ tons: l.tons, spec: l.spec })))),
    { label: 'Volume (m³)', get: (s) => s.volumeM3 ?? '' },
    { label: 'Capacity (t)', get: (s) => { const t = capacityFor(s, commodities); return t > 0 ? num(t, 1) : (s.capacityTons ?? ''); } },
    { label: 'Radius / Width (m)', get: (s) => s.kind === 'bunker' ? (s.width ?? '') : (s.radius ?? '') },
    { label: 'Height / Length (m)', get: (s) => s.kind === 'bunker' ? (s.length ?? '') : (s.currentHeight ?? '') },
    { label: 'Angle of repose override (°)', get: (s) => s.angleOfRepose ?? '' },
    { label: 'Test weight override (t/m³)', get: (s) => s.testWeight ?? '' },
    { label: 'Comments', get: (s) => s.notes ?? '' },
  ]);
}

function exportPayablesCSV(year, stamp) {
  const { commodities, sales, storages } = db.get();
  const contract = (id) => { const s = sales.find((x) => x.id === id); return s ? [commodityName(commodities, s.commodityId), s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ') : ''; };
  exportRowsAsCSV(`grainflow-payables-${year}-${stamp}.csv`, db.getPayables(), [
    { label: 'Type', get: (p) => kindLabel(p.kind) },
    { label: 'From', get: (p) => p.supplier ?? '' },
    { label: 'Their invoice no.', get: (p) => p.reference ?? '' },
    { label: 'Invoice date', get: (p) => p.invoiceDate ?? '' },
    { label: 'Due date', get: (p) => p.dueDate ?? '' },
    { label: 'Contract', get: (p) => contract(p.saleId) },
    { label: 'Storage location', get: (p) => storages.find((s) => s.id === p.storageId)?.name ?? '' },
    { label: 'Tonnes', get: (p) => p.tons ?? '' },
    { label: 'Rate ($/t)', get: (p) => p.rate ?? '' },
    { label: 'Amount ex GST ($)', get: (p) => num(p.amount, 2) },
    { label: 'GST ($)', get: (p) => num(p.gst, 2) },
    { label: 'Total ($)', get: (p) => num(billTotal(p), 2) },
    { label: 'Status', get: (p) => (p.status === 'paid' ? 'Paid' : 'Unpaid') },
    { label: 'Paid date', get: (p) => p.paidDate ?? '' },
    { label: 'Comments', get: (p) => p.notes ?? '' },
  ]);
}

function exportOrdersCSV(year, stamp) {
  const { commodities, sales, movements } = db.get();
  const today = todayLocal();
  const saleOf = (o) => sales.find((x) => x.id === o.saleId);
  exportRowsAsCSV(`grainflow-orders-${year}-${stamp}.csv`, db.getOrders(), [
    { label: 'Buyer', get: (o) => saleOf(o)?.buyer ?? '' },
    { label: 'Commodity', get: (o) => commodityName(commodities, saleOf(o)?.commodityId) },
    { label: 'Contract no.', get: (o) => saleOf(o)?.contractNo ?? '' },
    { label: "Buyer's order no.", get: (o) => o.orderNo ?? '' },
    { label: 'Deliver from', get: (o) => o.deliverFrom ?? '' },
    { label: 'Deliver by', get: (o) => o.deliverBy ?? '' },
    { label: 'Tonnes ordered', get: (o) => num(o.tons, 2) },
    { label: 'Tonnes delivered', get: (o) => num(orderState(o, movements, today).delivered, 2) },
    { label: 'Tonnes left', get: (o) => num(orderState(o, movements, today).left, 2) },
    { label: 'Freight company', get: (o) => o.freightCompany ?? '' },
    { label: 'Status', get: (o) => STATE_LABEL[orderState(o, movements, today).state] },
    { label: 'Comments', get: (o) => o.notes ?? '' },
  ]);
}

function exportInvoicesCSV(year, stamp) {
  const { commodities, sales, invoices } = db.get();
  const saleLabel = (saleId) => {
    const s = sales.find((ss) => ss.id === saleId);
    if (!s) return 'Unknown contract';
    return [commodityName(commodities, s.commodityId), s.buyer, s.contractNo ? `#${s.contractNo}` : null].filter(Boolean).join(' · ');
  };
  exportRowsAsCSV(`grainflow-invoices-${year}-${stamp}.csv`, invoices, [
    { label: 'Invoice No', get: (i) => (isAdjustment(i) ? '' : i.invoiceNo ?? '') },
    // an adjustment note has a number of its own and says which invoice it adjusts
    { label: 'Adjustment note', get: (i) => (isAdjustment(i) ? noteLabel(i) : '') },
    { label: 'Adjusts invoice', get: (i) => (isAdjustment(i) ? (i.adjustsInvoiceNo ?? '') : '') },
    { label: 'Reason', get: (i) => (isAdjustment(i) ? i.reason ?? '' : '') },
    { label: 'Already in the invoice total', get: (i) => (isAdjustment(i) && i.appliedToInvoice ? 'Yes' : '') },
    { label: 'Issue date', get: (i) => i.issueDate ?? '' },
    { label: 'Due date', get: (i) => i.dueDate ?? '' },
    { label: 'Sale', get: (i) => saleLabel(i.saleId) },
    { label: 'Total tons', get: (i) => num(i.totalTons, 2) },
    { label: 'Subtotal ex GST ($)', get: (i) => num(i.subtotalExGST, 2) },
    { label: 'Freight total ($)', get: (i) => num(i.freightTotal, 2) },
    { label: 'Levies ($)', get: (i) => num(i.levies, 2) },
    { label: 'GST ($)', get: (i) => num(i.gst, 2) },
    { label: 'Total payable ($)', get: (i) => num(i.totalPayable, 2) },
    { label: 'Status', get: (i) => i.status ?? '' },
    { label: 'Paid date', get: (i) => i.paidDate ?? '' },
    // Invoices have no notes of their own; this is the contract's
    { label: 'Comments', get: (i) => i.notes ?? sales.find((s) => s.id === i.saleId)?.notes ?? '' },
  ]);
}
