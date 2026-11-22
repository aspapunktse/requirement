import type { ControlApplicability } from "@prisma/client";
import { z } from "zod";
import { controlAppliesToSystem, type ControlImpactThresholds, type SystemClassification } from "@/lib/control-applicability";
import { dueDateRefusal, validateInternalAudit } from "@/lib/internal-audit-rules";
import { hasOrganizationImplementation } from "@/lib/organization-implementation-rules";

/**
 * Check-up questions and the launch of an Internal Audit (PRD 0001 F-IA.2, F-IA.3, #154).
 * Pure and Prisma-free: the same `planLaunch` computes the launch preview on a draft's page
 * and drives the launch itself, so the two can't disagree. Nothing here writes a Change Event (product-owner decision 12a of 2026-10-13, comment on #154):
 * F-CE.1 lists a Check-up being evaluated (#156), not an audit being launched.
 */

export const MAX_QUESTIONS_PER_CONTROL = 20;
export const MAX_QUESTION_LENGTH = 2000;
/** The longest guidance note (#405) an Audit Question, a draft question or a Check-up question can carry. */
export const MAX_GUIDANCE_LENGTH = 1000;

/** A question with its optional guidance note (#405). `guidance` is trimmed plain text, or null for none. */
export type GuidedQuestion = { text: string; guidance: string | null };

/**
 * The body items of the two question-list writes (the Audit Questions of a Control, the questions of a draft): a bare
 * text (older clients; no note) or `{ text, guidance? }` (#405).
 */
export const questionItemsSchema = z.array(z.union([z.string(), z.object({ text: z.string(), guidance: z.string().nullish() })]));

/** Splits parsed body items into the texts and the guidance notes (null for none), by index. */
export function splitQuestionItems(items: z.infer<typeof questionItemsSchema>): { texts: string[]; guidance: (string | null)[] } {
  return {
    texts: items.map((item) => (typeof item === "string" ? item : item.text)),
    guidance: items.map((item) => (typeof item === "string" ? null : (item.guidance ?? null))),
  };
}

/** A guidance note as stored: trimmed, and null when empty or missing. */
export function normalizeGuidance(guidance: string | null | undefined): string | null {
  const text = guidance?.trim();
  return text ? text : null;
}

/** Why a guidance note is unacceptable, or null when fine (empty is fine). */
export function guidanceProblem(guidance: string | null | undefined): string | null {
  return (guidance?.trim().length ?? 0) > MAX_GUIDANCE_LENGTH ? `Guidance can be at most ${MAX_GUIDANCE_LENGTH} characters` : null;
}

/** The question list a Control starts with when it becomes a target of a draft: its Self-Assessment Question, if any. */
export function defaultQuestionsFor(selfAssessmentQuestion: string | null | undefined): GuidedQuestion[] {
  const text = selfAssessmentQuestion?.trim();
  // A Self-Assessment Question carries no guidance note (#405): that is the Control's Intent's job.
  return text ? [{ text, guidance: null }] : [];
}

/**
 * The question list a Control starts with in a draft (#404): a copy of its Audit Questions, or, when it has
 * none, `defaultQuestionsFor` its Self-Assessment Question. `bank` is in position order.
 */
export function defaultQuestionsForControl(
  bank: readonly { text: string; guidance?: string | null }[] | undefined,
  selfAssessmentQuestion: string | null | undefined,
): GuidedQuestion[] {
  const items = (bank ?? [])
    .map((q): GuidedQuestion => ({ text: q.text.trim(), guidance: normalizeGuidance(q.guidance) }))
    .filter((q) => q.text !== "");
  return items.length > 0 ? items : defaultQuestionsFor(selfAssessmentQuestion);
}

/**
 * The question list of a Control in the planner (#393) once the auditor has typed a first question for it:
 * `override` replaces the first question of `existing` (or becomes the only one), a blank one removes the
 * first question, and `undefined` leaves the list as it is. The later questions are never touched here (more
 * of them are added on the draft page). The first question keeps its guidance note only when its text is
 * unchanged; a replaced question starts with none, since the note was written for the old wording (#405).
 */
