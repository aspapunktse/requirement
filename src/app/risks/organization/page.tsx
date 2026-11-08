import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { canManageOrganizationRisks, canReadOrganizationRisks, getOrganizationRisks } from "@/lib/risks";
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
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canReadOrganizationRisks(user)) {
    return <p className="p-6 text-rg-muted">Organization Risks are not available to your role.</p>;
  }

  const canManage = canManageOrganizationRisks(user);
  const [rows, owners] = await Promise.all([
    getOrganizationRisks(),
    canManage
      ? // A Risk owner can be any User, whatever their role (#322).
      prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const risks: Risk[] = rows.map((risk) => ({
    id: risk.id,
    title: risk.title,
    description: risk.description,
    severity: risk.severity,
    likelihood: risk.likelihood,
    status: risk.status,
    source: risk.source,
    mitigationPlan: risk.mitigationPlan,
    ownerId: risk.ownerId,
    owner: risk.owner && { id: risk.owner.id, name: risk.owner.name },
    controlAssessment: null,
    checkUp: risk.checkUp && { id: risk.checkUp.id },
  }));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-2xl">Organization Risks</h1>
      <p className="mb-4 text-sm text-rg-muted">
        Risks that belong to no System: an Internal Auditor&apos;s Nonconformity on the Organization&apos;s own implementation of a Control opens one,
        and it links to that finding.
        {canManage ? "" : " You can read them; a Risk Owner or an Admin manages them."}
      </p>
      <OrganizationRiskList initialRisks={risks} canManage={canManage} canOpenCheckUp={canReadInternalAudits(user)} owners={owners} />
    </div>
  );
}
