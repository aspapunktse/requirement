import { getActingUser } from "@/lib/acting-user";
import { canWriteSystems, getVisibleSystem } from "@/lib/system-visibility";
import { canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { canMarkOnboarded } from "@/lib/onboarding";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import { canManageBusinessUnits } from "@/lib/business-units";
import { canManageFrameworkScopes } from "@/lib/framework-scope";
import { assessmentEditAccess, canChangeOwner, canSubmit } from "@/lib/system-permissions";
import { canManageProvider } from "@/lib/control-offering-rules";
import { listControlOfferings, listOfferableControls } from "@/lib/control-offerings";
import { canManageProviderDependencies } from "@/lib/provider-dependency-rules";
import { listDependents, listProviderChoices, listProviderDependencies } from "@/lib/provider-dependencies";
import { getSystemFrameworkRequirements } from "@/lib/requirement-status";
import { ControlAssessmentList } from "@/components/ControlAssessmentList";
import { SystemFrameworkRequirementsView } from "@/components/SystemFrameworkRequirements";
import { SubmitForReviewButton } from "@/components/SubmitForReviewButton";
import { RiskList } from "@/components/RiskList";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { MarkOnboardedButton } from "@/components/MarkOnboardedButton";
import { SystemCatalogRelation } from "@/components/SystemCatalogRelation";
import { SystemProvider } from "@/components/SystemProvider";
import { SystemProviderDependencies } from "@/components/SystemProviderDependencies";
import { DeploymentFacetsChanger } from "@/components/DeploymentFacetsChanger";
import { ImpactLevelsChanger } from "@/components/ImpactLevelsChanger";
import { ChangeOwnerButton } from "@/components/ChangeOwnerButton";
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

  const canManageThisProvider = canManageProvider(user, system);
  const canManageDependencies = canManageProviderDependencies(user, system);
  const [frameworkRequirements, offerings, offerable, dependencies, providerChoices, dependents] = await Promise.all([
    getSystemFrameworkRequirements(system),
    listControlOfferings(system),
    canManageThisProvider ? listOfferableControls(system) : Promise.resolve([]),
    listProviderDependencies(system, user),
    // Any owner or Admin may pick any Provider, visible to them or not (name, id, Onboarded or pending only).
    canManageDependencies ? listProviderChoices() : Promise.resolve([]),
    // Who depends on this Provider is for its owner or an Admin.
    system.isProvider && canManageThisProvider ? listDependents(system.id, user) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">{system.name}</h1>
      <p className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
        <StatusChip tone={onboardingStatusTone(system.status)}>{system.status}</StatusChip>
        {system.isProvider && <StatusChip tone="accent">Provider</StatusChip>}
        <span>
          {system.deploymentFacets.map((facet) => facet.name).join(" + ")} · owned by{" "}
          {system.owner.name}
        </span>
      </p>

      {canChangeOwner(user, system) && (
        <div className="mb-4">
          <ChangeOwnerButton
            actor={{ id: user.id, role: user.role }}
            system={{ id: system.id, name: system.name, ownerId: system.ownerId, ownerName: system.owner.name, canChange: true }}
          />
        </div>
      )}

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

      {system.status === "DRAFT" && canSubmit(user, system) && <SubmitForReviewButton systemId={system.id} />}
      {system.status === "APPROVED" && canMarkOnboarded(user, system) && (
        <MarkOnboardedButton systemId={system.id} />
      )}

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
        emptyLabel="This System isn't in scope for any Framework yet."
      />

      <h2 className="mb-3 mt-8 text-xl">Provider</h2>
      <SystemProvider
        systemId={system.id}
        canManage={canManageThisProvider}
        initialIsProvider={system.isProvider}
        initialOfferings={offerings}
        initialOfferable={offerable}
        dependents={dependents}
      />

      <h2 className="mb-3 mt-8 text-xl">Provider dependencies</h2>
      <SystemProviderDependencies
        systemId={system.id}
        canManage={canManageDependencies}
        initialDependencies={dependencies}
        choices={providerChoices}
      />

      <h2 className="mb-3 mt-8 text-xl">Controls</h2>
      <ControlAssessmentList
        // Remounts (and so reloads) when a Provider dependency is declared or removed: what this System inherits changes.
        key={dependencies.map((dependency) => dependency.providerId).join(",")}
        systemId={system.id}
        userRole={user.role}
        currentUserId={user.id}
        systemOwnerId={system.ownerId}
        readOnly={!canWriteSystems(user)}
        assessmentEditAccess={assessmentEditAccess(user, system)}
      />

      <h2 className="mb-3 mt-8 text-xl">Requirements by Framework</h2>
      <SystemFrameworkRequirementsView frameworks={frameworkRequirements} />

      <h2 className="mb-3 mt-8 text-xl">Risks</h2>
      <RiskList
        systemId={system.id}
        canLog={canLogRisk(user, system)}
        canManageStatus={ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)}
        canOpenCheckUp={canReadInternalAudits(user)}
      />

      <h2 className="mb-3 mt-8 text-xl">Approval</h2>
      <ApprovalPanel systemId={system.id} />
    </div>
  );
}
