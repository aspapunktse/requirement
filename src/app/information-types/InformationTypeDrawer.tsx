"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { SensitivityChip } from "@/components/SensitivityChip";
import {
  MAX_INFORMATION_TYPE_DESCRIPTION_LENGTH,
  MAX_INFORMATION_TYPE_NAME_LENGTH,
  type DeclaringSystem,
  type InformationTypeRow,
  type SuggestedFrameworkRef,
} from "@/lib/information-type";
import { frameworkLabel } from "@/lib/framework-label";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";
import "@/app/home/home.css";
import "@/app/systems/[id]/system-cockpit.css";
import "./information-types.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Declaring = { state: "loading" } | { state: "error" } | { state: "ready"; systems: DeclaringSystem[] };

/**
 * The drawer of the Information Type catalogue (#303): for a curator a form to add or change a type (name,
 * description, Sensitivity Level), for everyone else the type read-only. An existing type also lists the Systems
 * that declare it, as many as the acting user may see. Changing the level changes nothing on those Systems (ADR 0012),
 * and the form says so. A curator also picks the Frameworks the type suggests (ADR 0013): the Systems that declare it are
 * offered them for their Framework Scope, and flagged when the list changes; nothing is added to any scope. The route
 * decides who may write; a refusal or a duplicate name is shown here.
 */
