import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { canManageOrganizationRisks, canReadOrganizationRisks, getOrganizationRisks, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { OrganizationRiskList } from "@/components/OrganizationRiskList";
import type { Risk } from "@/components/RiskList";

/**
 * The Organization Risks (PRD 0001 F-IA.7, #157): Risks that belong to no System, opened by an
 * Internal Auditor's Nonconformity on an Organization-level Check-up and linked to it. A Risk Owner
 * and an Admin see and manage them (status, mitigation plan, owner); the Internal Auditor reads them.
 * Nobody else sees the page, and the Business Risk Owner's scoped views never list these Risks.
 */
export default async function OrganizationRisksPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canReadOrganizationRisks(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Organization Risks are not available to your role.</p>;
  }

  const canManage = canManageOrganizationRisks(user);
  const [rows, owners] = await Promise.all([
    getOrganizationRisks(),
    canManage
      ? prisma.user.findMany({ where: { role: { in: [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS] } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const risks: Risk[] = rows.map((risk) => ({
    id: risk.id,
    title: risk.title,
    description: risk.description,
    severity: risk.severity,
    likelihood: risk.likelihood,
    status: risk.status,
    mitigationPlan: risk.mitigationPlan,
    ownerId: risk.ownerId,
    owner: risk.owner && { id: risk.owner.id, name: risk.owner.name },
    controlAssessment: null,
    checkUp: risk.checkUp && { id: risk.checkUp.id },
  }));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-2xl">Organization Risks</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Risks that belong to no System: an Internal Auditor&apos;s Nonconformity on the Organization&apos;s own implementation of a Control opens one,
        and it links to that finding.
        {canManage ? "" : " You can read them; a Risk Owner or an Admin manages them."}
      </p>
      <OrganizationRiskList initialRisks={risks} canManage={canManage} canOpenCheckUp={canReadInternalAudits(user)} owners={owners} />
    </div>
  );
}
