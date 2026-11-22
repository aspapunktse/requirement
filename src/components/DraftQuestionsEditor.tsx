"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { validateQuestionList } from "@/lib/check-up-rules";

type Question = { text: string; guidance: string };

const INPUT_CLASSES = "w-full rounded border border-rg-control p-2 text-sm";

/**
 * The questions of one target Control of a draft Internal Audit (PRD 0001 F-IA.2, #154): edit,
 * add, remove and reorder, saved as one ordered list. The list starts as a copy of the Control's
 * Audit Questions or, without any, its Self-Assessment Question (taken when the Control was added to
 * the draft); "From the bank" adds the Audit Questions the list is missing. A Control without a question needs a question written before launch. The server enforces the same rules (`validateQuestionList`)
 * and refuses the write once the audit is launched. Each question has an optional guidance note (#405) beside it, copied with
 * the question from the bank and on to the Check-up.
 */
export function DraftQuestionsEditor({
  internalAuditId,
  control,
  initialQuestions,
  initialGuidance = [],
  bank = [],
}: {
  internalAuditId: string;
  control: { id: string; code: string };
  initialQuestions: string[];
  /** The guidance note of each initial question (#405), by index; null or missing for none. */
  initialGuidance?: (string | null)[];
  /** The Control's Audit Questions (#404) with their guidance notes, in order: "From the bank" offers the ones the list doesn't have yet. */
  bank?: { text: string; guidance: string | null }[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>(() => initialQuestions.map((text, index) => ({ text, guidance: initialGuidance[index] ?? "" })));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function change(next: Question[]) {
    setQuestions(next);
    setSaved(false);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...questions];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    change(next);
  }

  // The bank's questions the list doesn't have yet, compared trimmed.
  const present = new Set(questions.map((q) => q.text.trim()));
  const missing = bank.filter((q) => !present.has(q.text.trim()));
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  function insertChosen() {
    change([...questions, ...missing.filter((q) => chosen.has(q.text)).map((q) => ({ text: q.text, guidance: q.guidance ?? "" }))]);
    setChosen(new Set());
    setPicking(false);
  }

  async function save() {
    const found = validateQuestionList(
      questions.map((q) => q.text),
      questions.map((q) => q.guidance),
    );
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/internal-audits/${internalAuditId}/controls/${control.id}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: questions.map((q) => ({ text: q.text, guidance: q.guidance })) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.problems ?? [body.error ?? "Failed to save the questions"]);
        return;
      }
      const guidance: (string | null)[] = body.guidance ?? [];
      setQuestions((body.questions as string[]).map((text, index) => ({ text, guidance: guidance[index] ?? "" })));
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {questions.length === 0 && <p className="text-sm text-rg-muted">No question yet: write at least one before launching.</p>}
      {questions.map((question, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="flex w-full flex-col gap-1">
            <textarea
              className={INPUT_CLASSES}
              rows={2}
              aria-label={`Question ${index + 1} for ${control.code}`}
              value={question.text}
              onChange={(event) => change(questions.map((q, i) => (i === index ? { ...q, text: event.target.value } : q)))}
            />
            <textarea
              className={INPUT_CLASSES}
              rows={1}
              placeholder="Guidance (optional)"
              aria-label={`Guidance for question ${index + 1} for ${control.code} (optional)`}
              value={question.guidance}
              onChange={(event) => change(questions.map((q, i) => (i === index ? { ...q, guidance: event.target.value } : q)))}
            />
          </div>
          <div className="flex gap-1">
            <Button aria-label={`Move question ${index + 1} for ${control.code} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              Up
            </Button>
            <Button
              aria-label={`Move question ${index + 1} for ${control.code} down`}
              disabled={index === questions.length - 1}
              onClick={() => move(index, 1)}
            >
              Down
            </Button>
            <Button aria-label={`Remove question ${index + 1} for ${control.code}`} onClick={() => change(questions.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
        </div>
      ))}
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-rg-danger">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {picking && missing.length > 0 && (
        <fieldset className="flex flex-col gap-1 rounded border border-rg-control p-2">
          <legend className="text-sm text-rg-muted">Audit Questions of {control.code} not in this draft</legend>
          {missing.map(({ text, guidance }) => (
            <label key={text} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(text)}
                onChange={(event) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(text);
                    else next.delete(text);
                    return next;
                  })
                }
              />
              <span>
                {text}
                {guidance && <span className="block text-rg-muted">Guidance: {guidance}</span>}
              </span>
            </label>
          ))}
          <div>
            <Button disabled={chosen.size === 0} onClick={insertChosen} aria-label={`Insert chosen questions for ${control.code}`}>
              Insert chosen
            </Button>
          </div>
        </fieldset>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={() => change([...questions, { text: "", guidance: "" }])}>Add question</Button>
        {bank.length > 0 && (
          <Button disabled={missing.length === 0} onClick={() => setPicking((open) => !open)} aria-expanded={picking} aria-label={`From the bank for ${control.code}`}>
            From the bank
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={save} aria-label={`Save questions for ${control.code}`}>
          Save questions
        </Button>
        {saved && <span className="text-sm text-rg-muted">Saved</span>}
      </div>
    </div>
  );
}
