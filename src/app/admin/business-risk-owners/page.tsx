import { getActingUser } from "@/lib/acting-user";
import { BusinessRiskOwnerAssignments } from "@/components/BusinessRiskOwnerAssignments";

export default async function BusinessRiskOwnersPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return (
      <p className="p-6 text-rg-muted">
        Only Admins can manage Business Risk Owner assignments.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Business Risk Owners</h1>
      <p className="mb-4 text-sm text-rg-muted">
        Assign each Business Risk Owner the Business Unit(s) and/or Framework(s) they see Risks and compliance
        for. Independent axes — a Business Risk Owner may own either, both, or neither yet.
      </p>
      <BusinessRiskOwnerAssignments />
    </div>
  );
}
