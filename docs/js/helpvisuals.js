// The pictures in the how-to guide: small diagrams drawn as SVG, in the app's own colours so they follow light and dark.
//
// Pure: each function returns an <svg> string. The figures are illustrations of how a part of the app works, with made-up
// numbers, not live data. The wording they carry is checked by tests/help.test.mjs along with the rest of the guide.

import { TABS_BY_ROLE } from './nav.js?v=325';

const W = 340;
const C = {
  green: 'var(--accent-summary)', blue: 'var(--accent-report)', amber: 'var(--accent-input)',
  ink: 'var(--text)', dim: 'var(--text-dim)', line: 'var(--border)', card: 'var(--surface)', bg: 'var(--bg)',
  red: '#d8362b', purple: '#8e44ad', teal: '#16807a',
};
const TAB_LABEL = { position: 'Position', production: 'Production', sales: 'Sales', movement: 'Movement', storage: 'Storage', reports: 'Reports' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (n) => Math.round(n * 10) / 10;

const svg = (h, label, body) => `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}" style="width:100%;height:auto;display:block;font-family:inherit">${body}</svg>`;
const rect = (x, y, w, h, { fill = C.card, stroke = C.line, r = 8, sw = 1 } = {}) => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const text = (x, y, s, { size = 11, bold = false, anchor = 'middle', fill = C.ink } = {}) => `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${bold ? 'font-weight="700"' : ''} text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, { stroke = C.dim, sw = 1.5, dash = '' } = {}) => `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${stroke}" stroke-width="${sw}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
const arrow = (x1, y, x2, { stroke = C.green } = {}) => `${line(x1, y, x2 - 3, y, { stroke, sw: 2 })}<path d="M${f1(x2 - 8)} ${f1(y - 5)} L${f1(x2)} ${f1(y)} L${f1(x2 - 8)} ${f1(y + 5)}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (x, y, r, fill, stroke = 'none') => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${fill}" stroke="${stroke}"/>`;

/** A row of labelled boxes joined by arrows. `nodes` are [title, subtitle]; `arrows` are the small words over each arrow. */
export function flowSvg(nodes, { arrows = [], label = 'How it fits together', accent = C.green } = {}) {
  const n = nodes.length;
  const pad = 6; const gap = n >= 5 ? 18 : 26;
  const tSize = n >= 5 ? 10.5 : 11.5; const sSize = n >= 5 ? 8.5 : 9.5;
  const w = (W - 2 * pad - (n - 1) * gap) / n;
  const h = 58; const y = arrows.some(Boolean) ? 24 : 8;
  let body = '';
  nodes.forEach(([title, sub], i) => {
    const x = pad + i * (w + gap);
    body += rect(x, y, w, h, { fill: C.card, stroke: accent, sw: 1.5 });
    body += text(x + w / 2, y + 25, title, { size: tSize, bold: true });
    if (sub) body += text(x + w / 2, y + 42, sub, { size: sSize, fill: C.dim });
    if (i < n - 1) {
      body += arrow(x + w + 3, y + h / 2, x + w + gap - 2, { stroke: accent });
      if (arrows[i]) body += text(x + w + gap / 2, y + h / 2 - 8, arrows[i], { size: 8.5, fill: C.dim });
    }
  });
  return svg(y + h + 10, label, body);
}

/** The tab bar a role sees at the foot of the screen. */
function barBody(role, x, y, w) {
  const tabs = TABS_BY_ROLE[role] || [];
  const cell = w / Math.max(tabs.length, 1);
  let b = rect(x, y, w, 30, { fill: C.card, stroke: C.line, r: 9 });
  tabs.forEach((t, i) => {
    const cx = x + cell * i + cell / 2;
    b += dot(cx, y + 11, 3.2, i === 0 ? C.green : C.dim);
    b += text(cx, y + 24, TAB_LABEL[t] || t, { size: Math.min(8.5, cell / 6.2), fill: i === 0 ? C.green : C.dim, bold: i === 0 });
  });
  return b;
}

/** What each login sees at the foot of the screen: the tabs, and where it opens (the first, in green). */
export function rolesSvg() {
  const rows = [['owner', 'Owner'], ['manager', 'Manager'], ['bookkeeper', 'Book-keeper'], ['farm_worker', 'Worker'], ['driver', 'Driver']];
  const rh = 38;
  let b = '';
  rows.forEach(([role, name], i) => {
    const y = i * rh + 4;
    b += text(4, y + 19, name, { size: 11, bold: true, anchor: 'start' });
    b += barBody(role, 84, y, W - 88);
  });
  return svg(rows.length * rh + 6, 'The tabs each kind of login sees along the bottom of the screen', b);
}

/** One role's bar, on its own. */
export function tabsSvg(role) {
  return svg(38, 'The tabs along the bottom of your screen', barBody(role, 4, 4, W - 8));
}

/** A truck between where the grain came from and where it went, with its weights. */
function loadSvg() {
  let b = rect(4, 18, 82, 56, { stroke: C.green, sw: 1.5 }) + text(45, 40, 'From', { size: 9.5, fill: C.dim }) + text(45, 58, 'Paddock or silo', { size: 10.5, bold: true });
  b += rect(254, 18, 82, 56, { stroke: C.green, sw: 1.5 }) + text(295, 40, 'Going to', { size: 9.5, fill: C.dim }) + text(295, 58, 'Silo or contract', { size: 10.5, bold: true });
  // the truck
  b += rect(112, 28, 58, 28, { fill: C.green, stroke: C.green, r: 3 });
  b += `<path d="M172 36 h18 l10 10 v10 h-28z" fill="${C.green}" stroke="${C.green}" stroke-linejoin="round"/>`;
  b += dot(128, 60, 6, C.ink) + dot(128, 60, 2.5, C.bg) + dot(186, 60, 6, C.ink) + dot(186, 60, 2.5, C.bg);
  b += arrow(88, 46, 108) + arrow(204, 46, 250);
  // the weights
  const col = (x, name, val, fill) => rect(x, 88, 98, 36, { fill: fill || C.card, stroke: fill ? C.green : C.line }) + text(x + 49, 102, name, { size: 8.5, fill: fill ? '#fff' : C.dim, bold: true }) + text(x + 49, 118, val, { size: 12, bold: true, fill: fill ? '#fff' : C.ink });
  b += col(4, 'GROSS', '45.0 t') + col(121, 'TARE', '15.0 t') + col(238, 'NET', '30.0 t', C.green);
  return svg(132, 'A load: from a paddock or silo, by truck, to a silo or contract, with its gross, tare and net weights', b);
}

/** A load ticket as it comes out as a PDF. */
function ticketSvg() {
  let b = rect(70, 4, 200, 128, { fill: C.card, stroke: C.line, r: 6 });
  b += `<path d="M70 10 a6 6 0 0 1 6 -6 h188 a6 6 0 0 1 6 6 v34 h-200z" fill="${C.green}"/>`;
  b += text(82, 24, 'LOAD TICKET', { size: 11, bold: true, anchor: 'start', fill: '#fff' });
  b += text(82, 38, 'Trading name  ·  NGR', { size: 8, anchor: 'start', fill: '#fff' });
  b += text(258, 33, '#1038', { size: 16, bold: true, anchor: 'end', fill: '#fff' });
  [[80, 'DATE'], [128, 'TRUCK'], [176, 'GRADE'], [224, 'NET']].forEach(([x, l], i) => {
    b += rect(x - 4, 52, 44, 24, { fill: C.bg, stroke: 'none', r: 3 }) + text(x + 18, 62, l, { size: 6.5, fill: C.dim, bold: true });
    b += rect(x + 4, 66, 28, 3, { fill: i === 3 ? C.green : C.line, stroke: 'none', r: 1 });
  });
  b += rect(76, 84, 188, 20, { fill: C.bg, stroke: 'none', r: 3 }) + text(84, 97, 'FROM  Silo A   →   GOING TO  Contract', { size: 8.5, anchor: 'start' });
  b += rect(76, 110, 188, 16, { fill: 'none', stroke: C.line, r: 3 }) + line(82, 120, 258, 120, { stroke: C.line, sw: 0.6 });
  // the ticks that decide what is printed
  const tick = (y, l) => rect(4, y, 10, 10, { fill: C.green, stroke: C.green, r: 2 }) + `<path d="M6.5 ${y + 5.2} l2 2 l3.4 -4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` + text(19, y + 8.5, l, { size: 8.5, anchor: 'start' });
  b += tick(34, 'Origin') + tick(52, 'Tonnes') + tick(70, 'Destination') + tick(88, 'Comments') + tick(106, 'Quality');
  b += rect(280, 52, 56, 22, { fill: 'none', stroke: C.green, r: 11 }) + text(308, 67, 'PDF', { size: 10, bold: true, fill: C.green });
  return svg(138, 'A load ticket PDF with the ticks that choose what is printed', b);
}

/** Area times yield makes tonnes. */
function paddockSvg() {
  const box = (x, w, big, small, fill) => rect(x, 10, w, 56, { fill: fill || C.card, stroke: fill ? C.green : C.line, sw: fill ? 1.5 : 1 }) + text(x + w / 2, 36, big, { size: 15, bold: true, fill: fill ? '#fff' : C.ink }) + text(x + w / 2, 54, small, { size: 9.5, fill: fill ? '#fff' : C.dim });
  const b = box(4, 92, '210', 'hectares') + text(110, 44, '×', { size: 18, fill: C.dim })
    + box(126, 92, '4.1', 'tonnes per ha') + text(232, 44, '=', { size: 18, fill: C.dim })
    + box(246, 90, '861 t', 'produced', C.green);
  return svg(76, 'A paddock\'s area times its yield per hectare is the tonnes it produced', b);
}

/** Paddocks on the farm map, coloured by crop. */
function mapSvg() {
  const P = (pts, fill, name, lx, ly) => `<polygon points="${pts}" fill="${fill}" fill-opacity="0.6" stroke="${C.ink}" stroke-opacity="0.55" stroke-width="1"/>${text(lx, ly, name, { size: 9.5, bold: true })}`;
  let b = P('6,8 108,6 112,70 4,72', C.green, 'Boundary', 58, 44);
  b += P('120,6 214,8 216,70 118,70', C.amber, 'River Block', 168, 44);
  b += P('6,82 90,80 92,140 4,142', C.purple, 'Homestead', 48, 114);
  b += P('100,80 214,82 216,142 100,140', C.green, 'Long Paddock', 158, 114);
  b += `<text x="226" y="22" font-size="9.5" font-weight="700" fill="${C.ink}">Home Farm</text>`;
  [[C.green, 'Wheat'], [C.amber, 'Barley'], [C.purple, 'Canola']].forEach(([c, l], i) => {
    b += rect(226, 36 + i * 20, 11, 11, { fill: c, stroke: 'none', r: 3 }) + text(243, 45 + i * 20, l, { size: 10, anchor: 'start' });
  });
  b += text(226, 112, 'Outlines come from', { size: 8.5, anchor: 'start', fill: C.dim }) + text(226, 124, 'a shapefile', { size: 8.5, anchor: 'start', fill: C.dim });
  return svg(150, 'The farm map: paddock outlines coloured by their crop', b);
}

/** A silo with grain in it. */
function siloSvg() {
  let b = `<path d="M30 36 a40 14 0 0 1 80 0 v70 h-80z" fill="${C.card}" stroke="${C.line}" stroke-width="1.5"/>`;
  b += `<path d="M30 70 h80 v36 h-80z" fill="${C.amber}" fill-opacity="0.65"/>` + `<path d="M30 70 q40 -16 80 0" fill="${C.amber}" fill-opacity="0.65"/>`;
  b += line(30, 106, 110, 106, { stroke: C.line });
  b += line(126, 70, 126, 106, { stroke: C.dim, sw: 1, dash: '3 3' }) + text(134, 92, 'height', { size: 9.5, anchor: 'start', fill: C.dim });
  b += text(70, 126, 'Silo A', { size: 10, bold: true });
  b += rect(190, 22, 146, 24, { fill: C.card, stroke: C.line }) + text(200, 38, 'Radius and cone angle', { size: 9.5, anchor: 'start' });
  b += rect(190, 52, 146, 24, { fill: C.card, stroke: C.line }) + text(200, 68, 'Height of the grain', { size: 9.5, anchor: 'start' });
  b += rect(190, 82, 146, 24, { fill: C.green, stroke: C.green }) + text(200, 98, 'Tonnes worked out', { size: 9.5, anchor: 'start', bold: true, fill: '#fff' });
  b += arrow(168, 64, 186);
  return svg(132, 'A silo: its shape and the height of the grain give the tonnes', b);
}

/** A contract, part delivered. */
function contractSvg() {
  let b = text(4, 14, 'Contract  400 t', { size: 11, bold: true, anchor: 'start' }) + text(336, 14, '+/- 20 t', { size: 9.5, anchor: 'end', fill: C.dim });
  b += rect(4, 22, 332, 22, { fill: C.bg, stroke: C.line, r: 6 }) + `<rect x="4" y="22" width="215" height="22" rx="6" fill="${C.green}"/>`;
  b += text(14, 37, 'Delivered 260 t', { size: 10, anchor: 'start', bold: true, fill: '#fff' }) + text(326, 37, '140 t to go', { size: 10, anchor: 'end', fill: C.dim });
  [['Loads you record', 'count as delivered'], ['Confirmation', 'printable, to sign'], ['Invoice', 'from the loads']].forEach(([t, s], i) => {
    const x = 4 + i * 114;
    b += rect(x, 58, 104, 40, { fill: C.card, stroke: C.line }) + text(x + 52, 75, t, { size: 10, bold: true }) + text(x + 52, 89, s, { size: 8.5, fill: C.dim });
  });
  return svg(106, 'A contract with 260 of 400 tonnes delivered, and what comes from it', b);
}

/** Our invoice against the buyer's RCTI. */
function invoiceSvg() {
  const card = (x, title, amount, accent) => rect(x, 6, 122, 58, { stroke: accent, sw: 1.5 }) + text(x + 61, 24, title, { size: 9.5, fill: C.dim, bold: true }) + text(x + 61, 48, amount, { size: 14, bold: true });
  let b = card(4, 'OUR INVOICE', '$58,653.30', C.green) + card(214, 'BUYER\'S RCTI', '$58,533.80', C.blue);
  b += text(170, 40, 'vs', { size: 11, fill: C.dim });
  b += rect(70, 74, 200, 24, { fill: 'none', stroke: C.red, r: 12, sw: 1.5 }) + text(170, 90, 'RCTI is less by $119.50', { size: 11, bold: true, fill: C.red });
  b += text(170, 114, 'Matching totals show “Agrees” instead', { size: 9, fill: C.dim });
  return svg(122, 'An invoice set beside the buyer\'s RCTI, with the difference shown', b);
}

/** A new season: what goes across and what starts empty. */
function seasonSvg() {
  const col = (x, title, lines, accent) => rect(x, 6, 140, 104, { stroke: accent, sw: 1.5 }) + text(x + 70, 26, title, { size: 12, bold: true }) + lines.map((l, i) => text(x + 70, 48 + i * 17, l, { size: 9.5, fill: C.dim })).join('');
  let b = col(4, '2026', ['Paddocks and outlines', 'Silos and bunkers', 'Commodities', 'Contracts and loads'], C.dim);
  b += col(196, '2027', ['Paddocks and outlines', 'Silos and bunkers', 'Commodities', 'Contracts and loads'], C.green);
  b += arrow(150, 58, 190) + text(170, 50, 'carries', { size: 8.5, fill: C.dim });
  b += `<rect x="204" y="86" width="124" height="16" rx="4" fill="${C.bg}"/>` + text(266, 98, 'start empty', { size: 8.5, fill: C.dim });
  return svg(118, 'Starting a new season: paddocks, silos and commodities carry over, and contracts and loads start empty', b);
}

/** Working without signal. */
function offlineSvg() {
  const pill = (x, y, name, dotFill, ring) => rect(x, y, 112, 28, { fill: C.card, stroke: C.line, r: 14 }) + text(x + 44, y + 18, name, { size: 10, bold: true }) + dot(x + 92, y + 14, 5, dotFill, ring);
  let b = text(70, 14, 'No signal', { size: 10, bold: true, fill: C.dim }) + pill(14, 22, 'Sample 2026', C.amber) + text(70, 70, 'Saved on the phone', { size: 9.5, fill: C.dim });
  b += arrow(142, 36, 188);
  b += text(270, 14, 'Back in range', { size: 10, bold: true, fill: C.dim }) + pill(214, 22, 'Sample 2026', C.card, C.dim) + text(270, 70, 'Sent to the server', { size: 9.5, fill: C.dim });
  return svg(80, 'Without signal the dot beside the season is amber and changes wait on the phone; back in range they are sent and the dot is white', b);
}

/** The people on a farm and what they are given. */
function peopleSvg() {
  let b = rect(4, 6, 110, 52, { stroke: C.green, sw: 1.5 }) + text(59, 26, 'Owner', { size: 11, bold: true }) + text(59, 44, 'sends the invitation', { size: 8.5, fill: C.dim });
  b += arrow(118, 32, 150) + text(134, 24, 'link', { size: 8.5, fill: C.dim });
  b += rect(154, 6, 182, 52, { fill: C.card, stroke: C.line }) + text(245, 24, 'They choose nothing: you do', { size: 9.5, fill: C.dim });
  b += text(245, 44, 'Manager · Book-keeper · Worker · Driver', { size: 9.5, bold: true });
  return svg(66, 'An owner sends an invitation link and chooses what the person can do', b);
}

const FIGURES = {
  start: () => flowSvg([['Paddock', 'Production'], ['Silo', 'Storage'], ['Contract', 'Sales'], ['Invoice', 'Sales'], ['Paid', 'money in']], { arrows: ['load', 'load', '', ''], label: 'How it fits together: grain goes from a paddock to a silo to a contract, then is invoiced and paid' }),
  load: loadSvg,
  ticket: ticketSvg,
  paddocks: paddockSvg,
  map: mapSvg,
  storage: siloSvg,
  contracts: contractSvg,
  invoices: invoiceSvg,
  orders: () => flowSvg([['Order', 'from the buyer'], ['Delivery', 'loads to go'], ['Invoice', 'then paid']], { arrows: ['', ''], accent: C.blue, label: 'An order becomes deliveries, then an invoice' }),
  spray: () => flowSvg([['Tick paddocks', 'on the map'], ['Fill the form', 'product, rate'], ['Send the PDF', 'with the map']], { arrows: ['', ''], accent: C.green, label: 'Spray request: tick the paddocks, fill the form, send the PDF' }),
  inputs: () => flowSvg([['Buy', 'adds stock'], ['Use', 'takes it off'], ['Count', 'corrects it']], { arrows: ['', ''], accent: C.amber, label: 'Stock goes up with purchases, down with use, and a count corrects it' }),
  attention: () => flowSvg([['Position', 'top of the page'], ['Tap a line', 'opens the screen'], ['Fix it', 'the line goes']], { arrows: ['', ''], accent: C.red, label: 'Needs attention: a list on Position, tap a line to deal with it' }),
  signing: () => flowSvg([['Draw it once', 'My signature'], ['Tick sign', 'on the document'], ['Print or send', 'signed']], { arrows: ['', ''], accent: C.green, label: 'Draw your signature once, tick sign on a document, print or send it' }),
  safety: () => flowSvg([['Export backup', 'a file'], ['Keep it', 'off the phone'], ['Import', 'if needed']], { arrows: ['', ''], accent: C.blue, label: 'Export a backup, keep it somewhere else, import it if needed' }),
  help: () => flowSvg([['Report', 'what went wrong'], ['Support', 'if you allow it'], ['Fixed', 'a new build']], { arrows: ['', ''], accent: C.amber, label: 'Report a problem; the owner can let support look, read only' }),
  install: () => flowSvg([['Share or menu', 'in Safari or Chrome'], ['Add to Home Screen', 'tap Add'], ['Open the icon', 'full screen']], { arrows: ['', ''], accent: C.green, label: 'Open Commodity Mate in the browser, add it to the home screen, then open it from its icon' }),
  season: seasonSvg,
  people: peopleSvg,
  offline: offlineSvg,
};

/** The picture for a guide, or an empty string where it has none. */
export function figureFor(id) {
  return FIGURES[id] ? FIGURES[id]() : '';
}

export const FIGURE_IDS = Object.keys(FIGURES);
