// Spray requests: a job for a spray contractor, with the paddocks to be sprayed, sent as a PDF.
//
// A request holds who it is for, what is to go on (one to three products, each with a rate per hectare), the water
// rate, the paddocks, the window, and the answers to the aerial spraying checklist. It is sent in one of two forms:
//
//   standard  our own layout, for any contractor
//   aircair   Aircair's own Spray Request Form (a scan of their two pages, written over at measured positions)
//
// Either way a map page follows: the farm's paddocks, the ones to spray marked, north, and a scale. This file is pure:
// it works out what goes where, as plain data, and spraypdf.js draws it. That keeps the layout testable without a
// PDF library or a browser.

import { textWidth, wrapText } from './pdf.js?v=378';
import { dmy } from './fmt.js?v=378';
import { labelFontPx } from './farmmap.js?v=378';

export const FORMS = [
  { key: 'standard', label: 'Our own form' },
  { key: 'aircair', label: "Aircair's form" },
];
export const RATE_UNITS = ['L', 'mL', 'kg', 'g'];
export const MAX_CHEMICALS = 3;

/** The aerial spraying checklist, as the contractor words it. A, B and C are the three groups on their form. */
export const CHECKLIST = [
  { key: 'q1', group: 'A', text: 'Are the chemicals registered for aerial application on the intended crop?' },
  { key: 'q2', group: 'A', text: 'Is the application rate according to label recommendation?' },
  { key: 'q3', group: 'A', text: 'Have you contacted each of your neighbours and advised them of your intended spray application?' },
  { key: 'qI', group: 'B', text: 'Did you receive any objections to any spray drift encroachment?' },
  { key: 'qII', group: 'B', text: 'Are there any houses or work places or other inhabited buildings over which the aircraft must not fly?' },
  { key: 'qIII', group: 'B', text: 'Are there any grazing stock or other animals within 3km of the field to be sprayed?' },
  { key: 'qIV', group: 'B', text: 'Are there any houses or places where people live within 150m of the area to be sprayed?' },
  { key: 'q4', group: 'C', text: 'If you intend us to use a private airstrip have you sought permission from the owner?' },
];

const round = (n, dp = 2) => { const k = 10 ** dp; return Math.round((Number(n) || 0) * k) / k; };
const clean = (s) => String(s ?? '').trim();
/** A number written plainly: 12, 12.5, 1,250.5 (no trailing zeros). */
export const plain = (n, dp = 2) => round(n, dp).toLocaleString('en-AU', { maximumFractionDigits: dp });

export const nextSprayNo = (jobs = []) => {
  const used = jobs.map((j) => /(\d+)\s*$/.exec(String(j.jobNo || ''))?.[1]).filter(Boolean).map(Number);
  return `SJ-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0')}`;
};

/**
 * A new request, filled in from what the farm already knows: its own name, address and phone for the trading
 * details, and the paddocks chosen. `previous` (the last request to the same contractor) carries over the contractor,
 * their email, the contact people, and who supplies the chemical.
 */
export function sprayDefaults({ business = {}, paddocks = [], today = '', jobs = [], previous = null, form = 'standard' } = {}) {
  const prev = previous || {};
  const crops = [...new Set(paddocks.map((p) => clean(p.crop)).filter(Boolean))];
  const farms = [...new Set(paddocks.map((p) => clean(p.farm)).filter(Boolean))];
  return {
    jobNo: nextSprayNo(jobs),
    contractor: clean(prev.contractor), contractorEmail: clean(prev.contractorEmail),
    form: prev.form || form,
    status: 'draft', dateRequired: '',
    tradingName: clean(business.entityName) || clean(business.farmName),
    address: clean(business.address),
    phone: clean(business.phone), fax: '', mobile: clean(business.phone), uhf: '',
    contacts: prev.contacts?.length ? prev.contacts.map((c) => ({ ...c })) : [
      { name: clean(business.contactName), phone: clean(business.phone), uhf: '' },
      { name: '', phone: '', uhf: '' },
    ],
    property: farms.join(', ') || clean(business.farmName),
    crop: crops.join(', '),
    poNumber: '', chemicalSuppliedBy: clean(prev.chemicalSuppliedBy), locatedAt: clean(prev.locatedAt),
    chemicals: [{ name: '', rate: '', unit: 'L' }],
    waterRate: '',
    paddocks: paddocks.map((p) => ({ id: p.id, name: p.name, areaHa: round(p.areaHa), crop: clean(p.crop), farm: clean(p.farm) })),
    otherInstructions: '',
    checklist: Object.fromEntries(CHECKLIST.map((q) => [q.key, ''])),
    neighbours: [0, 1, 2].map(() => ({ name: '', phone: '', contacted: '' })),
    signedBy: clean(business.contactName), useSignature: false,
    today,
  };
}

