// Alternating colours down a list of items.
//
// Rows that run one into the next are read as one: the figures under one contract look like the
// next one's. Every second item in an unbroken run gets the other colour, and a heading (a
// commodity, a section) restarts the run, so each group opens the same way.
//
// Done in one place for every screen, after the screen is drawn, rather than by each screen
// remembering to number its own rows.

/**
 * Which items take the alternate colour, for a row of siblings given as "is this one a list item".
 * Anything that is not an item breaks the run, and the next item starts a new one.
 */
export function altFlags(isItem) {
  let n = 0;
  return isItem.map((item) => {
    if (!item) { n = 0; return false; }
    const alt = n % 2 === 1;
    n += 1;
    return alt;
  });
}

/**
 * Folding sections that sit one under another get the same treatment, but only where there are at least two in a
 * row: a section on its own needs nothing to tell it from its neighbour.
 *
 * @param {boolean[]} isFold  for a row of siblings, whether each is a foldable section
 * @returns {({alt: boolean}|null)[]}  null where a section is not banded
 */
export function foldBands(isFold) {
  const out = isFold.map(() => null);
  let start = -1;
  const close = (end) => {
    if (start >= 0 && end - start >= 2) for (let i = start; i < end; i += 1) out[i] = { alt: (i - start) % 2 === 1 };
    start = -1;
  };
  isFold.forEach((f, i) => { if (f) { if (start < 0) start = i; } else close(i); });
  close(isFold.length);
  return out;
}

// A row someone gave its own inline style is laid out by hand (a small list in a sheet): leave it alone.
const bandable = (el) => el.classList.contains('list-item') && !el.hasAttribute('style');
// Sections that already stand out (the coloured panels) keep their own look, as do hand-laid ones.
const bandableFold = (el) => el.matches?.('details.fold') && !el.classList.contains('feature') && !el.hasAttribute('style');

/** Mark every list item and run of folding sections under `root` as banded, alternating down each run. */
export function bandLists(root = document) {
  const parents = new Set([...root.querySelectorAll('.list-item, details.fold')].map((el) => el.parentElement).filter(Boolean));
  for (const parent of parents) {
    const kids = [...parent.children];
    const flags = altFlags(kids.map(bandable));
    kids.forEach((kid, i) => {
      if (!bandable(kid)) return;
      kid.classList.add('band');
      kid.classList.toggle('alt', flags[i]);
    });
    // a section that is hidden (the oil section outside canola) is not there for the purpose of a run
    const shown = kids.filter((k) => !k.hidden);
    const bands = foldBands(shown.map(bandableFold));
    kids.filter((k) => k.matches?.('details.fold')).forEach((k) => k.classList.remove('fold-band', 'fold-alt'));
    shown.forEach((kid, i) => {
      if (!bands[i]) return;
      kid.classList.add('fold-band');
      kid.classList.toggle('fold-alt', bands[i].alt);
    });
  }
}

/** Band what is on screen now, and again whenever a screen or a sheet redraws. */
export function watchLists(target = document.body) {
  let queued = false;
  const run = () => { queued = false; bandLists(target); };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // Right after the change and before anything is drawn, so a list never shows unbanded for a moment. Not a
    // wait for the next frame: a page that is not on screen draws none, and would never be banded.
    queueMicrotask(run);
  });
  // Child changes, and a section being shown or hidden. Not class changes, so banding never triggers itself.
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  bandLists(target);
  return () => observer.disconnect();
}
