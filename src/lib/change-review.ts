import type { EvaluationStage, EvaluationTrack, Prisma, RecommendationKind, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { canSeeDecider, memberGroupIds } from "@/lib/approvals";
import type { SystemClassification } from "@/lib/control-applicability";
import { BASE_REVIEW_STEP_NAME, remitParticipantsByControl } from "@/lib/review-participation";
import { lockSystem } from "@/lib/system-lock";
import { EVALUATION_STAGE_LABEL } from "@/lib/evaluation-stages";
import { RECOMMENDATION_LABEL, userCanRecommend } from "@/lib/evaluation-oag";
import { canDecideAtGate, sendBackTargets, sendBackTo } from "@/lib/gate-decisions";

/**
 * Change Review on an Onboarded System (#334, PRD 0002 F-CR.1-3, ADR 0014; CONTEXT.md "Change Review"). A change to a System's
 * Framework Scope or classification can add Controls to an OAG group's remit (the base review counts as a group). On an Onboarded
 * System that starts a Change Review, in the transaction that makes the change; the System stays Onboarded.
 *
 * - **Start or widen** (`startOrWidenChangeReview`): the remit before and after the change are compared (the same rules as the OAG review,
 *   `review-participation.ts`), and each (Control, participant) pair the change added is stored as a `ChangeReviewControl`. A change that
 *   adds nothing starts nothing. While a review is open, a later change widens it: its new pairs are added, and a participant that gains
 *   Controls has its live Recommendation voided so it recommends again on everything it now has. One review is open at a time per System.
 * - **Recommendations**: only the groups with Controls in the review take part, and each recommends on just those Controls. They are
 *   `Recommendation` rows tied to the review (`changeReviewId`, no stage) and follow the OAG review's rules: the Review Step rule says who
 *   may give one, it is shown as the group's, and an owner's edit to an added Control voids it.
 * - **Decision** (`decideChangeReview`): the Business System Owner (or an Admin who doesn't own the System) accepts, which closes the
 *   review, or revokes the ATO: the System goes back to Draft, at the stage they pick (a System on the classic flow, which has no stages,
 *   returns to Draft). It can be decided only once every participant has recommended, and only when the System has a Business System
 *   Owner: until one is set the owner's "My tasks" flag it.
 *
 * Writers take the caller's transaction client and expect the System row to be locked (`lockSystem`, first).
 */

type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: UserRole };

export const NO_OPEN_CHANGE_REVIEW = "This System has no open Change Review";
export const CHANGE_REVIEW_NEEDS_BSO = "This System has no Business System Owner: set one before the Change Review can be decided";
export const CHANGE_REVIEW_AWAITS_RECOMMENDATIONS = "Every group in the Change Review must recommend before it is decided";
export const CHANGE_REVIEW_DECISION_REFUSED = "Only the System's Business System Owner or an Admin who isn't its owner can decide a Change Review";
export const CHANGE_REVIEW_MOVED_ON = "The Change Review has moved on since you opened this form: reload the page";
export const CLASSIC_SEND_BACK_REFUSED = "This System has no stages: revoking its ATO returns it to Draft, so don't name a stage";
export const SEND_BACK_REQUIRED = "Say which stage to send the System back to";

const pairKey = (controlId: string, reviewGroupId: string | null) => `${controlId}|${reviewGroupId ?? ""}`;

async function remitPairs(tx: Tx, classification: SystemClassification) {
  const pairs = new Set<string>();
  for (const [controlId, participants] of await remitParticipantsByControl(tx, classification)) {
    for (const reviewGroupId of participants) pairs.add(pairKey(controlId, reviewGroupId));
  }
  return pairs;
}

/** "Base review (2 Controls), GDPR Review Group (1 Control)", in display order. */
function describeAdded(added: { controlId: string; reviewGroupId: string | null }[], names: Map<string, string>) {
  const counts = new Map<string | null, number>();
  for (const { reviewGroupId } of added) counts.set(reviewGroupId, (counts.get(reviewGroupId) ?? 0) + 1);
  return [...counts]
    .map(([reviewGroupId, count]) => ({ name: reviewGroupId === null ? BASE_REVIEW_STEP_NAME : (names.get(reviewGroupId) ?? "A group"), count, base: reviewGroupId === null }))
    .sort((a, b) => (a.base ? -1 : b.base ? 1 : a.name.localeCompare(b.name)))
    .map(({ name, count }) => `${name} (${count} ${count === 1 ? "Control" : "Controls"})`)
    .join(", ");
}

