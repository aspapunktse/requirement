import type { RiskSeverity, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { getApplicableControls, UNTOUCHED_ASSESSMENT_WHERE } from "@/lib/control-assessments";
import { getComplianceForSystems } from "@/lib/compliance";
import { loadCoverageSummaries } from "@/lib/framework-coverage";
import { frameworkLabel } from "@/lib/framework-label";
import { visibleFrameworksWhere } from "@/lib/frameworks";
import { scopedSystemsWhere, type AssignedScope } from "@/lib/business-risk-owner";
import { roleLabel } from "./role-label";
import type { HomePicture } from "./home-types";

/**
 * The picture beside each role's task list (proposal A, issue #226), built from data the role may see.
 * Pure builders are separate from the loaders so the shaping rules are testable without a database.
 */

const STAGES = ["Draft", "In review", "Approved", "Onboarded"];
/** A Rejected System goes back to Draft for revision; the enum value is mapped there as a safety net. */
function stageOf(status: string): number {
  switch (status) {
    case "IN_REVIEW":
      return 1;
    case "APPROVED":
      return 2;
    case "ONBOARDED":
      return 3;
    default:
      return 0;
  }
}

const DAY_MS = 86_400_000;
export const daysSince = (date: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));

/** A Reviewer is expected to decide within this many days of submission (the target line on the bars). */
export const REVIEW_TARGET_DAYS = 7;
/** More Systems than this are not drawn one by one (the card would stop being a picture). */
const MAX_SYSTEMS_DRAWN = 48;

function noteCount(total: number, noun: string, shown: number): string {
  const base = `${total} ${noun}${total === 1 ? "" : "s"}`;
  return shown < total ? `${base} · ${shown} shown` : base;
}

// System Owner: the pipeline of own Systems

/** Flags for the pipeline, taken from the owner's own task rows (`<systemId>:<reason>`), so the picture and the list agree. */
export function pipelineFlags(ownerRows: TaskRow[]): Map<string, string> {
  const flags = new Map<string, string>();
  const labels: Record<string, string> = { rejected: "Rejected", stale: "Stale", "needs-assessment": "Needs assessment" };
  for (const row of ownerRows) {
    const [systemId, reason] = row.id.split(":");
    if (row.kind === "System" && reason && labels[reason] && !flags.has(systemId)) flags.set(systemId, labels[reason]);
  }
  return flags;
}

export async function loadPipelinePicture(userId: string, flags: Map<string, string>): Promise<HomePicture> {
  // One snapshot for the Systems, their applicable Controls and their Assessments, every query on `tx`.
  const { systems, items } = await prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: { ownerId: userId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          confidentialityImpactLevel: true,
          integrityImpactLevel: true,
          availabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          frameworkScopes: { select: { id: true } },
        },
      });
      const items = [];
      for (const system of systems.slice(0, MAX_SYSTEMS_DRAWN)) {
        // "% assessed": the applicable Controls that have been touched (not an untouched Not Started row).
        const applicable = await getApplicableControls(system, {}, tx);
        const touched =
          applicable.length === 0
            ? 0
            : await tx.controlAssessment.count({
                where: { systemId: system.id, controlId: { in: applicable.map((control) => control.id) }, NOT: UNTOUCHED_ASSESSMENT_WHERE },
              });
        const flag = system.status === "REJECTED" ? "Rejected" : flags.get(system.id);
        items.push({
          id: system.id,
          name: system.name,
          href: `/systems/${system.id}`,
          stage: stageOf(system.status),
          pct: applicable.length === 0 ? null : Math.round((touched / applicable.length) * 100),
          ...(flag && { flag }),
        });
      }
      return { systems, items };
    },
    { isolationLevel: "RepeatableRead" },
  );
  const shown = items;
  return {
    type: "pipeline",
    title: "Your Systems through onboarding",
    note: noteCount(systems.length, "System", shown.length),
    empty: "You don't own a System yet.",
    stages: STAGES,
    items,
  };
}

// Reviewer: how long each review has waited

export function reviewWaitPicture(items: { id: string; name: string; href: string; days: number }[]): HomePicture {
  return {
    type: "bars",
    title: "How long each review has waited",
    note: `days since submitted · target ${REVIEW_TARGET_DAYS}`,
    empty: "No review is waiting for you.",
    unit: "d",
    target: REVIEW_TARGET_DAYS,
    items: [...items]
      .sort((a, b) => b.days - a.days)
      .slice(0, 10)
      .map((item) => ({ id: item.id, name: item.name, href: item.href, value: item.days })),
  };
}

// Risk Owner: open Risks by likelihood and severity

const SEVERITY_ORDER: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_LABEL = ["Low", "Medium", "High", "Critical"];

/**
 * A Risk has a `likelihood` and a `severity` on the same four-step scale (Low to Critical), which is
 * exactly a 4x4 grid. Rows run from the highest likelihood (top) to the lowest, columns from the lowest
 * severity (left) to the highest, as in the design.
 */