/** The products actually filled in, each knowing its place in the list (`i`), which is what a paddock's own rate is kept against. */
export const usedChemicals = (job) => (job.chemicals || []).map((c, i) => ({ ...c, i })).filter((c) => clean(c.name));

export const rateText = (c) => (c && Number(c.rate) > 0 ? `${plain(c.rate, 3)} ${c.unit || 'L'}` : '');

/**
 * The rate per hectare for one product on one paddock: the paddock's own rate when it has been given one (a stronger
 * rate on the worse paddock), otherwise the rate set for the product.
 */
export function rateOn(job, paddockId, c) {
  const own = Number(job.rateOverrides?.[paddockId]?.[c.i]);
  return own > 0 ? own : Number(c.rate) || 0;
}

/** The rate as written where there is one for the whole job: "1.2 L", or "1.2 to 1.5 L" when paddocks differ. */
export function rateSummary(job, c) {
  const rates = (job.paddocks || []).map((p) => rateOn(job, p.id, c)).filter((r) => r > 0);
  if (!rates.length) return rateText(c);
  const lo = Math.min(...rates); const hi = Math.max(...rates);
  return lo === hi ? `${plain(lo, 3)} ${c.unit || 'L'}` : `${plain(lo, 3)} to ${plain(hi, 3)} ${c.unit || 'L'}`;
}

/**
 * What a product goes on at, one entry for each different rate: the rate, the hectares it covers and the volume that
 * takes. A product at one rate everywhere is one entry; a stronger rate on a paddock or two makes a second.
 */
export function rateGroups(job, c) {
  const by = new Map();
  for (const p of job.paddocks || []) {
    const rate = rateOn(job, p.id, c);
    if (!(rate > 0)) continue;
    const g = by.get(rate) || { rate, rateText: `${plain(rate, 3)} ${c.unit || 'L'}`, ha: 0, paddocks: 0, qty: 0 };
    g.ha += Number(p.areaHa) || 0; g.paddocks += 1; g.qty += (Number(p.areaHa) || 0) * rate;
    by.set(rate, g);
  }
  return [...by.values()].sort((a, b) => a.rate - b.rate).map((g) => ({ ...g, ha: round(g.ha), amount: amountText(g.qty, c.unit) }));
}

/** An amount in its unit, tidied: 1500 mL is 1.5 L, 2500 g is 2.5 kg. */
export function amountText(qty, unit) {
  let q = Number(qty) || 0; let u = unit || 'L';
  if (u === 'mL' && q >= 1000) { q /= 1000; u = 'L'; }
  if (u === 'g' && q >= 1000) { q /= 1000; u = 'kg'; }
  return `${plain(q, 2)} ${u}`;
}

/**
 * The table of what goes where: a row for each paddock and product, each at its own rate. The water goes on the first
 * row of each paddock (it is the paddock's, not the product's). With no product named yet there is still a row for
 * each paddock.
 */
