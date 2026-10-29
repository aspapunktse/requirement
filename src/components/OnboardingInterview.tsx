"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ImpactLevel } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { CiaBars } from "@/app/systems/CiaBars";
import {
  IMPACT_LEVEL_WORD,
  IMPACT_STEPS,
  INTERVIEW_STEPS,
} from "@/app/systems/new/interview-steps";
import {
  compareEvaluations,
  EMPTY_ANSWERS,
  evaluateOnboarding,
  isNoEffect,
  ONBOARDING_GROUPS,
  providerOfferCount,
  toggled,
  type OnboardingAnswers,
  type OnboardingCatalog,
  type OnboardingEffect,
  type OnboardingEvaluation,
  type OnboardingFramework,
  type OnboardingGroup,
  type OnboardingRow,
} from "@/lib/onboarding-interview";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "@/app/systems/new/onboarding.css";

const GROUP_COLOR: Record<OnboardingGroup, string> = { YOU: "var(--rg-gold)", SHARED: "var(--rg-accent)", COVERED: "var(--rg-success)" };

type Note = { what: string; effect: OnboardingEffect } | null;

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** True when the viewer asked for reduced motion (and, to keep it simple and safe, where it can't be asked). */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true,
    () => true,
  );
}

/** The count, counting up or down to `target` unless the viewer prefers reduced motion. */
function useTweenedCount(target: number) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (reduced) return;
    const from = shownRef.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / 450);
      shownRef.current = Math.round(from + (target - from) * progress);
      setShown(shownRef.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return reduced ? target : shown;
}

function EffectChips({ effect, selected }: { effect: OnboardingEffect; selected: boolean }) {
  if (selected) return <StatusChip tone="neutral">Selected</StatusChip>;
  if (isNoEffect(effect)) return <StatusChip tone="neutral">No change</StatusChip>;
  return (
    <>
      {effect.added > 0 && <StatusChip tone="success">+{effect.added}</StatusChip>}
      {effect.removed > 0 && <StatusChip tone="danger">{"−"}{effect.removed}</StatusChip>}
      {effect.moved > 0 && <StatusChip tone="neutral">{effect.moved} change owner</StatusChip>}
    </>
  );
}

