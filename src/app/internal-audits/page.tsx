import { getActingUser } from "@/lib/acting-user";
import { canReadInternalAudits, canWriteInternalAudits } from "@/lib/internal-audit-rules";
import { loadInternalAuditList } from "@/lib/internal-audit-list";
import { AuditsCommandCenter } from "./AuditsCommandCenter";

/**
 * The Internal Audits list, design proposal A "Command center" (#398, PRD 0001 F-IA.1): a ring of the Check-ups in
 * the launched audits, stat cards that filter, and a lane of cards per status. Read by the Internal Auditor, Admin,
 * Compliance Manager and Risk Owner; only an Internal Auditor can start a new one. Everything is read here in one
 * snapshot (`loadInternalAuditList`) and passed down; nothing is fetched on mount.
 */
export default async function InternalAuditsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canReadInternalAudits(user)) {
    return <p className="p-6 text-rg-muted">Internal Audits are not available to your role.</p>;
  }

  const list = await loadInternalAuditList();

  return <AuditsCommandCenter key={user.id} list={list} canWrite={canWriteInternalAudits(user)} />;
}