export function applyFirstQuestion(existing: GuidedQuestion[], override: string | undefined): GuidedQuestion[] {
  if (override === undefined) return existing;
  const text = override.trim();
  if (text === "") return existing.slice(1);
  const first = existing[0];
  return [{ text, guidance: first && first.text === text ? first.guidance : null }, ...existing.slice(1)];
}

/**
 * Why `questions` isn't an acceptable list for one target Control, one message per problem (empty
 * when fine). An empty list is allowed on a draft (launch refuses it); a blank entry, an over-long
 * one or too many are not. The route and the editor share this.
 */
export function validateQuestionList(questions: string[], guidance: (string | null | undefined)[] = []): string[] {
  const problems: string[] = [];
  const guidanceProblems = new Set(guidance.map(guidanceProblem).filter((p) => p !== null));
  problems.push(...guidanceProblems);
  if (questions.length > MAX_QUESTIONS_PER_CONTROL) {
    problems.push(`A Control can have at most ${MAX_QUESTIONS_PER_CONTROL} questions`);
  }
  if (questions.some((text) => text.trim() === "")) problems.push("A question can't be blank");
  if (questions.some((text) => text.trim().length > MAX_QUESTION_LENGTH)) {
    problems.push(`A question can be at most ${MAX_QUESTION_LENGTH} characters`);
  }
  return problems;
}

export type LaunchControl = ControlImpactThresholds & {
  id: string;
  code: string;
  title: string;
  applicability: ControlApplicability;
  /** The Control Owner, or null if unassigned. */
  ownerId: string | null;
  /** The draft's questions for this Control, in order, with their guidance notes. */
  questions: GuidedQuestion[];
  deploymentFacets: { id: string }[];
  mappings: { requirement: { framework: { id: string; status: string; isBase: boolean } } }[];
};

export type LaunchSystem = SystemClassification & { id: string; name: string };

export type LaunchInputs = {
  audit: { title: string; dueDate: string | null; includeOrganization: boolean };
  controls: LaunchControl[];
  systems: LaunchSystem[];
};

export type LaunchBlockerKind = "invalid" | "past-due-date" | "no-questions" | "no-control-owner" | "nothing-to-generate";

export type LaunchBlocker = {
  kind: LaunchBlockerKind;
  message: string;
  /** The Controls the blocker is about (empty for the audit-level ones). */
  controlIds: string[];
};

export type PlannedCheckUp = {
  controlId: string;
  /** The target System, or null for the Organization-level Check-up. */
  systemId: string | null;
  /** The Check-up's own copy of the Control's questions and their guidance notes. */
  questions: GuidedQuestion[];
};

export type LaunchPlan = {
  checkUps: PlannedCheckUp[];
  /** Pairs where the Control doesn't apply to the System: no Check-up is generated for them. */
  skipped: { controlId: string; systemId: string }[];
  systemCheckUpCount: number;
  organizationCheckUpCount: number;
  blockers: LaunchBlocker[];
};

const codeCollator = new Intl.Collator("en", { numeric: true });

function codesOf(controls: LaunchControl[]): string {
  return controls.map((control) => control.code).join(", ");
}

/**
 * What launching an Internal Audit would create and skip, and what blocks it. When `blockers` is
 * not empty the launch is refused and writes nothing. Check-ups come out ordered by Control code
 * and then System name, with the Organization-level one last for its Control.
 *
 * - A System-level Check-up per selected System and target Control where the Control applies to
 *   the System (`controlAppliesToSystem`); otherwise the pair is skipped and counted. An
 *   Organizational Control is never paired with Systems, so it gets neither a System-level Check-up nor
 *   a skipped entry, only an Organization-level one. "Skipped" counts only a Per-System or Both target
 *   Control that doesn't apply to a picked System (product-owner decision 11a of 2026-10-13, comment on #154).
 * - When the Organization is included: an Organization-level Check-up per target Control that has
 *   an Organization Control Implementation (Organizational or Both). Each of those Controls needs a
 *   Control Owner (product-owner decision of 2026-10-12), or the launch is blocked.
 * - Every target Control needs at least one non-blank question.
 * - A launch that would generate no Check-up at all is blocked rather than producing an empty audit.
 */
