import type { CheckUpOutcome, InternalAuditStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { formatCalendarDate } from "@/lib/internal-audit-rules";
import { isCheckUpOpen, isCheckUpOverdue, ROLES_NEVER_ANSWERING_CHECK_UPS } from "@/lib/check-up-response-rules";

/**
 * The Check-ups addressed to a user (PRD 0001 F-IA.4, #155): the ones whose target they own *now*,
 * the System's owner for a System-level Check-up and the Control Owner for an Organization-level
 * one, whatever their role. Read in one bulk query (no query per Check-up) in one snapshot.
 *
 * Open ones (audit launched, no response yet) are the user's "My tasks" rows; the answered ones
 * stay reachable from "Your Check-ups" (`/check-ups`) while they can still be changed. A role that
 * can never answer (the Internal Auditor, independence) is addressed nothing: no task, no list.
 */

export const MY_CHECK_UPS_HREF = "/check-ups";

export type MyCheckUp = {
  id: string;
  control: { code: string; title: string };
  /** The System's name, or null for the Organization-level Check-up. */
  systemName: string | null;
  audit: { title: string; status: InternalAuditStatus; dueDate: string; launchedAt: Date | null };
  answered: boolean;
  /** How an Internal Auditor evaluated it (#156), or null if they haven't. */
  outcome: CheckUpOutcome | null;
  open: boolean;
  overdue: boolean;
};

/** Every Check-up of a launched or closed audit addressed to `user`, open ones first, then by due date and Control code. */
export async function listMyCheckUps(user: { id: string; role: UserRole }, now = new Date()): Promise<MyCheckUp[]> {
  if (ROLES_NEVER_ANSWERING_CHECK_UPS.includes(user.role)) return [];
  const rows = await prisma.$transaction(
    (tx) =>
      tx.checkUp.findMany({
        where: {
          internalAudit: { status: { in: ["LAUNCHED", "CLOSED"] } },
          OR: [{ system: { is: { ownerId: user.id } } }, { systemId: null, control: { ownerId: user.id } }],
        },
        select: {
          id: true,
          control: { select: { code: true, title: true } },
          system: { select: { name: true } },
          internalAudit: { select: { title: true, status: true, dueDate: true, launchedAt: true } },
          response: { select: { id: true } },
          evaluation: { select: { outcome: true } },
        },
      }),
    { isolationLevel: "RepeatableRead" },
  );
  return rows
    .map((row) => {
      const state = { auditStatus: row.internalAudit.status, answered: row.response !== null, dueDate: row.internalAudit.dueDate };
      const checkUp: MyCheckUp = {
        id: row.id,
        control: row.control,
        systemName: row.system?.name ?? null,
        audit: {
          title: row.internalAudit.title,
          status: row.internalAudit.status,
          dueDate: formatCalendarDate(row.internalAudit.dueDate),
          launchedAt: row.internalAudit.launchedAt,
        },
        answered: state.answered,
        outcome: row.evaluation?.outcome ?? null,
        open: isCheckUpOpen(state),
        overdue: isCheckUpOverdue(state, now),
      };
      return { checkUp, due: row.internalAudit.dueDate.getTime() };
    })
    .sort(
      (a, b) =>
        Number(b.checkUp.open) - Number(a.checkUp.open) ||
        a.due - b.due ||
        a.checkUp.control.code.localeCompare(b.checkUp.control.code, "en", { numeric: true }) ||
        Number(a.checkUp.systemName === null) - Number(b.checkUp.systemName === null) ||
        (a.checkUp.systemName ?? "").localeCompare(b.checkUp.systemName ?? "", "en"),
    )
    .map(({ checkUp }) => checkUp);
}

/** The "My tasks" row of one open Check-up. Overdue is the danger tone; the due date is in the subtitle. */
export function checkUpTaskRow(checkUp: MyCheckUp): TaskRow {
  return {
    id: `${checkUp.id}:check-up`,
    kind: "Check-up",
    title: `${checkUp.control.code} — ${checkUp.control.title}`,
    subtitle: `${checkUp.systemName ?? "Organization"} · ${checkUp.audit.title} · due ${checkUp.audit.dueDate}`,
    tone: checkUp.overdue ? "danger" : "accent",
    status: checkUp.overdue ? "Overdue" : "Open",
    ...(checkUp.audit.launchedAt && { updatedAt: checkUp.audit.launchedAt }),
    href: `/check-ups/${checkUp.id}`,
  };
}

/**
 * The Check-up rows of `user`'s "My tasks" (open ones only, overdue marked, soonest due first), and
 * how many Check-ups they have in all, answered ones included, for the "Your Check-ups" shortcut.
 */
export async function getCheckUpTasks(user: { id: string; role: UserRole }, now = new Date()): Promise<{ rows: TaskRow[]; total: number }> {
  const all = await listMyCheckUps(user, now);
  return { rows: all.filter((checkUp) => checkUp.open).map(checkUpTaskRow), total: all.length };
}