export function InformationTypeDrawer({
  type,
  levels,
  frameworkChoices = [],
  canCurate,
  onClose,
  onSaved,
}: {
  /** The type to show, or null to add a new one. */
  type: InformationTypeRow | null;
  levels: SensitivityLevelInfo[];
  /** The Frameworks a curator can pick from: every one except the base Framework. */
  frameworkChoices?: SuggestedFrameworkRef[];
  canCurate: boolean;
  onClose: () => void;
  onSaved: (row: InformationTypeRow, created: boolean) => void;
}) {
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  const [name, setName] = useState(type?.name ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [level, setLevel] = useState<number | null>(type?.sensitivityLevel ?? null);
  const [frameworkIds, setFrameworkIds] = useState<string[]>(type?.suggestedFrameworks.map((framework) => framework.id) ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState<Declaring>({ state: "loading" });
  const typeId = type?.id ?? null;
  const labelOf = (value: number) => levels.find((item) => item.level === value)?.label;

  // The Systems that declare the type: fetched when the drawer opens, with a loading and an error state.
  useEffect(() => {
    if (!typeId) return;
    let cancelled = false;
    fetch(`/api/information-types/${typeId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("not ok");
        const body = (await response.json()) as { systems: DeclaringSystem[] };
        if (!cancelled) setDeclaring({ state: "ready", systems: body.systems });
      })
      .catch(() => {
        if (!cancelled) setDeclaring({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [typeId]);

  useEffect(() => {
    (asideRef.current?.querySelector<HTMLElement>("input[name='name']") ?? closeRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target === document.body || (target instanceof Node && asideRef.current?.contains(target))) closeNow.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const aside = asideRef.current;
    if (!aside) return;
    const items = [...aside.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === aside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === aside)) {
      event.preventDefault();
      first.focus();
    }
  }

  const trimmedName = name.trim();
  const savedFrameworkIds = type?.suggestedFrameworks.map((framework) => framework.id) ?? [];
  const frameworksChanged = frameworkIds.length !== savedFrameworkIds.length || frameworkIds.some((id) => !savedFrameworkIds.includes(id));
  const changed = !type || trimmedName !== type.name || description.trim() !== (type.description ?? "") || level !== type.sensitivityLevel || frameworksChanged;
  const canSave = canCurate && trimmedName !== "" && level !== null && changed && !saving;
  const levelChanged = !!type && level !== null && level !== type.sensitivityLevel;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(type ? `/api/information-types/${type.id}` : "/api/information-types", {
        method: type ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, description: description.trim() || null, sensitivityLevel: level, frameworkIds }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not save the Information Type.");
        return;
      }
      onSaved(body.informationType as InformationTypeRow, !type);
    } catch {
      setError("Could not save the Information Type.");
    } finally {
      setSaving(false);
    }
  }

  const heading = type ? type.name : "Add an Information Type";

  return createPortal(
    <div className="sc-drawer-root it-drawer-root">
      <div className="sc-scrim" data-testid="information-type-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">{type ? "Information Type" : "New"}</span>
          <h2 id={titleId}>{heading}</h2>
          {type && (
            <div className="sc-dmeta">
              <SensitivityChip level={type.sensitivityLevel} label={labelOf(type.sensitivityLevel)} />
            </div>
          )}
        </header>
        <div className="sc-dbody">
          {canCurate ? (
            <form className="sc-dform" onSubmit={save} aria-label={type ? "Edit Information Type" : "New Information Type"}>
              {error && (
                <p role="alert" className="sc-err">
                  {error}
                </p>
              )}
              <label className="sc-field">
                <span>Name</span>
                <input name="name" value={name} maxLength={MAX_INFORMATION_TYPE_NAME_LENGTH} onChange={(event) => setName(event.target.value)} autoComplete="off" />
              </label>
              <label className="sc-field">
                <span>Description (optional)</span>
                <textarea
                  name="description"
                  rows={3}
                  value={description}
                  maxLength={MAX_INFORMATION_TYPE_DESCRIPTION_LENGTH}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div role="radiogroup" aria-labelledby={`${titleId}-level`} className="it-radios">
                <span id={`${titleId}-level`} className="it-legend">
                  Sensitivity Level
                </span>
                {levels.map((item) => (
                  <label key={item.level} className={`it-radio${level === item.level ? " on" : ""}`}>
                    <input
                      type="radio"
                      name="sensitivityLevel"
                      checked={level === item.level}
                      onChange={() => setLevel(item.level)}
                      aria-labelledby={`${titleId}-l${item.level}`}
                      aria-describedby={`${titleId}-d${item.level}`}
                    />
                    <span id={`${titleId}-l${item.level}`}>
                      <SensitivityChip level={item.level} label={item.label} />
                    </span>
                    <small id={`${titleId}-d${item.level}`}>{item.description}</small>
                  </label>
                ))}
              </div>
              <fieldset className="it-frameworks">
                <legend className="it-legend">Suggested Frameworks</legend>
                <p className="sc-faint">
                  A System that declares this type is offered these Frameworks for its Framework Scope. Its owner decides; nothing is added automatically.
                </p>
                {frameworkChoices.length === 0 && <p className="sc-faint">There are no other Frameworks to suggest yet.</p>}
                {frameworkChoices.map((framework) => (
                  <label key={framework.id} className="it-fw">
                    <input
                      type="checkbox"
                      checked={frameworkIds.includes(framework.id)}
                      onChange={(event) =>
                        setFrameworkIds((current) => (event.target.checked ? [...current, framework.id] : current.filter((id) => id !== framework.id)))
                      }
                    />
                    <span>{frameworkLabel(framework)}</span>
                    {framework.status === "DRAFT" && <small>Draft: suggests nothing until it is published</small>}
                  </label>
                ))}
              </fieldset>
              {type && type.systemCount > 0 && frameworksChanged && (
                <p className="sc-callout" role="note">
                  {plural(type.systemCount, "System")} declare{type.systemCount === 1 ? "s" : ""} this type. Changing its Frameworks flags{" "}
                  {type.systemCount === 1 ? "that System" : "those Systems"} for {type.systemCount === 1 ? "its owner" : "their owners"} to review; their Framework Scope isn&apos;t changed.
                </p>
              )}
              {type && type.systemCount > 0 && (
                <p className="sc-callout" role="note">
                  {plural(type.systemCount, "System")} declare{type.systemCount === 1 ? "s" : ""} this type.{" "}
                  {levelChanged
                    ? `Changing its level to ${labelOf(level)} changes nothing on ${type.systemCount === 1 ? "that System" : "those Systems"} by itself.`
                    : "Changing its level changes nothing on those Systems by itself."}
                </p>
              )}
              <div className="sc-btnrow">
                <button type="submit" className="hc-btn primary" disabled={!canSave}>
                  {saving ? "Saving…" : type ? "Save" : "Add"}
                </button>
                <button type="button" className="hc-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            type && (
              <>
                <p>{type.description ?? "No description."}</p>
                <dl className="sc-readonly">
                  <dt>Sensitivity Level</dt>
                  <dd>
                    <SensitivityChip level={type.sensitivityLevel} label={labelOf(type.sensitivityLevel)} />
                  </dd>
                  <dt>Suggested Frameworks</dt>
                  <dd>
                    {type.suggestedFrameworks.length === 0 ? (
                      <span className="sc-faint">None</span>
                    ) : (
                      <ul className="sc-tags" aria-label="Suggested Frameworks">
                        {type.suggestedFrameworks.map((framework) => (
                          <li key={framework.id}>{frameworkLabel(framework)}</li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </dl>
                <p className="sc-faint">Only the Compliance Manager or an Admin changes the catalogue.</p>
              </>
            )
          )}

          {type && (
            <section className="sc-dsec" aria-label="Declaring Systems">
              <h3>Declared by {plural(type.systemCount, "System")}</h3>
              {declaring.state === "loading" && <p className="sc-faint">Loading Systems…</p>}
              {declaring.state === "error" && (
                <p role="alert" className="sc-err">
                  Could not load the Systems that declare this type.
                </p>
              )}
              {declaring.state === "ready" && (
                <>
                  {declaring.systems.length === 0 ? (
                    <p className="sc-faint">{type.systemCount === 0 ? "No System declares it yet." : "None of the Systems that declare it are visible to you."}</p>
                  ) : (
                    <ul className="it-systems">
                      {declaring.systems.map((system) => (
                        <li key={system.id}>
                          <Link href={`/systems/${system.id}`}>{system.name}</Link>
                          <SensitivityChip level={system.sensitivityLevel} label={system.sensitivityLevel ? labelOf(system.sensitivityLevel) : undefined} size="sm" />
                        </li>
                      ))}
                    </ul>
                  )}
                  {declaring.systems.length > 0 && declaring.systems.length < type.systemCount && (
                    <p className="sc-faint">{plural(type.systemCount - declaring.systems.length, "more System")} not shown to your role.</p>
                  )}
                </>
              )}
              {type.systemCount > 0 && canCurate && <p className="sc-faint">A type that Systems declare can&apos;t be deleted.</p>}
              <p>
                <Link href={`/information-types/where?type=${encodeURIComponent(type.id)}`}>Where can I put this information?</Link>
              </p>
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
