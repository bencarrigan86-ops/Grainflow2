// A name in a table at the top of a tab that takes you to its section further down.
//
// Mark the row `data-jump="<id of the heading>"` and the heading `id="<that id>"`.
// The page scrolls so the heading lands just below the title bar — which stays fixed
// at the top, so scrolling the heading to the very edge would leave it hidden under
// it — and the heading flashes once so you can see where you arrived.

export function wireJumps(root) {
  root.querySelectorAll('[data-jump]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = root.querySelector('#' + CSS.escape(el.dataset.jump));
      if (!target) return;
      const bar = root.querySelector('.topbar');
      const room = (bar ? bar.getBoundingClientRect().height : 0) + 10;
      window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - room), behavior: 'smooth' });
      target.classList.remove('flash');
      void target.offsetWidth;            // restart the highlight if it is tapped twice
      target.classList.add('flash');
    });
  });
}
