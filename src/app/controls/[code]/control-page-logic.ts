import type { ControlAssessmentStatus } from "@prisma/client";
import { STATUS_ORDER } from "@/app/organization/controls/controls-logic";
import { mappingsByFramework, plural } from "../library-logic";
import type { ControlPageView, PageSystem } from "./control-page-types";

/**
 * The pure side of the Control page (design proposal B "Side rail and tabs", issue #314): which tabs a Control
 * has, the totals of its Requirements, the Systems search and the links. No React, no Prisma values.
 */

export type TabKey = "control" | "satisfies" | "implementation" | "systems";

export type TabDef = { key: TabKey; label: string; count: number | null };

/** The tabs this Control has, in order: Organization implementation only for an Organizational or Both Control, Systems only for a Per-System or Both one. */
export function tabsFor(view: Pick<ControlPageView, "organization" | "systems" | "control">): TabDef[] {
  const tabs: TabDef[] = [
    { key: "control", label: "The Control", count: null },
    { key: "satisfies", label: "Satisfies", count: view.control.mappings.length },
  ];
  if (view.organization) tabs.push({ key: "implementation", label: "Organization implementation", count: null });
  if (view.systems) tabs.push({ key: "systems", label: "Systems", count: view.systems.total });
  return tabs;
}

/** The tab `?tab=` names, or the first tab when it names none this Control has. */
export function tabFromParam(raw: string | null | undefined, tabs: TabDef[]): TabKey {
  return tabs.find((tab) => tab.key === raw)?.key ?? tabs[0].key;
}

export type RequirementTotals = { total: number; full: number; partial: number; frameworks: number };

export function requirementTotals(mappings: Pick<ControlPageView["control"], "mappings">["mappings"]): RequirementTotals {
  const full = mappings.filter((mapping) => mapping.coverage === "FULL").length;
  return { total: mappings.length, full, partial: mappings.length - full, frameworks: mappingsByFramework({ mappings }).length };
}

/** "3 Frameworks · 4 Full · 2 Partial", or the unmapped sentence. */
export function totalsLine(totals: RequirementTotals): string {
  if (totals.total === 0) return "Not mapped to any Requirement";
  return `${plural(totals.frameworks, "Framework")} · ${totals.full} Full · ${totals.partial} Partial`;
}

/** The Systems whose name, owner or Business Unit contains the query (case-insensitive); all of them for an empty query. */
export function filterSystems(list: PageSystem[], query: string): PageSystem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((system) => `${system.name} ${system.ownerName} ${system.businessUnits.join(" ")}`.toLowerCase().includes(needle));
}

/** The statuses that have at least one System, in the order used everywhere. */
export function presentStatuses(counts: Record<ControlAssessmentStatus, number>): ControlAssessmentStatus[] {
  return STATUS_ORDER.filter((status) => counts[status] > 0);
}

/** "You can see 3 of them" is said whenever fewer Systems are listed than the counts include. */
export function visibilityNote(total: number, listed: number): string | null {
  if (listed >= total) return null;
  return `Counts include all ${plural(total, "System")} this Control applies to. You can see ${listed} of them${listed === 0 ? ", so none are listed" : ""}.`;
}

/** The Control's page, optionally on one tab (`?tab=`). */
export const controlHref = (code: string, tab?: string | null) => `/controls/${encodeURIComponent(code)}${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`;

/** The Control's editor; `tab` is the tab to return to after Save or Cancel. */
export const controlEditHref = (code: string, tab?: string | null) => `/controls/${encodeURIComponent(code)}/edit${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`;
