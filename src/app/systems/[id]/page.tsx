import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { ROLES_ALLOWED_TO_APPROVE } from "@/lib/approvals";
import { canMarkOnboarded } from "@/lib/onboarding";
import { canManageCapabilities } from "@/lib/system-capabilities";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import { canManageRegulatoryOverlays } from "@/lib/system-overlays";
import { canManageBusinessUnits } from "@/lib/business-units";
import { canManageFrameworkScopes } from "@/lib/framework-scope";
import { ControlAssessmentList } from "@/components/ControlAssessmentList";
import { SubmitForReviewButton } from "@/components/SubmitForReviewButton";
import { RiskList } from "@/components/RiskList";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { MarkOnboardedButton } from "@/components/MarkOnboardedButton";
import { SystemCapabilities } from "@/components/SystemCapabilities";
import { SystemRegulatoryOverlays } from "@/components/SystemRegulatoryOverlays";
import { SystemCatalogRelation } from "@/components/SystemCatalogRelation";
import { DeploymentFacetsChanger } from "@/components/DeploymentFacetsChanger";
import { ImpactLevelsChanger } from "@/components/ImpactLevelsChanger";
import { StatusChip } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";

export default async function SystemDetailPage({ params }: PageProps<"/systems/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const system = await getVisibleSystem(user, id);

  if (!system) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">System not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">{system.name}</h1>
      <p className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
        <StatusChip tone={onboardingStatusTone(system.status)}>{system.status}</StatusChip>
        <span>
          {system.deploymentFacets.map((facet) => facet.name).join(" + ")} · owned by{" "}
          {system.owner.name}
        </span>
      </p>

      <dl className="flex flex-col gap-2 text-sm">
        {system.vendor && (
          <div>
            <dt className="font-medium">Vendor</dt>
            <dd>{system.vendor}</dd>
          </div>
        )}
        {system.description && (
          <div>
            <dt className="font-medium">Description</dt>
            <dd>{system.description}</dd>
          </div>
        )}
        {(system.confidentialityImpactLevel ||
          system.integrityImpactLevel ||
          system.availabilityImpactLevel) && (
          <div>
            <dt className="font-medium">Impact Level</dt>
            <dd>
              Confidentiality: {system.confidentialityImpactLevel ?? "Not classified"} · Integrity:{" "}
              {system.integrityImpactLevel ?? "Not classified"} · Availability:{" "}
              {system.availabilityImpactLevel ?? "Not classified"}
            </dd>
          </div>
        )}
        {system.onboardedAt && (
          <div>
            <dt className="font-medium">Onboarded</dt>
            <dd>{new Date(system.onboardedAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>

      {canChangeSystemClassification(user, system) && (
        <DeploymentFacetsChanger
          systemId={system.id}
          currentDeploymentFacetIds={system.deploymentFacets.map((facet) => facet.id)}
        />
      )}

      {canChangeSystemClassification(user, system) && (
        <ImpactLevelsChanger
          systemId={system.id}
          current={{
            confidentialityImpactLevel: system.confidentialityImpactLevel,
            integrityImpactLevel: system.integrityImpactLevel,
            availabilityImpactLevel: system.availabilityImpactLevel,
          }}
        />
      )}

      {system.status === "DRAFT" && <SubmitForReviewButton systemId={system.id} />}
      {system.status === "APPROVED" && canMarkOnboarded(user, system) && (
        <MarkOnboardedButton systemId={system.id} />
      )}

      <h2 className="mb-3 mt-8 text-xl">Capabilities</h2>
      <SystemCapabilities systemId={system.id} canManage={canManageCapabilities(user, system)} />

      <h2 className="mb-3 mt-8 text-xl">Regulatory Overlays</h2>
      <SystemRegulatoryOverlays
        systemId={system.id}
        canManage={canManageRegulatoryOverlays(user, system)}
      />

      <h2 className="mb-3 mt-8 text-xl">Business Units</h2>
      <SystemCatalogRelation
        systemId={system.id}
        canManage={canManageBusinessUnits(user, system)}
        resourcePath={`/api/systems/${system.id}/business-units`}
        resourceKey="businessUnits"
        catalogPath="/api/business-units"
        catalogKey="businessUnits"
        idField="businessUnitId"
        itemLabel="Business Unit"
        emptyLabel="No Business Units consuming this System yet."
      />

      <h2 className="mb-3 mt-8 text-xl">Framework Scope</h2>
      <SystemCatalogRelation
        systemId={system.id}
        canManage={canManageFrameworkScopes(user, system)}
        resourcePath={`/api/systems/${system.id}/framework-scopes`}
        resourceKey="frameworkScopes"
        catalogPath="/api/frameworks"
        catalogKey="frameworks"
        idField="frameworkId"
        itemLabel="Framework"
        emptyLabel="This System isn't in scope for any Framework's audit boundary yet."
      />

      <h2 className="mb-3 mt-8 text-xl">Controls</h2>
      <ControlAssessmentList
        systemId={system.id}
        userRole={user.role}
        currentUserId={user.id}
        systemOwnerId={system.ownerId}
      />

      <h2 className="mb-3 mt-8 text-xl">Risks</h2>
      <RiskList
        systemId={system.id}
        canLog={canLogRisk(user, system)}
        canManageStatus={ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)}
      />

      <h2 className="mb-3 mt-8 text-xl">Approval</h2>
      <ApprovalPanel
        systemId={system.id}
        canDecide={system.status === "IN_REVIEW" && ROLES_ALLOWED_TO_APPROVE.includes(user.role)}
      />
    </div>
  );
}
