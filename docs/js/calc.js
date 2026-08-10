// Silo / bunker grain volume math — ported from the "Silo Bunker Calc" tab.

const D2R = Math.PI / 180;

/**
 * Cylindrical silo with an optional cone hopper bottom and a peaked / flat / declined
 * grain surface on top (surface shape follows the commodity's angle of repose).
 * @param {object} p
 * @param {number} p.radius meters
 * @param {number} p.height barrel (cylinder) grain height, meters
 * @param {number} [p.coneAngle] hopper cone half-angle, degrees (0 = flat bottom)
 * @param {number} p.angleOfRepose commodity angle of repose, degrees
 * @param {number} p.testWeight tonnes / m3
 * @param {'peak'|'flat'|'decline'} p.fillState
 */
export function siloResult({ radius, height, coneAngle = 0, angleOfRepose, testWeight, fillState }) {
  const r = Number(radius) || 0;
  const h = Number(height) || 0;
  const coneH = r * Math.tan((Number(coneAngle) || 0) * D2R);
  const peakH = r * Math.tan((Number(angleOfRepose) || 0) * D2R);

  const barrelVol = Math.PI * r * r * h;
  const coneVol = (1 / 3) * Math.PI * r * r * coneH;
  const peakVol = (1 / 3) * Math.PI * r * r * peakH;

  let totalVol;
  if (fillState === 'peak') totalVol = barrelVol + coneVol + peakVol;
  else if (fillState === 'decline') totalVol = barrelVol + coneVol - peakVol;
  else totalVol = barrelVol + coneVol; // flat

  const tons = totalVol * (Number(testWeight) || 0);
  return { coneHeight: coneH, peakHeight: peakH, barrelVol, coneVol, peakVol, totalVol, tons };
}

/**
 * Open grain bunker / clamp: a peaked triangular-cross-section pile with a flat
 * straight middle and two half-cone ends, using the exact geometric formula
 * ("Method 2" on the Silo Bunker Calc tab).
 * @param {object} p
 * @param {number} p.width meters (across the pile, at the base)
 * @param {number} p.length meters (along the pile, at the base)
 * @param {number} p.angleDeg peak angle (grain angle of repose), degrees
 * @param {number} p.testWeight tonnes / m3
 */
export function bunkerResult({ width, length, angleDeg, testWeight }) {
  const w = Number(width) || 0;
  const l = Number(length) || 0;
  const a = (Number(angleDeg) || 0) * D2R;
  const height = (w / 2) * Math.tan(a);
  const volume = 0.25 * Math.tan(a) * w * w * ((l - w) + (Math.PI / 6) * w);
  const tons = volume * (Number(testWeight) || 0);
  return { height, volume, tons };
}

/**
 * Tarp size for a bunker: how much sheet is needed to drape over the peak
 * and reach the ground on both the width (side) and length (end) slopes,
 * plus a minimum overhang on each side to peg down — ported from the
 * "Tarp Req" columns on the Silo Bunker Calc tab.
 * @param {object} p
 * @param {number} p.width meters
 * @param {number} p.length meters
 * @param {number} p.angleDeg peak angle (grain angle of repose), degrees
 * @param {number} [p.overhangM] minimum overhang per side, meters (default 1.5)
 */
export function bunkerTarpRequirement({ width, length, angleDeg, overhangM = 1.5 }) {
  const w = Number(width) || 0;
  const l = Number(length) || 0;
  const h = (w / 2) * Math.tan((Number(angleDeg) || 0) * D2R);
  const overhang = Number(overhangM) || 0;

  const slantWidth = 2 * Math.sqrt(h * h + (w / 2) * (w / 2));
  const slantLength = 2 * Math.sqrt(h * h + (l / 2) * (l / 2));
  const tarpWidthNeeded = slantWidth + 2 * overhang;
  const tarpLengthNeeded = slantLength + 2 * overhang;

  return { height: h, slantWidth, slantLength, tarpWidthNeeded, tarpLengthNeeded };
}