async function groupNames(tx: Tx, ids: (string | null)[]) {
  const real = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows = real.length === 0 ? [] : await tx.reviewGroup.findMany({ where: { id: { in: real } }, select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

export type ChangeReviewStart = { changeReviewId: string; widened: boolean };

/**
 * Called inside the transaction that changes an Onboarded System's classification or Framework Scope, with the classification before
 * and after (`before`, `after`), on a System row the caller has locked. Nothing happens unless the System is Onboarded and open and the
 * change added Controls to some participant's remit. Starts a Change Review, or widens the open one (returning `widened`); null when
 * nothing was started or widened. Writes its Change Event, actor the person who made the change.
 */
/**
 * The System's complete classification as `tx` sees it now. Read it right after `lockSystem` and before the writes (`before`);
 * `startOrWidenChangeReview` reads the `after` itself, so the delta is of the locked state, never of the caller's earlier read
 * or of the request (two overlapping changes could otherwise each miss a Control that needs both).
 */
export async function readClassification(tx: Tx, systemId: string): Promise<SystemClassification> {
  const row = await tx.system.findUniqueOrThrow({
    where: { id: systemId },
    select: {
      sensitivityLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      frameworkScopes: { select: { id: true } },
    },
  });
  return row;
}

export async function startOrWidenChangeReview(
  tx: Tx,
  systemId: string,
  before: SystemClassification,
  actorId: string,
): Promise<ChangeReviewStart | null> {
  const system = await tx.system.findUnique({ where: { id: systemId }, select: { status: true, evaluationClosedAt: true } });
  if (!system || system.status !== "ONBOARDED" || system.evaluationClosedAt) return null;

  const after = await readClassification(tx, systemId);
  const was = await remitPairs(tx, before);
  const now = await remitParticipantsByControl(tx, after);
  const added: { controlId: string; reviewGroupId: string | null }[] = [];
  for (const [controlId, participants] of now) {
    for (const reviewGroupId of participants) if (!was.has(pairKey(controlId, reviewGroupId))) added.push({ controlId, reviewGroupId });
  }
  if (added.length === 0) return null;

  const open = await tx.changeReview.findFirst({ where: { systemId, status: "OPEN" }, include: { controls: { select: { controlId: true, reviewGroupId: true } } } });
  if (!open) {
    const review = await tx.changeReview.create({ data: { systemId, controls: { create: added } } });
    const names = await groupNames(tx, added.map((pair) => pair.reviewGroupId));
    await logChangeEvent(systemId, "CHANGE_REVIEW_STARTED", `Change Review started: ${describeAdded(added, names)}`, actorId, tx);
    return { changeReviewId: review.id, widened: false };
  }

  const known = new Set(open.controls.map((row) => pairKey(row.controlId, row.reviewGroupId)));
  const fresh = added.filter((pair) => !known.has(pairKey(pair.controlId, pair.reviewGroupId)));
  if (fresh.length === 0) return null;
  await tx.changeReviewControl.createMany({ data: fresh.map((pair) => ({ changeReviewId: open.id, ...pair })) });
  const names = await groupNames(tx, fresh.map((pair) => pair.reviewGroupId));
  await logChangeEvent(systemId, "CHANGE_REVIEW_WIDENED", `Change Review widened: ${describeAdded(fresh, names)}`, actorId, tx);
  // A participant that gained Controls recommends again, on everything it now has.
  const voidedAt = new Date();
  for (const reviewGroupId of new Set(fresh.map((pair) => pair.reviewGroupId))) {
    const voided = await tx.recommendation.updateMany({
      where: { changeReviewId: open.id, reviewGroupId, voidedAt: null },
      data: { voidedAt, voidReason: "Controls were added to the Change Review" },
    });
    if (voided.count > 0) {
      const name = reviewGroupId === null ? BASE_REVIEW_STEP_NAME : (names.get(reviewGroupId) ?? "A group");
      await logChangeEvent(systemId, "RECOMMENDATION_REOPENED", `${name} Recommendation reopened: Controls were added to the Change Review`, actorId, tx);
    }
  }
  return { changeReviewId: open.id, widened: true };
}

export type ChangeReviewParticipant = {
  reviewGroupId: string | null;
  name: string;
  controls: { code: string; title: string }[];
  recommendation: { id: string; kind: RecommendationKind; comment: string; givenAt: Date; givenById: string } | null;
  reopened: { at: Date; reason: string } | null;
};

/** The open Change Review of a System with its participants, base review first then by group name; null when none is open. Read on `tx`. */
export async function readOpenChangeReview(tx: Tx, systemId: string) {
  const review = await tx.changeReview.findFirst({ where: { systemId, status: "OPEN" }, orderBy: { startedAt: "desc" } });
  if (!review) return null;
  const rows = await tx.changeReviewControl.findMany({
    where: { changeReviewId: review.id },
    include: { control: { select: { code: true, title: true } }, reviewGroup: { select: { name: true } } },
    orderBy: [{ control: { code: "asc" } }],
  });
  const recommendations = await tx.recommendation.findMany({ where: { changeReviewId: review.id }, orderBy: [{ givenAt: "asc" }, { id: "asc" }] });
  const live = new Map<string | null, (typeof recommendations)[number]>();
  const reopened = new Map<string | null, { at: Date; reason: string }>();
  for (const row of recommendations) {
    if (!row.voidedAt) live.set(row.reviewGroupId, row);
    else if (row.voidReason) reopened.set(row.reviewGroupId, { at: row.voidedAt, reason: row.voidReason });
  }
  const byParticipant = new Map<string | null, ChangeReviewParticipant>();
  for (const row of rows) {
    const entry = byParticipant.get(row.reviewGroupId) ?? {
      reviewGroupId: row.reviewGroupId,
      name: row.reviewGroup?.name ?? BASE_REVIEW_STEP_NAME,
      controls: [],
      recommendation: live.get(row.reviewGroupId) ?? null,
      reopened: live.has(row.reviewGroupId) ? null : (reopened.get(row.reviewGroupId) ?? null),
    };
    entry.controls.push(row.control);
    byParticipant.set(row.reviewGroupId, entry);
  }
  const participants = [...byParticipant.values()].sort((a, b) => (a.reviewGroupId === null ? -1 : b.reviewGroupId === null ? 1 : a.name.localeCompare(b.name)));
  return { review, participants };
}

export type GiveChangeReviewRecommendationResult =
  | { ok: true; recommendation: { id: string; kind: RecommendationKind; comment: string; givenAt: Date; reviewGroupId: string | null; participantName: string } }
  | { ok: false; status: 409; error: string };

/**
 * Records a participant's Recommendation on the System's open Change Review, on a locked System row, after the route has checked who
 * may give it. 409, nothing written, when the review named isn't the open one (it closed or a new one started), the participant isn't
 * part of it, or already has a live Recommendation. The Change Event names the group, not the person.
 */
export async function giveChangeReviewRecommendation(
  tx: Tx,
  systemId: string,
  giverId: string,
  input: { changeReviewId: string; reviewGroupId: string | null; kind: RecommendationKind; comment: string },
): Promise<GiveChangeReviewRecommendationResult> {
  const open = await readOpenChangeReview(tx, systemId);
  if (!open) return { ok: false, status: 409, error: NO_OPEN_CHANGE_REVIEW };
  if (open.review.id !== input.changeReviewId) return { ok: false, status: 409, error: CHANGE_REVIEW_MOVED_ON };
  const participant = open.participants.find((candidate) => candidate.reviewGroupId === input.reviewGroupId);
  if (!participant) return { ok: false, status: 409, error: "That group isn't part of the Change Review on this System" };
  if (participant.recommendation) return { ok: false, status: 409, error: `${participant.name} has already given its Recommendation` };
  const created = await tx.recommendation.create({
    data: { systemId, changeReviewId: open.review.id, reviewGroupId: input.reviewGroupId, givenById: giverId, kind: input.kind, comment: input.comment },
  });
  await logChangeEvent(systemId, "RECOMMENDATION_GIVEN", `${participant.name}: ${RECOMMENDATION_LABEL[input.kind]} on the Change Review: ${input.comment}`, giverId, tx);
  return {
    ok: true,
    recommendation: { id: created.id, kind: created.kind, comment: created.comment, givenAt: created.givenAt, reviewGroupId: created.reviewGroupId, participantName: participant.name },
  };
}

/**
 * A person has just changed the Control Assessment of `control` (as `reopenRecommendationsForEdit` does at the OAG review): while the
 * System has an open Change Review, the live Recommendation of each participant whose added Controls include it is voided, and one
 * Change Event per participant is written, actor the editor. The caller has locked the System. Returns the names reopened.
 */
export async function reopenChangeReviewRecommendationsForEdit(tx: Tx, systemId: string, control: { id: string; code: string }, actorId: string) {
  const open = await tx.changeReview.findFirst({ where: { systemId, status: "OPEN" }, select: { id: true } });
  if (!open) return [];
  const rows = await tx.changeReviewControl.findMany({ where: { changeReviewId: open.id, controlId: control.id }, include: { reviewGroup: { select: { name: true } } } });
  const reason = `${control.code} changed after the Recommendation`;
  const voidedAt = new Date();
  const reopened: string[] = [];
  for (const row of rows) {
    const voided = await tx.recommendation.updateMany({ where: { changeReviewId: open.id, reviewGroupId: row.reviewGroupId, voidedAt: null }, data: { voidedAt, voidReason: reason } });
    if (voided.count === 0) continue;
    const name = row.reviewGroup?.name ?? BASE_REVIEW_STEP_NAME;
    await logChangeEvent(systemId, "RECOMMENDATION_REOPENED", `${name} Recommendation reopened: ${reason}`, actorId, tx);
    reopened.push(name);
  }
  return reopened;
}

export const changeReviewDecisionSchema = z
  .object({
    decision: z.enum(["ACCEPT", "REVOKE"]),
    comment: z.string().trim().min(1, "A comment is required").max(2000),
    sendBackTo: z.enum(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2", "OG3"]).optional(),
    /** The Change Review the form was shown for; refused (409) when another one is open by now. */
    changeReviewId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.decision === "REVOKE" || value.sendBackTo === undefined, { message: "A stage is named only when revoking the ATO", path: ["sendBackTo"] });
export type ChangeReviewDecisionInput = z.infer<typeof changeReviewDecisionSchema>;

export type ChangeReviewDecisionResult = { ok: true; decision: "ACCEPT" | "REVOKE"; stage: EvaluationStage | null } | { ok: false; status: 400 | 403 | 409; error: string };

/** The stages a revoked ATO can send the System back to: the earlier stages on its Track; none (null) for a System on the classic flow. */
export function revokeTargets(system: { evaluationStage: EvaluationStage | null; evaluationTrack: EvaluationTrack | null }): EvaluationStage[] | null {
  return system.evaluationStage === null ? null : sendBackTargets(system.evaluationTrack, "OG3");
}

/**
 * The Business System Owner's decision on the open Change Review. Locks the System first, then refuses (nothing written) unless the
 * actor may decide (checked on the locked row), a review is open (and is `input.changeReviewId`, when given), the System has a
 * Business System Owner and every participant has a live Recommendation. ACCEPT closes the review. REVOKE closes it, sets the System
 * back to Draft and, for a staged System, to the stage named (a send-back: the verdicts and Recommendations of the stages it reruns
 * are voided); the stage move is its own Change Event. A System on the classic flow takes no stage and just returns to Draft.
 */
export async function decideChangeReview(systemId: string, actor: Actor, input: ChangeReviewDecisionInput): Promise<ChangeReviewDecisionResult> {
  return prisma.$transaction(
    async (tx): Promise<ChangeReviewDecisionResult> => {
      await lockSystem(tx, systemId);
      const system = await tx.system.findUnique({
        where: { id: systemId },
        select: { ownerId: true, businessSystemOwnerId: true, evaluationStage: true, evaluationTrack: true, evaluationClosedAt: true },
      });
      if (!system || !canDecideAtGate(actor, system)) return { ok: false, status: 403, error: CHANGE_REVIEW_DECISION_REFUSED };
      if (system.evaluationClosedAt) return { ok: false, status: 409, error: "This System is closed" };
      const open = await readOpenChangeReview(tx, systemId);
      if (!open) return { ok: false, status: 409, error: NO_OPEN_CHANGE_REVIEW };
      if (input.changeReviewId !== undefined && input.changeReviewId !== open.review.id) return { ok: false, status: 409, error: CHANGE_REVIEW_MOVED_ON };
      if (system.businessSystemOwnerId === null) return { ok: false, status: 409, error: CHANGE_REVIEW_NEEDS_BSO };
      if (open.participants.some((participant) => participant.recommendation === null)) return { ok: false, status: 409, error: CHANGE_REVIEW_AWAITS_RECOMMENDATIONS };

      const targets = revokeTargets(system);
      let target: EvaluationStage | null = null;
      if (input.decision === "REVOKE") {
        if (targets === null && input.sendBackTo !== undefined) return { ok: false, status: 400, error: CLASSIC_SEND_BACK_REFUSED };
        if (targets !== null) {
          if (input.sendBackTo === undefined) return { ok: false, status: 400, error: SEND_BACK_REQUIRED };
          if (!targets.includes(input.sendBackTo)) return { ok: false, status: 409, error: "A System can only be sent back to an earlier stage on its Track" };
          target = input.sendBackTo;
        }
      }

      const now = new Date();
      await tx.changeReview.update({
        where: { id: open.review.id },
        data: { status: input.decision === "ACCEPT" ? "ACCEPTED" : "REVOKED", decidedAt: now, decidedById: actor.id, decisionComment: input.comment, sentBackTo: target },
      });
      if (input.decision === "REVOKE") {
        if (target !== null) await sendBackTo(tx, systemId, system.evaluationTrack, target, "The ATO was revoked by a Change Review", now);
        await tx.system.update({ where: { id: systemId }, data: { status: "DRAFT" } });
      }
      const detail =
        input.decision === "ACCEPT"
          ? "Change Review accepted"
          : `Change Review: ATO revoked, the System is back in ${target ? `${EVALUATION_STAGE_LABEL[target]}` : "Draft"}`;
      await logChangeEvent(systemId, "CHANGE_REVIEW_DECIDED", `${detail}: ${input.comment}`, actor.id, tx);
      if (target !== null) await logChangeEvent(systemId, "EVALUATION_STAGE_CHANGED", `ATO revoked: moved to ${EVALUATION_STAGE_LABEL[target]}`, actor.id, tx);
      return { ok: true, decision: input.decision, stage: target };
    },
    { timeout: 15_000 },
  );
}

export type ChangeReviewView = {
  id: string;
  startedAt: string;
  /** Whether the System has a Business System Owner; without one the review can't be decided. */
  hasBusinessSystemOwner: boolean;
  /** The viewer may decide it (the BSO, or an Admin who doesn't own the System); the form still waits for every Recommendation and a BSO. */
  canDecide: boolean;
  /** Every participant has a live Recommendation. */
  allRecommended: boolean;
  /** The stages the ATO can be revoked back to; null for a System on the classic flow (it returns to Draft). */
  sendBackTargets: EvaluationStage[] | null;
  participants: {
    reviewGroupId: string | null;
    name: string;
    controls: { code: string; title: string }[];
    recommendation: { kind: RecommendationKind; comment: string; givenAt: string; by: string | null } | null;
    reopened: { at: string; reason: string } | null;
    canGive: boolean;
  }[];
};

/** What the Change Review panel shows, in one RepeatableRead snapshot; null when the System has no open Change Review. A Recommendation is the group's; the person's name only where `canSeeDecider` allows. */
export async function loadChangeReviewView(viewer: Actor, systemId: string): Promise<ChangeReviewView | null> {
  const groupIds = await memberGroupIds(viewer.id);
  return prisma.$transaction(
    async (tx) => {
      const open = await readOpenChangeReview(tx, systemId);
      if (!open) return null;
      const system = await tx.system.findUnique({ where: { id: systemId }, select: { ownerId: true, businessSystemOwnerId: true, evaluationStage: true, evaluationTrack: true } });
      if (!system) return null;
      const groups = new Set(groupIds);
      const people = new Map(
        (await tx.user.findMany({ where: { id: { in: open.participants.flatMap((p) => (p.recommendation ? [p.recommendation.givenById] : [])) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
      );
      return {
        id: open.review.id,
        startedAt: open.review.startedAt.toISOString(),
        hasBusinessSystemOwner: system.businessSystemOwnerId !== null,
        canDecide: canDecideAtGate(viewer, system),
        allRecommended: open.participants.every((p) => p.recommendation !== null),
        sendBackTargets: revokeTargets(system),
        participants: open.participants.map((p) => ({
          reviewGroupId: p.reviewGroupId,
          name: p.name,
          controls: p.controls,
          recommendation: p.recommendation
            ? {
                kind: p.recommendation.kind,
                comment: p.recommendation.comment,
                givenAt: p.recommendation.givenAt.toISOString(),
                by: canSeeDecider(viewer, system.ownerId, groups, p) ? (people.get(p.recommendation.givenById) ?? null) : null,
              }
            : null,
          reopened: p.reopened ? { at: p.reopened.at.toISOString(), reason: p.reopened.reason } : null,
          canGive: p.recommendation === null && userCanRecommend(viewer, system.ownerId, groups, p.reviewGroupId),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** One open Change Review per Systems with its participants, for "My tasks": read in one snapshot. */
async function openReviewsWhere(where: Prisma.SystemWhereInput) {
  return prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: { ...where, evaluationClosedAt: null, changeReviews: { some: { status: "OPEN" } } },
        orderBy: { updatedAt: "asc" },
        select: { id: true, name: true, ownerId: true, businessSystemOwnerId: true, updatedAt: true },
      });
      const result: { system: (typeof systems)[number]; participants: ChangeReviewParticipant[] }[] = [];
      for (const system of systems) {
        const open = await readOpenChangeReview(tx, system.id);
        if (open) result.push({ system, participants: open.participants });
      }
      return result;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** The open Change Review Recommendations `user` may give, for "My tasks": the Review Step rule, on Systems they don't own. One entry per System and participant. */
export async function getOpenChangeReviewRecommendationsForUser(user: Actor) {
  const groupIds = await memberGroupIds(user.id);
  if (user.role !== "ADMIN" && user.role !== "REVIEWER" && groupIds.length === 0) return [];
  const reviews = await openReviewsWhere({ ownerId: { not: user.id } });
  return reviews.flatMap(({ system, participants }) =>
    participants.filter((p) => p.recommendation === null && userCanRecommend(user, system.ownerId, groupIds, p.reviewGroupId)).map((participant) => ({ system, participant })),
  );
}

/** The Systems with a Change Review ready for `user`'s decision as Business System Owner (every group has recommended), for "My tasks". */
export async function getChangeReviewDecisionTasksForUser(user: { id: string }) {
  const reviews = await openReviewsWhere({ businessSystemOwnerId: user.id, ownerId: { not: user.id } });
  return reviews.filter(({ participants }) => participants.every((p) => p.recommendation !== null)).map(({ system }) => system);
}

/** The Systems `user` owns whose open Change Review can't be decided because they have no Business System Owner, for "My tasks". */
export async function getChangeReviewsNeedingBsoForOwner(user: { id: string }) {
  return prisma.system.findMany({
    where: { ownerId: user.id, businessSystemOwnerId: null, evaluationClosedAt: null, changeReviews: { some: { status: "OPEN" } } },
    orderBy: { updatedAt: "asc" },
    select: { id: true, name: true, updatedAt: true },
  });
}
