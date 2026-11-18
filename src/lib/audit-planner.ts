import type { ControlApplicability, InternalAuditStatus, OnboardingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { InternalAuditDetail } from "@/lib/internal-audits";

/**
 * What the audit planner (#393) loads on the server: the Controls with when each was last audited, the
 * Systems, and the earlier audits a new one can repeat. Dates leave as ISO strings so the result can be passed
 * to a client component. Who may open the planner is decided by the pages; the planning rules themselves
 * (`planLaunch`) run behind `POST /api/internal-audits/preview`, never here.
 */

const SNAPSHOT = { isolationLevel: "RepeatableRead" } as const;
const codeCollator = new Intl.Collator("en", { numeric: true });

export type PlannerControl = {
  id: string;
  code: string;
  title: string;
  applicability: ControlApplicability;
  /** The Control's domain, shown as a filter chip (its category). */
  category: string;
  /** The Self-Assessment Question: what a Check-up asks unless the auditor writes another. */
  question: string | null;
  /** **Last audited**: when the Control's most recent evaluated Check-up was evaluated (any outcome, any target), or null if never. */
  lastAudited: string | null;
};

export type PlannerSystem = {
  id: string;
  name: string;
  vendor: string | null;
  status: OnboardingStatus;
  ownerName: string;
  deploymentFacets: string[];
};

/** An earlier audit the planner can repeat: only launched or closed ones, with what still exists of its scope. */
export type RepeatableAudit = {
  id: string;
  title: string;
  status: Exclude<InternalAuditStatus, "DRAFT">;
  /** When it was launched (ISO). */
  launchedAt: string;
  controlIds: string[];
  systemIds: string[];
  includeOrganization: boolean;
};

export type PlannerData = {
  controls: PlannerControl[];
  systems: PlannerSystem[];
  repeatable: RepeatableAudit[];
};

/**
 * Each Control's **last audited** date by Control id: the latest evaluation of any of its Check-ups, whatever the
 * outcome and target. A withdrawn Check-up doesn't count (it can't have been evaluated, but the rule is stated
 * where it is read). A Control with no entry has never been audited.
 */
export async function loadLastAudited(tx: Prisma.TransactionClient): Promise<Map<string, Date>> {
  const rows = await tx.$queryRaw<{ controlId: string; lastAudited: Date }[]>`
    SELECT cu."controlId" AS "controlId", MAX(ev."evaluatedAt") AS "lastAudited"
    FROM "CheckUpEvaluation" ev
    JOIN "CheckUp" cu ON cu."id" = ev."checkUpId"
    WHERE NOT EXISTS (SELECT 1 FROM "CheckUpWithdrawal" w WHERE w."checkUpId" = cu."id")
    GROUP BY cu."controlId"`;
  return new Map(rows.map((row) => [row.controlId, row.lastAudited]));
}

/**
 * The launched and closed audits, most recently launched first, each with the Controls and Systems it still has
 * and its Organization setting. A Control or System deleted or retired since (a System closed at OG3, which no
 * Check-up is launched for) is left out without comment. A draft is never offered.
 */
export async function listRepeatableAudits(): Promise<RepeatableAudit[]> {
  return prisma.$transaction(async (tx) => {
    const audits = await tx.internalAudit.findMany({
      where: { status: { in: ["LAUNCHED", "CLOSED"] } },
      orderBy: [{ launchedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        launchedAt: true,
        createdAt: true,
        includeOrganization: true,
        controls: { select: { controlId: true } },
        systems: { select: { systemId: true } },
      },
    });
    if (audits.length === 0) return [];
    const [controls, systems] = await Promise.all([
      tx.control.findMany({ where: { id: { in: [...new Set(audits.flatMap((a) => a.controls.map((c) => c.controlId)))] } }, select: { id: true } }),
      tx.system.findMany({
        where: { id: { in: [...new Set(audits.flatMap((a) => a.systems.map((s) => s.systemId)))] }, evaluationClosedAt: null },
        select: { id: true },
      }),
    ]);
    const controlIds = new Set(controls.map((control) => control.id));
    const systemIds = new Set(systems.map((system) => system.id));
    return audits.map((audit) => ({
      id: audit.id,
      title: audit.title,
      status: audit.status as RepeatableAudit["status"],
      launchedAt: (audit.launchedAt ?? audit.createdAt).toISOString(),
      controlIds: audit.controls.map((row) => row.controlId).filter((id) => controlIds.has(id)),
      systemIds: audit.systems.map((row) => row.systemId).filter((id) => systemIds.has(id)),
      includeOrganization: audit.includeOrganization,
    }));
  }, SNAPSHOT);
}

/** Everything the planner page needs, read in one snapshot. */
export async function loadPlannerData(): Promise<PlannerData> {
  const [{ controls, systems }, repeatable] = await Promise.all([
    prisma.$transaction(async (tx) => {
      const [controlRows, systemRows, lastAudited] = await Promise.all([
        tx.control.findMany({
          select: { id: true, code: true, title: true, applicability: true, category: true, question: true },
        }),
        tx.system.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            vendor: true,
            status: true,
            owner: { select: { name: true } },
            deploymentFacets: { select: { name: true }, orderBy: { name: "asc" } },
          },
        }),
        loadLastAudited(tx),
      ]);
      return {
        controls: controlRows
          .map((control): PlannerControl => ({ ...control, lastAudited: lastAudited.get(control.id)?.toISOString() ?? null }))
          .sort((a, b) => codeCollator.compare(a.code, b.code)),
        systems: systemRows.map(
          (system): PlannerSystem => ({
            id: system.id,
            name: system.name,
            vendor: system.vendor,
            status: system.status,
            ownerName: system.owner.name,
            deploymentFacets: system.deploymentFacets.map((facet) => facet.name),
          }),
        ),
      };
    }, SNAPSHOT),
    listRepeatableAudits(),
  ]);
  return { controls, systems, repeatable };
}

/** What the edit page hands the planner about the draft: its fields and the first question of each Control. */
export type PlannerInitial = {
  id: string;
  title: string;
  scopeDescription: string;
  dueDate: string;
  includeOrganization: boolean;
  controlIds: string[];
  systemIds: string[];
  /** The draft's first question per Control id (absent when it has none). */
  firstQuestions: Record<string, string>;
};

export function plannerInitialFrom(audit: InternalAuditDetail): PlannerInitial {
  return {
    id: audit.id,
    title: audit.title,
    scopeDescription: audit.scopeDescription,
    dueDate: audit.dueDate,
    includeOrganization: audit.includeOrganization,
    controlIds: audit.controls.map((control) => control.id),
    systemIds: audit.systems.map((system) => system.id),
    firstQuestions: Object.fromEntries(audit.controls.flatMap((control) => (control.questions[0] ? [[control.id, control.questions[0]]] : []))),
  };
}
