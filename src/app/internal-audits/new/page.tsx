import { getActingUser } from "@/lib/acting-user";
import { canWriteInternalAudits } from "@/lib/internal-audit-rules";
import { listAuditChoices } from "@/lib/internal-audits";
import { InternalAuditForm } from "@/components/InternalAuditForm";

export default async function NewInternalAuditPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canWriteInternalAudits(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Only an Internal Auditor can create an Internal Audit.</p>;
  }

  const { controls, systems } = await listAuditChoices();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">New Internal Audit</h1>
      <p className="mb-4 text-sm text-zinc-500">It starts as a draft: nothing is sent to anyone until it is launched.</p>
      <InternalAuditForm controls={controls} systems={systems} />
    </div>
  );
}
