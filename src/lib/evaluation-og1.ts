import type { EvaluationStage, EvaluationTrack, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { userCanDecideStep } from "@/lib/approvals";
import { firstRoundControlIdsForSystem } from "@/lib/first-round";
import { EVALUATION_STAGE_LABEL, TRACK_LABEL } from "@/lib/evaluation-stages";
import {
  participantList,
  participantsContainingControl,
  participantsOver,
  participantsToReopen,
  type Participant,
} from "@/lib/review-participation";

/**
 * OG1, the first gate of staged evaluation (#328, PRD 0002 F-ST.3, ADR 0014): every group with first-round Controls in its remit,
 * plus the base review (always), gives a Self or Full verdict with a comment. Any Full means the Full track, otherwise Self.
 *
 * It runs on the participation rules of `review-participation.ts` (#326), over the System's first-round Controls with the base
 * review included, and follows the Review Step rules of ADR 0010 (`review-steps.ts`): who takes part is derived live from the
 * System's Framework Scope, a verdict that stops being the participant's is voided, an owner's edit in the participant's remit
 * reopens it, and it is shown as the group's. The verdicts are `TrackVerdict` rows.
 *
 * Only verdicts given since the System entered OG1 (`evaluationStageEnteredAt`) count, so a later run of OG1 starts every
 * participant open. Every function takes the caller's transaction client; the writers expect the System row to be locked
 * (`lockSystem`, first, in a READ COMMITTED transaction). Nothing here imports `review-steps.ts` (it imports this).
 */

type Tx = Prisma.TransactionClient;

/** What the participation rules read of a System. */
const CLASSIFICATION_INCLUDE = {
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemInclude;

/** Open question 2 on #200, as for the Review Steps: a stale Control in no declared Published Framework reopens the base review. */
const STALE_CONTROL_FALLS_BACK_TO_BASE = true;

export type LiveVerdict = {
  id: string;
  verdict: EvaluationTrack;
  comment: string;
  givenAt: Date;
  verdictById: string;
};

export type Og1Participant = Participant & {
  /** The participant's live verdict, or null while it is open. */
  verdict: LiveVerdict | null;
  /** Set on an open participant whose verdict an edit reopened: when, and why. */
  reopened?: { at: Date; reason: string };
};

/** The Track a set of verdicts adds up to: any Full is Full, otherwise Self. */
export function trackFromVerdicts(verdicts: { verdict: EvaluationTrack }[]): EvaluationTrack {
  return verdicts.some((entry) => entry.verdict === "FULL") ? "FULL" : "SELF";
}

/** Who may give a participant's verdict: the Review Step rule (an Admin any, a Reviewer the base, a group's member its own, nobody on a System they own). */
export const userCanGiveVerdict = userCanDecideStep;

/**
 * The state of OG1 on a System, read on `tx`; null unless the System exists and is at OG1. `participants` are the live ones
 * (base review first, then groups by name), each with its live verdict.
 */
export async function readOg1(tx: Tx, systemId: string) {
  const system = await tx.system.findUnique({ where: { id: systemId }, include: CLASSIFICATION_INCLUDE });
  if (!system || system.evaluationStage !== "OG1" || !system.evaluationStageEnteredAt) return null;
  const since = system.evaluationStageEnteredAt;
  const firstRound = await firstRoundControlIdsForSystem(systemId, { db: tx });
  const participation = await participantsOver(tx, system, { controls: firstRound, includeBase: true });
  const verdicts = await tx.trackVerdict.findMany({
    where: { systemId, givenAt: { gte: since } },
    orderBy: [{ givenAt: "asc" }, { id: "asc" }],
  });
  const liveByParticipant = new Map<string | null, LiveVerdict>();
  const reopenedBy = new Map<string | null, { at: Date; reason: string }>();
  for (const entry of verdicts) {
    if (!entry.voidedAt) {
      liveByParticipant.set(entry.reviewGroupId, entry);
    } else if (entry.voidReason) {
      reopenedBy.set(entry.reviewGroupId, { at: entry.voidedAt, reason: entry.voidReason });
    }
  }
  const participants = participantList(participation).map((participant): Og1Participant => {
    const verdict = liveByParticipant.get(participant.reviewGroupId) ?? null;
    if (verdict) return { ...participant, verdict };
    const reopened = reopenedBy.get(participant.reviewGroupId);
    return reopened ? { ...participant, verdict: null, reopened } : { ...participant, verdict: null };
  });
  return { system, firstRound, participants, since };
}

/** Moves the System out of OG1 on the verdicts given: Full goes to Qualification, Self to the second round. Null if it was no longer at OG1. */
async function closeOg1(tx: Tx, systemId: string, verdicts: { verdict: EvaluationTrack }[], actorId: string) {
  const track = trackFromVerdicts(verdicts);
  const stage: EvaluationStage = track === "FULL" ? "QUALIFICATION" : "SECOND_ROUND";
  const moved = await tx.system.updateMany({
    where: { id: systemId, evaluationStage: "OG1" },
    data: { evaluationStage: stage, evaluationTrack: track, evaluationStageEnteredAt: new Date() },
  });
  if (moved.count === 0) return null;
  await logChangeEvent(
    systemId,
    "EVALUATION_STAGE_CHANGED",
    `OG1 closed: ${TRACK_LABEL[track]} track, moved to ${EVALUATION_STAGE_LABEL[stage]}`,
    actorId,
    tx,
  );
  return { track, stage };
}

/**
 * Brings OG1 in line with the live participants, on a System row the caller has locked: a group's verdicts whose group is no
 * longer a participant (its first-round Controls left the remit, its Framework left the scope) are voided, and when every remaining
 * participant has a verdict OG1 closes (a dropped group may have been the last one to wait for). Nothing to do unless the System is
 * at OG1. `actorId` is the person who caused the close (the verdict's giver), else the system. Returns the close, if one happened.
 */
export async function settleOg1(tx: Tx, systemId: string, actorId: string = SYSTEM_ACTOR) {
  const og1 = await readOg1(tx, systemId);
  if (!og1) return null;
  const liveGroupIds = og1.participants.flatMap((participant) => (participant.reviewGroupId === null ? [] : [participant.reviewGroupId]));
  await tx.trackVerdict.updateMany({
    where: { systemId, givenAt: { gte: og1.since }, voidedAt: null, reviewGroupId: { not: null, notIn: liveGroupIds } },
    data: { voidedAt: new Date() },
  });
  if (og1.participants.length === 0 || og1.participants.some((participant) => participant.verdict === null)) return null;
  return closeOg1(tx, systemId, og1.participants.map((participant) => participant.verdict!), actorId);
}

export type GiveVerdictResult =
  | {
      ok: true;
      verdict: { id: string; verdict: EvaluationTrack; comment: string; givenAt: Date; reviewGroupId: string | null; participantName: string };
      closed: { track: EvaluationTrack; stage: EvaluationStage } | null;
    }
  | { ok: false; status: 409; error: string };

export const NOT_AT_OG1 = "This System isn't at OG1";

/**
 * Records a verdict for a participant, on a System row the caller has locked, after the route has checked who may give it.
 * First settles OG1 (so a participant that left the review can't be answered for), then refuses when the System isn't at OG1, when
 * the participant isn't part of it, or when it already has a live verdict (409, nothing written). Writes the verdict and its Change
 * Event (the detail names the participant, not the person), then closes OG1 when this was the last open participant.
 */
export async function giveVerdict(
  tx: Tx,
  systemId: string,
  giverId: string,
  input: { reviewGroupId: string | null; verdict: EvaluationTrack; comment: string },
): Promise<GiveVerdictResult> {
  const closedBySettle = await settleOg1(tx, systemId);
  const og1 = await readOg1(tx, systemId);
  if (!og1) {
    return { ok: false, status: 409, error: closedBySettle ? "OG1 has just closed: every remaining participant had given a verdict" : NOT_AT_OG1 };
  }
  const participant = og1.participants.find((candidate) => candidate.reviewGroupId === input.reviewGroupId);
  if (!participant) return { ok: false, status: 409, error: "That participant isn't part of OG1 on this System" };
  if (participant.verdict) return { ok: false, status: 409, error: `${participant.name} has already given its verdict at OG1` };

  const created = await tx.trackVerdict.create({
    data: { systemId, reviewGroupId: input.reviewGroupId, verdictById: giverId, verdict: input.verdict, comment: input.comment },
  });
  await logChangeEvent(systemId, "TRACK_VERDICT_GIVEN", `${participant.name}: ${TRACK_LABEL[input.verdict]}: ${input.comment}`, giverId, tx);
  const closed = await settleOg1(tx, systemId, giverId);
  return {
    ok: true,
    verdict: {
      id: created.id,
      verdict: created.verdict,
      comment: created.comment,
      givenAt: created.givenAt,
      reviewGroupId: created.reviewGroupId,
      participantName: participant.name,
    },
    closed,
  };
}

/**
 * A person has just changed the Control Assessment of `control` on a System (#328, as `reopenStepsForEdit` does for Approvals). While
 * the System is at OG1, the live verdict of every participant whose remit contains the Control (a first-round Control) is voided with
 * the reason, and one Change Event per reopened participant is written, actor the editor, all on `tx`. The caller has locked the System
 * and calls this only for an edit that really changed the Assessment. After OG1 has closed nothing is reopened. Returns the names reopened.
 */
export async function reopenVerdictsForEdit(tx: Tx, systemId: string, control: { id: string; code: string }, actorId: string) {
  const og1 = await readOg1(tx, systemId);
  if (!og1 || !og1.firstRound.has(control.id)) return [];
  const remit = await participantsContainingControl(
    tx,
    og1.system,
    control.id,
    { controls: og1.firstRound, includeBase: true },
    STALE_CONTROL_FALLS_BACK_TO_BASE,
  );
  const reason = `${control.code} changed after the verdict`;
  const voidedAt = new Date();
  const reopened: string[] = [];
  for (const participant of participantsToReopen(og1.participants, remit, (candidate) => candidate.verdict !== null)) {
    await tx.trackVerdict.updateMany({
      where: { systemId, reviewGroupId: participant.reviewGroupId, givenAt: { gte: og1.since }, voidedAt: null },
      data: { voidedAt, voidReason: reason },
    });
    await logChangeEvent(systemId, "TRACK_VERDICT_REOPENED", `${participant.name} verdict reopened: ${reason}`, actorId, tx);
    reopened.push(participant.name);
  }
  return reopened;
}

/**
 * The open OG1 verdicts `user` may give, for "My tasks": on Systems at OG1 that the user doesn't own, the base review's for a
 * Reviewer or Admin, a group's for a member of the group, any open one for an Admin. One entry per System and participant.
 */
export async function getOpenVerdictsForUser(user: { id: string; role: UserRole }) {
  const groupIds = (await prisma.reviewGroup.findMany({ where: { members: { some: { id: user.id } } }, select: { id: true } })).map((group) => group.id);
  const decidesAny = user.role === "ADMIN" || user.role === "REVIEWER";
  if (!decidesAny && groupIds.length === 0) return [];
  return prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: { evaluationStage: "OG1", ownerId: { not: user.id } },
        orderBy: { updatedAt: "asc" },
        select: { id: true, name: true, ownerId: true, updatedAt: true },
      });
      const tasks: { system: (typeof systems)[number]; participant: Og1Participant }[] = [];
      for (const system of systems) {
        const og1 = await readOg1(tx, system.id);
        if (!og1) continue;
        for (const participant of og1.participants) {
          if (participant.verdict === null && userCanGiveVerdict(user, system.ownerId, groupIds, participant.reviewGroupId)) {
            tasks.push({ system, participant });
          }
        }
      }
      return tasks;
    },
    { isolationLevel: "RepeatableRead" },
  );
}
