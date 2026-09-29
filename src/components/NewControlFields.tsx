"use client";

export type ControlApplicability = "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH";

/** The fields of a new Control, as typed into the create form. */
export type NewControlDraft = {
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  applicability: ControlApplicability;
  question: string;
  intent: string;
  examples: string;
};

export const NEW_CONTROL_DRAFT: NewControlDraft = {
  code: "",
  title: "",
  description: "",
  category: "",
  mandatory: true,
  applicability: "PER_SYSTEM",
  question: "",
  intent: "",
  examples: "",
};

/** The JSON body `POST /api/controls` (and the create-from-gap endpoint) takes for a draft. */
export function newControlBody(draft: NewControlDraft) {
  return {
    code: draft.code,
    title: draft.title,
    description: draft.description,
    category: draft.category,
    mandatory: draft.mandatory,
    applicability: draft.applicability,
    question: draft.applicability === "ORGANIZATIONAL" ? undefined : draft.question || undefined,
    intent: draft.intent || undefined,
    examples: draft.examples
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

const INPUT_CLASS = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

/**
 * The form fields for authoring a Control, shared by the Control Library's
 * "New Control" form and the Coverage view's "Create Supplementary Control"
 * form so the two can't drift. The caller supplies the <form>, the submit
 * button and the state.
 */
export function NewControlFields({
  draft,
  onChange,
}: {
  draft: NewControlDraft;
  onChange: (patch: Partial<NewControlDraft>) => void;
}) {
  return (
    <>
      <input
        aria-label="Code"
        placeholder="Code (e.g. SEC-042)"
        className={INPUT_CLASS}
        value={draft.code}
        onChange={(event) => onChange({ code: event.target.value })}
        required
      />
      <input
        aria-label="Title"
        placeholder="Title"
        className={INPUT_CLASS}
        value={draft.title}
        onChange={(event) => onChange({ title: event.target.value })}
        required
      />
      <textarea
        aria-label="Description"
        placeholder="Description"
        className={INPUT_CLASS}
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
        required
      />
      <input
        aria-label="Category"
        placeholder="Category (e.g. Security)"
        className={INPUT_CLASS}
        value={draft.category}
        onChange={(event) => onChange({ category: event.target.value })}
        required
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.mandatory}
          onChange={(event) => onChange({ mandatory: event.target.checked })}
        />
        Mandatory
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Applicability
        <select
          aria-label="Applicability"
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={draft.applicability}
          onChange={(event) => onChange({ applicability: event.target.value as ControlApplicability })}
        >
          <option value="ORGANIZATIONAL">Organizational</option>
          <option value="PER_SYSTEM">Per-System</option>
          <option value="BOTH">Both</option>
        </select>
      </label>
      {draft.applicability !== "ORGANIZATIONAL" && (
        <>
          <input
            aria-label="Self-Assessment Question"
            placeholder="Self-Assessment Question"
            className={INPUT_CLASS}
            value={draft.question}
            onChange={(event) => onChange({ question: event.target.value })}
            required
          />
          <input
            aria-label="Intent"
            placeholder="Intent (why the question matters, optional)"
            className={INPUT_CLASS}
            value={draft.intent}
            onChange={(event) => onChange({ intent: event.target.value })}
          />
          <textarea
            aria-label="Examples"
            placeholder="Example ways to satisfy it, one per line (optional)"
            className={INPUT_CLASS}
            value={draft.examples}
            onChange={(event) => onChange({ examples: event.target.value })}
          />
        </>
      )}
    </>
  );
}
