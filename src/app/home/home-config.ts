/**
 * Switches for the optional parts of the Home page; the product owner chose to show all three
 * (issue #226). Each is one constant, so flipping or dropping a part is a one-line change.
 */

/** Sparklines on the stat cards: weekly trends rebuilt from existing timestamps (see `home-trends.ts`). */
export const SHOW_STAT_TRENDS = true;

/** The "Recent activity" card (the last `ACTIVITY_DAYS` days of Change Events the role can see). */
export const SHOW_ACTIVITY = true;

/** The Ctrl+K "jump to" palette over the role's tasks and shortcuts. */
export const SHOW_JUMP_PALETTE = true;

export const ACTIVITY_DAYS = 14;
export const ACTIVITY_MAX = 8;