export function sprayRows(job) {
  const chems = usedChemicals(job);
  const water = Number(job.waterRate) || 0;
  const rows = [];
  (job.paddocks || []).forEach((p, g) => {
    const ha = Number(p.areaHa) || 0;
    if (!chems.length) { rows.push({ g, field: p.name, ha, chemical: '', rate: '', amount: '', spray: water > 0 ? `${plain(ha * water, 0)} L` : '' }); return; }
    chems.forEach((c, n) => {
      const rate = rateOn(job, p.id, c);
      rows.push({
        g, field: p.name, ha, chemical: c.name, rate: rate > 0 ? rateText({ rate, unit: c.unit }) : '',
        amount: rate > 0 ? amountText(ha * rate, c.unit) : '',
        spray: n === 0 && water > 0 ? `${plain(ha * water, 0)} L` : '',
      });
    });
  });
  return rows;
}

/** Hectares, what has to be mixed of each product (each paddock at its own rate), and the water, for the whole request. */
export function sprayTotals(job) {
  const ha = (job.paddocks || []).reduce((s, p) => s + (Number(p.areaHa) || 0), 0);
  return {
    ha: round(ha),
    paddocks: (job.paddocks || []).length,
    chemicals: usedChemicals(job).map((c) => {
      const qty = (job.paddocks || []).reduce((sum, p) => sum + (Number(p.areaHa) || 0) * rateOn(job, p.id, c), 0);
      return { name: c.name, text: qty > 0 ? amountText(qty, c.unit) : '', groups: rateGroups(job, c) };
    }),
    waterL: Number(job.waterRate) > 0 ? round(ha * Number(job.waterRate), 0) : 0,
  };
}

/** What is missing before it can go. */
export function sprayProblems(job) {
  const out = [];
  if (!(job.paddocks || []).length) out.push('Tick the paddocks to be sprayed.');
  if (!usedChemicals(job).length) out.push('Name the product to go on.');
  for (const c of usedChemicals(job)) if ((job.paddocks || []).some((p) => !(rateOn(job, p.id, c) > 0))) out.push(`Give the rate per hectare for ${c.name}.`);
  if (!clean(job.dateRequired)) out.push('Say when you need it done.');
  if (!clean(job.contractor)) out.push('Who is it going to? Enter the contractor.');
  if (job.form === 'aircair' && !clean(job.tradingName)) out.push("Enter your trading name (Aircair's form asks for it).");
  return out;
}

export const sprayTitle = (job) => [clean(job.jobNo), clean(job.contractor), clean(job.property)].filter(Boolean).join(' · ') || 'Spray request';

// ---------------------------------------------------------------------------
// where things are written
// ---------------------------------------------------------------------------

/** Text that must fit a box: the size comes down to `min`, then it is cut with an ellipsis. */
export function fitText(text, maxWidth, size = 9, { bold = false, min = 6.5 } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { text: '', size };
  let s = size;
  while (s > min && textWidth(t, s, bold) > maxWidth) s -= 0.5;
  if (textWidth(t, s, bold) <= maxWidth) return { text: t, size: s };
  let cut = t.length;
  while (cut > 1 && textWidth(`${t.slice(0, cut)}...`, s, bold) > maxWidth) cut -= 1;
  return { text: `${t.slice(0, cut)}...`, size: s };
}

