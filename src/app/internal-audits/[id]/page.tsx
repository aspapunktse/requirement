import { getActingUser } from "@/lib/acting-user";
import { canReadInternalAudits, canWriteInternalAudits } from "@/lib/internal-audit-rules";
import { loadInternalAuditPage } from "@/lib/internal-audit-detail";
import { canEvaluateCheckUps } from "@/lib/check-up-evaluation-rules";
import { canWithdrawCheckUps } from "@/lib/check-up-withdrawal-rules";
import { canCloseInternalAudits } from "@/lib/internal-audit-close-rules";
import { AuditCommandCenter } from "./AuditCommandCenter";
import { DraftAudit } from "./DraftAudit";

/**
 * One Internal Audit, design proposal A "Command center" (#399, PRD 0001 F-IA.1 to F-IA.8). A draft shows its read view
 * with the launch preview; a launched audit shows where it stands (a ring of its Check-ups by state, whether it can be
 * closed), stat cards that filter, the Check-ups grouped and a panel to evaluate or withdraw the picked one; a closed
 * audit shows its findings and is read-only. Everything is read here in one snapshot (`loadInternalAuditPage`) and passed
 * down. Readers are unchanged; every action is limited to the roles allowed to do it (`canEvaluateCheckUps`,
 * `canWithdrawCheckUps`, `canCloseInternalAudits`, `canWriteInternalAudits`), and the routes refuse the rest again.
 */
export default async function InternalAuditPage({ params }: PageProps<"/internal-audits/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canReadInternalAudits(user)) {
    return <p className="p-6 text-rg-muted">Internal Audits are not available to your role.</p>;
  }

  const page = await loadInternalAuditPage(id);

  if (!page) {
    return <p className="p-6 text-rg-muted">Internal Audit not found.</p>;
  }

  if (page.audit.status === "DRAFT") {
    return <DraftAudit key={user.id} page={page} canWrite={canWriteInternalAudits(user)} />;
  }

  return (
    <AuditCommandCenter
      key={`${user.id}:${page.audit.id}`}
      page={page}
      rights={{ canEvaluate: canEvaluateCheckUps(user), canWithdraw: canWithdrawCheckUps(user), canClose: canCloseInternalAudits(user) }}
    />
  );
}
