import type { EvaluationStage, Prisma, RecommendationKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { userCanDecideStep } from "@/lib/approvals";
import { EVALUATION_STAGE_LABEL } from "@/lib/evaluation-stages";
import { participantList, participantsContainingControl, participantsOver, participantsToReopen, type Participant } from "@/lib/review-participation";

/**
 * The OAG reviews on the Full track, before OG2 and before OG3 (#331, #332, PRD 0002 F-OAG.1-2, ADR 0014): every group with a remit on the System, plus the
 * base review (always), gives a Recommendation (Recommend, Recommend with conditions or Advise against) with a comment. The BSO decides
 * at OG2; a group only advises.
 *
 * Same shape as OG1 (`evaluation-og1.ts`) and the same participation rules (`review-participation.ts`, #326), but over ALL the System's
 * applicable Controls, not the first-round ones: who takes part is derived live from the Framework Scope, a Recommendation that stops
 * being the participant's is voided, an owner's edit in the participant's remit reopens it, and it is shown as the group's. They are
 * `Recommendation` rows. A Recommendation given while the System was at the stage counts only if given since it entered it, and a
 * send-back to or before the stage voids the live ones (`voidRecommendations`), so a later run starts every participant open.
 *
 * "Recommend with conditions" has no field of its own: the conditions are free text in the comment (PRD F-OAG.1, not followed up).
 * The writers take the caller's transaction client and expect the System row to be locked (`lockSystem`, first).
 */

type Tx = Prisma.TransactionClient;

/** The two OAG reviews (#331 before OG2, #332 before OG3): one module runs both, the System's current stage says which. The stage is stored on each row. */
export const OAG_STAGES = ["OAG_REVIEW_1", "OAG_REVIEW_2"] as const satisfies readonly EvaluationStage[];
export type OagStage = (typeof OAG_STAGES)[number];
export const isOagStage = (stage: EvaluationStage | null | undefined): stage is OagStage => stage === "OAG_REVIEW_1" || stage === "OAG_REVIEW_2";
/** Where each review closes to. */
const CLOSES_TO = { OAG_REVIEW_1: "OG2", OAG_REVIEW_2: "OG3" } as const satisfies Record<OagStage, EvaluationStage>;
export const NOT_AT_OAG_REVIEW = "This System isn't at the OAG review";

export const RECOMMENDATION_LABEL: Record<RecommendationKind, string> = {
  RECOMMEND: "Recommend",
  RECOMMEND_WITH_CONDITIONS: "Recommend with conditions",
  ADVISE_AGAINST: "Advise against",
};

/** Open question 2 on #200, as for the Review Steps and OG1: a stale Control in no declared Published Framework reopens the base review. */
const STALE_CONTROL_FALLS_BACK_TO_BASE = true;

const CLASSIFICATION_INCLUDE = {
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemInclude;

export type LiveRecommendation = { id: string; kind: RecommendationKind; comment: string; givenAt: Date; givenById: string };

export type OagParticipant = Participant & {
  /** The participant's live Recommendation, or null while it is open. */
  recommendation: LiveRecommendation | null;
  /** Set on an open participant whose Recommendation an edit reopened: when, and why. */
  reopened?: { at: Date; reason: string };
};

/** Who may give a participant's Recommendation: the Review Step rule (an Admin any, a Reviewer the base, a group's member its own, nobody on a System they own). */
export const userCanRecommend = userCanDecideStep;

/** The state of the OAG review the System is at (`stage` says which), read on `tx`; null unless the System exists and is at one. */
export async function readOagReview(tx: Tx, systemId: string) {
  const system = await tx.system.findUnique({ where: { id: systemId }, include: CLASSIFICATION_INCLUDE });
  if (!system || !isOagStage(system.evaluationStage) || !system.evaluationStageEnteredAt) return null;
  const stage = system.evaluationStage;
  const since = system.evaluationStageEnteredAt;
  const participation = await participantsOver(tx, system, { includeBase: true });
  const rows = await tx.recommendation.findMany({
    where: { systemId, stage, givenAt: { gte: since } },
    orderBy: [{ givenAt: "asc" }, { id: "asc" }],
  });
  const live = new Map<string | null, LiveRecommendation>();
  const reopenedBy = new Map<string | null, { at: Date; reason: string }>();
  for (const row of rows) {
    if (!row.voidedAt) live.set(row.reviewGroupId, row);
    else if (row.voidReason) reopenedBy.set(row.reviewGroupId, { at: row.voidedAt, reason: row.voidReason });
  }
  const participants = participantList(participation).map((participant): OagParticipant => {
    const recommendation = live.get(participant.reviewGroupId) ?? null;
    if (recommendation) return { ...participant, recommendation };
    const reopened = reopenedBy.get(participant.reviewGroupId);
    return reopened ? { ...participant, recommendation: null, reopened } : { ...participant, recommendation: null };
  });
  return { system, participants, since, stage };
}

/** The live Recommendations of an OAG review, as the groups', base review first then by group name: what the BSO sees at OG2. */
export async function readLiveRecommendations(tx: Tx, systemId: string, stage: OagStage = "OAG_REVIEW_1") {
  const rows = await tx.recommendation.findMany({
    where: { systemId, stage, voidedAt: null },
    include: { reviewGroup: { select: { name: true } } },
    orderBy: [{ givenAt: "asc" }, { id: "asc" }],
  });
  return rows.sort((a, b) => (a.reviewGroupId === null ? -1 : b.reviewGroupId === null ? 1 : (a.reviewGroup?.name ?? "").localeCompare(b.reviewGroup?.name ?? "")));
}

/** Whether any live Recommendation of the given reviews advises against: Proceed at OG2 (review 1) or Authorize at OG3 (both) then needs a written justification. */
export async function hasAdviseAgainst(tx: Tx, systemId: string, stages: readonly OagStage[] = ["OAG_REVIEW_1"]) {
  return (await tx.recommendation.count({ where: { systemId, stage: { in: [...stages] }, voidedAt: null, kind: "ADVISE_AGAINST" } })) > 0;
}

/** Voids the live Recommendations of the given OAG reviews (a send-back to or before a review starts it again). */
export async function voidRecommendations(tx: Tx, systemId: string, stages: readonly OagStage[], reason: string, now: Date) {
  if (stages.length === 0) return;
  await tx.recommendation.updateMany({ where: { systemId, stage: { in: [...stages] }, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
}

/** Moves the System from the OAG review `stage` to OG2 (review 1) or OG3 (review 2). Null if it was no longer at it. The move is automatic, so its actor is the system. */
async function closeOagReview(tx: Tx, systemId: string, stage: OagStage) {
  const next = CLOSES_TO[stage];
  const moved = await tx.system.updateMany({
    where: { id: systemId, evaluationStage: stage },
    data: { evaluationStage: next, evaluationStageEnteredAt: new Date() },
  });
  if (moved.count === 0) return null;
  await logChangeEvent(systemId, "EVALUATION_STAGE_CHANGED", `OAG review closed: moved to ${EVALUATION_STAGE_LABEL[next]}`, SYSTEM_ACTOR, tx);
  return { stage: next };
}

/**
 * Brings the OAG review in line with the live participants, on a System row the caller has locked: a group's Recommendations whose group
 * is no longer a participant are voided, and when every remaining participant has one the review closes (a dropped group may have been
 * the last to wait for). Nothing to do unless the System is at the review. Returns the close, if one happened.
 */
export async function settleOagReview(tx: Tx, systemId: string) {
  const review = await readOagReview(tx, systemId);
  if (!review) return null;
  const liveGroupIds = review.participants.flatMap((participant) => (participant.reviewGroupId === null ? [] : [participant.reviewGroupId]));
  await tx.recommendation.updateMany({
    where: { systemId, stage: review.stage, givenAt: { gte: review.since }, voidedAt: null, reviewGroupId: { not: null, notIn: liveGroupIds } },
    data: { voidedAt: new Date() },
  });
  if (review.participants.some((participant) => participant.recommendation === null)) return null;
  return closeOagReview(tx, systemId, review.stage);
}

export type GiveRecommendationResult =
  | {
      ok: true;
      recommendation: { id: string; kind: RecommendationKind; comment: string; givenAt: Date; reviewGroupId: string | null; participantName: string };
      closed: { stage: "OG2" | "OG3" } | null;
    }
  | { ok: false; status: 409; error: string };

/**
 * Records a participant's Recommendation, on a System row the caller has locked, after the route has checked who may give it. First
 * settles the review, then refuses (409, nothing written) when the System isn't at it, the participant isn't part of it or already has
 * a live Recommendation. Writes the row and its Change Event (the detail names the group, not the person), then closes the review
 * when this was the last open participant.
 */
export async function giveRecommendation(
  tx: Tx,
  systemId: string,
  giverId: string,
  input: { reviewGroupId: string | null; kind: RecommendationKind; comment: string },
): Promise<GiveRecommendationResult> {
  const closedBySettle = await settleOagReview(tx, systemId);
  const review = await readOagReview(tx, systemId);
  if (!review) {
    return { ok: false, status: 409, error: closedBySettle ? "The OAG review has just closed: every remaining group had recommended" : NOT_AT_OAG_REVIEW };
  }
  const participant = review.participants.find((candidate) => candidate.reviewGroupId === input.reviewGroupId);
  if (!participant) return { ok: false, status: 409, error: "That group isn't part of the OAG review on this System" };
  if (participant.recommendation) return { ok: false, status: 409, error: `${participant.name} has already given its Recommendation` };

  const created = await tx.recommendation.create({
    data: { systemId, stage: review.stage, reviewGroupId: input.reviewGroupId, givenById: giverId, kind: input.kind, comment: input.comment },
  });
  await logChangeEvent(systemId, "RECOMMENDATION_GIVEN", `${participant.name}: ${RECOMMENDATION_LABEL[input.kind]}: ${input.comment}`, giverId, tx);
  const closed = await settleOagReview(tx, systemId);
  return {
    ok: true,
    recommendation: { id: created.id, kind: created.kind, comment: created.comment, givenAt: created.givenAt, reviewGroupId: created.reviewGroupId, participantName: participant.name },
    closed,
  };
}

/**
 * A person has just changed the Control Assessment of `control` on a System (as `reopenVerdictsForEdit` does at OG1). While the System is
 * at the OAG review, the live Recommendation of every participant whose remit contains the Control is voided with the reason, and one
 * Change Event per reopened participant is written, actor the editor, all on `tx`. The caller has locked the System and calls this only
 * for an edit that really changed the Assessment. Once the review has closed nothing is reopened. Returns the names reopened.
 */
export async function reopenRecommendationsForEdit(tx: Tx, systemId: string, control: { id: string; code: string }, actorId: string) {
  const review = await readOagReview(tx, systemId);
  if (!review) return [];
  const remit = await participantsContainingControl(tx, review.system, control.id, { includeBase: true }, STALE_CONTROL_FALLS_BACK_TO_BASE);
  const reason = `${control.code} changed after the Recommendation`;
  const voidedAt = new Date();
  const reopened: string[] = [];
  for (const participant of participantsToReopen(review.participants, remit, (candidate) => candidate.recommendation !== null)) {
    await tx.recommendation.updateMany({
      where: { systemId, stage: review.stage, reviewGroupId: participant.reviewGroupId, givenAt: { gte: review.since }, voidedAt: null },
      data: { voidedAt, voidReason: reason },
    });
    await logChangeEvent(systemId, "RECOMMENDATION_REOPENED", `${participant.name} Recommendation reopened: ${reason}`, actorId, tx);
    reopened.push(participant.name);
  }
  return reopened;
}

/**
 * The open Recommendations `user` may give, for "My tasks": on Systems at the OAG review that the user doesn't own, the base review's
 * for a Reviewer or Admin, a group's for a member, any open one for an Admin. One entry per System and participant.
 */
export async function getOpenRecommendationsForUser(user: { id: string; role: UserRole }) {
  const groupIds = (await prisma.reviewGroup.findMany({ where: { members: { some: { id: user.id } } }, select: { id: true } })).map((group) => group.id);
  const decidesAny = user.role === "ADMIN" || user.role === "REVIEWER";
  if (!decidesAny && groupIds.length === 0) return [];
  return prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: { evaluationStage: { in: [...OAG_STAGES] }, evaluationClosedAt: null, ownerId: { not: user.id } },
        orderBy: { updatedAt: "asc" },
        select: { id: true, name: true, ownerId: true, updatedAt: true },
      });
      const tasks: { system: (typeof systems)[number]; stage: OagStage; participant: OagParticipant }[] = [];
      for (const system of systems) {
        const review = await readOagReview(tx, system.id);
        if (!review) continue;
        for (const participant of review.participants) {
          if (participant.recommendation === null && userCanRecommend(user, system.ownerId, groupIds, participant.reviewGroupId)) tasks.push({ system, stage: review.stage, participant });
        }
      }
      return tasks;
    },
    { isolationLevel: "RepeatableRead" },
  );
}
