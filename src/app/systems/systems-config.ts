/**
 * Switches and thresholds of the Systems list (design proposal A "Register table", issue #232). Each is
 * one constant, so flipping or dropping an optional part is a one-line change.
 */

/** Sparklines on the stat cards, from the daily snapshots (`systems-trends.ts`). */
export const SHOW_STAT_TRENDS = true;

/** The Ctrl+K palette over "New System" and every visible System. */
export const SHOW_JUMP_PALETTE = true;

/** The "Compact" toggle that tightens the table rows. */
export const SHOW_COMPACT_TOGGLE = true;

// The two thresholds (a stale Draft's age, the "Under N% met" percentage) are Admin settings, not constants:
// see `src/lib/app-settings.ts` and `/admin/settings` (#240).

/** Rows per page: the choices, and the one used until a choice is made. */
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