// Aircair's Spray Request Form, from a scan of the two pages. Points from the top left of the page. The lines of
// each box were measured off the scan; `text` is written just above the line of a row, after its printed label.
const A = {
  // page 1
  tradingName: { x: 110, y: 204.5, w: 452 },
  address: [{ x: 94, y: 218.5, w: 468 }, { x: 32, y: 233, w: 530 }, { x: 32, y: 247.5, w: 530 }],
  phoneRow: { y: 262, phone: { x: 72, w: 92 }, fax: { x: 192, w: 96 }, mobile: { x: 336, w: 136 }, uhf: { x: 505, w: 58 } },
  contacts: [{ y: 290.5 }, { y: 305 }], contactCols: { name: { x: 68, w: 152 }, phone: { x: 264, w: 114 }, uhf: { x: 412, w: 150 } },
  property: { x: 80, y: 344.5, w: 198 }, crop: { x: 318, y: 344.5, w: 244 },
  dateRequired: { x: 110, y: 373, w: 166 }, poNumber: { x: 405, y: 373, w: 157 },
  suppliedBy: { x: 144, y: 401.5, w: 208 }, locatedAt: { x: 412, y: 401.5, w: 150 },
  tableLines: [447.3, 467.3, 487, 507, 527, 546.5, 566.5, 586.5, 606.8, 626.8, 646.8, 667, 687],
  cols: { field: [26.5, 151.8], ha: [151.8, 188.8], chemical: [188.8, 355.3], rate: [355.3, 417.3], amount: [417.3, 479.8], spray: [479.8, 565.5] },
  instructions: [{ x: 119, y: 721, w: 441 }, { x: 32, y: 733, w: 530 }, { x: 32, y: 744, w: 530 }],
  // page 2
  yn: { yes: [506.3, 542.3], no: [542.3, 579.3] },
  checkRows: {
    q1: [142, 161.5], q2: [161.5, 181.3], q3: [181.3, 201],
    qI: [266, 285.8], qII: [285.8, 314.8], qIII: [314.8, 334.8], qIV: [334.8, 356.8],
    q4: [456.5, 476.5],
  },
  q4Cols: { yes: [505.3, 542.5], no: [542.5, 582] },
  neighbourRows: [[408.5, 422.8], [422.8, 437.3], [437.3, 451.3]],
  neighbourCols: { name: [16, 162], phone: [168, 241], contacted: [498, 580] },
  signature: { x: 96, y: 761, w: 250, boxH: 34 },
  signedName: { x: 72, y: 797, w: 280 },
  date: { y: 761, day: 410, month: 456, year: 508 },
};
export const AIRCAIR_LAYOUT = A;
export const AIRCAIR_ROWS = A.tableLines.length - 1;

/**
 * What to write on Aircair's two pages: { pages: [ops, ops], overflow }. An op is
 * { t: 'text', x, y, text, size, bold } with y the baseline, or { t: 'cross', cx, cy } for a ticked Y or N box.
 * `overflow` is how many rows did not fit on the form's table (they are all on the attached sheet).
 */
