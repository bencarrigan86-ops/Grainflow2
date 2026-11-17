// A commodity's gross margin cost can be given as a total or as dollars per hectare of what is sown to it. The total is what is kept and
// what the Position tab uses; dollars per hectare is just a way to work it out (or to read it back) from the area, so nothing new is saved.

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const cents = (v) => Math.round(v * 100) / 100;

/** The total cost for a cost per hectare over an area, to the cent. 0 when either is missing. */
export function totalFromPerHa(perHa, areaHa) {
  return n(perHa) > 0 && n(areaHa) > 0 ? cents(n(perHa) * n(areaHa)) : 0;
}

/** The cost per hectare a total comes to over an area, to the cent. 0 when there is no area to spread it over. */
export function perHaFromTotal(total, areaHa) {
  return n(total) > 0 && n(areaHa) > 0 ? cents(n(total) / n(areaHa)) : 0;
}

/** The hectares sown to a commodity: every field that has it, added up. */
export function commodityAreaHa(fields, commodityId) {
  if (!commodityId) return 0;
  return (fields || []).filter((f) => f.commodityId === commodityId).reduce((s, f) => s + n(f.areaHa), 0);
}
