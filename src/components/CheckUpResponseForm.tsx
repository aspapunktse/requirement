"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckUpAnswer } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import {
  CHECK_UP_ANSWER_LABEL,
  CHECK_UP_ANSWERS,
  descriptionRequired,
  MAX_DESCRIPTION_LENGTH,
  MAX_EVIDENCE_LINKS,
  validateCheckUpResponse,
} from "@/lib/check-up-response-rules";

const INPUT_CLASSES = "w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

type QuestionState = { answer: CheckUpAnswer | ""; description: string };

/**
 * The recipient's answer to a Check-up (PRD 0001 F-IA.4, #155): Yes / No / N/A for every question,
 * a description (required for No and N/A) and evidence links, one URL per line (links only, no
 * upload). It starts from the current response when there is one, so a submitted response can be
 * changed. The server applies the same rules (`validateCheckUpResponse`), checks the caller is the
 * recipient and refuses the write once the Check-up can no longer be changed.
 */
export function CheckUpResponseForm({
  checkUpId,
  questions,
  initialEvidenceLinks,
  changing,
}: {
  checkUpId: string;
  questions: { id: string; position: number; text: string; answer: { answer: CheckUpAnswer; description: string } | null }[];
  initialEvidenceLinks: string[];
  /** True when a response exists and this edits it. */
  changing: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, QuestionState>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, { answer: q.answer?.answer ?? "", description: q.answer?.description ?? "" }])),
  );
  const [links, setLinks] = useState(initialEvidenceLinks.join("\n"));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function change(questionId: string, patch: Partial<QuestionState>) {
    setState((current) => ({ ...current, [questionId]: { ...current[questionId], ...patch } }));
    setSaved(false);
  }

  async function submit() {
    const body = {
      answers: questions.map((q) => ({ questionId: q.id, answer: state[q.id].answer, description: state[q.id].description })),
      evidenceLinks: links.split("\n"),
    };
    const found = validateCheckUpResponse(body, questions).problems;
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/check-ups/${checkUpId}/response`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(result.problems ?? [result.error ?? "Failed to save the response"]);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {questions.map((question) => {
        const current = state[question.id];
        const needsDescription = current.answer !== "" && descriptionRequired(current.answer);
        return (
          <fieldset key={question.id} className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <legend className="px-1 text-sm font-medium">
              {question.position}. {question.text}
            </legend>
            <div className="flex gap-4 text-sm">
              {CHECK_UP_ANSWERS.map((answer) => (
                <label key={answer} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`answer-${question.id}`}
                    value={answer}
                    checked={current.answer === answer}
                    onChange={() => change(question.id, { answer })}
                    aria-label={`${CHECK_UP_ANSWER_LABEL[answer]} for question ${question.position}`}
                  />
                  {CHECK_UP_ANSWER_LABEL[answer]}
                </label>
              ))}
            </div>
            <textarea
              className={INPUT_CLASSES}
              rows={2}
              maxLength={MAX_DESCRIPTION_LENGTH}
              aria-label={`Description for question ${question.position}${needsDescription ? " (required)" : ""}`}
              placeholder={needsDescription ? "Required: explain the answer" : "Optional"}
              value={current.description}
              onChange={(event) => change(question.id, { description: event.target.value })}
            />
          </fieldset>
        );
      })}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Evidence links</span>
        <span className="text-zinc-500">One http(s) URL per line, at most {MAX_EVIDENCE_LINKS}. Links only: nothing is uploaded.</span>
        <textarea
          className={INPUT_CLASSES}
          rows={3}
          aria-label="Evidence links"
          value={links}
          onChange={(event) => {
            setLinks(event.target.value);
            setSaved(false);
          }}
        />
      </label>

      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {changing ? "Save changes" : "Submit response"}
        </Button>
        {saved && <span className="text-sm text-zinc-500">Saved</span>}
      </div>
    </form>
  );
}
