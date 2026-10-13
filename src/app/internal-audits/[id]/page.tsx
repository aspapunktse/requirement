import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import {
  canReadInternalAudits,
  canWriteInternalAudits,
  INTERNAL_AUDIT_STATUS_LABEL,
  internalAuditEditRefusal,
  internalAuditNotes,
} from "@/lib/internal-audit-rules";
import { getInternalAudit } from "@/lib/internal-audits";
import { internalAuditStatusTone } from "@/lib/status-tones";
import { buttonClassName } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { DeleteInternalAuditButton } from "@/components/DeleteInternalAuditButton";

/**
 * One Internal Audit (PRD 0001 F-IA.1, #152): everything on it, with notes where a half of it
 * would audit nothing. Edit and delete are offered to an Internal Auditor while it is a draft.
 */
export default async function InternalAuditPage({ params }: PageProps<"/internal-audits/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canReadInternalAudits(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audits are not available to your role.</p>;
  }

  const audit = await getInternalAudit(id);

  if (!audit) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audit not found.</p>;
  }

  const canEdit = canWriteInternalAudits(user) && internalAuditEditRefusal(audit.status) === null;
  const notes = internalAuditNotes({
    includeOrganization: audit.includeOrganization,
    systemCount: audit.systems.length,
    controls: audit.controls,
  });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <p className="mb-2 text-sm">
        <Link className="underline" href="/internal-audits">
          Internal Audits
        </Link>
      </p>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-2xl">{audit.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <StatusChip tone={internalAuditStatusTone(audit.status)}>{INTERNAL_AUDIT_STATUS_LABEL[audit.status]}</StatusChip>
            <span>Due {audit.dueDate}</span>
            <span>Created by {audit.createdBy.name}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-start gap-2">
            <Link href={`/internal-audits/${audit.id}/edit`} className={buttonClassName("secondary")}>
              Edit
            </Link>
            <DeleteInternalAuditButton id={audit.id} title={audit.title} />
          </div>
        )}
      </div>

      {audit.status === "DRAFT" && (
        <p className="mb-4 text-sm text-zinc-500">This is a draft: nothing has been sent to anyone, and no Check-up exists.</p>
      )}

      {notes.length > 0 && (
        <ul role="note" className="mb-4 list-disc rounded border border-ems-warn pl-8 pr-3 py-2 text-sm">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Scope</h2>
        <p className="text-sm">{audit.scopeDescription || <span className="text-zinc-500">No scope description.</span>}</p>
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Controls ({audit.controls.length})</h2>
        {audit.controls.length === 0 ? (
          <p className="text-sm text-zinc-500">No Controls. Edit the draft to pick some.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {audit.controls.map((control) => (
              <li key={control.id}>
                <span className="font-medium">{control.code}</span> {control.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Systems ({audit.systems.length})</h2>
        {audit.systems.length === 0 ? (
          <p className="text-sm text-zinc-500">No Systems picked.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {audit.systems.map((system) => (
              <li key={system.id}>
                <Link className="underline" href={`/systems/${system.id}`}>
                  {system.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg">Organization</h2>
        <p className="text-sm">
          {audit.includeOrganization
            ? "The Organization Control Implementations of the target Controls are included."
            : "The Organization Control Implementations are not included."}
        </p>
      </section>
    </div>
  );
}
