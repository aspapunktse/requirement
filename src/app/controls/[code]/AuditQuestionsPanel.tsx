"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateAuditQuestions } from "@/lib/control-audit-questions";

type Question = { text: string; guidance: string | null };
type Item = { key: number; text: string; guidance: string };

const toItem = (q: Question, key: number): Item => ({ key, text: q.text, guidance: q.guidance ?? "" });

/**
 * A Control's Audit Questions (#404): the standing questions an Internal Auditor verifies it with, and the
 * starting point of a new Internal Audit draft for this Control. Compliance Manager, Admin and Internal Auditor
 * get an inline editor (add, edit, remove, reorder, saved as one ordered list); everyone else who can see the
 * Control gets the list read-only. The server enforces the same rules and the same roles.
 */
export function AuditQuestionsPanel({
  controlId,
  code,
  initialQuestions,
  canCurate,
}: {
  controlId: string;
  code: string;
  initialQuestions: Question[];
  canCurate: boolean;
}) {
  const router = useRouter();
  const nextKey = useRef(initialQuestions.length);
  const [items, setItems] = useState<Item[]>(() => initialQuestions.map(toItem));
  const [saved, setSaved] = useState<Question[]>(initialQuestions);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  if (!canCurate) {
    return (
      <div className="cp-block">
        <span className="cp-label">Audit Questions</span>
        {initialQuestions.length === 0 ? (
          <p className="cp-muted">No Audit Questions yet.</p>
        ) : (
          <ol aria-label={`Audit Questions for ${code}`} className="cp-aq-read">
            {initialQuestions.map((question, index) => (
              <li key={index}>
                {question.text}
                {question.guidance && <p className="cp-muted cp-small cp-aq-guidance">Guidance: {question.guidance}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  const dirty = items.length !== saved.length || items.some((item, index) => item.text !== saved[index].text || item.guidance.trim() !== (saved[index].guidance ?? ""));

  function change(next: Item[]) {
    setItems(next);
    setJustSaved(false);
  }

  function move(index: number, by: -1 | 1) {
    const next = [...items];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    change(next);
  }

  async function save() {
    const found = validateAuditQuestions(
      items.map((item) => item.text),
      items.map((item) => item.guidance),
    );
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/controls/${controlId}/audit-questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: items.map((item) => ({ text: item.text, guidance: item.guidance })) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.problems ?? [body.error ?? "Failed to save the Audit Questions"]);
        return;
      }
      const texts: string[] = body.questions;
      const guidance: (string | null)[] = body.guidance ?? [];
      const questions = texts.map((text, index): Question => ({ text, guidance: guidance[index] ?? null }));
      setSaved(questions);
      setItems(questions.map((question) => toItem(question, nextKey.current++)));
      setJustSaved(true);
      router.refresh();
    } catch {
      setProblems(["Failed to save the Audit Questions"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-block cp-aq">
      <span className="cp-label">Audit Questions</span>
      <p className="cp-muted cp-small">
        What an Internal Auditor asks to verify this Control works. A new Internal Audit draft starts from a copy of these; later changes here don&apos;t change
        drafts or Check-ups that already exist. Without any, the draft starts from the Self-Assessment Question. An optional guidance note beside a question travels with it and
        is shown to the person answering and to the Internal Auditor.
      </p>
      {items.length === 0 && <p className="cp-muted">No Audit Questions yet.</p>}
      <ul className="cp-aq-list" aria-label={`Audit Questions for ${code}`}>
        {items.map((item, index) => (
          <li key={item.key} className="cp-aq-row">
            <div className="cp-aq-fields">
              <textarea
                rows={2}
                aria-label={`Audit Question ${index + 1} for ${code}`}
                value={item.text}
                onChange={(event) => change(items.map((other) => (other.key === item.key ? { ...other, text: event.target.value } : other)))}
              />
              <textarea
                rows={1}
                placeholder="Guidance (optional)"
                aria-label={`Guidance for Audit Question ${index + 1} (optional)`}
                value={item.guidance}
                onChange={(event) => change(items.map((other) => (other.key === item.key ? { ...other, guidance: event.target.value } : other)))}
              />
            </div>
            <div className="cp-aq-actions">
              <button type="button" className="hc-btn" aria-label={`Move Audit Question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                Up
              </button>
              <button
                type="button"
                className="hc-btn"
                aria-label={`Move Audit Question ${index + 1} down`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                Down
              </button>
              <button type="button" className="hc-btn" aria-label={`Remove Audit Question ${index + 1}`} onClick={() => change(items.filter((other) => other.key !== item.key))}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      {problems.length > 0 && (
        <ul role="alert" className="cp-aq-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="cp-aq-bar">
        <button type="button" className="hc-btn" onClick={() => change([...items, { key: nextKey.current++, text: "", guidance: "" }])}>
          Add Audit Question
        </button>
        <button type="button" className="hc-btn primary" disabled={busy || !dirty} onClick={save}>
          Save Audit Questions
        </button>
        {justSaved && !dirty && <span className="cp-muted cp-small">Saved</span>}
      </div>
    </div>
  );
}
