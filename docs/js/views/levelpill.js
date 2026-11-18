// A coloured chip for what a role can do in an area, so a table of ticks and blanks reads at a glance. Shared by the how-to guide
// (Help) and the farm's own rules (Settings).

import { esc } from '../fmt.js?v=414';
import { LEVELS } from '../helpcontent.js?v=414';

const TINT = { full: 'var(--accent-summary)', view: 'var(--accent-report)', own: 'var(--accent-input)', used: 'var(--accent-input)', draft: 'var(--accent-input)', none: 'var(--text-dim)' };

export const pill = (level) => `<span title="${esc(LEVELS[level].label)}" style="display:inline-block;min-width:34px;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:700;color:${TINT[level]};background:color-mix(in srgb, ${TINT[level]} ${level === 'none' ? 8 : 18}%, transparent);${level === 'none' ? 'font-weight:400' : ''}">${esc(LEVELS[level].short)}</span>`;

/** The columns, in order, with the short name for each. */
export const ROLE_SHORT = { owner: 'Owner', manager: 'Manager', bookkeeper: 'Book-keeper', farm_worker: 'Worker', driver: 'Driver', advisor: 'Advisor' };
