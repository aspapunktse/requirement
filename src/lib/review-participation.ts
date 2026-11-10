import type { Prisma } from "@prisma/client";
import { APPLICABILITY_SCOPING } from "@/lib/control-assessments";
import {
  APPLICABLE_APPLICABILITIES,
  meetsAllImpactThresholds,
  type SystemClassification,
} from "@/lib/control-applicability";

/**
 * Who takes part in a review of a System, and whom an owner's edit reopens (CONTEXT.md "Review Step",
 * ADR 0010, ADR 0014). Separated from Approve/Reject so the same rules serve any outcome (an
 * Approval, a Self/Full verdict, a Recommendation) over any chosen subset of the System's Controls.
 *
 * A **participant** is the base review (`reviewGroupId` null) or a Review Group. Participation is
 * derived live from the System's declared Framework Scope and Control remits; nothing here is stored
 * and nothing here knows what an outcome is. A caller supplies a `ParticipationScope`:
 * - `controls`: which of the System's Controls count (default all). A set of Control ids or a
 *   predicate; a group with no Control in the subset takes no part.
 * - `includeBase`: whether the base review takes part. When true it always does, whatever the subset
 *   holds (it is the review nobody opts out of); when false it never does.
 *
 * Today's Approve/Reject Review Steps (`review-steps.ts`) call this over all Controls with the base
 * included.
 */

export const BASE_REVIEW_STEP_NAME = "Base review";

/** A chosen subset of Controls: a set of ids, or a predicate on the Control id. */
export type ControlSubset = ReadonlySet<string> | ((controlId: string) => boolean);

export type ParticipationScope = {
  /** Only these Controls count; undefined means all the System's Controls. */
  controls?: ControlSubset;
  /** Whether the base review takes part (always, when true). */
  includeBase: boolean;
};

export type Participant = {
  /** Null for the base review, otherwise the Review Group. */
  reviewGroupId: string | null;
  name: string;
};

export type Participation = { base: boolean; groups: Map<string, string> };

export function inSubset(subset: ControlSubset | undefined, controlId: string): boolean {
  if (!subset) return true;
  return typeof subset === "function" ? subset(controlId) : subset.has(controlId);
}

/** What a Control must look like for `isBaseControl`: its mappings and the Framework of each Requirement. */
type ControlWithFrameworks = { mappings: { requirement: { framework: { isBase: boolean } } }[] };

/**
 * A **Base Control**: one mapped, at any Coverage, to at least one Requirement of the base
 * Framework (`Framework.isBase`). Base Controls always stay in the base review's remit,
 * even when they also satisfy a Framework with a Review Group, so an Annex A Control is
 * never judged twice. Everything else is a non-base Control (in practice a Supplementary one).
 * This is the single definition of "base" for reviews; change it here only.
 */
export function isBaseControl(control: ControlWithFrameworks): boolean {
  return control.mappings.some(({ requirement }) => requirement.framework.isBase);
}

