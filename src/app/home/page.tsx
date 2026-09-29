import type { UserRole } from "@prisma/client";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { PageHead } from "@/components/ui/PageHead";
import { TaskTable, type TaskRow } from "@/components/ui/TaskTable";
import { TileNav, type NavTile } from "@/components/ui/TileNav";
import { getSystemsNeedingAttention, getSystemsAwaitingApproval, getAllOpenRisks } from "@/lib/dashboard";
import { scopedSystemsWhere, getAssignedScope } from "@/lib/business-risk-owner";
import { getActionableQueryCount, getActionableQueries } from "@/lib/assessment-queries";
import { attentionReasonTone, riskSeverityTone } from "@/lib/status-tones";
import { RISK_INCLUDE } from "@/lib/risks";

/**
 * Role-differentiated landing page: a page-head with headline stats, a
 * unified "My tasks" table of everything needing this role's attention, and
 * a "Where to start" tile grid of pure navigation shortcuts. Redesign of the
 * plain DashboardCard grid from #54 — see issue #57 for the EMS "document
 * brief" pattern this follows, and #59 for why this lives at /home rather
 * than /.
 */
export default async function HomePage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const view = await roleView(user);
  // Every role can read the Framework Coverage view (#74), so it's a shortcut for all of them.
  const tiles: NavTile[] = [
    ...view.tiles,
    { title: "Framework coverage", description: "Which Requirements the Control Library covers, and the gaps.", href: "/frameworks" },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <PageHead
        breadcrumb={["ISMS · System onboarding", "Home"]}
        pageId={`HOME . ${user.role.replace(/_/g, " ")}`}
        title={`Welcome, ${user.name}.`}
        lede={view.lede}
        stats={[{ label: "Role", value: user.role.replace(/_/g, " ") }, ...view.stats]}
      />

      {view.tasks && (
        <section className="mb-8">
          <SectionHead title="My tasks" note={`${view.tasks.length} open`} />
          <TaskTable rows={view.tasks} />
        </section>
      )}

      <section>
        <SectionHead title="Where to start" note={`${tiles.length} shortcuts · click to open`} />
        <TileNav tiles={tiles} />
      </section>
    </div>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-zinc-300 pb-2 dark:border-zinc-700">
      <h2 className="font-sans! text-lg font-semibold text-ems-ink-1">{title}</h2>
      <p className="ems-mono-label text-right text-ems-ink-4">{`// ${note}`}</p>
    </div>
  );
}

type RoleView = {
  lede: string;
  stats: { label: string; value: number | string }[];
  tasks?: TaskRow[];
  tiles: NavTile[];
};

async function roleView(user: { id: string; name: string; role: UserRole }): Promise<RoleView> {
  switch (user.role) {
    case "SYSTEM_OWNER": {
      const ownedSystemIds = (
        await prisma.system.findMany({ where: { ownerId: user.id }, select: { id: true } })
      ).map((s) => s.id);
      const [attention, openQueries] = await Promise.all([
        getSystemsNeedingAttention(user.id),
        getActionableQueries(user, ownedSystemIds),
      ]);

      const tasks: TaskRow[] = [
        ...attention.map((system): TaskRow => ({
          id: system.id,
          kind: "System",
          title: system.name,
          tone: attentionReasonTone(system.reason),
          status: system.reason === "rejected" ? "Rejected" : "Stale assessment",
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
        lede: "Track the Systems you own through onboarding, and reply to anything a Reviewer or Risk Owner has raised.",
        stats: [
          { label: "Needing attention", value: attention.length },
          { label: "Open questions", value: openQueries.length },
        ],
        tasks,
        tiles: [
          { title: "Create a System", description: "Start onboarding a new system or cloud solution.", href: "/systems/new" },
          { title: "Browse your Systems", description: "Every System you own, regardless of status.", href: "/systems?owner=me" },
        ],
      };
    }

    case "ADMIN": {
      const [controls, facets, capabilities, overlays] = await Promise.all([
        prisma.control.count(),
        prisma.deploymentFacet.count(),
        prisma.capability.count(),
        prisma.regulatoryOverlay.count(),
      ]);

      return {
        lede: "Manage the catalogs every System's onboarding is assessed against.",
        stats: [
          { label: "Controls", value: controls },
          { label: "Deployment facets", value: facets },
          { label: "Capabilities", value: capabilities },
          { label: "Regulatory overlays", value: overlays },
        ],
        tiles: [
          { title: "Controls", description: "Manage the Control Library.", href: "/admin/controls" },
          { title: "Deployment Facets", description: "Manage deployment classifications.", href: "/admin/deployment-facets" },
          { title: "Capabilities", description: "Manage centrally-provided dependencies.", href: "/admin/capabilities" },
          { title: "Regulatory Overlays", description: "Manage regulatory classifications.", href: "/admin/regulatory-overlays" },
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
