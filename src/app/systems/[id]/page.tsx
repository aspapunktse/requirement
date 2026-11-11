import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { canWriteSystems } from "@/lib/system-visibility";
import { canAssignRiskOwner, canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { canRecordRiskAnalysis } from "@/lib/risk-analysis";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import { canManageBusinessUnits } from "@/lib/business-units";
import { canManageFrameworkScopes } from "@/lib/framework-scope";
import { assessmentEditAccess } from "@/lib/system-permissions";
import { canManageProvider } from "@/lib/control-offering-rules";
import { listControlOfferings, listOfferableControls } from "@/lib/control-offerings";
import { prisma } from "@/lib/prisma";
import { listSensitivityLevels } from "@/lib/sensitivity-level-data";
import { canManageProviderDependencies } from "@/lib/provider-dependency-rules";
import { listDependents, listProviderChoices, listProviderDependencies } from "@/lib/provider-dependencies";
import "@/app/home/home.css";
import { SystemChangeReview } from "./SystemChangeReview";
import { SystemCockpit } from "./SystemCockpit";
import { SystemActivity } from "./SystemActivity";
import { SystemControls } from "./SystemControls";
import { SystemDocumentation } from "./SystemDocumentation";
import { SystemEvaluation } from "./SystemEvaluation";
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
  const [offerings, offerable, dependencies, providerChoices, dependents, sensitivityLevels] = await Promise.all([
    listControlOfferings(system),
    canManageThisProvider ? listOfferableControls(system) : Promise.resolve([]),
    listProviderDependencies(system, user),
    // Any owner or Admin may pick any Provider, visible to them or not (name, id, Onboarded or pending only).
    canManageDependencies ? listProviderChoices() : Promise.resolve([]),
    // Who depends on this Provider is for its owner or an Admin.
    system.isProvider && canManageThisProvider ? listDependents(system.id, user) : Promise.resolve([]),
    listSensitivityLevels(),
  ]);
  // A Risk owner can be any User, whatever their role (#322); an Admin, a Risk Owner or a Risk Facilitator assigns one (#360, #362),
  // and only an Admin or a Risk Owner manages a Risk's status.
  const canManageRisks = ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role);
  const canAssignOwner = canAssignRiskOwner(user, system);
  const canRecordAnalysis = canRecordRiskAnalysis(user, system);
  // Recording a Risk Analysis is a subset of assigning owners, so `riskOwners` serves its participants too.
  const riskOwners = canAssignOwner || canRecordAnalysis ? await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const canChangeClassification = canChangeSystemClassification(user, system);

  const panels = {
    // Only a staged System has an Evaluation tab (#328); the cockpit leaves the panel out for the rest.
    evaluation: view.system.evaluation ? <SystemEvaluation systemId={system.id} /> : null,
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
        sensitivityLevels={sensitivityLevels}
      />
    ),
    requirements: <SystemRequirements frameworks={view.frameworks} entries={frameworkRequirements} />,
    risks: (
      <SystemRisks
        systemId={system.id}
        canLog={canLogRisk(user, system)}
        canManageStatus={canManageRisks}
        canAssignOwner={canAssignOwner}
        canOpenCheckUp={canReadInternalAudits(user)}
        owners={riskOwners}
        riskAnalyses={{ canRecord: canRecordAnalysis }}
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
    documentation: <SystemDocumentation systemId={system.id} />,
    profile: (
      <SystemProfile
        systemId={system.id}
        about={{
          ...view.system.about,
          needsVendorDetails: view.system.needsVendorDetails,
          ownerName: view.system.ownerName,
          createdAt: view.system.createdAt,
          onboardedAt: view.system.onboardedAt,
        }}
        canChangeClassification={canChangeClassification}
        canManageBusinessUnits={canManageBusinessUnits(user, system)}
        canManageFrameworkScopes={canManageFrameworkScopes(user, system)}
        deploymentFacetIds={system.deploymentFacets.map((facet) => facet.id)}
        sensitivityLevel={system.sensitivityLevel}
        sensitivityLevels={sensitivityLevels}
        informationTypes={view.system.informationTypes}
        belowInformationTypes={view.system.belowInformationTypes}
        suggestedFrameworks={view.system.suggestedFrameworks}
        impactLevels={{
          integrityImpactLevel: system.integrityImpactLevel,
          availabilityImpactLevel: system.availabilityImpactLevel,
        }}
      />
    ),
    activity: <SystemActivity systemId={system.id} timeline={view.timeline} now={view.now} />,
  };

  // Keyed on the System and the acting user, so switching either starts from a clean state.
  const hasOpenChangeReview = (await prisma.changeReview.count({ where: { systemId: system.id, status: "OPEN" } })) > 0;
  // An open Change Review on an Onboarded System (#334) sits below the header card, above the tabs, until the Business System Owner decides.
  // The newest Change Event is the panel's revision: a classification, Assessment or Business System Owner change, or a
  // Recommendation, adds one, so the panel reads again after each `router.refresh()` instead of showing a stale view.
  const latestEvent = hasOpenChangeReview
    ? await prisma.changeEvent.findFirst({ where: { systemId: system.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } })
    : null;
  const banner = hasOpenChangeReview ? (
    <div className="ev">
      <SystemChangeReview systemId={system.id} revision={latestEvent?.id ?? ""} />
    </div>
  ) : undefined;
  return <SystemCockpit key={`${system.id}:${user.id}`} view={view} panels={panels} banner={banner} />;
}
