import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import type { NavTile } from "@/components/ui/TileNav";
import { getSystemsAwaitingApproval, getAllOpenRisks } from "@/lib/dashboard";
import { scopedSystemsWhere, getAssignedScope } from "@/lib/business-risk-owner";
import { getActionableQueries } from "@/lib/assessment-queries";
import { getOwnerTasks, mergeTaskRows } from "@/lib/owner-tasks";
import { getControlOwnerTasks } from "@/lib/control-owner-tasks";
import { riskSeverityTone } from "@/lib/status-tones";
import { RISK_INCLUDE } from "@/lib/risks";

/** Compliance Manager and Admin shortcut to the Organization's Control implementations (#120). */
const ORGANIZATION_CONTROLS_TILE: NavTile = {
  title: "Organization Controls",
  description: "How the Organization implements its Organizational and Both Controls.",
  href: "/organization/controls",
};

/** Every role can read the Statement of Applicability (#145). */
const STATEMENT_OF_APPLICABILITY_TILE: NavTile = {
  title: "Statement of Applicability",
  description: "Every Control: included or excluded, why, and how far it is implemented.",
  href: "/statement-of-applicability",
};

export type RoleView = {
  lede: string;
  stats: { label: string; value: number | string }[];
  tasks?: TaskRow[];
  tiles: NavTile[];
};

/**
 * What `/home` shows for `user`: the role's own view (lede, stats, tasks,
 * tiles) plus, for anyone who owns at least one System, the owner tasks
 * (#98). Ownership is `ownerId` alone, whatever the role, so a REVIEWER or
 * VIEWER who owns a System also sees its rejected / stale / needs-assessment
 * rows and the Queries awaiting their reply. A user who owns nothing sees
 * exactly the role view. A COMPLIANCE_MANAGER never gets System owner tasks, and a
 * SYSTEM_OWNER always gets the section, even while it's empty.
 *
 * Control Owner tasks (#120) are separate: one row per Control the user owns
 * whose Organization Control Implementation is Not Started or In Progress, for
 * any role, a COMPLIANCE_MANAGER included (owning a Control is not owning a
 * System). They follow the System owner rows and come before the role's own.
 */
export async function roleView(user: { id: string; name: string; role: UserRole }): Promise<RoleView> {
  const [view, owner, controlRows] = await Promise.all([
    roleOwnView(user).then(withStatementOfApplicabilityTile),
    getOwnerTasks(user),
    getControlOwnerTasks(user),
  ]);
  const isSystemOwnerRole = user.role === "SYSTEM_OWNER";
  if (!isSystemOwnerRole && owner.ownedCount === 0 && controlRows.length === 0) return view;

  const stats = [...view.stats];
  if (isSystemOwnerRole) {
    stats.push({ label: "Needing attention", value: owner.needingAttentionCount });
    stats.push({ label: "Open questions", value: owner.openQuestionCount });
  } else if (owner.ownedCount > 0) {
    // A second headline pair next to the role's own would clutter the strip.
    // "Your Systems needing attention" is always new information; the open
    // questions are skipped where the role's own "Open questions" stat
    // already counts them (REVIEWER, RISK_OWNER: it spans every System,
    // owner-side Queries on owned Systems included).
    stats.push({ label: "Your Systems needing attention", value: owner.needingAttentionCount });
    if (!stats.some((stat) => stat.label === "Open questions")) {
      stats.push({ label: "Open questions", value: owner.openQuestionCount });
    }
  }

  return { ...view, stats, tasks: mergeTaskRows([...owner.rows, ...controlRows], view.tasks ?? []) };
}

function withStatementOfApplicabilityTile(view: RoleView): RoleView {
  return { ...view, tiles: [...view.tiles, STATEMENT_OF_APPLICABILITY_TILE] };
}

