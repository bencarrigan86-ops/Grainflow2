// Contracts marked paid: finished with, so left off the main list and the pick lists, but kept and still counted in
// the position and the reports. A paid contract that a record already points to stays on that record's pick list,
// so editing an old load, order or bill never loses its contract.

/** The contracts still being worked on, plus any named in `keep`. */
export const activeSales = (sales, keep = []) => {
  const stay = new Set((Array.isArray(keep) ? keep : [keep]).filter(Boolean));
  return (sales || []).filter((s) => !s.paid || stay.has(s.id));
};

/** The contracts marked paid. */
export const paidSales = (sales) => (sales || []).filter((s) => s.paid);
