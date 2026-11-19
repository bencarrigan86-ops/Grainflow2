// The setup walk-through: one question at a time, in the order a farm gets set up.
// This file is the thinking (which step is next, the records each answer makes); views/setupwalk.js is the screens.
// Pure, so it can be tested without a browser.

import { startProgress } from './helpcontent.js?v=428';

/**
 * The steps this person can do, each with whether the farm already has it, and the position of the first one not done.
 * Owners and managers also get the season, straight after the business: every farm starts with one, named after the year, so it
 * never ticks itself, and the walk only asks for it the first time (it is skipped when Continue setup picks up part way).
 */
export function walkSteps(role, data) {
  const { steps } = startProgress(role, data);
  const list = steps.slice();
  if (role === 'owner' || role === 'manager') {
    const at = list.findIndex((s) => s.id === 'business');
    list.splice(at + 1, 0, { id: 'season', label: 'Name the season', detail: 'The label for the year you are setting up', route: 'settings', done: true, canOpen: true });
  }
  const next = list.findIndex((s) => !s.done);
  return { steps: list, first: next < 0 ? list.length : next };
}

const text = (v) => String(v ?? '').trim();
const numberOr0 = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** The season label to save: the typed one, or nothing when it is blank or unchanged. */
export function seasonLabel(typed, current) {
  const label = String(typed ?? '').trim();
  return label && label !== current ? label : null;
}

/** What goes on the business details: only what was typed, so nothing already saved is wiped by a blank box. */
export function businessPatch({ entityName, abn, ngr }) {
  const out = {};
  if (text(entityName)) out.entityName = text(entityName);
  if (text(abn)) out.abn = text(abn);
  if (text(ngr)) out.ngr = text(ngr);
  return out;
}

/** A commodity added by name; cotton is sold in bales. Returns null when no name was given. */
export function commodityRecord({ name, unit }) {
  if (!text(name)) return null;
  return { name: text(name), unit: unit === 'bale' ? 'bale' : 't' };
}

/** A paddock: name, hectares and crop. Yield and the rest are filled in later in Production. */
export function fieldRecord({ name, areaHa, commodityId }) {
  if (!text(name)) return null;
  return { name: text(name), property: '', areaHa: numberOr0(areaHa), commodityId: commodityId || null, yieldMode: 'actual', yieldTHa: 0 };
}

/** A silo or bunker, with its volume (capacity works out from it and the test weight) and what is in it now. */
export function storageRecord({ name, kind, volumeM3, commodityId, openingStock }) {
  if (!text(name)) return null;
  return {
    kind: kind === 'bunker' ? 'bunker' : 'silo',
    name: text(name),
    volumeM3: numberOr0(volumeM3),
    commodityId: commodityId || null,
    openingStock: numberOr0(openingStock),
  };
}

/** A contract: who is buying, how much, at what price. Everything else keeps the usual zero. */
export function saleRecord({ buyer, commodityId, tons, price, date, deliveryEnd }) {
  if (!text(buyer) || !commodityId || !numberOr0(tons)) return null;
  return {
    date: date || '',
    commodityId,
    buyer: text(buyer),
    tons: numberOr0(tons),
    tonsDelivered: 0,
    price: numberOr0(price),
    deliveryStart: '',
    deliveryEnd: deliveryEnd || '',
    freight: 0,
    premiumDiscount: 0,
    ginning: 0,
    brokerageRate: 0,
    leviesPct: 0,
    paid: false,
  };
}

/** What a load picks up when it leaves: the commodity of a paddock, a silo, or a contract. */
export function commodityOfEnd(data, type, id) {
  if (type === 'field') return data.fields?.find((f) => f.id === id)?.commodityId || null;
  if (type === 'silo') return data.storages?.find((s) => s.id === id)?.commodityId || null;
  if (type === 'sale') return data.sales?.find((s) => s.id === id)?.commodityId || null;
  return null;
}

/** A load, from a paddock or silo to a silo or contract. The commodity rides on the load itself. */
export function loadRecord({ date, tons, from, to, data }) {
  const t = numberOr0(tons);
  if (!t || !from?.id || !to?.id) return null;
  const commodityId = commodityOfEnd(data, from.type, from.id) || commodityOfEnd(data, to.type, to.id) || null;
  return {
    date: date || '',
    ...(commodityId ? { commodityId } : {}),
    froms: [{ type: from.type, id: from.id, tons: t }],
    tos: [{ type: to.type, id: to.id, tons: t }],
    truckRego: '',
    driver: '',
    tons: t,
    weightStatus: 'final',
  };
}

/** Contracts that have grain delivered against them and no invoice yet: where the first invoice comes from. */
export function invoiceable(data) {
  const invoiced = new Set((data.invoices || []).map((i) => i.saleId));
  const delivered = new Map();
  for (const m of data.movements || []) {
    for (const leg of m.tos || []) {
      if (leg.type === 'sale') delivered.set(leg.id, (delivered.get(leg.id) || 0) + (Number(leg.tons) || 0));
    }
  }
  return (data.sales || []).filter((s) => !invoiced.has(s.id) && ((delivered.get(s.id) || 0) > 0 || Number(s.tonsDelivered) > 0));
}
