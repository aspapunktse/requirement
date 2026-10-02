"use client";

import { useState } from "react";
import Link from "next/link";
import type { ControlOfferingType } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import {
  CONTROL_OFFERING_TYPES,
  CONTROL_OFFERING_TYPE_LABEL,
  controlOfferingRefusal,
} from "@/lib/control-offering-rules";
import type { ControlOfferingRow, OfferableControl } from "@/lib/control-offerings";
import type { DependentRow } from "@/lib/provider-dependency-rules";

const SELECT_CLASSES = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";
const TEXTAREA_CLASSES = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

/**
 * The "Provider" section of the System page (PRD 0001 F-IN.2, ADR 0008, #123):
 * whether the System is a Provider and its Control Offerings, read by everyone
 * who can see the System. The System's owner or an Admin (`canManage`, computed
 * by the page with the same `canManageProvider` the API enforces) can mark or
 * unmark it, and add, edit and remove Offerings, and sees the Systems that depend
 * on the Provider (#124): their names only, linked only when the viewer can open
 * them. A Provider with Offerings or dependents can't be unmarked. The data comes
 * from the server page as props and is updated from each response; nothing is
 * fetched on mount. `offerable` is the Controls that apply to the Provider and
 * aren't offered yet.
 */
export function SystemProvider({
  systemId,
  canManage,
  initialIsProvider,
  initialOfferings,
  initialOfferable,
  dependents = [],
}: {
  systemId: string;
  canManage: boolean;
  initialIsProvider: boolean;
  initialOfferings: ControlOfferingRow[];
  initialOfferable: OfferableControl[];
  /** The Systems depending on this Provider; only passed to its owner or an Admin. */
  dependents?: DependentRow[];
}) {
  const [isProvider, setIsProvider] = useState(initialIsProvider);
  const [offerings, setOfferings] = useState(initialOfferings);
  const [offerable, setOfferable] = useState(initialOfferable);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(parsed.error ?? "Something went wrong");
      return null;
    }
    return parsed;
  }

  async function setProvider(next: boolean) {
    const result = await send(`/api/systems/${systemId}/provider`, "PATCH", { isProvider: next });
    if (result) setIsProvider(result.isProvider);
  }

  async function addOffering(input: { controlId: string; type: ControlOfferingType; customerResponsibility?: string }) {
    const result = await send(`/api/systems/${systemId}/offerings`, "POST", input);
    if (!result) return false;
    const added = result.offering as ControlOfferingRow;
    setOfferings((previous) => [...previous, added].sort((a, b) => byCode(a.control, b.control)));
    setOfferable((previous) => previous.filter((control) => control.id !== added.control.id));
    return true;
  }

  async function saveOffering(row: ControlOfferingRow, patch: { type: ControlOfferingType; customerResponsibility?: string }) {
    const result = await send(`/api/systems/${systemId}/offerings/${row.id}`, "PATCH", patch);
    if (!result) return;
    const saved = result.offering as ControlOfferingRow;
    setOfferings((previous) => previous.map((offering) => (offering.id === saved.id ? saved : offering)));
    setEditingId(null);
  }

  async function removeOffering(row: ControlOfferingRow) {
    if (!window.confirm(`Remove the Control Offering for ${row.control.code}?`)) {
      return;
    }
    const result = await send(`/api/systems/${systemId}/offerings/${row.id}`, "DELETE");
    if (!result) return;
    setOfferings((previous) => previous.filter((offering) => offering.id !== row.id));
    // Only a Control that still applies to the Provider can be offered again.
    if (row.applies) setOfferable((previous) => [...previous, row.control].sort(byCode));
    if (editingId === row.id) setEditingId(null);
  }

  const hasOfferings = offerings.length > 0;
  const hasDependents = dependents.length > 0;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {error && <p className="text-red-600">{error}</p>}

      {isProvider ? (
        <p>
          This System is a Provider: it publishes Control Offerings for the Systems that depend on it.
        </p>
      ) : (
        <p className="text-zinc-500">This System is not a Provider.</p>
      )}

      {canManage && (
        <div className="flex flex-col gap-1">
          {isProvider ? (
            <>
              <Button onClick={() => setProvider(false)} disabled={busy || hasOfferings || hasDependents}>
                Stop being a Provider
              </Button>
              {hasOfferings && (
                <p className="text-xs text-zinc-500">
                  Remove its Control Offerings first: a System with Offerings stays a Provider.
                </p>
              )}
              {hasDependents && (
                <p className="text-xs text-zinc-500">
                  Systems depend on it: a Provider stays a Provider until every System has removed its dependency.
                </p>
              )}
            </>
          ) : (
            <Button variant="secondary" onClick={() => setProvider(true)} disabled={busy}>
              Mark as a Provider
            </Button>
          )}
        </div>
      )}

      {isProvider && canManage && (
        <>
          <h3 className="mt-2 text-base font-medium">Systems depending on this Provider</h3>
          {hasDependents ? (
            <ul className="flex flex-col gap-1">
              {dependents.map((dependent) => (
                <li key={dependent.id}>
                  {dependent.canSee ? (
                    <Link className="underline" href={`/systems/${dependent.id}`}>
                      {dependent.name}
                    </Link>
                  ) : (
                    dependent.name
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-500">No System depends on this Provider yet.</p>
          )}
        </>
      )}

      {isProvider && (
        <>
          <h3 className="mt-2 text-base font-medium">Control Offerings</h3>
          {!hasOfferings && <p className="text-zinc-500">No Control Offerings yet.</p>}
          <ul className="flex flex-col gap-2">
            {offerings.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.control.code}</span>
                  <span>{row.control.title}</span>
                  <StatusChip tone={row.type === "FULL" ? "accent" : "warn"}>
                    {CONTROL_OFFERING_TYPE_LABEL[row.type]}
                  </StatusChip>
                </div>
                {row.type === "SHARED" && row.customerResponsibility && (
                  <p className="whitespace-pre-wrap">
                    <span className="font-medium">Customer responsibility: </span>
                    {row.customerResponsibility}
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-2 text-zinc-500">
                  Provider&apos;s own status:{" "}
                  <StatusChip tone={controlAssessmentStatusTone(row.providerStatus)}>
                    {CONTROL_ASSESSMENT_STATUS_LABEL[row.providerStatus]}
                  </StatusChip>
                </p>
                {!row.applies && (
                  <p className="text-xs text-ems-warn">
                    This Control no longer applies to this Provider, so the Offering gives no credit.
                  </p>
                )}
                {canManage && editingId !== row.id && (
                  <div className="flex gap-2">
                    <Button
                      className="px-2 py-0.5 text-xs"
                      aria-label={`Edit Offering ${row.control.code}`}
                      onClick={() => {
                        setError(null);
                        setEditingId(row.id);
                      }}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    <Button
                      className="px-2 py-0.5 text-xs"
                      aria-label={`Remove Offering ${row.control.code}`}
                      onClick={() => removeOffering(row)}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                  </div>
                )}
                {canManage && editingId === row.id && (
                  <OfferingEditor
                    row={row}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(patch) => saveOffering(row, patch)}
                  />
                )}
              </li>
            ))}
          </ul>

          {canManage && <AddOfferingForm offerable={offerable} busy={busy} onAdd={addOffering} />}
        </>
      )}
    </div>
  );
}

/** The type picker plus, for Shared, the customer-responsibility text; shared by the add form and the editor. */
function TypeAndText({
  label,
  type,
  text,
  onType,
  onText,
}: {
  label: string;
  type: ControlOfferingType;
  text: string;
  onType: (type: ControlOfferingType) => void;
  onText: (text: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        {`Type${label}`}
        <select
          className={SELECT_CLASSES}
          value={type}
          onChange={(event) => onType(event.target.value as ControlOfferingType)}
        >
          {CONTROL_OFFERING_TYPES.map((value) => (
            <option key={value} value={value}>
              {CONTROL_OFFERING_TYPE_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      {type === "SHARED" && (
        <label className="flex flex-col gap-1">
          {`Customer responsibility${label}`}
          <textarea
            className={TEXTAREA_CLASSES}
            rows={3}
            value={text}
            onChange={(event) => onText(event.target.value)}
          />
        </label>
      )}
    </>
  );
}

function AddOfferingForm({
  offerable,
  busy,
  onAdd,
}: {
  offerable: OfferableControl[];
  busy: boolean;
  onAdd: (input: { controlId: string; type: ControlOfferingType; customerResponsibility?: string }) => Promise<boolean>;
}) {
  const [controlId, setControlId] = useState("");
  const [type, setType] = useState<ControlOfferingType>("FULL");
  const [text, setText] = useState("");

  // The same rule the API enforces, so the person sees why Add is off before trying.
  const refusal = controlOfferingRefusal(type, text);

  async function handleAdd() {
    const added = await onAdd({
      controlId,
      type,
      ...(type === "SHARED" && { customerResponsibility: text }),
    });
    if (added) {
      setControlId("");
      setType("FULL");
      setText("");
    }
  }

  if (offerable.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        Every Control that applies to this Provider is already offered.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <h4 className="font-medium">Add a Control Offering</h4>
      <label className="flex flex-col gap-1">
        Control
        <select className={SELECT_CLASSES} value={controlId} onChange={(event) => setControlId(event.target.value)}>
          <option value="">Select a Control</option>
          {offerable.map((control) => (
            <option key={control.id} value={control.id}>
              {`${control.code} ${control.title}`}
            </option>
          ))}
        </select>
      </label>
      <TypeAndText label="" type={type} text={text} onType={setType} onText={setText} />
      {refusal && <p className="text-xs text-zinc-500">{refusal}.</p>}
      <Button variant="primary" onClick={handleAdd} disabled={busy || controlId === "" || refusal !== null}>
        Add Offering
      </Button>
    </div>
  );
}

function OfferingEditor({
  row,
  busy,
  onCancel,
  onSave,
}: {
  row: ControlOfferingRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { type: ControlOfferingType; customerResponsibility?: string }) => void;
}) {
  const [type, setType] = useState<ControlOfferingType>(row.type);
  const [text, setText] = useState(row.customerResponsibility ?? "");

  const refusal = controlOfferingRefusal(type, text);
  const unchanged =
    type === row.type && (type === "FULL" || text.trim() === (row.customerResponsibility ?? "").trim());

  return (
    <div className="flex flex-col gap-2">
      <TypeAndText label={` of ${row.control.code}`} type={type} text={text} onType={setType} onText={setText} />
      {refusal && <p className="text-xs text-zinc-500">{refusal}.</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => onSave({ type, ...(type === "SHARED" && { customerResponsibility: text }) })}
          disabled={busy || refusal !== null || unchanged}
        >
          Save
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
