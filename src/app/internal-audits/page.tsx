import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { canReadInternalAudits, canWriteInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";
import { listInternalAudits } from "@/lib/internal-audits";
import { buttonClassName } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { internalAuditStatusTone } from "@/lib/status-tones";

/**
 * The Internal Audits (PRD 0001 F-IA.1, #152): title, due date and state of each. Read by the
 * Internal Auditor, Admin, Compliance Manager and Risk Owner; only an Internal Auditor can start a
 * new one. The rows are loaded here and passed down; nothing is fetched on mount.
 */
export default async function InternalAuditsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canReadInternalAudits(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audits are not available to your role.</p>;
  }

  const audits = await listInternalAudits();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl">Internal Audits</h1>
          <p className="text-sm text-zinc-500">
            An Internal Auditor plans an audit as a draft: the Controls to verify, the Systems and whether the
            Organization is included. Nothing is sent to anyone while it is a draft.
          </p>
        </div>
        {canWriteInternalAudits(user) && (
          <Link href="/internal-audits/new" className={buttonClassName("primary", "whitespace-nowrap")}>
            New Internal Audit
          </Link>
        )}
      </div>

      {audits.length === 0 ? (
        <p className="text-sm text-zinc-500">There are no Internal Audits yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">Title</th>
              <th className="py-2 pr-4 font-medium">Due</th>
              <th className="py-2 pr-4 font-medium">State</th>
              <th className="py-2 pr-4 font-medium">Controls</th>
              <th className="py-2 pr-4 font-medium">Systems</th>
              <th className="py-2 font-medium">Organization</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((audit) => (
              <tr key={audit.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">
                  <Link className="font-medium underline" href={`/internal-audits/${audit.id}`}>
                    {audit.title}
                  </Link>
                </td>
                <td className="py-2 pr-4">{audit.dueDate}</td>
                <td className="py-2 pr-4">
                  <StatusChip tone={internalAuditStatusTone(audit.status)}>{INTERNAL_AUDIT_STATUS_LABEL[audit.status]}</StatusChip>
                </td>
                <td className="py-2 pr-4">{audit.controlCount}</td>
                <td className="py-2 pr-4">{audit.systemCount}</td>
                <td className="py-2">{audit.includeOrganization ? "Included" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
