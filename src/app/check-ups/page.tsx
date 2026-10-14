import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { listMyCheckUps } from "@/lib/check-up-tasks";
import { CHECK_UP_OUTCOME_LABEL } from "@/lib/check-up-evaluation-rules";
import { checkUpOutcomeTone } from "@/lib/status-tones";
import { StatusChip } from "@/components/ui/StatusChip";

/**
 * "Your Check-ups" (PRD 0001 F-IA.4, #155): every Check-up addressed to the acting user, that is,
 * whose target they own now. Open ones are also in "My tasks" on /home; the answered ones are here
 * so a response can be found and changed until it is evaluated; an evaluated one shows its outcome
 * (#156). Everyone sees only their own.
 */
export default async function MyCheckUpsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const checkUps = await listMyCheckUps(user);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-2 text-2xl">Your Check-ups</h1>
      <p className="mb-4 text-sm text-zinc-500">The Check-ups addressed to you as the owner of the target, open and answered.</p>
      {checkUps.length === 0 ? (
        <p className="text-sm text-zinc-500">No Check-ups are addressed to you.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checkUps.map((checkUp) => (
            <li key={checkUp.id} className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              {checkUp.withdrawn ? (
                <StatusChip tone="neutral">Withdrawn</StatusChip>
              ) : checkUp.outcome ? (
                <StatusChip tone={checkUpOutcomeTone(checkUp.outcome)}>{CHECK_UP_OUTCOME_LABEL[checkUp.outcome]}</StatusChip>
              ) : checkUp.answered ? (
                <StatusChip tone="success">Answered</StatusChip>
              ) : checkUp.overdue ? (
                <StatusChip tone="danger">Overdue</StatusChip>
              ) : (
                <StatusChip tone="accent">{checkUp.open ? "Open" : "Not answered"}</StatusChip>
              )}
              <Link className="font-medium underline" href={`/check-ups/${checkUp.id}`}>
                {checkUp.control.code} {checkUp.control.title}
              </Link>
              <span className="text-zinc-500">
                {checkUp.systemName ?? "Organization"} · {checkUp.audit.title} · due {checkUp.audit.dueDate}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
