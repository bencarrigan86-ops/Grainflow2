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

// A row someone gave its own inline style is laid out by hand (a small list in a sheet): leave it alone.
const bandable = (el) => el.classList.contains('list-item') && !el.hasAttribute('style');

/** Mark every list item under `root` as banded, alternating down each run. */
export function bandLists(root = document) {
  const parents = new Set([...root.querySelectorAll('.list-item')].map((el) => el.parentElement).filter(Boolean));
  for (const parent of parents) {
    const kids = [...parent.children];
    const flags = altFlags(kids.map(bandable));
    kids.forEach((kid, i) => {
      if (!bandable(kid)) return;
      kid.classList.add('band');
      kid.classList.toggle('alt', flags[i]);
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
    requestAnimationFrame(run);
  });
  // child changes only: toggling a class is an attribute change, so banding never triggers itself
  observer.observe(target, { childList: true, subtree: true });
  bandLists(target);
  return () => observer.disconnect();
}
