"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "@/app/home/home.css";
import "./planner.css";
import { Icon } from "@/app/home/HomeGraphics";
import type { PlannerControl, PlannerData, PlannerInitial } from "@/lib/audit-planner";
import { dueDateRefusal, isDueForAudit, validateInternalAudit } from "@/lib/internal-audit-rules";
import type { SystemFilterMatch, SystemFilterOptions } from "@/lib/internal-audits";
import { PlannerControls } from "./PlannerControls";
import { PlannerPreview, type Item } from "./PlannerPreview";
import { PlannerWhere, type WhereSystem } from "./PlannerWhere";
import { dayAsUtc, dayToDate, formatDay, isoDay, QUICK_DUES, suggestedTitle, TIGHT_WORKING_DAYS, workingDaysUntil } from "./planner-logic";
import type { PlanPreview } from "./planner-types";

const NOT_AUDITED = "Not audited in 12 months";
const noSubscribe = () => () => {};

/**
 * The planner for a new or edited draft Internal Audit (design proposal A, issue #393): a hero with the title,
 * "Start from" cards, three steps (when, which Controls, where) and a launch preview beside them. What a launch
 * would generate comes from the server (`POST /api/internal-audits/preview`, which runs `planLaunch`); this
 * component only collects the picks, asks, and lays the answer out. Saving posts the same fields the old form did,
 * plus the first questions the auditor edited. The API enforces every rule again.
 */
