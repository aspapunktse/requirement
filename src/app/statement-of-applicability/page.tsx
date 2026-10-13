import { getActingUser } from "@/lib/acting-user";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { StatementOfApplicability } from "@/components/StatementOfApplicability";

/**
 * The Statement of Applicability (PRD 0001 F-OUT.4, #145): every Control in the
 * Control Library with whether it is included, why, and how far it is implemented.
 * Derived live and readable by every signed-in role; a Compliance Manager or an Admin
 * can also write the exclusion justifications (#150). The rows are loaded
 * here and passed down as props.
 */
export default async function StatementOfApplicabilityPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const rows = await loadStatementOfApplicability();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-1 text-2xl">Statement of Applicability</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Every Control in the Control Library: included when it applies to the Organization or to at least one System,
        excluded otherwise. Derived live from the Frameworks, Systems and implementation statuses; nothing is stored.
      </p>
      <StatementOfApplicability rows={rows} canEdit={ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role)} />
    </div>
  );
}
