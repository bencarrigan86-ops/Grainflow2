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
const REF_TYPE_TO_DB = { silo: 'storage', field: 'field', sale: 'sale' };
const REF_TYPE_FROM_DB = { storage: 'silo', field: 'field', sale: 'sale' };

const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
const s = (v) => (v === null || v === undefined ? '' : String(v));
const orNull = (v) => (v === '' || v === undefined ? null : v);

// ---------------------------------------------------------------------------
// app shape  ->  rows
// ---------------------------------------------------------------------------

export function stateToRows(state, farmId) {
  const out = {
    farms: [], seasons: [], commodities: [], fields: [], field_agronomy: [],
    storages: [], sales: [], sale_terms: [], movements: [], movement_legs: [],
    movement_photos: [], invoices: [], overheads: [],
  };

  const b = state.businessDetails || {};
  out.farms.push({
    id: farmId,
    entity_name: s(b.entityName),
    abn: orNull(b.abn), ngr: orNull(b.ngr),
    contact_name: orNull(b.contactName), phone: orNull(b.phone),
    email: orNull(b.email), address: orNull(b.address),
    payment_terms_days: b.paymentTermsDays ?? 14,
    bank_name: orNull(b.bankName), account_name: orNull(b.accountName),
    bsb: orNull(b.bsb), account_number: orNull(b.accountNumber),
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
      });
    }

    for (const m of year.movements || []) {
      out.movements.push({
        id: m.id, farm_id: farmId, season_id: seasonId,
        ticket_no: m.ticketNo ?? null,
        move_date: orNull(m.date),
        commodity_id: orNull(m.commodityId),
        status: m.status || 'open',
        truck_rego: orNull(m.truckRego), driver_name: orNull(m.driver),
        gross_weight: orNull(m.grossWeight), tare_weight: orNull(m.tareWeight),
        tons: n(m.tons),
        weight_status: m.weightStatus || 'estimate',
        notes: orNull(m.notes),
        corrects_id: orNull(m.correctsId),
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
        totals: inv.totals || {},
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
        };
      }),

      movements: inSeason(rows.movements, season.id).map((m) => {
        const legs = legsByMovement.get(m.id) || [];
        const photo = photoByMovement.get(m.id);
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
          froms: legs.filter((l) => l.direction === 'from').map(toLeg),
          tos: legs.filter((l) => l.direction === 'to').map(toLeg),
        };
      }),

      invoices: inSeason(rows.invoices, season.id).map((inv) => ({
        id: inv.id, saleId: inv.sale_id, invoiceNo: inv.invoice_no,
        status: inv.status, paidDate: inv.paid_date,
        lines: inv.lines || [], totals: inv.totals || {},
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
      entityName: farm.entity_name ?? '',
      abn: farm.abn ?? '', ngr: farm.ngr ?? '',
      contactName: farm.contact_name ?? '', phone: farm.phone ?? '',
      email: farm.email ?? '', address: farm.address ?? '',
      paymentTermsDays: farm.payment_terms_days ?? 14,
      bankName: farm.bank_name ?? '', accountName: farm.account_name ?? '',
      bsb: farm.bsb ?? '', accountNumber: farm.account_number ?? '',
    },
  };
}

export { uid };
