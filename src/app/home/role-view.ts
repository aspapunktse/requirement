import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import type { NavTile } from "@/components/ui/TileNav";
import { getAllOpenRisks } from "@/lib/dashboard";
import { getOpenStepsForUser } from "@/lib/review-steps";
import { scopedSystemsWhere, getAssignedScope } from "@/lib/business-risk-owner";
import { getActionableQueries } from "@/lib/assessment-queries";
import { getOwnerTasks, mergeTaskRows } from "@/lib/owner-tasks";
import { getControlOwnerTasks } from "@/lib/control-owner-tasks";
import { getCheckUpTasks, MY_CHECK_UPS_HREF } from "@/lib/check-up-tasks";
import { countAwaitingEvaluation } from "@/lib/check-up-evaluations";
import { riskSeverityTone } from "@/lib/status-tones";
import {
  canReadOrganizationRisks,
  ORGANIZATION_RISK_LABEL,
  ORGANIZATION_RISKS_HREF,
  riskHref,
  RISK_INCLUDE,
  SYSTEM_RISK_WHERE,
} from "@/lib/risks";
import { visibleFrameworksWhere } from "@/lib/frameworks";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { isReadOnlySystemRole } from "@/lib/system-permissions";
import { frameworkLabel } from "@/lib/framework-label";
import { BASE_REVIEW_STEP_NAME } from "@/lib/review-steps";
import { loadRecentActivity } from "./home-activity";
import { computeTrends } from "./home-trends";
import { withSnapshotTrends } from "./home-snapshots";
import {
  daysSince,
  loadAuditOverview,
  loadFrameworkRingsPicture,
  loadOnboardedByBusinessUnitPicture,
  loadPipelinePicture,
  loadPortfolioPicture,
  loadUsersByRolePicture,
  pipelineFlags,
  REVIEW_TARGET_DAYS,
  reviewWaitPicture,
  riskHeatPicture,
} from "./home-pictures";
import type { HomeActivity, HomeLane, HomePicture, HomeStat, HomeTask } from "./home-types";

/** Compliance Manager, Admin and Internal Auditor shortcut to the Organization's Control implementations (#120, #147). */
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

/** The roles that read Internal Audits without running them (#152); the Internal Auditor's own tile is in its case. */
const INTERNAL_AUDITS_READ_TILE: NavTile = {
  title: "Internal Audits",
  description: "Read-only: the audits the Internal Auditors plan and run.",
  href: "/internal-audits",
};

/** The read-only Control Library (#169), for the roles that don't have the editor tile. */
const CONTROL_LIBRARY_TILE: NavTile = {
  title: "Control Library",
  description: "Every Control: what it applies to and the Requirements it satisfies. Read-only.",
  href: "/controls",
};

/** The Risks that belong to no System (#157): managed by the Risk Owner and the Admin, read by the Internal Auditor. */
const ORGANIZATION_RISKS_TILE: NavTile = {
  title: "Organization Risks",
  description: "Risks that belong to no System, opened by an Internal Audit's Nonconformity on the Organization.",
  href: ORGANIZATION_RISKS_HREF,
};

/** Anyone with a Check-up addressed to them can reach the answered ones too (#155); shown only to those who have one. */
const MY_CHECK_UPS_TILE: NavTile = {
  title: "Your Check-ups",
  description: "The Check-ups addressed to you, open and answered. An answer can be changed until the Internal Auditor evaluates it.",
  href: MY_CHECK_UPS_HREF,
};

export type RoleView = {
  lede: string;
  /** What the role is scoped to (a Business Risk Owner's Business Units and Frameworks), shown as a chip. */
  scope?: string;
  stats: HomeStat[];
  /** Always a list (possibly empty): the page shows an empty state instead of hiding the section. */
  tasks: HomeTask[];
  tiles: NavTile[];
  picture: HomePicture;
  activity: HomeActivity[];
};