export function aircairOps(job) {
  const p1 = []; const p2 = [];
  const put = (list, box, text, { size = 9, bold = false } = {}) => {
    const f = fitText(text, box.w, size, { bold });
    if (f.text) list.push({ t: 'text', x: box.x, y: box.y, text: f.text, size: f.size, bold });
  };
  put(p1, A.tradingName, job.tradingName);
  const addr = wrapText(clean(job.address).replace(/\s*[\r\n]+\s*/g, ', '), A.address[0].w, 9);
  const first = addr.shift() || '';
  put(p1, A.address[0], first);
  // the rest of the address runs on to the two blank lines below
  const rest = wrapText(addr.join(' '), A.address[1].w, 9);
  rest.slice(0, 2).forEach((line, i) => put(p1, A.address[i + 1], line));
  const pr = A.phoneRow;
  put(p1, { x: pr.phone.x, y: pr.y, w: pr.phone.w }, job.phone);
  put(p1, { x: pr.fax.x, y: pr.y, w: pr.fax.w }, job.fax);
  put(p1, { x: pr.mobile.x, y: pr.y, w: pr.mobile.w }, job.mobile);
  put(p1, { x: pr.uhf.x, y: pr.y, w: pr.uhf.w }, job.uhf);
  (job.contacts || []).slice(0, 2).forEach((c, i) => {
    const y = A.contacts[i].y;
    put(p1, { ...A.contactCols.name, y }, c.name);
    put(p1, { ...A.contactCols.phone, y }, c.phone);
    put(p1, { ...A.contactCols.uhf, y }, c.uhf);
  });
  put(p1, A.property, job.property);
  put(p1, A.crop, job.crop);
  put(p1, A.dateRequired, dmy(job.dateRequired) || job.dateRequired);
  put(p1, A.poNumber, job.poNumber);
  put(p1, A.suppliedBy, job.chemicalSuppliedBy);
  put(p1, A.locatedAt, job.locatedAt);

  // the table: a row for each paddock and product, the last row pointing to the attached list if they do not all fit
  const rows = sprayRows(job);
  const cap = AIRCAIR_ROWS;
  const overflow = Math.max(0, rows.length - cap);
  const shown = overflow ? rows.slice(0, cap - 1) : rows;
  const cell = (key, i, text, opts) => {
    const [x0, x1] = A.cols[key];
    put(p1, { x: x0 + 3, y: A.tableLines[i] + 13.5, w: x1 - x0 - 6 }, text, opts);
  };
  // every other paddock gets a light band across its rows (a paddock with two products has two rows in one band)
  shown.forEach((r, i) => {
    if (r.g % 2) p1.unshift({ t: 'band', x0: A.cols.field[0], x1: A.cols.spray[1], y0: A.tableLines[i] + 0.8, y1: A.tableLines[i + 1] - 0.8 });
  });
  shown.forEach((r, i) => {
    cell('field', i, r.field); cell('ha', i, r.ha ? plain(r.ha, 1) : ''); cell('chemical', i, r.chemical);
    cell('rate', i, r.rate); cell('amount', i, r.amount); cell('spray', i, r.spray);
  });
  if (overflow) cell('field', cap - 1, `+ ${overflow + 1} more: see attached list`, { size: 8 });

  // the first line sits beside the printed label, the next two run across the full width
  const note = clean(job.otherInstructions).replace(/\s+/g, ' ');
  if (note) {
    const first = wrapText(note, A.instructions[0].w, 8.5)[0];
    put(p1, A.instructions[0], first, { size: 8.5 });
    wrapText(note.slice(first.length).trim(), A.instructions[1].w, 8.5).filter(Boolean).slice(0, 2)
      .forEach((line, i) => put(p1, A.instructions[i + 1], line, { size: 8.5 }));
  }

  // page 2: the checklist
  const cross = (xs, ys) => p2.push({ t: 'cross', cx: (xs[0] + xs[1]) / 2, cy: (ys[0] + ys[1]) / 2 });
  for (const q of CHECKLIST) {
    const a = (job.checklist || {})[q.key];
    if (a !== 'yes' && a !== 'no') continue;
    const ys = A.checkRows[q.key];
    const xs = q.key === 'q4' ? A.q4Cols : A.yn;
    cross(a === 'yes' ? xs.yes : xs.no, ys);
  }
  (job.neighbours || []).slice(0, 3).forEach((n, i) => {
    if (!clean(n.name) && !clean(n.phone)) return;
    const y = A.neighbourRows[i][1] - 4;
    put(p2, { x: A.neighbourCols.name[0] + 3, y, w: A.neighbourCols.name[1] - A.neighbourCols.name[0] - 6 }, n.name);
    put(p2, { x: A.neighbourCols.phone[0] + 3, y, w: A.neighbourCols.phone[1] - A.neighbourCols.phone[0] - 6 }, n.phone);
    if (n.contacted === 'yes') put(p2, { x: A.neighbourCols.contacted[0] + 3, y, w: 70 }, 'Yes');
  });
  put(p2, A.signedName, job.signedBy);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(job.signedDate || job.today));
  if (d && (job.useSignature || clean(job.signedBy))) {
    put(p2, { x: A.date.day, y: A.date.y, w: 28 }, d[3]);
    put(p2, { x: A.date.month, y: A.date.y, w: 28 }, d[2]);
    put(p2, { x: A.date.year, y: A.date.y, w: 40 }, d[1]);
  }
  return { pages: [p1, p2], overflow };
}