export function riskHeatPicture(risks: { likelihood: RiskSeverity; severity: RiskSeverity }[]): HomePicture {
  const cells = SEVERITY_ORDER.map(() => SEVERITY_ORDER.map(() => 0));
  for (const risk of risks) {
    const row = SEVERITY_ORDER.length - 1 - SEVERITY_ORDER.indexOf(risk.likelihood);
    cells[row][SEVERITY_ORDER.indexOf(risk.severity)] += 1;
  }
  return {
    type: "heat",
    title: "Open Risks by likelihood and severity",
    note: `${risks.length} open`,
    empty: "No open Risks.",
    rows: [...SEVERITY_LABEL].reverse(),
    cols: SEVERITY_LABEL,
    cells,
  };
}

// Business Risk Owner: the portfolio in scope

/**
 * Systems in the user's assigned scope by onboarding status, each with its compliance % (against the
 * base Framework, as on the Business Risk Owner dashboard) and its number of open Risks.
 */
export async function loadPortfolioPicture(scope: AssignedScope, openRisks: { systemId: string | null }[]): Promise<HomePicture> {
  const where = scopedSystemsWhere(scope);
  const [systems, compliance] = await Promise.all([
    prisma.system.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, status: true } }),
    getComplianceForSystems(where),
  ]);
  const pctBySystem = new Map(compliance.bySystem.map((row) => [row.systemId, row.percentage]));
  const risksBySystem = new Map<string, number>();
  for (const risk of openRisks) if (risk.systemId) risksBySystem.set(risk.systemId, (risksBySystem.get(risk.systemId) ?? 0) + 1);
  const shown = systems.slice(0, MAX_SYSTEMS_DRAWN);
  return {
    type: "portfolio",
    title: "Your portfolio by onboarding status",
    note: `${noteCount(systems.length, "System", shown.length)} · compliance %`,
    empty: "No System is in your assigned scope.",
    stages: STAGES,
    items: shown.map((system) => {
      const pct = pctBySystem.get(system.id);
      return {
        id: system.id,
        name: system.name,
        href: `/systems/${system.id}`,
        stage: stageOf(system.status),
        pct: pct === null || pct === undefined ? null : Math.round(pct),
        risks: risksBySystem.get(system.id) ?? 0,
      };
    }),
  };
}

// Compliance Manager: Framework coverage

const MAX_RINGS = 8;

/** The share of each Framework's Requirements that are covered (a Full Control Mapping), the figure of the Coverage view. */
export async function loadFrameworkRingsPicture(user: { role: UserRole }, limit = MAX_RINGS): Promise<HomePicture> {
  const { frameworks, summaries } = await prisma.$transaction(
    async (tx) => {
      const frameworks = await tx.framework.findMany({
        where: visibleFrameworksWhere(user),
        orderBy: [{ isBase: "desc" }, { name: "asc" }, { version: "desc" }],
        select: { id: true, name: true, version: true },
      });
      return { frameworks, summaries: await loadCoverageSummaries(frameworks.map((framework) => framework.id), tx) };
    },
    { isolationLevel: "RepeatableRead" },
  );
  const withRequirements = frameworks.filter((framework) => summaries[framework.id].total > 0);
  return {
    type: "rings",
    title: "Framework coverage by the Control Library",
    note: "share of Requirements covered",
    empty: "No Framework has Requirements yet.",
    items: withRequirements.slice(0, limit).map((framework) => ({
      id: framework.id,
      name: frameworkLabel(framework),
      value: Math.round((summaries[framework.id].covered / summaries[framework.id].total) * 100),
      href: `/frameworks/${framework.id}/coverage`,
    })),
  };
}

// Internal Auditor: Check-up states of launched audits

const AUDIT_LEGEND = [
  { label: "Evaluated", tone: "var(--rg-accent)" },
  { label: "To evaluate", tone: "var(--rg-gold)" },
  { label: "Not answered", tone: "var(--rg-line)" },
  { label: "Withdrawn", tone: "var(--rg-muted)" },
];

type CheckUpFlags = { response: unknown; evaluation: unknown; withdrawal: unknown };

/** [evaluated, to evaluate, not answered, withdrawn]: a withdrawn Check-up is only withdrawn, whatever else it has. */
export function checkUpStateCounts(checkUps: CheckUpFlags[]): [number, number, number, number] {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const checkUp of checkUps) {
    if (checkUp.withdrawal) counts[3] += 1;
    else if (checkUp.evaluation) counts[0] += 1;
    else if (checkUp.response) counts[1] += 1;
    else counts[2] += 1;
  }
  return counts;
}

export type AuditOverview = { picture: HomePicture; rows: (TaskRow & { updatedAt: Date })[] };

const MAX_AUDITS_DRAWN = 6;

