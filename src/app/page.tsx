import type { UserRole } from "@prisma/client";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { getSystemsNeedingAttention, getSystemsAwaitingApproval, getAllOpenRisks } from "@/lib/dashboard";
import { scopedSystemsWhere, getAssignedScope } from "@/lib/business-risk-owner";
import { getActionableQueryCount } from "@/lib/requirement-queries";

/**
 * Role-differentiated landing page: a short set of shortcuts into whatever
 * that role most needs next, rather than one generic page for everyone. See
 * issue #54 for the per-role shortcut list this implements.
 */
export default async function Home() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Requirement & Risk Onboarding</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Track requirement fulfillment and risk during system and cloud onboarding.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {await roleCards(user)}
      </div>
    </div>
  );
}

async function roleCards(user: { id: string; role: UserRole }) {
  switch (user.role) {
    case "SYSTEM_OWNER": {
      const ownedSystemIds = (
        await prisma.system.findMany({ where: { ownerId: user.id }, select: { id: true } })
      ).map((s) => s.id);
      const [attention, openQuestions] = await Promise.all([
        getSystemsNeedingAttention(user.id),
        getActionableQueryCount(user, ownedSystemIds),
      ]);
      return (
        <>
          <DashboardCard
            title="Create a System"
            description="Start onboarding a new system or cloud solution."
            href="/systems/new"
          />
          <DashboardCard
            title="Systems needing attention"
            description="Your Draft Systems that were rejected and returned, or carry a stale Requirement Assessment."
            count={attention.length}
            href="/systems?owner=me&status=DRAFT"
          />
          <DashboardCard
            title="Questions awaiting your reply"
            description="Requirement Queries a Reviewer or Risk Owner raised on one of your Systems."
            count={openQuestions}
            href="/systems?owner=me"
          />
        </>
      );
    }

    case "ADMIN": {
      const [requirements, facets, capabilities, overlays] = await Promise.all([
        prisma.requirement.count(),
        prisma.deploymentFacet.count(),
        prisma.capability.count(),
        prisma.regulatoryOverlay.count(),
      ]);
      return (
        <>
          <DashboardCard
            title="Requirements"
            description="Manage the Requirement Catalog."
            count={requirements}
            href="/admin/requirements"
          />
          <DashboardCard
            title="Deployment Facets"
            description="Manage deployment classifications."
            count={facets}
            href="/admin/deployment-facets"
          />
          <DashboardCard
            title="Capabilities"
            description="Manage centrally-provided dependencies."
            count={capabilities}
            href="/admin/capabilities"
          />
          <DashboardCard
            title="Regulatory Overlays"
            description="Manage regulatory classifications."
            count={overlays}
            href="/admin/regulatory-overlays"
          />
        </>
      );
    }

    case "REVIEWER": {
      const allSystemIds = (await prisma.system.findMany({ select: { id: true } })).map((s) => s.id);
      const [awaiting, openQuestions] = await Promise.all([
        getSystemsAwaitingApproval(),
        getActionableQueryCount(user, allSystemIds),
      ]);
      return (
        <>
          <DashboardCard
            title="Awaiting your review"
            description="Systems submitted and waiting on an Approval decision."
            count={awaiting.length}
            href="/systems?status=IN_REVIEW"
          />
          <DashboardCard
            title="Open Questions"
            description="Requirement Queries where the System Owner has replied and it's your turn to look."
            count={openQuestions}
            href="/systems"
          />
        </>
      );
    }

    case "RISK_OWNER": {
      const allSystemIds = (await prisma.system.findMany({ select: { id: true } })).map((s) => s.id);
      const [openRisks, openQuestions] = await Promise.all([
        getAllOpenRisks(),
        getActionableQueryCount(user, allSystemIds),
      ]);
      return (
        <>
          <DashboardCard
            title="Open Risks"
            description="Risks across every System that still need a status update."
            count={openRisks.length}
            href="/systems"
          />
          <DashboardCard
            title="Open Questions"
            description="Requirement Queries where the System Owner has replied and it's your turn to look."
            count={openQuestions}
            href="/systems"
          />
        </>
      );
    }

    case "BUSINESS_RISK_OWNER": {
      const scope = await getAssignedScope(user.id);
      const openRisks = await prisma.risk.count({
        where: { status: "OPEN", system: scopedSystemsWhere(scope) },
      });
      return (
        <DashboardCard
          title="Your scoped Risks & Compliance"
          description="Open Risks and compliance percentage for Systems in your assigned Business Unit(s)/Framework(s)."
          count={openRisks}
          href="/business-risk-owner"
        />
      );
    }

    case "VIEWER":
    default: {
      const onboardedCount = await prisma.system.count({ where: { status: "ONBOARDED" } });
      return (
        <DashboardCard
          title="Browse Onboarded Systems"
          description="See every System that has completed onboarding."
          count={onboardedCount}
          href="/systems?status=ONBOARDED"
        />
      );
    }
  }
}
