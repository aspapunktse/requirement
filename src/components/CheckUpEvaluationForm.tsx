"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckUpOutcome } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import {
  CHECK_UP_OUTCOME_LABEL,
  CHECK_UP_OUTCOMES,
  commentRequired,
  MAX_EVALUATION_COMMENT_LENGTH,
  validateEvaluation,
} from "@/lib/check-up-evaluation-rules";

const INPUT_CLASSES = "w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

/**
 * An Internal Auditor's evaluation of an answered Check-up (PRD 0001 F-IA.6, #156): Conforming,
 * Observation or Nonconformity and a comment, required for the last two. An evaluation is final
 * and freezes the recipient's response, which the form says before it is submitted. The server
 * applies the same rules (`validateEvaluation`), checks the role and the Check-up's state.
 */
export function CheckUpEvaluationForm({ checkUpId }: { checkUpId: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<CheckUpOutcome | "">("");
  const [comment, setComment] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found = validateEvaluation({ outcome, comment }).problems;
    setProblems(found);
    if (found.length > 0 || outcome === "") return;
    // An evaluation is final (decision 18a, comment on #156), so ask first; validation has passed.
    if (
      !window.confirm(
        `Record this Check-up as ${CHECK_UP_OUTCOME_LABEL[outcome]}? An evaluation is final: it can't be changed, and the recipient can no longer change the response.`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/check-ups/${checkUpId}/evaluation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, comment }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(result.problems ?? [result.error ?? "Failed to save the evaluation"]);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-zinc-500">
        An evaluation is final: once recorded it can&apos;t be changed, and the recipient can no longer change the response.
      </p>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Outcome</legend>
        {CHECK_UP_OUTCOMES.map((option) => (
          <label key={option} className="flex items-center gap-1">
            <input type="radio" name="outcome" value={option} checked={outcome === option} onChange={() => setOutcome(option)} />
            {CHECK_UP_OUTCOME_LABEL[option]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Comment{outcome !== "" && commentRequired(outcome) ? " (required)" : " (optional for Conforming)"}</span>
        <textarea
          className={INPUT_CLASSES}
          rows={3}
          maxLength={MAX_EVALUATION_COMMENT_LENGTH}
          aria-label="Comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          Record evaluation
        </Button>
      </div>
    </form>
  );
}
