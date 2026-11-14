// Translation between the app's in-memory shape and the 16 relational tables.
//
// These are pure functions on purpose — no network, no database client, no
// side effects. That is what makes the round-trip testable, and the round trip
// is the whole point: anything that goes out to Postgres and comes back must
// arrive identical, or a grower's season quietly changes shape on the way.
//
// Three things happen here that are not simple renames:
//
//   1. The nested years object flattens onto season_id.
//   2. froms/tos arrays on a movement become movement_legs rows, with a
//      direction column. A load blending three silos into two is five rows.
//   3. fields and sales each split in two — field_agronomy and sale_terms hold
//      the parts a field device must never receive. See decision 6 in the
//      schema migration.

const uid = () => crypto.randomUUID();

// The app and the database disagree about one word, deliberately.
//
// In the interface a movement leg pointing at on-farm storage has type 'silo' —
// the picker is called siloOptions, endpointLabel checks for 'silo', derived.js
// computes stock from it. But that picker also lists bunkers, so 'silo' is the
// wrong name for the category; the table is `storages` and the row's own `kind`
// says whether it is a silo or a bunker.
//
// Rather than rename the concept across four view files and the derived-stock
// calculation, the boundary translates. The database stays correct, the app
// keeps its habits, and this is exactly what a mapping layer is for.
import { cleanGradeOptions } from './gradeprice.js?v=235';
import { cleanOffFarm } from './offfarm.js?v=235';

const REF_TYPE_TO_DB = { silo: 'storage', field: 'field', sale: 'sale' };
const REF_TYPE_FROM_DB = { storage: 'silo', field: 'field', sale: 'sale' };

const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const s = (v) => (v === null || v === undefined ? '' : String(v));
const orNull = (v) => (v === '' || v === undefined ? null : v);

// Quality — what the grain is, as opposed to how much of it there is. [app key,
// column, kind]. A storage carries all seven; a load carries the six that
// describe grain (a load has no "crop year" of its own).
//
// Both are optional and both arrived in a migration, so both follow one rule:
// the columns are left out of a row entirely while nothing is recorded, rather
// than sent as nulls. A database that has not had the migration yet rejects any
// row that names them, and sending them on every silo and every load would stop
// them all saving over a feature nobody had used. Something that has ever had a
// value recorded (__hasQuality) keeps sending the columns, so clearing a value
// reaches the server as a null rather than being forgotten.
const QUALITY_FIELDS = [
  ['cropYear', 'crop_year', 'text'],
  ['grade', 'grade', 'text'],
  ['moisturePct', 'moisture_pct', 'num'],
  ['proteinPct', 'protein_pct', 'num'],
  ['screeningsPct', 'screenings_pct', 'num'],
  ['testWeightKgHl', 'test_weight_kg_hl', 'num'],
  ['fallingNumber', 'falling_number', 'num'],
  // Canola oil. A later column than the rest, so it is sent on its own: only once an oil figure has been
  // recorded (see __hasOil), never along with a grade or a protein. Otherwise every graded load would be
  // refused until the database had the column.
  ['oilPct', 'oil_pct', 'num', 'optional'],
];
const LOAD_QUALITY_FIELDS = QUALITY_FIELDS.filter(([key]) => key !== 'cropYear');

// What an invoice carries that has no column of its own: when it was issued and is due, and its figures. Kept in the
// row's `totals` under this key, so they come back with the invoice.
const INVOICE_KEY = '__invoice';
const INVOICE_EXTRAS = ['issueDate', 'dueDate', 'totalTons', 'subtotalExGST', 'freightTotal', 'levies', 'gst', 'totalPayable'];
function invoiceExtras(inv) {
  const out = {};
  for (const k of INVOICE_EXTRAS) if (inv[k] !== undefined) out[k] = inv[k];
  return Object.keys(out).length ? { [INVOICE_KEY]: out } : {};
}

/**
 * One ticket as the app holds it, from its row, its legs and its photo row. Used for the
 * whole farm at startup, and for a single ticket when two devices have changed it (see
 * ticketmerge.js). `__rev` is the server's version of the row, so a device can tell later
 * whether somebody else has changed it since.
 */