/** What a role's own case builds, before the owner / Control Owner / Check-up rows and the lanes are added. */
type RoleViewDraft = {
  lede: string;
  scope?: string;
  stats: HomeStat[];
  tasks?: (TaskRow & { updatedAt?: Date })[];
  tiles: NavTile[];
  picture?: HomePicture;
  /** When each review the Reviewer waits on was submitted, for the trend of its figures. */
  reviewStarts?: Date[];
};

/**
 * Whose move a task is (proposal A's urgency lanes). The one place the rule lives, from the row's kind and
 * status chip:
 * - "Your move": anything the user must act on now: a rejected System, Controls to assess, a Query awaiting
 *   a reply, an open Risk rated Critical or High, a Control implementation to start or continue, an overdue
 *   Check-up, a System awaiting the user's review, an audit with answers to evaluate or ready to close.
 * - "Waiting on others": the ball is with someone else: an owned System in review, an audit whose Check-ups
 *   the owners have not answered yet.
 * - "Coming up": not yet due or only getting stale: a stale assessment, an open Check-up that is not
 *   overdue, a Medium or Low Risk, a draft audit.
 * Anything else is the user's move: a row nobody else is working on should not hide in a quiet lane.
 */
export function classifyLane(row: { kind: string; status: string }): HomeLane {
  switch (row.kind) {
    case "System":
      if (row.status === "In review") return "waiting";
      return row.status === "Stale assessment" ? "soon" : "you";
    case "Risk":
      return row.status === "Critical" || row.status === "High" ? "you" : "soon";
    case "Check-up":
      return row.status === "Overdue" ? "you" : "soon";
    case "Audit":
      if (row.status === "Waiting on owners") return "waiting";
      return row.status === "Draft" ? "soon" : "you";
    default:
      return "you";
  }
}

/** The one primary action of a task row: a short verb for the button, from its kind, status and the user's role. */
export function taskAction(row: { kind: string; status: string }, role: UserRole): string {
  switch (row.kind) {
    case "System":
      if (row.status === "Rejected") return "Fix and resubmit";
      if (row.status === "Needs assessment") return "Assess";
      if (row.status === "In review") return "View";
      return "Review";
    case "Query":
      return row.status === "Awaiting your reply" ? "Reply" : "Open";
    case "Risk":
      return role === "BUSINESS_RISK_OWNER" || isReadOnlySystemRole({ role }) ? "View" : "Update";
    case "Check-up":
      return "Answer";
    case "Control":
      return row.status === "Not started" ? "Start" : "Continue";
    case "Audit":
      if (row.status === "Draft") return "Continue draft";
      if (row.status === "Ready to close") return "Close audit";
      return row.status === "Waiting on owners" ? "View" : "Evaluate next";
    default:
      return "Open";
  }
}

function toHomeTask(row: TaskRow, role: UserRole, now: Date): HomeTask {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    ...(row.subtitle !== undefined && { subtitle: row.subtitle }),
    tone: row.tone,
    status: row.status,
    href: row.href,
    lane: classifyLane(row),
    days: row.updatedAt ? daysSince(row.updatedAt, now) : null,
    action: taskAction(row, role),
  };
}

/** The task kind a headline figure filters the list by, where it counts exactly those rows. */
const STAT_FILTER: Record<string, string> = {
  "Needing attention": "System",
  "Your Systems needing attention": "System",
  "Awaiting review": "System",
  "Open questions": "Query",
  "Open risks": "Risk",
  "Open risks in scope": "Risk",
};
/** Figures that read as "something to do" when above zero. */
const WARN_WHEN_POSITIVE = new Set(Object.keys(STAT_FILTER));