export function planLaunch(inputs: LaunchInputs, now: Date = new Date()): LaunchPlan {
  const controls = [...inputs.controls].sort((a, b) => codeCollator.compare(a.code, b.code));
  const systems = [...inputs.systems].sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id));
  const questionsOf = (control: LaunchControl) => control.questions
      .map((q): GuidedQuestion => ({ text: q.text.trim(), guidance: normalizeGuidance(q.guidance) }))
      .filter((q) => q.text !== "");
  const blockers: LaunchBlocker[] = [];

  const problems = validateInternalAudit({
    title: inputs.audit.title,
    controlIds: controls.map((control) => control.id),
    systemIds: systems.map((system) => system.id),
    includeOrganization: inputs.audit.includeOrganization,
    dueDate: inputs.audit.dueDate,
  });
  for (const problem of problems) blockers.push({ kind: "invalid", message: problem, controlIds: [] });

  if (inputs.audit.dueDate) {
    const refusal = dueDateRefusal(inputs.audit.dueDate, now);
    if (refusal) blockers.push({ kind: "past-due-date", message: `${refusal}: change it before launching`, controlIds: [] });
  }

  const withoutQuestions = controls.filter((control) => questionsOf(control).length === 0);
  if (withoutQuestions.length > 0) {
    blockers.push({
      kind: "no-questions",
      message: `Every Control needs at least one question. No question yet for: ${codesOf(withoutQuestions)}`,
      controlIds: withoutQuestions.map((control) => control.id),
    });
  }

  const checkUps: PlannedCheckUp[] = [];
  const skipped: LaunchPlan["skipped"] = [];
  let systemCheckUpCount = 0;
  let organizationCheckUpCount = 0;
  const organizationLevel = inputs.audit.includeOrganization ? controls.filter((c) => hasOrganizationImplementation(c.applicability)) : [];

  const withoutOwner = organizationLevel.filter((control) => control.ownerId === null);
  if (withoutOwner.length > 0) {
    blockers.push({
      kind: "no-control-owner",
      message: `Every Control audited at Organization level needs a Control Owner. No Control Owner for: ${codesOf(withoutOwner)}`,
      controlIds: withoutOwner.map((control) => control.id),
    });
  }

  for (const control of controls) {
    const questions = questionsOf(control);
    // An Organizational Control is never paired with Systems: no System-level Check-up and no skipped
    // entry (product-owner decision 11a of 2026-10-13, comment on #154).
    for (const system of control.applicability === "ORGANIZATIONAL" ? [] : systems) {
      if (controlAppliesToSystem(control, system)) {
        checkUps.push({ controlId: control.id, systemId: system.id, questions });
        systemCheckUpCount += 1;
      } else {
        skipped.push({ controlId: control.id, systemId: system.id });
      }
    }
    if (organizationLevel.includes(control)) {
      checkUps.push({ controlId: control.id, systemId: null, questions });
      organizationCheckUpCount += 1;
    }
  }

  if (checkUps.length === 0 && problems.length === 0) {
    blockers.push({
      kind: "nothing-to-generate",
      message:
        "Launching would generate no Check-up: no target Control applies to a picked System, and no Organization Control Implementation is included. Change the Controls or Systems first",
      controlIds: [],
    });
  }

  return { checkUps, skipped, systemCheckUpCount, organizationCheckUpCount, blockers };
}

/** The launch summary shown after a launch and in the confirmation: counts in one sentence. */
export function launchSummaryText(plan: Pick<LaunchPlan, "systemCheckUpCount" | "organizationCheckUpCount" | "skipped">): string {
  const total = plan.systemCheckUpCount + plan.organizationCheckUpCount;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    plural(total, "Check-up", "Check-ups"),
    `(${plan.systemCheckUpCount} System-level, ${plan.organizationCheckUpCount} Organization-level)`,
  ];
  const skipped =
    plan.skipped.length === 0
      ? "none skipped"
      : `${plural(plan.skipped.length, "System and Control pair", "System and Control pairs")} skipped because the Control doesn't apply to the System`;
  return `${parts.join(" ")}; ${skipped}`;
}
