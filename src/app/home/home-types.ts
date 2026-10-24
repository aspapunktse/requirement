import type { UserRole } from "@prisma/client";
import type { ChipTone } from "@/components/ui/StatusChip";

/**
 * The serialisable shapes the Home page passes from the server (`role-view.ts`, `home-view.ts`) to its
 * client component. Type-only: nothing here may import server code at runtime.
 */

/** Whose move a task is: the user's now, someone else's, or later (due later or getting stale). */
export type HomeLane = "you" | "waiting" | "soon";

export const HOME_LANES: { key: HomeLane; label: string; hint: string }[] = [
  { key: "you", label: "Your move", hint: "act on these" },
  { key: "waiting", label: "Waiting on others", hint: "nothing to do yet" },
  { key: "soon", label: "Coming up", hint: "due later or getting stale" },
];

export type HomeTask = {
  id: string;
  /** System, Query, Risk, Control, Check-up or Audit. */
  kind: string;
  title: string;
  subtitle?: string;
  tone: ChipTone;
  status: string;
  href: string;
  lane: HomeLane;
  /** Whole days since the task last changed, or null when it has no date. */
  days: number | null;
  /** The one primary action of the row, e.g. "Reply". */
  action: string;
};

export type HomeStatTone = "warn" | "danger" | "ok";

export type HomeStat = {
  label: string;
  value: number | string;
  tone?: HomeStatTone;
  /** The task kind this card filters the task list by; a card without one is not a button. */
  filter?: string;
  /** Oldest to newest. Nothing fills it today (no history exists); see `SHOW_STAT_TRENDS`. */
  trend?: number[];
};

export type HomeIconKey =
  | "plus"
  | "stack"
  | "check"
  | "book"
  | "doc"
  | "search"
  | "grid"
  | "alert"
  | "chart"
  | "layers"
  | "building"
  | "system"
  | "query"
  | "risk"
  | "control"
  | "checkup"
  | "audit"
  | "arrow"
  | "bolt";

export type HomeTile = {
  title: string;
  description: string;
  href: string;
  foot?: string;
  icon: HomeIconKey;
  primary?: boolean;
};

export type HomeActivity = {
  id: string;
  who: string;
  what: string;
  /** The System's name, when the event belongs to one. */
  target?: string;
  href?: string;
  days: number;
  tone: "ok" | "warn" | "danger" | "accent";
};

/** One picture per role, drawn from data that role may see. `empty` is shown instead when there is nothing to draw. */
export type HomePicture = { title: string; note: string; empty: string } & (
  | { type: "pipeline"; stages: string[]; items: { id: string; name: string; href: string; stage: number; pct: number | null; flag?: string }[] }
  | { type: "bars"; unit?: string; target?: number; items: { id: string; name: string; value: number; href?: string }[] }
  | { type: "heat"; rows: string[]; cols: string[]; cells: number[][] }
  | { type: "portfolio"; stages: string[]; items: { id: string; name: string; href: string; stage: number; pct: number | null; risks: number }[] }
  | { type: "rings"; items: { id: string; name: string; value: number; href: string }[] }
  | { type: "audits"; legend: { label: string; tone: string }[]; items: { id: string; name: string; href: string; parts: number[] }[] }
  | { type: "mosaic"; groups: { name: string; items: { id: string; name: string; href: string }[] }[] }
);

export type HomeView = {
  name: string;
  role: UserRole;
  roleLabel: string;
  lede: string;
  scope?: string;
  stats: HomeStat[];
  tasks: HomeTask[];
  tiles: HomeTile[];
  picture: HomePicture;
  activity: HomeActivity[];
};
