import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { canWriteSystems } from "@/lib/system-visibility";
import { canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import { canManageBusinessUnits } from "@/lib/business-units";
import { canManageFrameworkScopes } from "@/lib/framework-scope";
import { assessmentEditAccess } from "@/lib/system-permissions";
import { canManageProvider } from "@/lib/control-offering-rules";
import { listControlOfferings, listOfferableControls } from "@/lib/control-offerings";
import { canManageProviderDependencies } from "@/lib/provider-dependency-rules";
import { listDependents, listProviderChoices, listProviderDependencies } from "@/lib/provider-dependencies";
import "@/app/home/home.css";
import { SystemCockpit } from "./SystemCockpit";
import { SystemActivity } from "./SystemActivity";
import { SystemControls } from "./SystemControls";
import { SystemProfile } from "./SystemProfile";
import { SystemProviders } from "./SystemProviders";
import { SystemRequirements } from "./SystemRequirements";
import { SystemRisks } from "./SystemRisks";
import { loadSystemPage } from "./system-page-data";

/** A message in the Register look, for a page with nothing else to show. */
function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hc">
      <div className="hc-card hc-done" role="status">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}

/**
 * One System's page, design proposal A "Cockpit" (issue #243): a header with the System's identity,
 * lifecycle, next step and headline figures, pinned tabs, and an Overview of tiles. `loadSystemPage` reads
 * the Overview's data in one snapshot, and only for a System the user may see (`visibleSystemsWhere`); the
 * client component only adds the interactions and keeps the tab in the URL hash. The Controls tab is the
 * grouped list with its Control drawer (#244); Requirements, Risks, Providers, Profile and Approval and
 * activity are the cards of #245, on the same API routes and permission checks the page always had.
 */
export default async function SystemDetailPage({ params }: PageProps<"/systems/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <EmptyState title="Pick a user to act as first">Choose who you are acting as in the header to see this System.</EmptyState>;
  }

  const page = await loadSystemPage(user, id);

  if (!page) {
    return (
      <EmptyState title="System not found">
        It doesn&apos;t exist, or you can&apos;t see it. <Link href="/systems">Back to the Systems list</Link>
      </EmptyState>
    );
  }

  const { view, system, frameworkRequirements } = page;
  const canManageThisProvider = canManageProvider(user, system);
  const canManageDependencies = canManageProviderDependencies(user, system);
  const [offerings, offerable, dependencies, providerChoices, dependents] = await Promise.all([
    listControlOfferings(system),
    canManageThisProvider ? listOfferableControls(system) : Promise.resolve([]),
    listProviderDependencies(system, user),
    // Any owner or Admin may pick any Provider, visible to them or not (name, id, Onboarded or pending only).
    canManageDependencies ? listProviderChoices() : Promise.resolve([]),
    // Who depends on this Provider is for its owner or an Admin.
    system.isProvider && canManageThisProvider ? listDependents(system.id, user) : Promise.resolve([]),
  ]);
  const canChangeClassification = canChangeSystemClassification(user, system);

  const panels = {
    controls: (
      <SystemControls
        // Remounts (and so reloads) when a Provider dependency is declared or removed: what this System inherits changes.
        key={dependencies.map((dependency) => dependency.providerId).join(",")}
        systemId={system.id}
        userRole={user.role}
        currentUserId={user.id}
        systemOwnerId={system.ownerId}
        readOnly={!canWriteSystems(user)}
        assessmentEditAccess={assessmentEditAccess(user, system)}
      />
    ),
    requirements: <SystemRequirements frameworks={view.frameworks} entries={frameworkRequirements} />,
    risks: (
      <SystemRisks
        systemId={system.id}
        canLog={canLogRisk(user, system)}
        canManageStatus={ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)}
        canOpenCheckUp={canReadInternalAudits(user)}
      />
    ),
    providers: (
      <SystemProviders
        systemId={system.id}
        systemName={system.name}
        canManageDependencies={canManageDependencies}
        canManageProvider={canManageThisProvider}
        initialDependencies={dependencies}
        choices={providerChoices}
        isProvider={system.isProvider}
        offerings={offerings}
        offerable={offerable}
        dependents={dependents}
        controlTotals={{ total: view.controls.total, organization: view.controls.bySource.organization, system: view.controls.bySource.system, byProvider: view.controls.byProvider }}
      />
    ),
    profile: (
      <SystemProfile
        systemId={system.id}
        about={{
          vendor: view.system.vendor,
          ownerName: view.system.ownerName,
          createdAt: view.system.createdAt,
          onboardedAt: view.system.onboardedAt,
          description: view.system.description,
        }}
        canChangeClassification={canChangeClassification}
        canManageBusinessUnits={canManageBusinessUnits(user, system)}
        canManageFrameworkScopes={canManageFrameworkScopes(user, system)}
        deploymentFacetIds={system.deploymentFacets.map((facet) => facet.id)}
        impactLevels={{
          confidentialityImpactLevel: system.confidentialityImpactLevel,
          integrityImpactLevel: system.integrityImpactLevel,
          availabilityImpactLevel: system.availabilityImpactLevel,
        }}
      />
    ),
    activity: <SystemActivity systemId={system.id} timeline={view.timeline} now={view.now} />,
  };

  // Keyed on the System and the acting user, so switching either starts from a clean state.
  return <SystemCockpit key={`${system.id}:${user.id}`} view={view} panels={panels} />;
}
