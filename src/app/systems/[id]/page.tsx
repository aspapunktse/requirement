import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canLogRisk, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { RequirementAssessmentList } from "@/components/RequirementAssessmentList";
import { SubmitForReviewButton } from "@/components/SubmitForReviewButton";
import { RiskList } from "@/components/RiskList";

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
      <h1 className="mb-1 text-xl font-semibold">{system.name}</h1>
      <p className="mb-4 text-sm text-zinc-500">
        {system.status} · {system.systemType.name} · owned by {system.owner.name}
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
        {system.dataClassification && (
          <div>
            <dt className="font-medium">Data Classification</dt>
            <dd>{system.dataClassification}</dd>
          </div>
        )}
      </dl>

      {system.status === "DRAFT" && <SubmitForReviewButton systemId={system.id} />}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Requirements</h2>
      <RequirementAssessmentList systemId={system.id} userRole={user.role} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">Risks</h2>
      <RiskList
        systemId={system.id}
        canLog={canLogRisk(user, system)}
        canManageStatus={ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)}
      />
    </div>
  );
}
