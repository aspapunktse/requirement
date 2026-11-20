import type { InternalAuditStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadLaunchReports } from "@/lib/check-ups";
import {
  addCheckUpState,
  checkUpState,
  emptyCheckUpFindings,
  emptyCheckUpStateCounts,
  sumCheckUpStateCounts,
  type CheckUpFindings,
  type CheckUpStateCounts,
} from "@/lib/check-up-states";
import { calendarDaysUntil, formatCalendarDate } from "@/lib/internal-audit-rules";

/**
 * Everything the Internal Audits list shows (#398), read in one RepeatableRead snapshot in a constant number of
 * queries: one for the audits, one for the Check-up flags of every launched or closed audit (aggregated here by
 * `check-up-states.ts`), and a few grouped ones for the drafts' launch planning (`loadLaunchReports`, the same
 * `planLaunch` the launch runs). No query per audit or Check-up. Dates leave as strings so the result can go to
 * a client component.
 */

export type DraftPlanSummary = {
  /** Check-ups launching the draft would send (System-level plus Organization-level). */
  checkUpCount: number;
  /** The first thing that blocks launching it, or null when it is ready to launch. */
  firstBlocker: string | null;
};

export type InternalAuditListItem = {
  id: string;
  title: string;
  scopeDescription: string;
  status: InternalAuditStatus;
  dueDate: string;
  /** Calendar days from today to the due date when the list was read (negative once past). */
  daysUntilDue: number | null;
  includeOrganization: boolean;
  controlCount: number;
  systemCount: number;
  /** Launched audits: the Check-ups per state. Null for a draft and a closed audit. */
  progress: CheckUpStateCounts | null;
  /** Draft only. */
  plan: DraftPlanSummary | null;
  /** Closed only. */
  findings: CheckUpFindings | null;
  closedAt: string | null;
  closedBy: string | null;
};

export type InternalAuditList = {
  /** Launched audits soonest due first, then drafts soonest due first, then closed audits newest first. */
  audits: InternalAuditListItem[];
  /** The Check-ups of every launched audit by state: the ring. */
  totals: CheckUpStateCounts;
};

const STATUS_ORDER: Record<InternalAuditStatus, number> = { LAUNCHED: 0, DRAFT: 1, CLOSED: 2 };

type SortableAudit = { status: InternalAuditStatus; dueDate: Date; createdAt: Date; closedAt: Date | null };

/** Launched soonest due first, drafts soonest due first, closed newest first (by when they were closed). Newer audits first on a tie. */
function compareAudits(a: SortableAudit, b: SortableAudit): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  const newestFirst = b.createdAt.getTime() - a.createdAt.getTime();
  if (a.status === "CLOSED") return (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0) || newestFirst;
  return a.dueDate.getTime() - b.dueDate.getTime() || newestFirst;
}

export async function loadInternalAuditList(now: Date = new Date()): Promise<InternalAuditList> {
  return prisma.$transaction(
    async (tx) => {
      const audits = await tx.internalAudit.findMany({
        select: {
          id: true,
          title: true,
          scopeDescription: true,
          status: true,
          dueDate: true,
          includeOrganization: true,
          createdAt: true,
          closedAt: true,
          closedBy: { select: { name: true } },
          _count: { select: { controls: true, systems: true } },
        },
      });

      const checkUps = await tx.checkUp.findMany({
        where: { internalAudit: { status: { in: ["LAUNCHED", "CLOSED"] } } },
        select: {
          internalAuditId: true,
          response: { select: { id: true } },
          evaluation: { select: { outcome: true } },
          withdrawal: { select: { id: true } },
          risk: { select: { id: true } },
        },
      });
      const byAudit = new Map(audits.map((audit) => [audit.id, audit]));
      const progress = new Map<string, CheckUpStateCounts>();
      const findings = new Map<string, CheckUpFindings>();
      for (const checkUp of checkUps) {
        const audit = byAudit.get(checkUp.internalAuditId);
        if (!audit) continue;
        const state = checkUpState(
          { answered: checkUp.response !== null, evaluated: checkUp.evaluation !== null, withdrawn: checkUp.withdrawal !== null },
          { status: audit.status, dueDate: audit.dueDate },
          now,
        );
        if (audit.status === "LAUNCHED") {
          const counts = progress.get(audit.id) ?? emptyCheckUpStateCounts();
          addCheckUpState(counts, state);
          progress.set(audit.id, counts);
        } else if (checkUp.evaluation) {
          const found = findings.get(audit.id) ?? emptyCheckUpFindings();
          found[checkUp.evaluation.outcome] += 1;
          if (checkUp.risk) found.risksOpened += 1;
          findings.set(audit.id, found);
        }
      }

      const reports = await loadLaunchReports(
        tx,
        audits.filter((audit) => audit.status === "DRAFT"),
        now,
      );

      const sorted = [...audits].sort(compareAudits);
      const items = sorted.map((audit): InternalAuditListItem => {
        const report = reports.get(audit.id);
        return {
          id: audit.id,
          title: audit.title,
          scopeDescription: audit.scopeDescription,
          status: audit.status,
          dueDate: formatCalendarDate(audit.dueDate),
          daysUntilDue: calendarDaysUntil(audit.dueDate, now),
          includeOrganization: audit.includeOrganization,
          controlCount: audit._count.controls,
          systemCount: audit._count.systems,
          progress: audit.status === "LAUNCHED" ? (progress.get(audit.id) ?? emptyCheckUpStateCounts()) : null,
          plan: report ? { checkUpCount: report.systemCheckUpCount + report.organizationCheckUpCount, firstBlocker: report.blockers[0]?.message ?? null } : null,
          findings: audit.status === "CLOSED" ? (findings.get(audit.id) ?? emptyCheckUpFindings()) : null,
          closedAt: audit.closedAt ? formatCalendarDate(audit.closedAt) : null,
          closedBy: audit.closedBy?.name ?? null,
        };
      });
      return {
        audits: items,
        totals: sumCheckUpStateCounts([...progress.values()]),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