// ---------------------------------------------------------------------------
// our own form
// ---------------------------------------------------------------------------

export const A4 = { w: 595.28, h: 841.89 };

/**
 * Our own request form as drawing ops, one page: who it is from and to, the job, the products, the paddock table
 * (as many rows as fit; the full list is on the map page), and the instructions. Returns { ops, rowsShown }.
 * Ops: text {t,x,y,text,size,bold,align}, line {t:'line',x1,y1,x2,y2}, rect {t:'rect',x,y,w,h,fill,stroke}.
 */
export function standardOps(job) {
  const ops = []; const M = 40;
  const text = (x, y, s, o = {}) => { if (clean(s) || s === 0) ops.push({ t: 'text', x, y, text: String(s), size: o.size || 10, bold: !!o.bold, align: o.align || 'left', gray: o.gray ?? 0 }); };
  const line = (x1, y1, x2, y2) => ops.push({ t: 'line', x1, y1, x2, y2 });
  const tot = sprayTotals(job);

  text(M, 58, 'SPRAY REQUEST', { size: 20, bold: true });
  text(A4.w - M, 46, clean(job.jobNo), { size: 11, bold: true, align: 'right' });
  text(A4.w - M, 62, `Date required: ${dmy(job.dateRequired) || '-'}`, { size: 10, align: 'right' });
  line(M, 72, A4.w - M, 72);

  let y = 92;
  const block = (label, lines) => {
    text(M, y, label, { size: 8, bold: true, gray: 0.35 });
    y += 12;
    for (const l of lines.filter((x) => clean(x))) { text(M, y, l, { size: 10 }); y += 13; }
    return y;
  };
  const col2 = 310;
  // two columns: from and to
  const fromTop = y;
  block('FROM', [job.tradingName, ...wrapText(clean(job.address).replace(/\s*[\r\n]+\s*/g, ', '), 250, 10), [job.phone && `Phone ${job.phone}`, job.mobile && job.mobile !== job.phone && `Mobile ${job.mobile}`].filter(Boolean).join('   ')]);
  const afterFrom = y; y = fromTop;
  ops.push({ t: 'text', x: col2, y, text: 'TO', size: 8, bold: true, align: 'left', gray: 0.35 }); y += 12;
  for (const l of [job.contractor, job.contractorEmail].filter(clean)) { text(col2, y, l, { size: 10 }); y += 13; }
  y = Math.max(afterFrom, y) + 4;
  const contactLines = (job.contacts || []).filter((c) => clean(c.name)).map((c) => [c.name, c.phone && `Phone ${c.phone}`, c.uhf && `UHF ${c.uhf}`].filter(Boolean).join('   '));
  if (contactLines.length) y = block('CONTACTS', contactLines) + 2;

  line(M, y, A4.w - M, y); y += 16;
  const kv = (k, v, x, yy) => { text(x, yy, k, { size: 8, bold: true, gray: 0.35 }); text(x, yy + 12, clean(v) || '-', { size: 10 }); };
  kv('PROPERTY', job.property, M, y); kv('CROP', job.crop, col2, y); y += 32;
  kv('PURCHASE ORDER', job.poNumber, M, y); kv('CHEMICAL SUPPLIED BY', [job.chemicalSuppliedBy, job.locatedAt && `at ${job.locatedAt}`].filter(clean).join(' '), col2, y); y += 32;

  // products
  text(M, y, 'PRODUCTS', { size: 8, bold: true, gray: 0.35 }); y += 13;
  // one block for each product, every other one tinted; a product at two rates has a line for each rate and its name once
  usedChemicals(job).forEach((c, n) => {
    const groups = tot.chemicals.find((x) => x.name === c.name)?.groups || [];
    const lines = Math.max(1, groups.length);
    if (n % 2) ops.push({ t: 'rect', x: M, y: y - 11, w: A4.w - 2 * M, h: lines * 14 + 1, tint: [0.86, 0.93, 0.86] });
    text(M + 3, y, c.name, { size: 10, bold: true });
    if (!groups.length) text(col2, y, 'rate not set', { size: 10 });
    groups.forEach((g, i) => {
      text(col2, y + i * 14, `${g.rateText} per ha`, { size: 10 });
      text(col2 + 80, y + i * 14, `${plain(g.ha, 1)} ha   =   ${g.amount}`, { size: 10 });
    });
    y += lines * 14 + 4;
  });
  if (Number(job.waterRate) > 0) { text(M, y, 'Water', { size: 10, bold: true }); text(col2, y, `${plain(job.waterRate, 1)} L per ha   =   ${plain(tot.waterL, 0)} L in all`, { size: 10 }); y += 14; }
  y += 8;

  // the paddock table
  const cols = [[M, 'Field'], [M + 120, 'Ha'], [M + 160, 'Chemical'], [M + 330, 'Rate/ha'], [M + 395, 'Amount'], [M + 460, 'Spray vol']];
  ops.push({ t: 'rect', x: M, y: y - 11, w: A4.w - 2 * M, h: 16, fill: 0.93 });
  cols.forEach(([x, l]) => text(x + 3, y, l, { size: 9, bold: true }));
  y += 14;
  const rows = sprayRows(job);
  const bottom = 735;
  let shown = 0;
  for (const r of rows) {
    if (y > bottom) break;
    if (r.g % 2) ops.push({ t: 'rect', x: M, y: y - 10.5, w: A4.w - 2 * M, h: 14.5, tint: [0.86, 0.93, 0.86] });
    text(cols[0][0] + 3, y, fitText(r.field, 112).text, { size: 9 });
    text(cols[1][0] + 3, y, r.ha ? plain(r.ha, 1) : '', { size: 9 });
    text(cols[2][0] + 3, y, fitText(r.chemical, 162).text, { size: 9 });
    text(cols[3][0] + 3, y, r.rate, { size: 9 }); text(cols[4][0] + 3, y, r.amount, { size: 9 }); text(cols[5][0] + 3, y, r.spray, { size: 9 });
    line(M, y + 4, A4.w - M, y + 4);
    y += 15; shown += 1;
  }
  if (shown < rows.length) { text(M + 3, y, `+ ${rows.length - shown} more rows: see the attached list`, { size: 9, gray: 0.35 }); y += 15; }
  text(cols[0][0] + 3, y, 'Total', { size: 9, bold: true });
  text(cols[1][0] + 3, y, plain(tot.ha, 1), { size: 9, bold: true });
  y += 22;

  if (clean(job.otherInstructions) && y < 770) {
    text(M, y, 'OTHER INSTRUCTIONS', { size: 8, bold: true, gray: 0.35 }); y += 12;
    for (const l of wrapText(job.otherInstructions, A4.w - 2 * M, 10).slice(0, Math.max(1, Math.floor((800 - y) / 13)))) { text(M, y, l, { size: 10 }); y += 13; }
  }
  return { ops, rowsShown: shown };
}

