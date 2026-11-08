import { getActingUser } from "@/lib/acting-user";
import { loadRiskRegister } from "@/lib/risk-register";
import { canReadOrganizationRisks } from "@/lib/risk-roles";
import { RiskRegister } from "./RiskRegister";

/**
 * The Risk register (#322): every Risk the acting user may see across Systems, with its Risk Source, and
 * the Organization Risks for the roles that may read them. Read-only; each row links to where the Risk is
 * managed. Filters (`?source=`, `?status=`, `?severity=`) live in the URL so a filtered view can be linked.
 */
export default async function RiskRegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getActingUser();
  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  // Keyed on the acting user, so switching user starts from a clean state.
  return (
    <RiskRegister
      key={user.id}
      rows={await loadRiskRegister(user)}
      canReadOrganizationRisks={canReadOrganizationRisks(user)}
      initialFilters={{ source: first("source"), status: first("status"), severity: first("severity") }}
    />
  );
}
