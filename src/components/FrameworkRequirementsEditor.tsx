"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  ControlMappingEditor,
  type MappedControl,
  type PickableControl,
} from "@/components/ControlMappingEditor";

export type RequirementRow = {
  id: string;
  code: string;
  section: string;
  title: string;
  text: string;
  mappings: MappedControl[];
};

type RequirementDraft = { code: string; section: string; title: string; text: string };

const EMPTY_DRAFT: RequirementDraft = { code: "", section: "", title: "", text: "" };

/** The hint under the text field: paraphrase-only Frameworks must never hold verbatim standard text. */
export function textHint(licensing: "PARAPHRASE_ONLY" | "QUOTABLE"): string {
  return licensing === "PARAPHRASE_ONLY"
    ? "Own-words paraphrase, no verbatim text. This Framework is licensed, so never paste the standard's wording."
    : "This Framework's text is public domain, so it may be quoted.";
}

function compareCodes(a: { code: string }, b: { code: string }) {
  return a.code.localeCompare(b.code, undefined, { numeric: true });
}

/** Requirements grouped under their `section`, sections and codes in natural order. */
function groupBySection(requirements: RequirementRow[]): { section: string; items: RequirementRow[] }[] {
  const groups = new Map<string, RequirementRow[]>();
  for (const requirement of requirements) {
    groups.set(requirement.section, [...(groups.get(requirement.section) ?? []), requirement]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([section, items]) => ({ section, items: items.sort(compareCodes) }));
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

function RequirementFields({
  draft,
  onChange,
  licensing,
  idPrefix,
}: {
  draft: RequirementDraft;
  onChange: (patch: Partial<RequirementDraft>) => void;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  idPrefix: string;
}) {
  const hintId = `${idPrefix}-text-hint`;
  const inputClass = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Code"
          placeholder="Code (e.g. Art. 21(2)(h))"
          className={`${inputClass} w-48`}
          value={draft.code}
          onChange={(event) => onChange({ code: event.target.value })}
          required
        />
        <input
          aria-label="Section"
          placeholder="Section (e.g. Article 21)"
          className={`${inputClass} min-w-48 flex-1`}
          value={draft.section}
          onChange={(event) => onChange({ section: event.target.value })}
          required
        />
      </div>
      <input
        aria-label="Title"
        placeholder="Title"
        className={inputClass}
        value={draft.title}
        onChange={(event) => onChange({ title: event.target.value })}
        required
      />
      <textarea
        aria-label="Text"
        aria-describedby={hintId}
        placeholder="Text"
        className={inputClass}
        rows={3}
        value={draft.text}
        onChange={(event) => onChange({ text: event.target.value })}
        required
      />
      <p id={hintId} className="text-xs text-zinc-500">
        {textHint(licensing)}
      </p>
    </>
  );
}

/**
 * Authoring for one Framework's Requirements: grouped by section, with
 * create / edit / delete (code, section, title, text) and, under each, the
 * Control Mapping editor. The server page hands in the initial Requirements;
 * every mutation reloads them from `GET /api/frameworks/[id]/requirements`.
 * See #73, PRD 0001 F-FW.4, F-CL.4.
 */
export function FrameworkRequirementsEditor({
  frameworkId,
  licensing,
  initialRequirements,
  controls,
}: {
  frameworkId: string;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  initialRequirements: RequirementRow[];
  controls: PickableControl[];
}) {
  const [requirements, setRequirements] = useState<RequirementRow[]>(initialRequirements);
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<RequirementDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RequirementDraft>(EMPTY_DRAFT);

  const basePath = `/api/frameworks/${frameworkId}/requirements`;

  async function reload() {
    const response = await fetch(basePath);
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to reload the Requirements"));
      return;
    }
    setRequirements((await response.json()).requirements ?? []);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch(basePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newDraft),
    });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to create the Requirement"));
      return;
    }
    // Keep the section: Requirements are usually entered a section at a time.
    setNewDraft({ ...EMPTY_DRAFT, section: newDraft.section });
    await reload();
  }

  function startEditing(requirement: RequirementRow) {
    setEditingId(requirement.id);
    setEditDraft({
      code: requirement.code,
      section: requirement.section,
      title: requirement.title,
      text: requirement.text,
    });
    setError(null);
  }

  async function handleSaveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setError(null);
    const response = await fetch(`${basePath}/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editDraft),
    });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to update the Requirement"));
      return;
    }
    setEditingId(null);
    await reload();
  }

  async function handleDelete(requirement: RequirementRow) {
    const mapped = requirement.mappings.length;
    const warning =
      mapped > 0
        ? `Delete Requirement ${requirement.code}? Its ${mapped} Control Mapping${mapped === 1 ? "" : "s"} will be removed too.`
        : `Delete Requirement ${requirement.code}?`;
    if (!window.confirm(warning)) return;

    setError(null);
    const response = await fetch(`${basePath}/${requirement.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to delete the Requirement"));
      return;
    }
    if (editingId === requirement.id) setEditingId(null);
    await reload();
  }

  const groups = groupBySection(requirements);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {groups.length === 0 && <p className="text-sm text-zinc-500">No Requirements yet. Add the first one below.</p>}

      {groups.map(({ section, items }) => (
        <section key={section} aria-label={`Section ${section}`} className="flex flex-col gap-3">
          <h2 className="border-b border-zinc-200 pb-1 text-base dark:border-zinc-800">{section}</h2>
          <ul className="flex flex-col gap-3">
            {items.map((requirement) => (
              <li key={requirement.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                {editingId === requirement.id ? (
                  <form onSubmit={handleSaveEdit} className="flex flex-col gap-2">
                    <RequirementFields
                      draft={editDraft}
                      onChange={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
                      licensing={licensing}
                      idPrefix={`edit-${requirement.id}`}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary">
                        Save Requirement
                      </Button>
                      <Button onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-medium">{requirement.code}</span>
                      <span>{requirement.title}</span>
                      <span className="ml-auto flex gap-2">
                        <Button
                          className="px-2 py-0.5 text-xs"
                          aria-label={`Edit ${requirement.code}`}
                          onClick={() => startEditing(requirement)}
                        >
                          Edit
                        </Button>
                        <Button
                          className="px-2 py-0.5 text-xs"
                          aria-label={`Delete ${requirement.code}`}
                          onClick={() => handleDelete(requirement)}
                        >
                          Delete
                        </Button>
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
                      {requirement.text}
                    </p>
                  </>
                )}
                <ControlMappingEditor
                  frameworkId={frameworkId}
                  requirementId={requirement.id}
                  requirementCode={requirement.code}
                  mappings={requirement.mappings}
                  controls={controls}
                  onChanged={reload}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
        <h2 className="text-base">Add a Requirement</h2>
        <RequirementFields
          draft={newDraft}
          onChange={(patch) => setNewDraft((prev) => ({ ...prev, ...patch }))}
          licensing={licensing}
          idPrefix="new"
        />
        <Button type="submit" variant="primary">
          Add Requirement
        </Button>
      </form>
    </div>
  );
}