// ---------------------------------------------------------------------------
// the map page
// ---------------------------------------------------------------------------

/** The nearest round length, in metres, that is no longer than `maxM`. */
export function niceLength(maxM) {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  let best = steps[0];
  for (const s of steps) if (s <= maxM) best = s;
  return best;
}

/**
 * The map for the request: the paddocks to spray, marked, with the farm's other paddocks around them for context.
 * `items` are mapLayout() items (metres, north up). The picture is fitted to the paddocks chosen with room around
 * them. `box` is where it goes on the page, in points from the top left.
 * Returns the scale (points per metre), the view origin (metres), what to draw and where north and the scale bar go.
 */
// `view` ({x, y, w, h} in metres) fits the picture to exactly that area instead (the farm map, as zoomed on screen).
export function sprayMapPlan({ items, selectedIds, box, margin = 0.3, minSpanM = 1400, named = false, view = null }) {
  const sel = new Set(selectedIds);
  const chosen = items.filter((i) => sel.has(i.id));
  const use = chosen.length ? chosen : items;
  const b = view ? [view.x, view.y, view.x + view.w, view.y + view.h] : [Infinity, Infinity, -Infinity, -Infinity];
  if (!view) for (const i of use) { b[0] = Math.min(b[0], i.bbox[0]); b[1] = Math.min(b[1], i.bbox[1]); b[2] = Math.max(b[2], i.bbox[2]); b[3] = Math.max(b[3], i.bbox[3]); }
  const spanW = view ? b[2] - b[0] : Math.max((b[2] - b[0]) * (1 + 2 * margin), minSpanM);
  const spanH = view ? b[3] - b[1] : Math.max((b[3] - b[1]) * (1 + 2 * margin), minSpanM * (box.h / box.w));
  const s = Math.min(box.w / spanW, box.h / spanH);
  const cx = (b[0] + b[2]) / 2; const cy = (b[1] + b[3]) / 2;
  const vx0 = cx - box.w / (2 * s); const vy0 = cy - box.h / (2 * s);
  const vx1 = vx0 + box.w / s; const vy1 = vy0 + box.h / s;
  const inView = (i) => i.bbox[2] >= vx0 && i.bbox[0] <= vx1 && i.bbox[3] >= vy0 && i.bbox[1] <= vy1;
  const draw = items.filter(inView).map((i) => ({ id: i.id, d: i.d, color: i.color, selected: sel.has(i.id) }));
  const labels = items.filter(inView).map((i) => {
    const chosen = sel.has(i.id);
    const selected = chosen || named;
    const wPt = (i.bbox[2] - i.bbox[0]) * s; const hPt = (i.bbox[3] - i.bbox[1]) * s;
    const X = box.x + (i.cx - vx0) * s; const Y = box.y + (i.cy - vy0) * s;
    const inside = X > box.x + 4 && X < box.x + box.w - 4 && Y > box.y + 4 && Y < box.y + box.h - 4;
    // a name is written as large as its paddock allows; the paddocks to spray are always named, the others only
    // when the smallest writing fits inside them
    const fit = labelFontPx(wPt, hPt, Math.max(String(i.name).length, 8), 2, { min: 4.5, max: 10 });
    const size = chosen ? Math.min(9.5, Math.max(fit, 7)) : Math.min(fit, named ? 10 : 7.5);
    return { id: i.id, name: i.name, areaHa: i.areaHa, x: X, y: Y, selected, size, show: inside && (chosen || fit > 0) };
  }).filter((l) => l.show);
  const barM = niceLength((box.w * 0.32) / s);
  return {
    s, vx0, vy0, draw, labels,
    north: { x: box.x + box.w - 22, y: box.y + 34, len: 26 },
    scaleBar: { metres: barM, widthPt: barM * s, label: barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, x: box.x + 10, y: box.y + box.h - 12 },
  };
}

/** What the map page says above the map and in the table under it. */
export function mapPageText(job) {
  const tot = sprayTotals(job);
  return {
    title: 'SPRAY MAP',
    lines: [
      [job.jobNo, job.contractor && `to ${job.contractor}`, job.dateRequired && `needed ${dmy(job.dateRequired)}`].filter(clean).join('   '),
      [job.property && `Property: ${job.property}`, job.crop && `Crop: ${job.crop}`].filter(clean).join('   '),
      [...usedChemicals(job).map((c) => `${c.name} ${rateSummary(job, c)}/ha`), Number(job.waterRate) > 0 && `water ${plain(job.waterRate, 1)} L/ha`].filter(Boolean).join('   +   '),
    ].filter(clean),
    total: `${tot.paddocks} paddock${tot.paddocks === 1 ? '' : 's'}, ${plain(tot.ha, 1)} ha`,
  };
}