/**
 * The launched Internal Audits (any auditor's; every auditor reads them all) drawn by Check-up state, and
 * one task row per audit the user created itself: a draft to finish, an audit with answers to evaluate,
 * one waiting on the owners, or one ready to close. One row per audit, not per Check-up (product-owner
 * decision 20a on #156). Read in one RepeatableRead snapshot.
 */
export async function loadAuditOverview(userId: string): Promise<AuditOverview> {
  const audits = await prisma.$transaction(
    (tx) =>
      tx.internalAudit.findMany({
        where: { OR: [{ status: "LAUNCHED" }, { status: "DRAFT", createdById: userId }] },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          createdById: true,
          launchedAt: true,
          updatedAt: true,
          checkUps: { select: { response: { select: { id: true } }, evaluation: { select: { id: true } }, withdrawal: { select: { id: true } } } },
        },
      }),
    { isolationLevel: "RepeatableRead" },
  );

  const launched = audits.filter((audit) => audit.status === "LAUNCHED");
  const rows: AuditOverview["rows"] = [];
  for (const audit of audits.filter((a) => a.createdById === userId)) {
    const base = { id: `${audit.id}:audit`, kind: "Audit", title: audit.title, href: `/internal-audits/${audit.id}`, updatedAt: audit.launchedAt ?? audit.updatedAt };
    if (audit.status === "DRAFT") {
      rows.push({ ...base, subtitle: "Draft · write the questions and launch it", tone: "neutral", status: "Draft" });
      continue;
    }
    const [evaluated, toEvaluate, notAnswered, withdrawn] = checkUpStateCounts(audit.checkUps);
    if (toEvaluate > 0) {
      rows.push({
        ...base,
        subtitle: `${toEvaluate} answered ${toEvaluate === 1 ? "Check-up" : "Check-ups"} to evaluate${notAnswered > 0 ? ` · ${notAnswered} not answered yet` : ""}`,
        tone: "warn",
        status: `${toEvaluate} to evaluate`,
      });
    } else if (notAnswered > 0) {
      rows.push({ ...base, subtitle: `${notAnswered} ${notAnswered === 1 ? "Check-up" : "Check-ups"} not answered yet`, tone: "neutral", status: "Waiting on owners" });
    } else {
      rows.push({ ...base, subtitle: `All ${evaluated + withdrawn} Check-ups evaluated or withdrawn · ready to close`, tone: "success", status: "Ready to close" });
    }
  }

  return {
    rows,
    picture: {
      type: "audits",
      title: "Launched audits by Check-up state",
      note: noteCount(launched.length, "launched audit", Math.min(launched.length, MAX_AUDITS_DRAWN)),
      empty: "No Internal Audit is launched.",
      legend: AUDIT_LEGEND,
      items: launched.slice(0, MAX_AUDITS_DRAWN).map((audit) => ({
        id: audit.id,
        name: audit.title,
        href: `/internal-audits/${audit.id}`,
        parts: [...checkUpStateCounts(audit.checkUps)],
      })),
    },
  };
}

// Admin: users by role

export async function loadUsersByRolePicture(): Promise<{ picture: HomePicture; total: number }> {
  const groups = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  return {
    total,
    picture: {
      type: "bars",
      title: "Users by role",
      note: `${total} ${total === 1 ? "user" : "users"}`,
      empty: "There are no users.",
      items: groups
        .map((group) => ({ id: group.role, name: roleLabel(group.role), value: group._count._all }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "en")),
    },
  };
}

// Viewer: Onboarded Systems by Business Unit

export const NO_BUSINESS_UNIT = "No Business Unit";

/** Onboarded Systems (every role reads these) grouped by the Business Unit(s) that use them; a System with none is grouped last. */
export async function loadOnboardedByBusinessUnitPicture(): Promise<HomePicture> {
  const systems = await prisma.system.findMany({
    where: { status: "ONBOARDED" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, businessUnits: { select: { name: true }, orderBy: { name: "asc" } } },
  });
  const shown = systems.slice(0, MAX_SYSTEMS_DRAWN * 2);
  const groups = new Map<string, { id: string; name: string; href: string }[]>();
  for (const system of shown) {
    const names = system.businessUnits.length > 0 ? system.businessUnits.map((unit) => unit.name) : [NO_BUSINESS_UNIT];
    for (const name of names) groups.set(name, [...(groups.get(name) ?? []), { id: system.id, name: system.name, href: `/systems/${system.id}` }]);
  }
  return {
    type: "mosaic",
    title: "Onboarded Systems by Business Unit",
    note: noteCount(systems.length, "System", shown.length),
    empty: "No System has completed onboarding yet.",
    groups: [...groups.entries()]
      .sort(([a], [b]) => (a === NO_BUSINESS_UNIT ? 1 : b === NO_BUSINESS_UNIT ? -1 : a.localeCompare(b, "en")))
      .map(([name, items]) => ({ name, items })),
  };
}
