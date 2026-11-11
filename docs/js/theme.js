// Light or dark: the phone's own setting by default, or the person's choice here.
//
// "auto" follows the device, as the app always has. "light" and "dark" are set on
// the page (data-theme on the root element), which the stylesheet reads in front
// of the device setting. The choice is kept on this device only — a phone in
// the dark and a computer in daylight are allowed to differ.

const KEY = 'grainflow.theme';

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
}

export function setTheme(mode) {
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(KEY, mode);
    else localStorage.removeItem(KEY);
  } catch { /* private mode: it applies for this visit only */ }
  applyTheme(mode);
}

export function initTheme() { applyTheme(getTheme()); }
