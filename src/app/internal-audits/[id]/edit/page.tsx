import { getActingUser } from "@/lib/acting-user";
import { loadPlannerData, plannerInitialFrom } from "@/lib/audit-planner";
import { canWriteInternalAudits, internalAuditEditRefusal } from "@/lib/internal-audit-rules";
import { getInternalAudit, listSystemFilterOptions } from "@/lib/internal-audits";
import { AuditPlanner } from "../../planner/AuditPlanner";

export default async function EditInternalAuditPage({ params }: PageProps<"/internal-audits/[id]/edit">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canWriteInternalAudits(user)) {
    return <p className="p-6 text-rg-muted">Only an Internal Auditor can edit an Internal Audit.</p>;
  }

  const audit = await getInternalAudit(id);

  if (!audit) {
    return <p className="p-6 text-rg-muted">Internal Audit not found.</p>;
  }

  const refusal = internalAuditEditRefusal(audit.status);
  if (refusal) {
    return <p className="p-6 text-rg-muted">{refusal}.</p>;
  }

  const [data, filterOptions] = await Promise.all([loadPlannerData(), listSystemFilterOptions()]);

  return <AuditPlanner data={data} filterOptions={filterOptions} initial={plannerInitialFrom(audit)} />;
}
