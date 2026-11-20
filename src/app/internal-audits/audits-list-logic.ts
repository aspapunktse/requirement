import type { InternalAuditList, InternalAuditListItem } from "@/lib/internal-audit-list";

/**
 * The Internal Audits list's filters and card wording (#398), pure so they can be unit tested. A filter is one
 * of the stat cards; clicking the active one clears it.
 */
export type AuditFilter = "LAUNCHED" | "awaiting" | "overdue" | "DRAFT" | "CLOSED";

/** Does the audit pass the filter? "awaiting" and "overdue" keep the launched audits with at least one such Check-up. */
export function matchesFilter(audit: InternalAuditListItem, filter: AuditFilter | null): boolean {
  switch (filter) {
    case null:
      return true;
    case "LAUNCHED":
    case "DRAFT":
    case "CLOSED":
      return audit.status === filter;
    case "awaiting":
      return audit.status === "LAUNCHED" && (audit.progress?.awaiting ?? 0) > 0;
    case "overdue":
      return audit.status === "LAUNCHED" && (audit.progress?.overdue ?? 0) > 0;
  }
}

/** A case-insensitive substring match on title or scope. A blank query matches everything. */
export function matchesQuery(audit: InternalAuditListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || `${audit.title} ${audit.scopeDescription}`.toLowerCase().includes(q);
}

export type AuditStatCounts = { launched: number; awaiting: number; overdue: number; drafts: number; closed: number };

/** The stat cards: audits per status, and the Check-ups awaiting evaluation and overdue across the launched audits. */
export function statCounts(list: InternalAuditList): AuditStatCounts {
  const countOf = (status: InternalAuditListItem["status"]) => list.audits.filter((audit) => audit.status === status).length;
  return { launched: countOf("LAUNCHED"), awaiting: list.totals.awaiting, overdue: list.totals.overdue, drafts: countOf("DRAFT"), closed: countOf("CLOSED") };
}

/** "Due in N days", "Due today" or "N days overdue", and how urgent it is: red once past, amber within 7 days. */
export function dueLine(daysUntilDue: number | null): { text: string; urgency: "late" | "soon" | null } {
  if (daysUntilDue === null) return { text: "", urgency: null };
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  if (daysUntilDue < 0) return { text: `${days(-daysUntilDue)} overdue`, urgency: "late" };
  if (daysUntilDue === 0) return { text: "Due today", urgency: "soon" };
  return { text: `Due in ${days(daysUntilDue)}`, urgency: daysUntilDue <= 7 ? "soon" : null };
}