async function roleOwnView(user: { id: string; name: string; role: UserRole }): Promise<RoleView> {
  switch (user.role) {
    case "SYSTEM_OWNER":
      // Its tasks and stats are the owner tasks, added by `roleView` for every role.
      return {
        lede: "Track the Systems you own through onboarding, and reply to anything a Reviewer or Risk Owner has raised.",
        stats: [],
        tiles: [
          { title: "Create a System", description: "Start onboarding a new system or cloud solution.", href: "/systems/new" },
          { title: "Browse your Systems", description: "Every System you own, regardless of status.", href: "/systems?owner=me" },
        ],
      };

    case "ADMIN": {
      const [controls, facets] = await Promise.all([prisma.control.count(), prisma.deploymentFacet.count()]);

      return {
        lede: "Manage the catalogs every System's onboarding is assessed against.",
        stats: [
          { label: "Controls", value: controls },
          { label: "Deployment facets", value: facets },
        ],
        tiles: [
          { title: "Controls", description: "Manage the Control Library.", href: "/admin/controls" },
          { title: "Deployment Facets", description: "Manage deployment classifications.", href: "/admin/deployment-facets" },
          ORGANIZATION_CONTROLS_TILE,
        ],
      };
    }

    case "COMPLIANCE_MANAGER": {
      const [controls, frameworks] = await Promise.all([prisma.control.count(), prisma.framework.count()]);

      return {
        lede: "Curate the requirement database: the Control Library and the Frameworks it maps to.",
        stats: [
          { label: "Controls", value: controls },
          { label: "Frameworks", value: frameworks },
        ],
        tiles: [
          { title: "Control Library", description: "Author Controls and scope what each applies to.", href: "/admin/controls" },
          { title: "Frameworks", description: "Manage the Framework catalog.", href: "/admin/frameworks" },
          ORGANIZATION_CONTROLS_TILE,
          { title: "Browse Systems", description: "Every System across every status, read-only.", href: "/systems" },
        ],
      };
    }

    case "REVIEWER": {
      const allSystemIds = (await prisma.system.findMany({ select: { id: true } })).map((s) => s.id);
      const [awaiting, openQueries] = await Promise.all([
        getSystemsAwaitingApproval(),
        getActionableQueries(user, allSystemIds),
      ]);

      const tasks: TaskRow[] = [
        ...awaiting.map((system): TaskRow => ({
          id: system.id,
          kind: "System",
          title: system.name,
          tone: "accent",
          status: "Awaiting review",
          updatedAt: system.updatedAt,
          href: `/systems/${system.id}`,
        })),
        ...openQueries.map((query): TaskRow => ({
          id: query.id,
          kind: "Query",
          title: query.controlTitle,
          subtitle: query.systemName,
          tone: "accent",
          status: "Your turn",
          updatedAt: query.updatedAt,
          href: `/systems/${query.systemId}`,
        })),
      ];

      return {
        lede: "Systems waiting on your Approval decision, and questions where the System Owner has replied.",
        stats: [
          { label: "Awaiting review", value: awaiting.length },
          { label: "Open questions", value: openQueries.length },
        ],
        tasks,
        tiles: [{ title: "Browse Systems", description: "Every System across every status.", href: "/systems" }],
      };
    }

    case "RISK_OWNER": {
      const allSystemIds = (await prisma.system.findMany({ select: { id: true } })).map((s) => s.id);
      const [openRisks, openQueries] = await Promise.all([
        getAllOpenRisks(),
        getActionableQueries(user, allSystemIds),
      ]);

      return {
        lede: "Open Risks across every System that still need a status update, and questions where it's your turn to look.",
        stats: [
          { label: "Open risks", value: openRisks.length },
          { label: "Open questions", value: openQueries.length },
        ],
        tasks: riskAndQueryTasks(openRisks, openQueries),
        tiles: [{ title: "Browse Systems", description: "Every System across every status.", href: "/systems" }],
      };
    }

    case "BUSINESS_RISK_OWNER": {
      const scope = await getAssignedScope(user.id);
      const [openRisks, openQueries] = await Promise.all([
        prisma.risk.findMany({
          where: { status: "OPEN", system: scopedSystemsWhere(scope) },
          include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        }),
        getActionableQueries(
          user,
          (
            await prisma.system.findMany({ where: scopedSystemsWhere(scope), select: { id: true } })
          ).map((s) => s.id),
        ),
      ]);

      return {
        lede: "Open Risks across the Systems in your assigned Business Unit(s)/Framework(s).",
        stats: [{ label: "Open risks in scope", value: openRisks.length }],
        tasks: riskAndQueryTasks(openRisks, openQueries),
        tiles: [
          { title: "Your scoped dashboard", description: "Risks and compliance across your assigned scope.", href: "/business-risk-owner" },
        ],
      };
    }

    case "VIEWER":
    default: {
      const onboardedCount = await prisma.system.count({ where: { status: "ONBOARDED" } });

      return {
        lede: "Browse every System that has completed onboarding.",
        stats: [{ label: "Onboarded systems", value: onboardedCount }],
        tiles: [
          { title: "Browse Onboarded Systems", description: "See every System that has completed onboarding.", href: "/systems?status=ONBOARDED" },
        ],
      };
    }
  }
}

type OpenRisk = Awaited<ReturnType<typeof getAllOpenRisks>>[number];

function riskAndQueryTasks(
  openRisks: OpenRisk[],
  openQueries: Awaited<ReturnType<typeof getActionableQueries>>,
): TaskRow[] {
  return [
    ...openRisks.map((risk): TaskRow => ({
      id: risk.id,
      kind: "Risk",
      title: risk.title,
      subtitle: risk.system.name,
      tone: riskSeverityTone(risk.severity),
      status: risk.severity,
      updatedAt: risk.updatedAt,
      href: `/systems/${risk.system.id}`,
    })),
    ...openQueries.map((query): TaskRow => ({
      id: query.id,
      kind: "Query",
      title: query.controlTitle,
      subtitle: query.systemName,
      tone: "accent",
      status: "Your turn",
      updatedAt: query.updatedAt,
      href: `/systems/${query.systemId}`,
    })),
  ];
}