function decorateStat(stat: HomeStat): HomeStat {
  const filter = STAT_FILTER[stat.label];
  const tone = stat.tone ?? (WARN_WHEN_POSITIVE.has(stat.label) && typeof stat.value === "number" && stat.value > 0 ? "warn" : stat.label === "Onboarded systems" ? "ok" : undefined);
  return { ...stat, ...(filter && { filter }), ...(tone && { tone }) };
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** Systems the user owns that are In Review: the Reviewers' move, so "waiting on others" (owner tasks skip them). */
async function ownedInReviewRows(user: { id: string; role: UserRole }): Promise<TaskRow[]> {
  if (isReadOnlySystemRole(user)) return [];
  const systems = await prisma.system.findMany({ where: { ownerId: user.id, status: "IN_REVIEW" }, orderBy: { updatedAt: "asc" }, select: { id: true, name: true, updatedAt: true } });
  return systems.map(
    (system): TaskRow => ({
      id: `${system.id}:in-review`,
      kind: "System",
      title: system.name,
      subtitle: "Submitted for review, waiting for a decision",
      tone: "neutral",
      status: "In review",
      updatedAt: system.updatedAt,
      href: `/systems/${system.id}`,
    }),
  );
}

/**
 * What `/home` shows for `user`: the role's own view (lede, stats, tasks,
 * tiles) plus, for anyone who owns at least one System, the owner tasks
 * (#98). Ownership is `ownerId` alone, whatever the role, so a REVIEWER or
 * VIEWER who owns a System also sees its rejected / stale / needs-assessment
 * rows and the Queries awaiting their reply. A user who owns nothing sees
 * exactly the role view. A COMPLIANCE_MANAGER or INTERNAL_AUDITOR never gets System
 * owner tasks, and a SYSTEM_OWNER always gets the section, even while it's empty.
 *
 * Control Owner tasks (#120) are separate: one row per Control the user owns
 * whose Organization Control Implementation is Not Started or In Progress, for
 * any role but the strictly read-only INTERNAL_AUDITOR (who may not edit the
 * implementation), a COMPLIANCE_MANAGER included (owning a Control is not owning a
 * System). They follow the System owner rows and come before the role's own.
 *
 * Open Check-ups (#155) addressed to the user, as the owner of the System or the Control Owner
 * of an Organization-level target, are rows too, for any role but the Internal Auditor (who may
 * not answer its own audit's Check-ups), after the Control Owner rows. A user with any Check-up,
 * answered ones included, also gets the "Your Check-ups" tile.
 */
export async function roleView(user: { id: string; name: string; role: UserRole }, now = new Date()): Promise<RoleView> {
  const reviewStepRows = (await getOpenStepsForUser(user)).map(
    ({ system, step }): TaskRow => ({
      // The base step keeps the System's id (a Reviewer's row since before Review Steps); a group's step has its own row.
      id: step.reviewGroupId === null ? system.id : `${system.id}:step:${step.reviewGroupId}`,
      kind: "System",
      title: system.name,
      subtitle: step.name,
      tone: "accent",
      status: "Awaiting review",
      updatedAt: system.updatedAt,
      href: `/systems/${system.id}`,
    }),
  );
  const [view, owner, controlRows, checkUps, inReviewRows, activity] = await Promise.all([
    roleOwnView(user, reviewStepRows)
      .then((own) => withReviewStepTasks(own, user, reviewStepRows))
      .then((own) => withMemberQueryTasks(own, user))
      .then((own) => withControlLibraryTile(own, user))
      .then(withStatementOfApplicabilityTile)
      .then((view) => withOrganizationRisksTile(user, view))
      .then((view) => withInternalAuditsReadTile(user, view)),
    getOwnerTasks(user),
    getControlOwnerTasks(user),
    getCheckUpTasks(user),
    ownedInReviewRows(user),
    loadRecentActivity(user, now),
  ]);
  const isSystemOwnerRole = user.role === "SYSTEM_OWNER";
  if (checkUps.total > 0) view.tiles = [...view.tiles, MY_CHECK_UPS_TILE];

  let stats = [...view.stats];
  let tasks = view.tasks ?? [];
  if (isSystemOwnerRole || owner.ownedCount > 0 || controlRows.length > 0 || checkUps.rows.length > 0) {
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
    tasks = mergeTaskRows([...owner.rows, ...controlRows, ...checkUps.rows], tasks);
  }
  tasks = [...tasks, ...inReviewRows];
  stats = stats.map(decorateStat);
  const queryScope =
    user.role === "REVIEWER" || user.role === "RISK_OWNER"
      ? undefined
      : { ownerId: user.id };
  const derived = await computeTrends(
    user,
    stats.map((stat) => stat.label),
    { reviewStarts: view.reviewStarts, attentionSystemIds: [...pipelineFlags(owner.rows).keys()], queryScope },
    now,
  );
  // Past points with a recorded daily snapshot (#227) replace the values derived from timestamps.
  const trends = await withSnapshotTrends(user.id, derived, now);
  stats = stats.map((stat) => (trends[stat.label] ? { ...stat, trend: trends[stat.label] } : stat));

  const picture = isSystemOwnerRole ? await loadPipelinePicture(user.id, pipelineFlags(owner.rows)) : (view.picture ?? EMPTY_PICTURE);

  return {
    lede: view.lede,
    ...(view.scope && { scope: view.scope }),
    stats,
    tasks: tasks.map((row) => toHomeTask(row, user.role, now)),
    tiles: view.tiles,
    picture,
    activity,
  };
}

const EMPTY_PICTURE: HomePicture = { type: "mosaic", title: "Overview", note: "", empty: "Nothing to show yet.", groups: [] };

/**
 * Open Assessment Queries on Controls in the remit of the user's Review Groups, where it is the
 * reviewer side's turn (#201). A Reviewer's and a Risk Owner's own view already lists every Query, so
 * they are skipped; an Internal Auditor is never a member. Rows already in the view are not repeated.
 */
async function withMemberQueryTasks(view: RoleViewDraft, user: { id: string; role: UserRole }): Promise<RoleViewDraft> {
  if (user.role === "REVIEWER" || user.role === "RISK_OWNER" || user.role === "INTERNAL_AUDITOR") return view;
  // One read, empty for anyone in no group: this runs on every landing page.
  const systems = await prisma.system.findMany({
    where: { frameworkScopes: { some: { reviewGroup: { members: { some: { id: user.id } } } } }, ownerId: { not: user.id } },
    select: { id: true },
  });
  if (systems.length === 0) return view;
  const queries = await getActionableQueries(
    user,
    systems.map((system) => system.id),
    { membershipOnly: true },
  );
  const seen = new Set((view.tasks ?? []).map((row) => row.id));
  const rows = queries
    .filter((query) => !seen.has(query.id))
    .map((query): TaskRow => ({
      id: query.id,
      kind: "Query",
      title: query.controlTitle,
      subtitle: query.systemName,
      tone: "accent",
      status: "Your turn",
      updatedAt: query.updatedAt,
      href: `/systems/${query.systemId}`,
    }));
  return rows.length === 0 ? view : { ...view, tasks: [...(view.tasks ?? []), ...rows] };
}

/**
 * Open Review Steps the user can decide (#199): a Reviewer's own view already lists them; for every other
 * role (an Admin, or anyone who is a member of a Review Group) they follow the role's own tasks.
 */
function withReviewStepTasks(view: RoleViewDraft, user: { role: UserRole }, rows: TaskRow[]): RoleViewDraft {
  if (user.role === "REVIEWER" || rows.length === 0) return view;
  return { ...view, tasks: [...(view.tasks ?? []), ...rows] };
}

/** Admin and Compliance Manager already have the editor tile; everyone else gets the read-only page. */
function withControlLibraryTile(view: RoleViewDraft, user: { role: UserRole }): RoleViewDraft {
  if (user.role === "ADMIN" || user.role === "COMPLIANCE_MANAGER") return view;
  return { ...view, tiles: [...view.tiles, CONTROL_LIBRARY_TILE] };
}

function withStatementOfApplicabilityTile(view: RoleViewDraft): RoleViewDraft {
  return { ...view, tiles: [...view.tiles, STATEMENT_OF_APPLICABILITY_TILE] };
}

function withOrganizationRisksTile(user: { role: UserRole }, view: RoleViewDraft): RoleViewDraft {
  if (!canReadOrganizationRisks(user)) return view;
  return { ...view, tiles: [...view.tiles, ORGANIZATION_RISKS_TILE] };
}

function withInternalAuditsReadTile(user: { role: UserRole }, view: RoleViewDraft): RoleViewDraft {
  if (user.role === "INTERNAL_AUDITOR" || !canReadInternalAudits(user)) return view;
  return { ...view, tiles: [...view.tiles, INTERNAL_AUDITS_READ_TILE] };
}

async function roleOwnView(user: { id: string; name: string; role: UserRole }, reviewStepRows: TaskRow[]): Promise<RoleViewDraft> {
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
      const [controls, facets, users] = await Promise.all([prisma.control.count(), prisma.deploymentFacet.count(), loadUsersByRolePicture()]);

      return {
        lede: "Manage the catalogs every System's onboarding is assessed against.",
        stats: [
          { label: "Controls", value: controls },
          { label: "Deployment facets", value: facets },
          { label: "Users", value: users.total },
        ],
        picture: users.picture,
        tiles: [
          { title: "Controls", description: "Manage the Control Library.", href: "/admin/controls" },
          { title: "Deployment Facets", description: "Manage deployment classifications.", href: "/admin/deployment-facets" },
          { title: "Review Groups", description: "Manage who reviews each Framework.", href: "/admin/review-groups" },
          ORGANIZATION_CONTROLS_TILE,
        ],
      };
    }

    case "COMPLIANCE_MANAGER": {
      const [controls, frameworks, picture] = await Promise.all([prisma.control.count(), prisma.framework.count(), loadFrameworkRingsPicture(user)]);

      return {
        lede: "Curate the requirement database: the Control Library and the Frameworks it maps to.",
        stats: [
          { label: "Controls", value: controls },
          { label: "Frameworks", value: frameworks },
        ],
        picture,
        tiles: [
          { title: "Control Library", description: "Author Controls and scope what each applies to.", href: "/admin/controls" },
          { title: "Frameworks", description: "Manage the Framework catalog.", href: "/admin/frameworks" },
          ORGANIZATION_CONTROLS_TILE,
          { title: "Browse Systems", description: "Every System across every status, read-only.", href: "/systems" },
        ],
      };
    }

    case "INTERNAL_AUDITOR": {
      const [systems, frameworks, draftAudits, launchedAudits, awaitingEvaluation, audits] = await Promise.all([
        prisma.system.count(),
        prisma.framework.count({ where: visibleFrameworksWhere(user) }),
        prisma.internalAudit.count({ where: { status: "DRAFT" } }),
        prisma.internalAudit.count({ where: { status: "LAUNCHED" } }),
        countAwaitingEvaluation(),
        loadAuditOverview(user.id),
      ]);

      return {
        lede: "Read everything and change nothing outside your own audits: every System, Control, Framework and Risk, with the Organization's implementation of each Control.",
        stats: [
          { label: "Systems", value: systems },
          { label: "Frameworks", value: frameworks },
          { label: "Draft Internal Audits", value: draftAudits },
          // Answered Check-ups to evaluate (#156): a count, not a task row per Check-up; each audit's page
          // links the next one. Product-owner decision 20a of 2026-10-13 (comment on #156).
          { label: "Check-ups awaiting evaluation", value: awaitingEvaluation },
        ],
        // One row per audit the auditor created (not per Check-up, decision 20a on #156).
        tasks: audits.rows,
        picture: audits.picture,
        tiles: [
          {
            title: "Internal Audits",
            description: "Plan an audit as a draft, write its questions and launch it to send the Check-ups.",
            href: "/internal-audits",
            foot: `${draftAudits === 1 ? "1 draft" : `${draftAudits} drafts`}, ${launchedAudits} launched`,
          },
          { title: "Browse Systems", description: "Every System across every status, read-only.", href: "/systems" },
          ORGANIZATION_CONTROLS_TILE,
        ],
      };
    }

    case "REVIEWER": {
      const allSystemIds = (await prisma.system.findMany({ select: { id: true } })).map((s) => s.id);
      const openQueries = await getActionableQueries(user, allSystemIds);

      const tasks: TaskRow[] = [
        ...reviewStepRows,
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

      // How long each review has waited: from the System's latest Review Round, else its last update.
      const systemIdOf = (row: TaskRow) => row.href.split("/").pop() ?? row.id;
      const rounds = await prisma.reviewRound.findMany({
        where: { systemId: { in: reviewStepRows.map(systemIdOf) } },
        orderBy: { submittedAt: "desc" },
        select: { systemId: true, submittedAt: true },
      });
      const submittedAt = new Map<string, Date>();
      for (const round of rounds) if (!submittedAt.has(round.systemId)) submittedAt.set(round.systemId, round.submittedAt);
      const now = new Date();
      const waits = reviewStepRows.map((row) => ({
        id: row.id,
        name: row.subtitle && row.subtitle !== BASE_REVIEW_STEP_NAME ? `${row.title} · ${row.subtitle}` : row.title,
        href: row.href,
        days: daysSince(submittedAt.get(systemIdOf(row)) ?? row.updatedAt ?? now, now),
      }));
      const oldest = Math.max(0, ...waits.map((wait) => wait.days));

      return {
        lede: "Systems waiting on your Approval decision, and questions where the System Owner has replied.",
        stats: [
          { label: "Awaiting review", value: reviewStepRows.length },
          { label: "Open questions", value: openQueries.length },
          { label: "Oldest waiting", value: waits.length === 0 ? "none" : `${oldest} d`, ...(oldest > REVIEW_TARGET_DAYS && { tone: "danger" as const }) },
        ],
        picture: reviewWaitPicture(waits),
        reviewStarts: reviewStepRows.map((row) => submittedAt.get(systemIdOf(row)) ?? row.updatedAt ?? now),
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
          { label: "Critical", value: openRisks.filter((risk) => risk.severity === "CRITICAL").length, ...(openRisks.some((risk) => risk.severity === "CRITICAL") && { tone: "danger" as const }) },
          { label: "Open questions", value: openQueries.length },
        ],
        picture: riskHeatPicture(openRisks),
        tasks: riskAndQueryTasks(openRisks, openQueries),
        tiles: [{ title: "Browse Systems", description: "Every System across every status.", href: "/systems" }],
      };
    }

    case "BUSINESS_RISK_OWNER": {
      const scope = await getAssignedScope(user.id);
      const [openRisks, openQueries, scopeUnits, scopeFrameworks] = await Promise.all([
        prisma.risk.findMany({
          // Never an Organization Risk (#157): the scoped views are per System.
          where: { status: "OPEN", ...SYSTEM_RISK_WHERE, system: scopedSystemsWhere(scope) },
          include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        }),
        getActionableQueries(
          user,
          (
            await prisma.system.findMany({ where: scopedSystemsWhere(scope), select: { id: true } })
          ).map((s) => s.id),
        ),
        prisma.businessUnit.findMany({ where: { id: { in: scope.businessUnitIds } }, orderBy: { name: "asc" }, select: { name: true } }),
        prisma.framework.findMany({ where: { id: { in: scope.frameworkIds } }, orderBy: { name: "asc" }, select: { name: true, version: true } }),
      ]);
      const scopeNames = [...scopeUnits.map((unit) => unit.name), ...scopeFrameworks.map(frameworkLabel)];

      return {
        lede: "Open Risks across the Systems in your assigned Business Unit(s)/Framework(s).",
        ...(scopeNames.length > 0 && { scope: scopeNames.join(" · ") }),
        stats: [{ label: "Open risks in scope", value: openRisks.length }],
        picture: await loadPortfolioPicture(scope, openRisks),
        tasks: riskAndQueryTasks(openRisks, openQueries),
        tiles: [
          { title: "Your scoped dashboard", description: "Risks and compliance across your assigned scope.", href: "/business-risk-owner" },
        ],
      };
    }

    case "VIEWER":
    default: {
      const [onboardedCount, picture] = await Promise.all([prisma.system.count({ where: { status: "ONBOARDED" } }), loadOnboardedByBusinessUnitPicture()]);

      return {
        lede: "Browse every System that has completed onboarding.",
        stats: [{ label: "Onboarded systems", value: onboardedCount }],
        picture,
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
      subtitle: risk.system?.name ?? ORGANIZATION_RISK_LABEL,
      tone: riskSeverityTone(risk.severity),
      status: titleCase(risk.severity),
      updatedAt: risk.updatedAt,
      href: riskHref(risk),
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