/** One answer card: a radio or checkbox with title, hint and the effect picking it would have. */
function OptionCard({
  type,
  name,
  title,
  hint,
  checked,
  disabled,
  effect,
  selected,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  title: string;
  hint?: string | null;
  checked: boolean;
  disabled?: boolean;
  effect: OnboardingEffect | null;
  /** Show "Selected" instead of an effect (a radio that is already the answer). */
  selected?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label className={`ob-opt${checked ? " on" : ""}${disabled ? " off" : ""}`}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-h ${id}-e`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ob-opt-t" id={`${id}-t`}>
        {title}
      </span>
      <span className="ob-opt-h" id={`${id}-h`}>
        {hint}
      </span>
      <span className="ob-opt-e" id={`${id}-e`}>
        {effect && <EffectChips effect={effect} selected={selected ?? false} />}
      </span>
    </label>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The guided System onboarding interview (design proposal A, issue #258): one plain-language question at a
 * time, with the System's applicable Controls beside it, grouped by who does the work, growing and shrinking
 * with every answer. The rules (applicability, who does the work) are the pure ones in
 * `src/lib/onboarding-interview.ts`, run in the browser on the one catalog the page reads, so each option's
 * effect needs no request. "Create System" makes the Draft System with all its answers in one request.
 */
export function OnboardingInterview() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<OnboardingCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS);
  const [questionsAnswered, setQuestionsAnswered] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [note, setNote] = useState<Note>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepMoved = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/system-onboarding")
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Could not load the onboarding data");
        return response.json() as Promise<OnboardingCatalog>;
      })
      .then((body) => {
        if (!cancelled) setCatalog(body);
      })
      .catch((reason: Error) => {
        if (!cancelled) setLoadError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Move focus to the new step's heading, but not on first render.
  useEffect(() => {
    if (!stepMoved.current) {
      stepMoved.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const evaluation = useMemo(() => (catalog ? evaluateOnboarding(catalog, answers) : null), [catalog, answers]);
  const animatedCount = useTweenedCount(evaluation?.counts.applicable ?? 0);

  // Rows that left a group (removed, or moved to another group) stay for their exit animation. They are
  // kept out of every count, hidden from assistive technology and inert; derived while rendering, not in an effect.
  const reducedMotion = usePrefersReducedMotion();
  const [seen, setSeen] = useState(evaluation);
  const [leaving, setLeaving] = useState<OnboardingRow[]>([]);
  if (evaluation !== seen) {
    setSeen(evaluation);
    if (!reducedMotion && evaluation && seen) {
      const live = new Set(evaluation.rows.map(rowKey));
      const gone = seen.rows.filter((row) => !live.has(rowKey(row)));
      setLeaving((old) => [...old.filter((row) => !live.has(rowKey(row))), ...gone]);
    }
  }
  const doneLeaving = (key: string) => setLeaving((old) => old.filter((row) => rowKey(row) !== key));

  if (loadError) {
    return (
      <div className="hc sy ob-wrap">
        <Crumbs />
        <section className="hc-card">
          <div className="hc-card-b ob-fail" role="alert">
            {loadError}
          </div>
        </section>
      </div>
    );
  }
  if (!catalog || !evaluation) {
    return (
      <div className="hc sy ob-wrap">
        <Crumbs />
        <section className="hc-card">
          <div className="hc-card-b hc-empty" role="status">
            Loading the onboarding questions...
          </div>
        </section>
      </div>
    );
  }

  const data = catalog;
  const current = evaluation;

  /** Applies `next` and notes what it did to the list. */
  function apply(next: OnboardingAnswers, what: string) {
    setNote({ what, effect: compareEvaluations(current, evaluateOnboarding(data, next)) });
    setAnswers(next);
  }

  function effectOf(next: OnboardingAnswers): OnboardingEffect {
    return compareEvaluations(current, evaluateOnboarding(data, next));
  }

  function goTo(index: number) {
    setStep(index);
    setFurthest((value) => Math.max(value, index));
  }

  const hasFacet = answers.deploymentFacetIds.length > 0;
  const stepKey = INTERVIEW_STEPS[step].key;
  const canCreate = hasFacet && name.trim().length > 0 && !creating;

  async function create() {
    setError(null);
    setCreating(true);
    try {
      const response = await fetch("/api/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          vendor: vendor.trim() || undefined,
          description: description.trim() || undefined,
          confidentialityImpactLevel: answers.confidentialityImpactLevel ?? undefined,
          integrityImpactLevel: answers.integrityImpactLevel ?? undefined,
          availabilityImpactLevel: answers.availabilityImpactLevel ?? undefined,
          deploymentFacetIds: answers.deploymentFacetIds,
          frameworkScopeIds: answers.frameworkScopeIds,
          providerIds: answers.providerIds,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Failed to create System");
        setCreating(false);
        return;
      }
      router.push(`/systems/${body.system.id}`);
    } catch {
      setError("Failed to create System");
      setCreating(false);
    }
  }

  const framework = (id: string) => data.frameworks.find((f) => f.id === id);
  const baseFramework = data.frameworks.find((f) => f.isBase);
  const askable = data.frameworks.filter((f) => !f.isBase && f.onboardingQuestion);
  const others = data.frameworks.filter((f) => !f.isBase && !f.onboardingQuestion);

  function renderImpactStep(which: "sensitivity" | "integrity" | "downtime") {
    const { axis, options } = IMPACT_STEPS[which];
    const chosen = answers[axis];
    return (
      <div className="ob-opts" role="radiogroup" aria-labelledby="ob-q-title">
        {options.map((option) => (
          <OptionCard
            key={option.level}
            type="radio"
            name={`ob-${which}`}
            title={option.title}
            hint={option.hint}
            checked={chosen === option.level}
            selected={chosen === option.level}
            effect={effectOf({ ...answers, [axis]: option.level })}
            onChange={() => apply({ ...answers, [axis]: option.level }, option.title)}
          />
        ))}
        {chosen && (
          <button type="button" className="ob-link" onClick={() => apply({ ...answers, [axis]: null }, `Cleared: ${which}`)}>
            Clear my answer
          </button>
        )}
      </div>
    );
  }

  function renderQuestion(item: OnboardingFramework) {
    const inScope = answers.frameworkScopeIds.includes(item.id);
    const answered = questionsAnswered.includes(item.id);
    const set = (yes: boolean) => {
      setQuestionsAnswered((list) => (list.includes(item.id) ? list : [...list, item.id]));
      apply({ ...answers, frameworkScopeIds: toggled(answers.frameworkScopeIds, item.id, yes) }, `${item.name}: ${yes ? "Yes" : "No"}`);
    };
    return (
      <fieldset key={item.id} className="ob-q">
        <legend>{item.onboardingQuestion}</legend>
        {item.onboardingHint && <p className="ob-opt-h">{item.onboardingHint}</p>}
        <div className="ob-yn">
          <OptionCard
            type="radio"
            name={`ob-fw-${item.id}`}
            title="Yes"
            hint={`${item.name} applies`}
            checked={inScope}
            selected={inScope}
            effect={effectOf({ ...answers, frameworkScopeIds: toggled(answers.frameworkScopeIds, item.id, true) })}
            onChange={() => set(true)}
          />
          <OptionCard
            type="radio"
            name={`ob-fw-${item.id}`}
            title="No"
            hint="Leave it out"
            checked={answered && !inScope}
            selected={answered && !inScope}
            effect={effectOf({ ...answers, frameworkScopeIds: toggled(answers.frameworkScopeIds, item.id, false) })}
            onChange={() => set(false)}
          />
        </div>
      </fieldset>
    );
  }

  function renderStep() {
    switch (stepKey) {
      case "delivery":
        return (
          <div className="ob-opts" role="group" aria-labelledby="ob-q-title">
            {data.deploymentFacets.length === 0 && <p className="hc-empty">No Deployment Facets exist yet. An Admin adds them in the catalog.</p>}
            {data.deploymentFacets.map((facet) => {
              const on = answers.deploymentFacetIds.includes(facet.id);
              const next = { ...answers, deploymentFacetIds: toggled(answers.deploymentFacetIds, facet.id, !on) };
              return (
                <OptionCard
                  key={facet.id}
                  type="checkbox"
                  name="ob-delivery"
                  title={facet.name}
                  hint={facet.description}
                  checked={on}
                  effect={effectOf(next)}
                  onChange={() => apply(next, `${on ? "Removed: " : ""}${facet.name}`)}
                />
              );
            })}
          </div>
        );
      case "sensitivity":
      case "integrity":
      case "downtime":
        return renderImpactStep(stepKey);
      case "laws":
        return (
          <div className="ob-laws">
            {askable.map(renderQuestion)}
            {baseFramework && (
              <p className="ob-base">
                <StatusChip tone="accent">Always included</StatusChip> {baseFramework.name} {baseFramework.version} is the base Framework and applies to every System.
              </p>
            )}
            {others.length > 0 && (
              <fieldset className="ob-q">
                <legend>Other laws and standards</legend>
                <p className="ob-opt-h">Pick every one that applies.</p>
                <div className="ob-opts">
                  {others.map((item) => {
                    const on = answers.frameworkScopeIds.includes(item.id);
                    const next = { ...answers, frameworkScopeIds: toggled(answers.frameworkScopeIds, item.id, !on) };
                    return (
                      <OptionCard
                        key={item.id}
                        type="checkbox"
                        name="ob-others"
                        title={`${item.name} ${item.version}`}
                        hint={item.description}
                        checked={on}
                        effect={effectOf(next)}
                        onChange={() => apply(next, `${on ? "Removed: " : ""}${item.name}`)}
                      />
                    );
                  })}
                </div>
              </fieldset>
            )}
            {askable.length === 0 && others.length === 0 && <p className="hc-empty">No other laws or standards are published yet.</p>}
          </div>
        );
      case "relies":
        return (
          <div className="ob-opts" role="group" aria-labelledby="ob-q-title">
            {data.providers.length === 0 && <p className="hc-empty">No System is marked as a Provider yet.</p>}
            {data.providers.map((provider) => {
              const on = answers.providerIds.includes(provider.id);
              const next = { ...answers, providerIds: toggled(answers.providerIds, provider.id, !on) };
              const offers = providerOfferCount(current, provider.id);
              return (
                <OptionCard
                  key={provider.id}
                  type="checkbox"
                  name="ob-relies"
                  title={provider.name}
                  hint={
                    provider.onboarded
                      ? `Offers ${offers} of the ${current.counts.applicable} applicable Controls`
                      : "Not Onboarded yet. Its Offerings count once it is."
                  }
                  checked={on}
                  effect={effectOf(next)}
                  onChange={() => apply(next, `${on ? "Removed: " : ""}${provider.name}`)}
                />
              );
            })}
          </div>
        );
      case "review":
        return renderReview();
    }
  }

  function levelAnswer(which: "sensitivity" | "integrity" | "downtime") {
    const { axis, options } = IMPACT_STEPS[which];
    const level = answers[axis];
    const option = options.find((o) => o.level === level);
    return option ? `${option.title} (${IMPACT_LEVEL_WORD[option.level as ImpactLevel]})` : "Not answered";
  }

  function renderReview() {
    const facets = answers.deploymentFacetIds.map((id) => data.deploymentFacets.find((f) => f.id === id)?.name).filter(Boolean) as string[];
    const laws = answers.frameworkScopeIds.map((id) => framework(id)).filter(Boolean) as OnboardingFramework[];
    const providers = answers.providerIds.map((id) => data.providers.find((p) => p.id === id)?.name).filter(Boolean) as string[];
    const rows: { key: string; stepIndex: number; label: string; value: React.ReactNode }[] = [
      {
        key: "delivery",
        stepIndex: 0,
        label: "Delivery",
        value: facets.length ? (
          <span className="facets">
            {facets.map((facet) => (
              <span className="facet" key={facet}>
                {facet}
              </span>
            ))}
          </span>
        ) : (
          "Not answered"
        ),
      },
      { key: "sensitivity", stepIndex: 1, label: "Sensitivity", value: levelAnswer("sensitivity") },
      { key: "integrity", stepIndex: 2, label: "Integrity", value: levelAnswer("integrity") },
      { key: "downtime", stepIndex: 3, label: "Downtime", value: levelAnswer("downtime") },
      {
        key: "laws",
        stepIndex: 4,
        label: "Laws and standards",
        value: laws.length ? laws.map((f) => `${f.name} ${f.version}`).join(", ") : "None besides the base Framework",
      },
      { key: "relies", stepIndex: 5, label: "Relies on", value: providers.length ? providers.join(", ") : "None" },
    ];
    const yours = current.counts.YOU;
    return (
      <div className="ob-review">
        <div className="ob-sum hc-card">
          <div className="hc-card-h">
            <h3>Your answers</h3>
            <CiaBars
              confidentiality={answers.confidentialityImpactLevel}
              integrity={answers.integrityImpactLevel}
              availability={answers.availabilityImpactLevel}
            />
          </div>
          <dl className="ob-dl">
            {rows.map((row) => (
              <div key={row.key} className="ob-dl-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
                <dd className="ob-edit">
                  <button type="button" className="ob-link" aria-label={`Edit ${row.label}`} onClick={() => goTo(row.stepIndex)}>
                    Edit
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="ob-extra">
          <label>
            Vendor (optional)
            <input className="ob-input" value={vendor} onChange={(event) => setVendor(event.target.value)} />
          </label>
          <label>
            Description (optional)
            <textarea className="ob-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
        <p className="ob-sentence">
          {plural(current.counts.applicable, "Control applies", "Controls apply")}. <strong>{yours}</strong> need work from you; the rest are shared or
          already covered.
        </p>
        <p className="ob-fine">Your answers can change later. The Controls update the same way after onboarding, so nothing here is locked in.</p>
      </div>
    );
  }

  const step_ = INTERVIEW_STEPS[step];
  const tallyText = `${plural(animatedCount, "Control applies", "Controls apply")}`;

  return (
    <div className="hc sy ob-wrap">
      <Crumbs />

      <section className="hc-hero ob-hero" aria-labelledby="ob-title">
        <div>
          <p className="hc-eyebrow">NEW SYSTEM</p>
          <h1 id="ob-title">Onboard a new System</h1>
          <p className="hc-lede">Answer a few plain questions. The list of Controls that apply grows and shrinks beside you, and nothing is locked in.</p>
          <label className="ob-name">
            System name
            <input
              className="ob-input"
              value={name}
              required
              placeholder="For example Payroll"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="ob-main">
        <div className="ob-left">
          <ol className="ob-stepper" aria-label="Steps">
            {INTERVIEW_STEPS.map((item, index) => {
              const state = index === step ? "now" : index <= furthest ? "past" : "next";
              const blocked = index > 0 && !hasFacet;
              return (
                <li key={item.key} className={`step ${state}`}>
                  <button
                    type="button"
                    disabled={blocked}
                    aria-current={index === step ? "step" : undefined}
                    onClick={() => goTo(index)}
                    title={blocked ? "Pick how you get the system first" : undefined}
                  >
                    <span className="n" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="l">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="hc-card ob-card" aria-labelledby="ob-q-title">
            <div className="hc-card-h">
              <h2 id="ob-q-title" ref={headingRef} tabIndex={-1}>
                {step_.title}
              </h2>
              <p>
                Step {step + 1} of {INTERVIEW_STEPS.length}
              </p>
            </div>
            <div className="hc-card-b">
              {step_.help && <p className="ob-help">{step_.help}</p>}
              {renderStep()}
              {stepKey !== "review" && <p className="ob-fine">The chips on each answer show how the list of Controls would change if you picked it.</p>}
              {error && (
                <p className="ob-fail" role="alert">
                  {error}
                </p>
              )}
              {stepKey === "review" && !canCreate && !creating && (
                <p className="ob-fine">{!hasFacet ? "Pick how you get the system (step 1) before creating it." : "Name the System at the top of the page before creating it."}</p>
              )}
              <div className="ob-nav">
                <Button variant="secondary" disabled={step === 0} onClick={() => goTo(step - 1)}>
                  Back
                </Button>
                {stepKey === "review" ? (
                  <Button variant="primary" disabled={!canCreate} onClick={create}>
                    {creating ? "Creating..." : "Create System"}
                  </Button>
                ) : (
                  <Button variant="primary" disabled={step === 0 && !hasFacet} onClick={() => goTo(step + 1)}>
                    Next
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="ob-right" aria-label="Applicable Controls">
          <section className="hc-card ob-list">
            <div className="hc-card-h">
              <h2 aria-label={`${plural(current.counts.applicable, "Control applies", "Controls apply")}, of ${current.counts.library} in the library`}>
                <span className="ob-big num">{animatedCount}</span>{" "}
                <span>{current.counts.applicable === 1 ? "Control applies" : "Controls apply"}</span>
                <small>, of {current.counts.library} in the library</small>
              </h2>
            </div>
            <div className="hc-card-b">
              <Tally evaluation={current} />
              <p className="ob-note" aria-live="polite">
                {note ? (
                  <>
                    <span className="what">{note.what}</span>
                    {note.effect.added > 0 && <StatusChip tone="success">+{note.effect.added} now apply</StatusChip>}
                    {note.effect.removed > 0 && <StatusChip tone="danger">{"−"}{note.effect.removed} no longer apply</StatusChip>}
                    {note.effect.moved > 0 && <StatusChip tone="neutral">{note.effect.moved} changed owner</StatusChip>}
                    {isNoEffect(note.effect) && <span className="muted">No change to the list</span>}
                  </>
                ) : (
                  <span className="muted">Every System starts with the Controls below. Your answers add or remove the rest.</span>
                )}
              </p>
            </div>
            <div className="ob-groups">
              {ONBOARDING_GROUPS.map(({ group, title, intro, empty }) => {
                const rows = current.rows.filter((row) => row.group === group);
                const liveKeys = new Set(rows.map(rowKey));
                const shown = [
                  ...rows.map((row) => ({ row, gone: false })),
                  ...leaving.filter((row) => row.group === group && !liveKeys.has(rowKey(row))).map((row) => ({ row, gone: true })),
                ].sort((a, b) => CODE_COLLATOR.compare(a.row.control.code, b.row.control.code));
                return (
                  <section key={group} aria-label={title}>
                    <h3 className="hc-lane-h">
                      <i style={{ background: GROUP_COLOR[group] }} aria-hidden="true" />
                      {title} {"·"} {rows.length}
                      <small>{intro}</small>
                    </h3>
                    {rows.length === 0 && <p className="ob-empty">{empty}</p>}
                    {shown.length > 0 && (
                      <ul className="ob-rows">
                        {shown.map(({ row, gone }) => (
                          <ControlRow key={`${rowKey(row)}${gone ? "|gone" : ""}`} row={row} gone={gone} onGone={() => doneLeaving(rowKey(row))} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      <div className="ob-mini" aria-hidden="true">
        <b className="num">{tallyText}</b>
        <span>
          <b className="num">{current.counts.YOU}</b> are yours
        </span>
      </div>
    </div>
  );
}

function Crumbs() {
  return (
    <div className="ob-crumbrow">
      <nav aria-label="Breadcrumb" className="ob-crumbs">
        <Link href="/systems">Systems</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">New System</span>
      </nav>
    </div>
  );
}

/** The stacked bar and its legend: who does the work for the applicable Controls. */
function Tally({ evaluation }: { evaluation: OnboardingEvaluation }) {
  return (
    <>
      <div className="ob-bar" role="img" aria-label={`${evaluation.counts.YOU} you do, ${evaluation.counts.SHARED} shared, ${evaluation.counts.COVERED} covered for you`}>
        {ONBOARDING_GROUPS.map(({ group }) => (
          <i key={group} style={{ flexGrow: evaluation.counts[group], background: GROUP_COLOR[group] }} />
        ))}
      </div>
      <div className="hc-legend ob-legend">
        {ONBOARDING_GROUPS.map(({ group, title }) => (
          <span key={group}>
            <i style={{ background: GROUP_COLOR[group] }} aria-hidden="true" />
            <b className="num">{evaluation.counts[group]}</b> {title}
          </span>
        ))}
      </div>
    </>
  );
}

const CODE_COLLATOR = new Intl.Collator("en", { numeric: true });

function rowKey(row: OnboardingRow) {
  return `${row.group}|${row.control.id}`;
}

/** One Control in the live list. A row that left its group plays its exit, then asks to be removed. */
function ControlRow({ row, gone, onGone }: { row: OnboardingRow; gone: boolean; onGone: () => void }) {
  useEffect(() => {
    if (!gone) return;
    // Fallback in case the animation never ends (a hidden tab, styles not loaded).
    const timer = setTimeout(onGone, 600);
    return () => clearTimeout(timer);
  }, [gone, onGone]);
  return (
    <li className={`ob-row${gone ? " leaving" : ""}`} aria-hidden={gone || undefined} inert={gone} onAnimationEnd={gone ? onGone : undefined}>
      <span className="code">{row.control.code}</span>
      <span className="t">
        <b>{row.control.title}</b>
        {row.coveredBy && <small>Covered by {row.coveredBy}</small>}
        {row.sharedBy.map((shared) => (
          <small key={shared.providerId}>
            Shared with {shared.providerName}
            {shared.customerResponsibility ? `. Your part: ${shared.customerResponsibility}` : ""}
          </small>
        ))}
      </span>
    </li>
  );
}