export function movementFromRow(m, legs = [], photo = null) {
  const toLeg = (l) => ({
    __legId: l.id,
    type: REF_TYPE_FROM_DB[l.ref_type] || l.ref_type,
    id: l.ref_id,
    tons: n(l.tons),
  });
  return {
    ...(photo ? {
      __photoId: photo.id,
      photoPath: photo.storage_path,
      photoTakenAt: photo.taken_at ?? null,
    } : {}),
    id: m.id, ticketNo: m.ticket_no,
    date: m.move_date ?? '',
    commodityId: m.commodity_id,
    status: m.status,
    truckRego: m.truck_rego ?? '', driver: m.driver_name ?? '',
    grossWeight: m.gross_weight, tareWeight: m.tare_weight,
    tons: n(m.tons),
    weightStatus: m.weight_status,
    notes: m.notes ?? '',
    correctsId: m.corrects_id,
    ...(m.source_ref ? { sourceRef: m.source_ref } : {}),
    ...(m.external_ticket_no != null ? { externalTicketNo: m.external_ticket_no, __hasExtTicket: true } : {}),
    ...(m.order_id ? { orderId: m.order_id, __hasOrderId: true } : {}),
    ...loadQuality.fromRow(m),
    ...(m.updated_at ? { __rev: m.updated_at } : {}),
    froms: legs.filter((l) => l.direction === 'from').map(toLeg),
    tos: legs.filter((l) => l.direction === 'to').map(toLeg),
  };
}

function qualityKit(fields) {
  const has = (rec) => fields.some(([key]) => rec[key] !== undefined && rec[key] !== null && rec[key] !== '');
  const columns = (rec) => {
    if (!has(rec) && !rec.__hasQuality && !rec.__hasOil) return {};
    return Object.fromEntries(fields
      // an optional column is left out until a value has been recorded for it
      .filter(([key, , , optional]) => !optional || (rec[key] !== undefined && rec[key] !== null && rec[key] !== '') || rec.__hasOil)
      .map(([key, col, kind]) => [
        col,
        kind === 'num' ? (rec[key] === '' || rec[key] == null ? null : Number(rec[key])) : orNull(rec[key] ?? ''),
      ]));
  };
  const fromRow = (row) => {
    // Nothing recorded comes back with no quality keys at all, the way it went
    // out, so a round trip changes nothing.
    if (!fields.some(([, col]) => row[col] !== null && row[col] !== undefined)) return {};
    const out = {};
    for (const [key, col, kind, optional] of fields) {
      if (optional && row[col] === undefined) continue;   // the database has no such column yet
      out[key] = kind === 'num' ? (row[col] == null ? null : Number(row[col])) : (row[col] ?? '');
      if (optional && row[col] != null) out.__hasOil = true;
    }
    // only the optional oil recorded: not "quality" in the older sense
    if (fields.some(([, col, , optional]) => !optional && row[col] !== null && row[col] !== undefined)) out.__hasQuality = true;
    return out;
  };
  return { has, columns, fromRow };
}

const storageQuality = qualityKit(QUALITY_FIELDS);
const loadQuality = qualityKit(LOAD_QUALITY_FIELDS);

/** Has anything about the grain's quality been recorded on this storage? */
export const hasStorageQuality = storageQuality.has;
/** ...or on this load? */
export const hasLoadQuality = loadQuality.has;

const qualityColumns = storageQuality.columns;
const qualityFromRow = storageQuality.fromRow;

/**
 * A free-text note on a storage. Same rule: no column while there is no note,
 * and a note that has existed keeps its column so deleting it reaches the server.
 */
export const hasStorageNote = (st) => String(st.notes ?? '').trim() !== '';
/**
 * Running samples of a silo, by tonnes from the bottom: { asOf, bands: [{ tons, grade,
 * proteinPct, … }] }, one json column. Same rule as the others — no column while nothing
 * is described, and a description that has existed keeps its column so clearing it
 * reaches the server.
 */
export const hasGradeBands = (st) => Array.isArray(st.gradeBands) && st.gradeBands.length > 0;
function bandColumns(st) {
  if (!hasGradeBands(st) && !st.__hasBands) return {};
  return { grade_bands: hasGradeBands(st) ? { asOf: st.gradeBandsDate || null, bands: st.gradeBands } : null };
}
function bandsFromRow(row) {
  const g = row.grade_bands;
  return g && Array.isArray(g.bands) && g.bands.length
    ? { gradeBands: g.bands, gradeBandsDate: g.asOf || '', __hasBands: true }
    : {};
}

function noteColumns(st) {
  if (!hasStorageNote(st) && !st.__hasNotes) return {};
  return { notes: orNull(String(st.notes ?? '').trim()) };
}
function noteFromRow(row) {
  return row.notes === null || row.notes === undefined ? {} : { notes: row.notes, __hasNotes: true };
}

// ---------------------------------------------------------------------------
// app shape  ->  rows
// ---------------------------------------------------------------------------

