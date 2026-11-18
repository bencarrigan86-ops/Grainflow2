/**
 * One colour for each commodity, the same on every screen that shows its name (Sales, Movement).
 * The common crops have their own; anything else gets one from the set by its name, so it is the same every time.
 * The colours themselves are in the stylesheet (.com-amber and so on), mixed with the text colour so they read in the dark theme too.
 */

const SET = ['amber', 'blue', 'teal', 'coral', 'plum', 'olive', 'rose', 'slate'];

const OWN = [
  ['wheat', 'amber'],
  ['cotton', 'blue'],
  ['barley', 'teal'],
  ['canola', 'coral'],
  ['sorghum', 'rose'],
  ['chickpea', 'olive'],
];

/** The colour name for a commodity: 'amber', 'blue', and so on. A name with nothing in it gets the neutral slate. */
export function commodityColour(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return 'slate';
  const own = OWN.find(([word]) => n.includes(word));
  if (own) return own[1];
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return SET[h % SET.length];
}

/** The class for it, to put on the commodity's name. */
export const commodityClass = (name) => `com-${commodityColour(name)}`;