const CONTROL_FOR_REMIT = {
  mappings: {
    select: {
      requirement: {
        select: {
          framework: {
            select: {
              id: true,
              isBase: true,
              status: true,
              reviewGroup: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ControlInclude;

type ControlForRemit = Prisma.ControlGetPayload<{ include: typeof CONTROL_FOR_REMIT }>;

/**
 * Which participants a Control belongs to, given the System's declared Framework Scope: the single
 * rule behind both "which groups have remit on a System" and "whom does an edit to this Control
 * reopen". A base Control belongs to the base review only. Any other Control belongs to the review
 * of each Review Group tied to a Published, declared Framework it is mapped to, and to the base
 * review if it is also mapped to such a Framework with no group (those fall to the base review).
 * Applicability (facets, Impact Levels) is not looked at here.
 */
function stepsOfControl(control: ControlForRemit, declaredScopeIds: Set<string>) {
  const groups = new Map<string, string>();
  if (isBaseControl(control)) return { base: true, groups };
  let base = false;
  for (const { requirement } of control.mappings) {
    const { framework } = requirement;
    if (framework.status !== "PUBLISHED" || !declaredScopeIds.has(framework.id)) continue;
    if (framework.reviewGroup) groups.set(framework.reviewGroup.id, framework.reviewGroup.name);
    else base = true;
  }
  return { base, groups };
}

/**
 * The Review Groups in whose remit each Control of the System sits, keyed by Control id (a Control
 * in no group's remit is absent). A Control is in a group's remit when it is a non-base Control
 * that applies to the System (same rules as `getApplicableControls`: applicability, Deployment
 * Facets, Impact Levels, a Published Framework in scope) and is mapped to a Requirement of a
 * Published Framework of the group that is in the System's *declared* Framework Scope. A Framework
 * with no group adds none; its non-base Controls fall to the base review. This is the single
 * definition of a group's remit.
 *
 * Takes the transaction client so the reads see one snapshot. `controlId` narrows the read to one
 * Control; `subset` drops Controls outside it (none are dropped by default).
 */
export async function remitGroupsByControl(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
  controlId?: string,
  subset?: ControlSubset,
) {
  const byControl = new Map<string, Map<string, string>>();
  if (controlId !== undefined && !inSubset(subset, controlId)) return byControl;
  const controls = await tx.control.findMany({
    where: {
      ...(controlId !== undefined && { id: controlId }),
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
    },
    include: CONTROL_FOR_REMIT,
  });

  const declaredScopeIds = new Set(system.frameworkScopes.map((framework) => framework.id));
  for (const control of controls) {
    if (!inSubset(subset, control.id)) continue;
    if (!meetsAllImpactThresholds(system, control)) continue;
    const { groups } = stepsOfControl(control, declaredScopeIds);
    if (groups.size > 0) byControl.set(control.id, groups);
  }
  return byControl;
}

/**
 * Every participant whose remit contains each applicable Control of the System, base review included (`null` in the set), keyed by
 * Control id: `remitGroupsByControl`'s question with the base review answered too. A Control is in the base review's remit when it is
 * a base Control, or a non-base Control of a declared Published Framework with no Review Group. A Control in nobody's remit is absent.
 * Used to tell what a change added to a participant's remit (a Change Review, #334).
 */
export async function remitParticipantsByControl(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
): Promise<Map<string, Set<string | null>>> {
  const byControl = new Map<string, Set<string | null>>();
  const controls = await tx.control.findMany({
    where: { applicability: { in: [...APPLICABLE_APPLICABILITIES] }, AND: APPLICABILITY_SCOPING(system) },
    include: CONTROL_FOR_REMIT,
  });
  const declaredScopeIds = new Set(system.frameworkScopes.map((framework) => framework.id));
  for (const control of controls) {
    if (!meetsAllImpactThresholds(system, control)) continue;
    const { base, groups } = stepsOfControl(control, declaredScopeIds);
    const participants = new Set<string | null>(groups.keys());
    if (base) participants.add(null);
    if (participants.size > 0) byControl.set(control.id, participants);
  }
  return byControl;
}

/**
 * Who takes part in a review of the System over `scope`: the Review Groups with at least one Control
 * of the subset in their remit (id to name; Frameworks sharing a group give one entry), and whether
 * the base review is in (`scope.includeBase`, regardless of the subset).
 */
export async function participantsOver(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
  scope: ParticipationScope,
): Promise<Participation> {
  const groups = new Map<string, string>();
  for (const forControl of (await remitGroupsByControl(tx, system, undefined, scope.controls)).values()) {
    for (const [id, name] of forControl) groups.set(id, name);
  }
  return { base: scope.includeBase, groups };
}

/** The participants in display order: the base review first (when in), then the groups by name. */
export function participantList(participation: Participation): Participant[] {
  return [
    ...(participation.base ? [{ reviewGroupId: null, name: BASE_REVIEW_STEP_NAME }] : []),
    ...[...participation.groups]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([reviewGroupId, name]) => ({ reviewGroupId, name })),
  ];
}

/**
 * The ids of the participants (`null` is the base review) whose remit contains `controlId` on the
 * System, by the same rule as `participantsOver` but for one Control and without its applicability
 * test: an edit can be to a stale Control too (one a facet change left behind). A Control outside
 * `scope.controls` is in nobody's remit, and the base review counts only when `scope.includeBase`.
 * `staleFallsToBase` decides whether a Control in no declared Published Framework reopens the base
 * review (open question 2 on #200). Whether the participants are live is for the caller to check.
 */
export async function participantsContainingControl(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
  controlId: string,
  scope: ParticipationScope,
  staleFallsToBase = true,
) {
  const ids = new Set<string | null>();
  if (!inSubset(scope.controls, controlId)) return ids;
  const control = await tx.control.findUnique({ where: { id: controlId }, include: CONTROL_FOR_REMIT });
  if (!control) return ids;
  const { base, groups } = stepsOfControl(control, new Set(system.frameworkScopes.map((framework) => framework.id)));
  if (base) ids.add(null);
  for (const id of groups.keys()) ids.add(id);
  if (ids.size === 0 && staleFallsToBase) ids.add(null);
  if (!scope.includeBase) ids.delete(null);
  return ids;
}

/**
 * The participants whose outcome an edit reopens: those in `remit` (from `participantsContainingControl`)
 * that have an outcome to reopen, as `hasOutcome` says (an Approval, a verdict, a Recommendation).
 * Pure: the caller does the voiding and the Change Events.
 */
export function participantsToReopen<T extends { reviewGroupId: string | null }>(
  participants: T[],
  remit: Set<string | null>,
  hasOutcome: (participant: T) => boolean,
): T[] {
  return participants.filter((participant) => remit.has(participant.reviewGroupId) && hasOutcome(participant));
}
