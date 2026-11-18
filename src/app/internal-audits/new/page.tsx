import { getActingUser } from "@/lib/acting-user";
import { loadPlannerData } from "@/lib/audit-planner";
import { canWriteInternalAudits } from "@/lib/internal-audit-rules";
import { listSystemFilterOptions } from "@/lib/internal-audits";
import { AuditPlanner } from "../planner/AuditPlanner";

export default async function NewInternalAuditPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canWriteInternalAudits(user)) {
    return <p className="p-6 text-rg-muted">Only an Internal Auditor can create an Internal Audit.</p>;
  }

  const [data, filterOptions] = await Promise.all([loadPlannerData(), listSystemFilterOptions()]);

  return <AuditPlanner data={data} filterOptions={filterOptions} />;
}
