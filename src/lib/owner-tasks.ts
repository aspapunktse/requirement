import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { getActionableQueries } from "@/lib/assessment-queries";
import { attentionReasonTone } from "@/lib/status-tones";
import { isReadOnlySystemRole } from "@/lib/system-permissions";

export type OwnerTasks = {
  /** How many Systems the user owns (`ownerId === user.id`). 0 means there is nothing owner-side to show. */
  ownedCount: number;
  rows: TaskRow[];
  /** Distinct owned Systems with at least one attention row. */
  needingAttentionCount: number;
  /** Open Assessment Queries on owned Systems whose latest message isn't the owner's ("Awaiting your reply"). */
  openQuestionCount: number;
};

const NO_OWNER_TASKS: OwnerTasks = { ownedCount: 0, rows: [], needingAttentionCount: 0, openQuestionCount: 0 };

/**
 * The "My tasks" rows a user has as the owner of Systems (#98): rejected /
 * stale / needs-assessment Systems and Assessment Queries awaiting their
 * reply. Keyed on `ownerId` alone, whatever the user's role (#91): a
 * REVIEWER, RISK_OWNER, VIEWER, ADMIN or BUSINESS_RISK_OWNER who owns a
 * System gets them exactly like a SYSTEM_OWNER does, in addition to their
 * role's own tasks. An ADMIN's "admin rights over every System" is not
 * ownership: only Systems whose `ownerId` is the user count.
 *
 * A COMPLIANCE_MANAGER (#71) or INTERNAL_AUDITOR (#147) is strictly read-only
 * on Systems, so they get nothing even when recorded as an owner.
 *
 * Query semantics: `getActionableQueries` checks ownership before role (see
 * `isQueryActionableBy`), so for Systems the user owns it returns the
 * owner-side set, whatever the role: open Queries whose latest message
 * isn't the owner's. The role-side meaning ("your turn" for a REVIEWER or
 * RISK_OWNER) only applies to Systems they don't own.
 */
export async function getOwnerTasks(user: { id: string; role: UserRole }): Promise<OwnerTasks> {
  if (isReadOnlySystemRole(user)) return NO_OWNER_TASKS;

  const ownedSystemIds = (
    await prisma.system.findMany({ where: { ownerId: user.id }, select: { id: true } })
  ).map((s) => s.id);
  if (ownedSystemIds.length === 0) return NO_OWNER_TASKS;

  const [attention, openQueries] = await Promise.all([
    getSystemsNeedingAttention(user.id),
    getActionableQueries(user, ownedSystemIds),
  ]);

  const rows: TaskRow[] = [
    ...attention.map((system): TaskRow => ({
      id: `${system.id}:${system.reason}`,
      kind: "System",
      title: system.name,
      ...(system.reason === "needs-assessment" && {
        subtitle: `${system.count} ${system.count === 1 ? "Control needs" : "Controls need"} assessment`,
      }),
      tone: attentionReasonTone(system.reason),
      status:
        system.reason === "rejected"
          ? "Rejected"
          : system.reason === "needs-assessment"
            ? "Needs assessment"
            : "Stale assessment",
      href: `/systems/${system.id}`,
    })),
    ...openQueries.map((query): TaskRow => ({
      id: query.id,
      kind: "Query",
      title: query.controlTitle,
      subtitle: query.systemName,
      tone: "accent",
      status: "Awaiting your reply",
      updatedAt: query.updatedAt,
      href: `/systems/${query.systemId}`,
    })),
  ];

  return {
    ownedCount: ownedSystemIds.length,
    rows,
    needingAttentionCount: new Set(attention.map((system) => system.id)).size,
    openQuestionCount: openQueries.length,
  };
}

/**
 * Owner rows first, then the role's own rows, without duplicates: a row whose
 * id is already among the owner rows is dropped from the role's. The overlap
 * is real: a REVIEWER's or RISK_OWNER's own Query list covers every System,
 * so it already contains the owner-side Queries on a System they own. The
 * owner row wins because its "Awaiting your reply" chip says why the user is
 * on the hook, where the role row would just say "Your turn". Owner System
 * rows are keyed `<systemId>:<reason>`, so they never collide with a role's
 * System rows (e.g. "Awaiting review"), which are separate tasks.
 */
export function mergeTaskRows(ownerRows: TaskRow[], roleRows: TaskRow[]): TaskRow[] {
  const seen = new Set(ownerRows.map((row) => row.id));
  return [...ownerRows, ...roleRows.filter((row) => !seen.has(row.id))];
}
