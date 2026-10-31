import { getActingUser } from "@/lib/acting-user";
import { StatementLedger } from "./StatementLedger";
import { loadSoaView } from "./soa-data";

/**
 * The Statement of Applicability (PRD 0001 F-OUT.4, #145), design proposal A "Statement Ledger" in the Home look
 * (issue #272): every Control in the Control Library with whether it is included, why, and how far it is
 * implemented. Derived live and readable by every signed-in role; a Compliance Manager or an Admin can also write
 * the exclusion justifications (#150). `loadSoaView` reads everything in one snapshot and decides which
 * System names the acting user may see.
 */
export default async function StatementOfApplicabilityPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const view = await loadSoaView(user);

  // Keyed on the acting user, so switching user starts from a clean state: no filter, search or open Control carried over.
  return <StatementLedger key={user.id} view={view} />;
}
