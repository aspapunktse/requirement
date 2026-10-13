import { getActingUser } from "@/lib/acting-user";
import { canWriteInternalAudits, internalAuditEditRefusal } from "@/lib/internal-audit-rules";
import { getInternalAudit, listAuditChoices } from "@/lib/internal-audits";
import { InternalAuditForm } from "@/components/InternalAuditForm";

export default async function EditInternalAuditPage({ params }: PageProps<"/internal-audits/[id]/edit">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canWriteInternalAudits(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Only an Internal Auditor can edit an Internal Audit.</p>;
  }

  const audit = await getInternalAudit(id);

  if (!audit) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audit not found.</p>;
  }

  const refusal = internalAuditEditRefusal(audit.status);
  if (refusal) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">{refusal}.</p>;
  }

  const { controls, systems } = await listAuditChoices();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">Edit Internal Audit</h1>
      <InternalAuditForm controls={controls} systems={systems} initial={audit} />
    </div>
  );
}