export function AuditPlanner({
  data,
  filterOptions,
  initial,
}: {
  data: PlannerData;
  filterOptions: SystemFilterOptions;
  initial?: PlannerInitial;
}) {
  const router = useRouter();
  const creating = !initial;
  // The browser's calendar day, or "" while rendering on the server (so the two renders agree).
  const todayKey = useSyncExternalStore(noSubscribe, () => isoDay(new Date()), () => "");
  const today = todayKey ? dayToDate(todayKey) : null;
  const nowUtc = today ? dayAsUtc(today) : null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [scope, setScope] = useState(initial?.scopeDescription ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [includeOrganization, setIncludeOrganization] = useState(initial?.includeOrganization ?? false);
  const [controlIds, setControlIds] = useState<string[]>(initial?.controlIds ?? []);
  const [systemIds, setSystemIds] = useState<string[]>(initial?.systemIds ?? []);
  // First questions the auditor changed, by Control id: only those that differ from where the Control starts.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null);
  const [found, setFound] = useState<WhereSystem[]>([]);
  const [startedFrom, setStartedFrom] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [earlier, setEarlier] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  const controlsById = useMemo(() => new Map(data.controls.map((control) => [control.id, control])), [data.controls]);
  const pickedSet = useMemo(() => new Set(controlIds), [controlIds]);
  const draftIds = useMemo(() => new Set(initial?.controlIds ?? []), [initial]);

  /** What the Control's first question is before any edit: the saved draft's, or the Control's own question. */
  const baselineFor = (control: PlannerControl) => (draftIds.has(control.id) ? (initial?.firstQuestions[control.id] ?? "") : (control.question ?? ""));
  const questionFor = (control: PlannerControl) => edits[control.id] ?? baselineFor(control);
  function editQuestion(control: PlannerControl, text: string) {
    setEdits((current) => {
      const next = { ...current };
      if (text === baselineFor(control)) delete next[control.id];
      else next[control.id] = text;
      return next;
    });
  }

  const systems: WhereSystem[] = useMemo(
    () => [
      ...data.systems.map((system) => ({ id: system.id, name: system.name, vendor: system.vendor, status: system.status, detail: system.deploymentFacets.join(" + ") })),
      ...found,
    ],
    [data.systems, found],
  );

  function pickControls(ids: string[], on: boolean) {
    setControlIds((current) => (on ? [...current, ...ids.filter((id) => !current.includes(id))] : current.filter((id) => !ids.includes(id))));
  }
  function toggleSystem(id: string) {
    setSystemIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }
  /** Adds the filter's matches to the picked Systems (never twice, none removed) and returns how many were new. */
  function addMatches(matches: SystemFilterMatch[]): number {
    const known = new Set(systems.map((system) => system.id));
    const fresh = matches.filter((match) => !systemIds.includes(match.id));
    setFound((current) => [
      ...current,
      ...matches.filter((match) => !known.has(match.id)).map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, status: m.status, detail: m.deploymentFacets.join(" + ") })),
    ]);
    setSystemIds((current) => [...current, ...matches.map((m) => m.id).filter((id) => !current.includes(id))]);
    return fresh.length;
  }

  // Start from.
  function startFromDue() {
    const ids = data.controls.filter((control) => isDueForAudit(control.lastAudited, nowUtc ?? undefined)).map((control) => control.id);
    pickControls(ids, true);
    setStartedFrom(NOT_AUDITED);
    setSaid(ids.length === 0 ? "No Control is due for audit." : `Added ${ids.length} Control${ids.length === 1 ? "" : "s"} that were not audited in the last 12 months.`);
  }
  /** Adds the pack's Controls to the picks (never twice, none removed). A Control the planner doesn't know (deleted since the page loaded) is skipped. */
  function startFromPack(packId: string) {
    const pack = data.packs.find((candidate) => candidate.id === packId);
    if (!pack) return;
    const ids = pack.controlIds.filter((id) => controlsById.has(id));
    const fresh = ids.filter((id) => !pickedSet.has(id)).length;
    pickControls(ids, true);
    setStartedFrom(pack.name);
    setSaid(
      ids.length === 0
        ? `"${pack.name}" has no Controls.`
        : `Added ${fresh} Control${fresh === 1 ? "" : "s"} from "${pack.name}"${fresh < ids.length ? ` (${ids.length - fresh} already picked)` : ""}.`,
    );
  }
  function repeat(auditId: string) {
    const audit = data.repeatable.find((candidate) => candidate.id === auditId);
    if (!audit) return;
    pickControls(audit.controlIds, true);
    setSystemIds((current) => [...current, ...audit.systemIds.filter((id) => !current.includes(id))]);
    if (audit.includeOrganization) setIncludeOrganization(true);
    setStartedFrom(`Repeat of ${audit.title}`);
    setEarlier(false);
    setSaid(
      `Copied ${audit.controlIds.length} Control${audit.controlIds.length === 1 ? "" : "s"} and ${audit.systemIds.length} System${audit.systemIds.length === 1 ? "" : "s"} from "${audit.title}". Questions are not copied.`,
    );
  }

  // The preview: asked for after the picks settle. State is only set from the timer and the answer, never synchronously in the effect.
  const hasTarget = systemIds.length > 0 || includeOrganization;
  const wantsPreview = controlIds.length > 0 && hasTarget;
  const sentEdits = useMemo(() => {
    const keep: Record<string, string> = {};
    for (const id of controlIds) if (edits[id] !== undefined) keep[id] = edits[id];
    return keep;
  }, [controlIds, edits]);
  const requestBody = useMemo(
    () => JSON.stringify({ internalAuditId: initial?.id, title, dueDate: dueDate || null, includeOrganization, controlIds, systemIds, firstQuestions: sentEdits }),
    [initial?.id, title, dueDate, includeOrganization, controlIds, systemIds, sentEdits],
  );
  const [answer, setAnswer] = useState<{ key: string; preview: PlanPreview } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!wantsPreview) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/internal-audits/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok || !body.preview) setFailedKey(requestBody);
        else setAnswer({ key: requestBody, preview: body.preview });
      } catch {
        if (!controller.signal.aborted) setFailedKey(requestBody);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [wantsPreview, requestBody]);
  const preview = wantsPreview ? (answer?.preview ?? null) : null;
  const stale = wantsPreview && answer?.key !== requestBody && failedKey !== requestBody;
  const failed = wantsPreview && failedKey === requestBody;

  // 1 When.
  const dueMoved = dueDate !== (initial?.dueDate ?? "");
  const dueProblem = !dueDate ? null : dueMoved || creating ? dueDateRefusal(dueDate) : null;
  const working = today && dueDate && !dueProblem ? workingDaysUntil(dueDate, today) : null;
  const tight = working !== null && working < TIGHT_WORKING_DAYS;

  const pickedControls = controlIds.map((id) => controlsById.get(id)).filter((control): control is PlannerControl => Boolean(control));
  const suggestion = today && !title.trim() ? suggestedTitle(today, pickedControls, startedFrom) : null;

  const readiness: Item[] = [
    { ok: title.trim() !== "", title: "A title", detail: title.trim() || "Name the audit" },
    { ok: Boolean(dueDate) && !dueProblem, title: "A due date", detail: dueProblem ?? (dueDate ? formatDay(dueDate) : "Pick when it is due") },
    { ok: controlIds.length > 0, title: "At least one Control", detail: `${controlIds.length} picked` },
    { ok: hasTarget, title: "At least one System or the Organization", detail: `${systemIds.length} System${systemIds.length === 1 ? "" : "s"}${includeOrganization ? " + the Organization" : ""}` },
  ];

  function writeQuestion(controlId: string) {
    setOpenId(controlId);
    setReveal((current) => ({ id: controlId, nonce: (current?.nonce ?? 0) + 1 }));
    controlsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function save() {
    const found = validateInternalAudit({ title, controlIds, systemIds, includeOrganization, dueDate: dueDate || null });
    if (dueProblem) found.push(dueProblem);
    setProblems(found);
    if (found.length > 0) return;

    setBusy(true);
    try {
      const response = await fetch(initial ? `/api/internal-audits/${initial.id}` : "/api/internal-audits", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, scopeDescription: scope, dueDate, includeOrganization, controlIds, systemIds, firstQuestions: sentEdits }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.problems ?? [body.error ?? "Failed to save the Internal Audit"]);
        return;
      }
      router.push(`/internal-audits/${body.internalAudit.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const total = preview ? preview.systemCheckUpCount + preview.organizationCheckUpCount : 0;
  const recent = data.repeatable.slice(0, 2);
  const olderAudits = data.repeatable.slice(2);

  return (
    <div className="hc ap" data-page-id="INTERNAL AUDIT . PLANNER">
      <nav className="ap-crumb" aria-label="Breadcrumb">
        <Link href="/internal-audits">Internal Audits</Link>
        <span>/</span>
        <span>{creating ? "New" : "Edit draft"}</span>
      </nav>

      {problems.length > 0 && (
        <ul role="alert" className="ap-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <header className="ap-hero">
        <div className="ap-hero-top">
          <span className="ap-chip">{creating ? "New Internal Audit" : "Draft"}</span>
          <span className="ap-chip">Nothing is sent to anyone until it is launched</span>
        </div>
        <input className="ap-title" aria-label="Title" placeholder={suggestion ?? "Name this audit"} value={title} onChange={(event) => setTitle(event.target.value)} />
        {suggestion && (
          <button type="button" className="ap-suggest" onClick={() => setTitle(suggestion)}>
            Use &ldquo;{suggestion}&rdquo;
          </button>
        )}
        <textarea className="ap-scope" rows={2} aria-label="Scope (optional)" placeholder="Scope (optional): what this audit is about" value={scope} onChange={(event) => setScope(event.target.value)} />
      </header>

      <section className="ap-start" aria-labelledby="ap-s-h">
        <div className="ap-start-h">
          <h2 id="ap-s-h">Start from</h2>
          <p>A shortcut for the picks below; change anything afterwards.</p>
        </div>
        <div className="ap-packs">
          <button type="button" className="ap-pack" onClick={startFromDue}>
            <span className="ib">
              <Icon name="alert" size={18} />
            </span>
            <b>{NOT_AUDITED}</b>
            <small>Every Control never audited or due again</small>
          </button>
          {data.packs.map((pack) => (
            <button key={pack.id} type="button" className="ap-pack" onClick={() => startFromPack(pack.id)}>
              <span className="ib">
                <Icon name="layers" size={18} />
              </span>
              <b>{pack.name}</b>
              <small>
                {pack.controlIds.length} Control{pack.controlIds.length === 1 ? "" : "s"}
                {pack.note ? ` · ${pack.note}` : ""}
              </small>
            </button>
          ))}
          {recent.map((audit) => (
            <button key={audit.id} type="button" className="ap-pack prev" onClick={() => repeat(audit.id)}>
              <span className="ib">
                <Icon name="audit" size={18} />
              </span>
              <b>Repeat {audit.title}</b>
              <small>
                {audit.controlIds.length} Controls · {audit.systemIds.length} Systems · {audit.status === "CLOSED" ? "closed" : "launched"} {formatDay(audit.launchedAt.slice(0, 10))}
              </small>
            </button>
          ))}
          {olderAudits.length > 0 && (
            <button type="button" className="ap-pack prev" aria-expanded={earlier} onClick={() => setEarlier((open) => !open)}>
              <span className="ib">
                <Icon name="layers" size={18} />
              </span>
              <b>More…</b>
              <small>Repeat an earlier audit</small>
            </button>
          )}
        </div>
        {earlier && (
          <div className="ap-earlier" role="group" aria-label="Earlier audits">
            {olderAudits.map((audit) => (
              <button key={audit.id} type="button" onClick={() => repeat(audit.id)}>
                <span>{audit.title}</span>
                <small>
                  {audit.controlIds.length} Controls · {audit.systemIds.length} Systems
                </small>
              </button>
            ))}
          </div>
        )}
        <p className="ap-said" role="status">
          {said}
        </p>
        <Link className="ap-manage" href="/internal-audits/control-packs">
          Manage Control Packs
        </Link>
      </section>

      <div className="ap-main">
        <div className="ap-flow">
          <section className="ap-card" aria-labelledby="ap-d-h">
            <div className="ap-card-h">
              <span className={`ap-step${dueDate && !dueProblem ? " done" : ""}`}>1</span>
              <h2 id="ap-d-h">When is it due?</h2>
              <p>Recipients get Check-ups when the audit is launched</p>
            </div>
            <div className="ap-card-b ap-when">
              <label className="ap-field">
                Due date
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
              <div className="ap-timeline">
                <div className="ap-seg" role="group" aria-label="Quick due dates">
                  {QUICK_DUES.map((quick) => (
                    <button key={quick.label} type="button" disabled={!today} onClick={() => today && setDueDate(quick.date(today))}>
                      {quick.label}
                    </button>
                  ))}
                </div>
                <div className="ap-tl-bar" aria-hidden="true">
                  <div className={`ap-tl-fill${tight ? " tight" : ""}`} style={{ width: `${Math.min(100, ((working ?? 0) / 40) * 100)}%` }} />
                </div>
                <div className="ap-tl-meta">
                  {dueProblem ? (
                    <span className="bad">{dueProblem}</span>
                  ) : working !== null ? (
                    <>
                      <span>
                        <b>{working}</b> working day{working === 1 ? "" : "s"} left
                      </span>
                      <span>{tight ? `Tight: under ${TIGHT_WORKING_DAYS} working days` : "Weekends excluded, no holidays"}</span>
                    </>
                  ) : (
                    <span>Pick a date to see the working days the recipients have</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div ref={controlsRef}>
            <PlannerControls
              controls={data.controls}
              picked={pickedSet}
              onPick={pickControls}
              questionFor={questionFor}
              onQuestion={editQuestion}
              perControl={preview?.perControl ?? null}
              now={nowUtc}
              openId={openId}
              onOpen={setOpenId}
              reveal={reveal}
            />
          </div>

          <PlannerWhere
            options={filterOptions}
            systems={systems}
            picked={systemIds}
            onToggle={toggleSystem}
            onAddMatches={addMatches}
            includeOrganization={includeOrganization}
            onOrganization={setIncludeOrganization}
            organizationCheckUps={preview?.organizationCheckUpCount ?? null}
          />
        </div>

        <div id="ap-preview">
          <PlannerPreview
            preview={preview}
            stale={stale}
            failed={failed}
            readiness={readiness}
            controlsById={controlsById}
            creating={creating}
            busy={busy}
            saveTitle={readiness.every((item) => item.ok) ? "" : "Something is still missing"}
            onSave={save}
            onCancel={() => router.back()}
            onWriteQuestion={writeQuestion}
          />
        </div>
      </div>

      <div className="ap-mobile-bar">
        <span>
          <b>{total}</b> Check-ups
        </span>
        <button type="button" className="hc-btn primary" onClick={() => document.getElementById("ap-preview")?.scrollIntoView?.({ behavior: "smooth" })}>
          Review
        </button>
      </div>
    </div>
  );
}