export function stateToRows(state, farmId) {
  const out = {
    farms: [], seasons: [], commodities: [], fields: [], field_agronomy: [],
    storages: [], sales: [], sale_terms: [], movements: [], movement_legs: [],
    movement_photos: [], invoices: [], overheads: [], sale_documents: [], payables: [], orders: [],
  };

  const b = state.businessDetails || {};
  out.farms.push({
    id: farmId,
    // Two names, deliberately. farm_name is the property — Sunnyridge — and is
    // what the app calls this place, what an invitation says you are joining,
    // and what the Account screen shows. entity_name is the ABN holder that
    // appears as the Seller on an invoice. They were one column and one of them
    // was always wrong wherever it was shown.
    farm_name: orNull(b.farmName),
    entity_name: s(b.entityName),
    abn: orNull(b.abn), ngr: orNull(b.ngr),
    contact_name: orNull(b.contactName), phone: orNull(b.phone),
    email: orNull(b.email), address: orNull(b.address),
    payment_terms_days: b.paymentTermsDays ?? 14,
    bank_name: orNull(b.bankName), account_name: orNull(b.accountName),
    bsb: orNull(b.bsb), account_number: orNull(b.accountNumber),
    // The quality assurance program named on a vendor declaration. Optional like the other later columns: sent once
    // it has been filled in, and kept after that so clearing it reaches the server.
    ...((b.qaProgram || b.qaNumber || b.__hasQa) ? { qa_program: orNull(b.qaProgram), qa_number: orNull(b.qaNumber) } : {}),
  });

  for (const [label, year] of Object.entries(state.years || {})) {
    const seasonId = year.__seasonId || uid();
    out.seasons.push({
      id: seasonId, farm_id: farmId, label,
      is_current: label === state.currentYear,
    });

    for (const c of year.commodities || []) {
      out.commodities.push({
        id: c.id, farm_id: farmId, season_id: seasonId,
        name: s(c.name),
        angle_of_repose: n(c.angleOfRepose), test_weight: n(c.testWeight),
        n_per_tonne: n(c.nPerTonne), mtm_price: n(c.mtmPrice),
        opening_stock: n(c.openingStock), retained_seed: n(c.retainedSeed),
        // Optional column (a migration added it): left out until a value has been recorded,
        // kept once one has, so clearing it still reaches the server.
        ...((Number(c.openingValue) || c.__hasOpeningValue) ? { opening_stock_value: n(c.openingValue) } : {}),
        // The farm's own grades for this commodity. Optional in the same way: left out until there are some.
        ...((c.customGrades?.length || c.__hasCustomGrades) ? { custom_grades: c.customGrades || [] } : {}),
        gross_margin_cost: n(c.grossMarginCost),
        // Cotton is counted in bales, not tonnes; without unit and the ginning
        // ratio the whole lint/seed flow has nothing to work from.
        unit: c.unit || 't',
        bales_per_round_bale: n(c.balesPerRoundBale),
        default_yield_t_ha: n(c.defaultYieldTHa),
        target_yield_t_ha: n(c.targetYieldTHa),
        notes: orNull(c.notes),
      });
    }

    for (const f of year.fields || []) {
      out.fields.push({
        id: f.id, farm_id: farmId, season_id: seasonId,
        name: s(f.name), area_ha: n(f.areaHa),
        commodity_id: orNull(f.commodityId),
        // A note about a boggy corner or a locked gate belongs with the load,
        // not behind the agronomy wall.
        notes: orNull(f.notes),
        // Whether harvest of this paddock is finished. Optional like the other later columns: left out until it is set.
        ...((f.harvestDone || f.__hasHarvestDone) ? { harvest_done: !!f.harvestDone } : {}),
        // Hectares still to harvest on a part-harvested paddock. Optional the same way; clearing it sends null.
        ...((f.harvestHaLeft != null || f.__hasHarvestHaLeft) ? { harvest_ha_left: f.harvestHaLeft == null ? null : n(f.harvestHaLeft) } : {}),
      });
      // The agronomy half. Always written, even when empty — a missing row and
      // a zeroed row are different things, and the app expects the fields to
      // exist.
      out.field_agronomy.push({
        id: f.__agronomyId || uid(), farm_id: farmId, field_id: f.id,
        yield_t_ha: n(f.yieldTHa),
        yield_mode: f.yieldMode || 'estimate',
        urea_required_kg_ha: n(f.ureaRequiredKgHa),
        urea_applied_kg_ha: n(f.ureaAppliedKgHa),
        seed_variety: orNull(f.seedVariety),
        seed_rate_kg_ha: n(f.seedRateKgHa),
        soil_test_n_kg_ha: n(f.soilTestNKgHa),
        target_yield_override_t_ha: n(f.targetYieldOverrideTHa),
        starter_required_kg_ha: n(f.starterRequiredKgHa),
        starter_applied_kg_ha: n(f.starterAppliedKgHa),
        // Dated applications, kept whole. A running total cannot answer "when
        // was the second pass" and a season of urea is a sequence, not a sum.
        urea_applications: Array.isArray(f.ureaApplications) ? f.ureaApplications : [],
      });
    }

    for (const st of year.storages || []) {
      out.storages.push({
        id: st.id, farm_id: farmId, season_id: seasonId,
        kind: st.kind || 'silo', name: s(st.name),
        commodity_id: orNull(st.commodityId),
        radius: orNull(st.radius), cone_angle: orNull(st.coneAngle),
        width: orNull(st.width), length: orNull(st.length),
        capacity_tons: orNull(st.capacityTons),
        angle_of_repose: orNull(st.angleOfRepose),
        test_weight: orNull(st.testWeight),
        tarp_overhang_m: orNull(st.tarpOverhangM),
        current_height: n(st.currentHeight),
        fill_state: st.fillState || 'peak',
        opening_stock: n(st.openingStock),
        unit_label: st.unitLabel || 't',
        ...qualityColumns(st),
        ...noteColumns(st),
        ...bandColumns(st),
        // A location held by a third party, with who runs it and what it held at the start of the season by grade.
        // Optional like the other later columns: only locations that are off-farm send it.
        ...((st.offFarm || st.__hasOffFarm) ? { off_farm: st.offFarm ? cleanOffFarm(st.offFarm) : null } : {}),
      });
    }

    for (const sale of year.sales || []) {
      out.sales.push({
        id: sale.id, farm_id: farmId, season_id: seasonId,
        commodity_id: orNull(sale.commodityId),
        buyer: orNull(sale.buyer), contract_no: orNull(sale.contractNo),
        grade: orNull(sale.grade),
        // The app spells it `tons`, the column `tonnes`. The mapping is exactly
        // the place to reconcile that; reading sale.tonnes here — a key no
        // build has ever written — is why contract tonnage was discarded.
        tonnes: n(sale.tons),
        delivery_period: orNull(sale.deliveryPeriod),
        sale_date: orNull(sale.date),
        location: orNull(sale.location),
        delivery_start: orNull(sale.deliveryStart),
        delivery_end: orNull(sale.deliveryEnd),
        tons_delivered: n(sale.tonsDelivered),
        tolerance_pct: n(sale.tolerancePct),
        tolerance_cap_tons: n(sale.toleranceCapTons),
        notes: orNull(sale.notes),
        // What a real contract says, and this app used to lose. See the
        // migration for why each one is here; the short version is that a
        // grower who cannot record them keeps the PDF open beside the app.
        crop_year: orNull(sale.cropYear),
        contract_type: orNull(sale.contractType),
        pricing_point: orNull(sale.pricingPoint),
        weights_to_govern: orNull(sale.weightsToGovern),
        delivery_terms: orNull(sale.deliveryTerms),
        buyer_contact: orNull(sale.buyerContact),
        // The farm's own number for the contract, beside the buyer's (contract_no). Optional like the other later columns.
        ...((sale.ourRef || sale.__hasOurRef) ? { our_ref: orNull(sale.ourRef) } : {}),
      });
      out.sale_terms.push({
        id: sale.__termsId || uid(), farm_id: farmId, sale_id: sale.id,
        price: n(sale.price),
        payment_terms_days: orNull(sale.paymentTermsDays),
        contract_value: orNull(sale.contractValue),
        // Everything below moves the margin, which is why it lives in the table
        // a field device never receives.
        freight: n(sale.freight),
        premium_discount: n(sale.premiumDiscount),
        ginning: n(sale.ginning),
        levies_pct: n(sale.leviesPct),
        broker_note: orNull(sale.brokerNote),
        buyer_abn: orNull(sale.buyerAbn),
        buyer_address: orNull(sale.buyerAddress),
        // The commercial half of a contract's terms: who the broker is, who
        // pays them, what the buyer pays to leave grain on farm, and which
        // rulebook governs when there is an argument.
        broker: orNull(sale.broker),
        broker_ref: orNull(sale.brokerRef),
        brokerage_paid_by: orNull(sale.brokeragePaidBy),
        carry_rate: n(sale.carryRate),
        carry_from: orNull(sale.carryFrom),
        payment_terms_basis: orNull(sale.paymentTermsBasis),
        trade_rules: orNull(sale.tradeRules),
        // The grades this contract lists, each with its $/t premium or discount. Optional like the other later
        // columns: left out until a grade is listed, kept once one has been, so clearing the list reaches the server.
        // Brokerage in $/t, charged on the tonnes delivered. Optional like the other later columns.
        ...((Number(sale.brokerageRate) || sale.__hasBrokerageRate) ? { brokerage_rate: n(sale.brokerageRate) } : {}),
        // Who pays the freight: 'we' (a bill in Payables) or 'buyer' (taken off the invoice). Sent once it is 'buyer', or
        // has been stored, so a contract that is never changed from the default never needs the column.
        ...((sale.freightPaidBy === 'buyer' || sale.__hasFreightPaidBy) ? { freight_paid_by: sale.freightPaidBy === 'buyer' ? 'buyer' : 'we' } : {}),
        ...((sale.gradeOptions?.length || sale.__hasGradeOptions) ? { grade_options: cleanGradeOptions(sale.gradeOptions) } : {}),
        // Canola priced for oil: the base oil and the % of price per 1% of oil. Optional in the same way.
        ...((Number(sale.oilAdjustPct) || sale.__hasOilTerms) ? { oil_base_pct: n(sale.oilBasePct), oil_adjust_pct: n(sale.oilAdjustPct) } : {}),
      });

      // The buyer's contract and the broker's note. Only the path travels in
      // the row; the file itself is in object storage, exactly as a movement
      // photo is. A document with no path is one whose upload did not finish,
      // and writing that row would leave a name on screen with nothing behind
      // it.
      for (const doc of sale.documents || []) {
        if (!doc?.storagePath) continue;
        out.sale_documents.push({
          id: doc.id, farm_id: farmId, sale_id: sale.id,
          kind: doc.kind || 'contract',
          file_name: orNull(doc.fileName),
          storage_path: doc.storagePath,
          byte_size: doc.byteSize ?? null,
          uploaded_at: doc.uploadedAt || new Date().toISOString(),
        });
      }
    }

    for (const m of year.movements || []) {
      out.movements.push({
        id: m.id, farm_id: farmId, season_id: seasonId,
        ticket_no: m.ticketNo ?? null,
        move_date: orNull(m.date),
        commodity_id: orNull(m.commodityId),
        // The receiving site's own ticket number, for a load that goes to another site. Optional like the other later columns.
        ...((m.externalTicketNo || m.__hasExtTicket) ? { external_ticket_no: orNull(m.externalTicketNo) } : {}),
        // The order this load was delivered against. Optional the same way: left out until a load has one.
        ...((m.orderId || m.__hasOrderId) ? { order_id: orNull(m.orderId) } : {}),
        status: m.status || 'open',
        truck_rego: orNull(m.truckRego), driver_name: orNull(m.driver),
        gross_weight: orNull(m.grossWeight), tare_weight: orNull(m.tareWeight),
        tons: n(m.tons),
        weight_status: m.weightStatus || 'estimate',
        notes: orNull(m.notes),
        corrects_id: orNull(m.correctsId),
        // The other system's movement number. Left out entirely unless there is one,
        // so a database without the migration still saves every ordinary load.
        ...(m.sourceRef ? { source_ref: m.sourceRef } : {}),
        ...loadQuality.columns(m),
      });

      const legs = [
        ...(m.froms || []).map((l) => ({ ...l, direction: 'from' })),
        ...(m.tos || []).map((l) => ({ ...l, direction: 'to' })),
      ];
      // Only an uploaded photo becomes a row. One still held as a data URL has
      // no object to point at yet, and writing a row with no file behind it
      // would show every viewer a broken image.
      if (m.photoPath) {
        out.movement_photos.push({
          id: m.__photoId || uid(), farm_id: farmId, movement_id: m.id,
          storage_path: m.photoPath,
          taken_at: m.photoTakenAt || null,
        });
      }

      for (const leg of legs) {
        out.movement_legs.push({
          id: leg.__legId || uid(), farm_id: farmId, movement_id: m.id,
          direction: leg.direction,
          ref_type: REF_TYPE_TO_DB[leg.type] || 'storage',
          ref_id: orNull(leg.id),
          tons: n(leg.tons),
        });
      }
    }

    for (const inv of year.invoices || []) {
      out.invoices.push({
        id: inv.id, farm_id: farmId, season_id: seasonId,
        sale_id: orNull(inv.saleId),
        invoice_no: inv.invoiceNo ?? null,
        status: inv.status || 'outstanding',
        paid_date: orNull(inv.paidDate),
        lines: inv.lines || [],
        // The invoice's own figures and dates have no columns of their own, so they travel inside `totals`, under
        // one key. Without this an invoice came back from the server with no amount and no due date.
        totals: { ...(inv.totals || {}), ...invoiceExtras(inv) },
      });
    }

    // Bills the farm owes: brokerage, freight, storage and the rest.
    for (const p of year.payables || []) {
      out.payables.push({
        id: p.id, farm_id: farmId, season_id: seasonId,
        kind: p.kind || 'other',
        supplier: orNull(p.supplier), reference: orNull(p.reference),
        invoice_date: orNull(p.invoiceDate), due_date: orNull(p.dueDate),
        amount: n(p.amount), gst: n(p.gst),
        sale_id: orNull(p.saleId), storage_id: orNull(p.storageId),
        tons: p.tons === '' || p.tons == null ? null : n(p.tons),
        rate: p.rate === '' || p.rate == null ? null : n(p.rate),
        status: p.status || 'unpaid', paid_date: orNull(p.paidDate),
        notes: orNull(p.notes),
      });
    }

    // Orders: a buyer asks for grain against a contract. The contract carries the detail; the order is the tonnes,
    // the window, who carts it and the buyer's own number.
    for (const o of year.orders || []) {
      out.orders.push({
        id: o.id, farm_id: farmId, season_id: seasonId,
        sale_id: orNull(o.saleId),
        order_no: orNull(o.orderNo),
        tons: n(o.tons),
        deliver_from: orNull(o.deliverFrom), deliver_by: orNull(o.deliverBy),
        freight_company: orNull(o.freightCompany),
        status: o.status || 'open',
        notes: orNull(o.notes),
      });
    }

    const oh = year.overheads || {};
    out.overheads.push({
      id: year.__overheadsId || uid(), farm_id: farmId, season_id: seasonId,
      finance: n(oh.finance), equipment_repayments: n(oh.equipmentRepayments),
      depreciation: n(oh.depreciation), wages: n(oh.wages),
      drawings: n(oh.drawings), admin: n(oh.admin), energy: n(oh.energy),
      insurance: n(oh.insurance), repairs_maintenance: n(oh.repairsMaintenance),
      other: n(oh.other),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// rows  ->  app shape
//
// Hidden __ids are carried back so a later stateToRows() reuses the same row
// ids rather than minting new ones on every save. Without them the split
// tables would accumulate orphans, one per write.
// ---------------------------------------------------------------------------

export function rowsToState(rows) {
  const farm = (rows.farms || [])[0] || {};
  const byId = (list, key) => {
    const m = new Map();
    for (const r of list || []) m.set(r[key], r);
    return m;
  };

  const agronomyByField = byId(rows.field_agronomy, 'field_id');
  const termsBySale = byId(rows.sale_terms, 'sale_id');

  const photoByMovement = byId(rows.movement_photos, 'movement_id');

  const docsBySale = new Map();
  for (const d of rows.sale_documents || []) {
    if (!docsBySale.has(d.sale_id)) docsBySale.set(d.sale_id, []);
    docsBySale.get(d.sale_id).push(d);
  }

  const legsByMovement = new Map();
  for (const leg of rows.movement_legs || []) {
    if (!legsByMovement.has(leg.movement_id)) legsByMovement.set(leg.movement_id, []);
    legsByMovement.get(leg.movement_id).push(leg);
  }

  const inSeason = (list, seasonId) =>
    (list || []).filter((r) => r.season_id === seasonId);

  const years = {};
  let currentYear = null;

  for (const season of rows.seasons || []) {
    if (season.is_current) currentYear = season.label;

    years[season.label] = {
      __seasonId: season.id,

      commodities: inSeason(rows.commodities, season.id).map((c) => ({
        id: c.id, name: c.name,
        angleOfRepose: n(c.angle_of_repose), testWeight: n(c.test_weight),
        nPerTonne: n(c.n_per_tonne), mtmPrice: n(c.mtm_price),
        openingStock: n(c.opening_stock), retainedSeed: n(c.retained_seed),
        ...(c.opening_stock_value != null ? { openingValue: n(c.opening_stock_value), __hasOpeningValue: true } : {}),
        ...(Array.isArray(c.custom_grades) ? { customGrades: c.custom_grades, __hasCustomGrades: true } : {}),
        grossMarginCost: n(c.gross_margin_cost),
        unit: c.unit ?? 't',
        balesPerRoundBale: n(c.bales_per_round_bale),
        defaultYieldTHa: n(c.default_yield_t_ha),
        targetYieldTHa: n(c.target_yield_t_ha),
        notes: c.notes ?? '',
      })),

      fields: inSeason(rows.fields, season.id).map((f) => {
        const a = agronomyByField.get(f.id) || {};
        return {
          id: f.id, name: f.name, areaHa: n(f.area_ha),
          commodityId: f.commodity_id,
          ...(f.harvest_done != null ? { harvestDone: !!f.harvest_done, __hasHarvestDone: true } : {}),
          ...(f.harvest_ha_left != null ? { harvestHaLeft: n(f.harvest_ha_left), __hasHarvestHaLeft: true } : {}),
          __agronomyId: a.id,
          yieldTHa: n(a.yield_t_ha),
          yieldMode: a.yield_mode || 'estimate',
          ureaRequiredKgHa: n(a.urea_required_kg_ha),
          ureaAppliedKgHa: n(a.urea_applied_kg_ha),
          seedVariety: a.seed_variety ?? '',
          seedRateKgHa: n(a.seed_rate_kg_ha),
          soilTestNKgHa: n(a.soil_test_n_kg_ha),
          targetYieldOverrideTHa: n(a.target_yield_override_t_ha),
          starterRequiredKgHa: n(a.starter_required_kg_ha),
          starterAppliedKgHa: n(a.starter_applied_kg_ha),
          ureaApplications: Array.isArray(a.urea_applications) ? a.urea_applications : [],
          notes: f.notes ?? '',
        };
      }),

      storages: inSeason(rows.storages, season.id).map((st) => ({
        id: st.id, kind: st.kind, name: st.name,
        commodityId: st.commodity_id,
        radius: st.radius, coneAngle: st.cone_angle,
        width: st.width, length: st.length,
        capacityTons: st.capacity_tons,
        angleOfRepose: st.angle_of_repose, testWeight: st.test_weight,
        tarpOverhangM: st.tarp_overhang_m,
        currentHeight: n(st.current_height),
        fillState: st.fill_state,
        openingStock: n(st.opening_stock),
        unitLabel: st.unit_label ?? 't',
        ...qualityFromRow(st),
        ...noteFromRow(st),
        ...bandsFromRow(st),
        ...(st.off_farm ? { offFarm: cleanOffFarm(st.off_farm), __hasOffFarm: true } : {}),
      })),

      sales: inSeason(rows.sales, season.id).map((sale) => {
        const t = termsBySale.get(sale.id) || {};
        return {
          id: sale.id, commodityId: sale.commodity_id,
          buyer: sale.buyer ?? '', contractNo: sale.contract_no ?? '',
          grade: sale.grade ?? '',
          tons: n(sale.tonnes),
          deliveryPeriod: sale.delivery_period ?? '',
          date: sale.sale_date ?? '',
          location: sale.location ?? '',
          deliveryStart: sale.delivery_start ?? '',
          deliveryEnd: sale.delivery_end ?? '',
          tonsDelivered: n(sale.tons_delivered),
          tolerancePct: n(sale.tolerance_pct),
          toleranceCapTons: n(sale.tolerance_cap_tons),
          notes: sale.notes ?? '',
          __termsId: t.id,
          price: n(t.price),
          paymentTermsDays: t.payment_terms_days,
          contractValue: t.contract_value,
          freight: n(t.freight),
          premiumDiscount: n(t.premium_discount),
          ginning: n(t.ginning),
          leviesPct: n(t.levies_pct),
          brokerNote: t.broker_note ?? '',
          buyerAbn: t.buyer_abn ?? '',
          buyerAddress: t.buyer_address ?? '',
          cropYear: sale.crop_year ?? '',
          contractType: sale.contract_type ?? '',
          pricingPoint: sale.pricing_point ?? '',
          weightsToGovern: sale.weights_to_govern ?? '',
          deliveryTerms: sale.delivery_terms ?? '',
          buyerContact: sale.buyer_contact ?? '',
          ...(sale.our_ref != null ? { ourRef: sale.our_ref, __hasOurRef: true } : {}),
          broker: t.broker ?? '',
          brokerRef: t.broker_ref ?? '',
          brokeragePaidBy: t.brokerage_paid_by ?? '',
          carryRate: n(t.carry_rate),
          carryFrom: t.carry_from ?? '',
          paymentTermsBasis: t.payment_terms_basis ?? '',
          tradeRules: t.trade_rules ?? '',
          ...(t.brokerage_rate != null ? { brokerageRate: n(t.brokerage_rate), __hasBrokerageRate: true } : {}),
          ...(t.freight_paid_by != null ? { freightPaidBy: t.freight_paid_by === 'buyer' ? 'buyer' : 'we', __hasFreightPaidBy: true } : {}),
          ...(Array.isArray(t.grade_options) ? { gradeOptions: cleanGradeOptions(t.grade_options), __hasGradeOptions: true } : {}),
          ...(t.oil_adjust_pct != null ? { oilBasePct: n(t.oil_base_pct), oilAdjustPct: n(t.oil_adjust_pct), __hasOilTerms: true } : {}),
          documents: (docsBySale.get(sale.id) || []).map((d) => ({
            id: d.id, kind: d.kind || 'contract',
            fileName: d.file_name ?? '',
            storagePath: d.storage_path,
            byteSize: d.byte_size ?? 0,
            uploadedAt: d.uploaded_at ?? '',
          })),
        };
      }),

      movements: inSeason(rows.movements, season.id).map((m) => movementFromRow(m, legsByMovement.get(m.id) || [], photoByMovement.get(m.id))),

      invoices: inSeason(rows.invoices, season.id).map((inv) => {
        const { [INVOICE_KEY]: extras, ...totals } = inv.totals || {};
        return {
          id: inv.id, saleId: inv.sale_id, invoiceNo: inv.invoice_no,
          status: inv.status, paidDate: inv.paid_date,
          lines: inv.lines || [], totals,
          ...(extras && typeof extras === 'object' ? extras : {}),
        };
      }),

      payables: inSeason(rows.payables, season.id).map((p) => ({
        id: p.id, kind: p.kind,
        supplier: p.supplier ?? '', reference: p.reference ?? '',
        invoiceDate: p.invoice_date ?? '', dueDate: p.due_date ?? '',
        amount: n(p.amount), gst: n(p.gst),
        saleId: p.sale_id, storageId: p.storage_id,
        tons: p.tons == null ? '' : n(p.tons), rate: p.rate == null ? '' : n(p.rate),
        status: p.status, paidDate: p.paid_date ?? '', notes: p.notes ?? '',
      })),

      orders: inSeason(rows.orders || [], season.id).map((o) => ({
        id: o.id, saleId: o.sale_id,
        orderNo: o.order_no ?? '', tons: n(o.tons),
        deliverFrom: o.deliver_from ?? '', deliverBy: o.deliver_by ?? '',
        freightCompany: o.freight_company ?? '',
        status: o.status || 'open', notes: o.notes ?? '',
      })),

      overheads: (() => {
        const oh = inSeason(rows.overheads, season.id)[0] || {};
        return {
          __overheadsId: oh.id,
          finance: n(oh.finance), equipmentRepayments: n(oh.equipment_repayments),
          depreciation: n(oh.depreciation), wages: n(oh.wages),
          drawings: n(oh.drawings), admin: n(oh.admin), energy: n(oh.energy),
          insurance: n(oh.insurance), repairsMaintenance: n(oh.repairs_maintenance),
          other: n(oh.other),
        };
      })(),
    };

    // __overheadsId belongs on the year, not inside overheads — the views
    // spread `overheads` into forms and would render a stray field.
    years[season.label].__overheadsId = years[season.label].overheads.__overheadsId;
    delete years[season.label].overheads.__overheadsId;
  }

  return {
    version: 2,
    currentYear: currentYear || Object.keys(years)[0] || String(new Date().getFullYear()),
    years,
    businessDetails: {
      // Falls back to the entity while a farm predates the split, so an older
      // farm reads as named rather than blank until somebody sets it.
      farmName: farm.farm_name ?? farm.entity_name ?? '',
      entityName: farm.entity_name ?? '',
      abn: farm.abn ?? '', ngr: farm.ngr ?? '',
      contactName: farm.contact_name ?? '', phone: farm.phone ?? '',
      email: farm.email ?? '', address: farm.address ?? '',
      paymentTermsDays: farm.payment_terms_days ?? 14,
      bankName: farm.bank_name ?? '', accountName: farm.account_name ?? '',
      bsb: farm.bsb ?? '', accountNumber: farm.account_number ?? '',
      ...((farm.qa_program != null || farm.qa_number != null) ? { qaProgram: farm.qa_program ?? '', qaNumber: farm.qa_number ?? '', __hasQa: true } : {}),
    },
  };
}

export { uid };
