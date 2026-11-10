import type { EvaluationStage, EvaluationTrack, GateOutcome, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { lockSystem } from "@/lib/system-lock";
import { EVALUATION_STAGE_LABEL, stepKeysFor } from "@/lib/evaluation-stages";
import { hasAdviseAgainst, OAG_STAGES, voidRecommendations, type OagStage } from "@/lib/evaluation-oag";

/**
 * The Business System Owner's decision at a gate (#330, #331, PRD 0002 F-ST.4-7, F-BSO.3) at Qualification, OG2 and OG3. Each decision is a `GateDecision` row
 * plus a GATE_DECIDED Change Event, written in the one transaction that applies it. The outcome enum is shared: AUTHORIZE stands for
 * Qualification's "Yes", OG2's "Proceed" and OG3's "Authorize to operate", so the API and the model have one vocabulary.
 *
 * - Qualification AUTHORIZE: the System moves to First documentation. OG2 AUTHORIZE: it moves to the second round. Proceeding against an
 *   Advise-against Recommendation needs a written `justification` (400 without), stored on the decision and shown next to it. The same at OG3 on the Full track, against an
 *   Advise-against from either OAG review (#332).
 * - AUTHORIZE: the System gets its ATO, which is `OnboardingStatus` APPROVED on a System still at OG3 (the migration rule "Approved
 *   Systems count as ATO"). Its owner or an Admin then marks it Onboarded as today.
 * - REJECT: final. `evaluationClosedAt` is set and the status is REJECTED; every write on the System is refused (409, `system-closed.ts`).
 * - SEND_BACK: to the first round (clears the Track and voids the OG1 verdicts, so OG1 runs again), to OG1, or to a later stage on the
 *   Track; the System re-enters that stage now, so the Risk Analysis and the verdicts that count are the ones given after it.
 *   Assessments, Risks, Documents and Risk Analyses are kept; a target at or before the OAG review also voids its Recommendations.
 * Open Risks never block a decision.
 */

type Actor = { id: string; role: UserRole };
type DecidableSystem = { ownerId: string; businessSystemOwnerId: string | null };

/** The gates the Business System Owner decides at (OG1 is the groups' verdicts, not a decision). */
export type Gate = "QUALIFICATION" | "OG2" | "OG3";

/** Only the System's Business System Owner or an Admin decides, and never on a System they own. */
export function canDecideAtGate(user: Actor, system: DecidableSystem): boolean {
  if (user.id === system.ownerId) return false;
  return user.role === "ADMIN" || (system.businessSystemOwnerId !== null && system.businessSystemOwnerId === user.id);
}

export const GATE_DECISION_REFUSED = "Only the System's Business System Owner or an Admin who isn't its owner can decide at a gate";
export const NOT_AT_OG3 = "This System isn't at OG3";
export const ALREADY_AUTHORIZED = "This System already has its authorization to operate";
export const SEND_BACK_TARGET_REFUSED = "A System can only be sent back to an earlier stage on its Track";
export const JUSTIFICATION_REQUIRED = "A written justification is required to proceed against an Advise-against Recommendation";
export const JUSTIFICATION_REQUIRED_AT_OG3 = "A written justification is required to authorize against an Advise-against Recommendation";
export const JUSTIFICATION_NOT_ALLOWED = "A justification belongs only to proceeding at OG2 or authorizing at OG3";

/** The OAG reviews whose live Advise-against a gate's AUTHORIZE needs a justification against: OG2 weighs review 1, OG3 both (the conservative reading). */
const ADVICE_AT: Partial<Record<Gate, readonly OagStage[]>> = { OG2: ["OAG_REVIEW_1"], OG3: OAG_STAGES };

/** The text the 409 gives, and what each gate's AUTHORIZE is called in Change Events. */
const GATE_TEXT: Record<Gate, { notAt: string; authorize: string }> = {
  QUALIFICATION: { notAt: "This System isn't at Qualification", authorize: "yes" },
  OG2: { notAt: "This System isn't at OG2", authorize: "proceed" },
  OG3: { notAt: NOT_AT_OG3, authorize: "authorized to operate" },
};

/** Where AUTHORIZE leads from a gate that isn't the last. */
const NEXT_STAGE: Record<"QUALIFICATION" | "OG2", EvaluationStage> = { QUALIFICATION: "FIRST_DOCUMENTATION", OG2: "SECOND_ROUND" };

/** The stages a System at `gate` on `track` can be sent back to: every stored stage of the Track before the gate (the derived Risk Analysis step is not one). */
export function sendBackTargets(track: EvaluationTrack | null, gate: Gate = "OG3"): EvaluationStage[] {
  const keys = stepKeysFor(track);
  return keys.slice(0, keys.indexOf(gate)).filter((key): key is EvaluationStage => key !== "RISK_ANALYSIS_1" && key !== "TRACK");
}

export const gateDecisionSchema = z
  .object({
    decision: z.enum(["AUTHORIZE", "REJECT", "SEND_BACK"]),
    comment: z.string().trim().min(1, "A comment is required").max(2000),
    sendBackTo: z
      .enum(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2", "OG3"])
      .optional(),
    justification: z.string().trim().min(1, "A justification can't be empty").max(2000).optional(),
  })
  .strict()
  .refine((value) => (value.decision === "SEND_BACK") === (value.sendBackTo !== undefined), {
    message: "Say which stage to send the System back to, and only when sending it back",
    path: ["sendBackTo"],
  });
export type GateDecisionInput = z.infer<typeof gateDecisionSchema>;
export const og3DecisionSchema = gateDecisionSchema;
export type Og3DecisionInput = GateDecisionInput;

export type GateDecisionResult = { ok: true; outcome: GateOutcome; stage: EvaluationStage } | { ok: false; status: 400 | 403 | 409; error: string };
export type Og3DecisionResult = GateDecisionResult;

const OUTCOME_TEXT: Record<GateOutcome, string> = { AUTHORIZE: "authorized to operate", REJECT: "rejected", SEND_BACK: "sent back" };

/**
 * Applies the decision at a gate. Locks the System first, then refuses (nothing written) unless the actor may decide (checked on the
 * locked row, so a concurrent change of Business System Owner counts), the System is open and at the gate (and, at OG3, not yet
 * authorized), and, to proceed at OG2 against an Advise-against, a justification came with it (400).
 */
export async function decideAtGate(systemId: string, gate: Gate, actor: Actor, input: GateDecisionInput): Promise<GateDecisionResult> {
  return prisma.$transaction(
    async (tx): Promise<GateDecisionResult> => {
      await lockSystem(tx, systemId);
      const system = await tx.system.findUnique({
        where: { id: systemId },
        select: { ownerId: true, businessSystemOwnerId: true, status: true, evaluationStage: true, evaluationTrack: true, evaluationClosedAt: true },
      });
      if (!system || !canDecideAtGate(actor, system)) return { ok: false, status: 403, error: GATE_DECISION_REFUSED };
      if (system.evaluationClosedAt) return { ok: false, status: 409, error: "This System is closed" };
      if (system.evaluationStage !== gate) return { ok: false, status: 409, error: GATE_TEXT[gate].notAt };
      if (system.status !== "DRAFT") return { ok: false, status: 409, error: ALREADY_AUTHORIZED };
      const advice = ADVICE_AT[gate];
      const proceeding = advice !== undefined && input.decision === "AUTHORIZE";
      if (input.justification !== undefined && !proceeding) return { ok: false, status: 400, error: JUSTIFICATION_NOT_ALLOWED };
      if (proceeding && input.justification === undefined && (await hasAdviseAgainst(tx, systemId, advice))) {
        return { ok: false, status: 400, error: gate === "OG3" ? JUSTIFICATION_REQUIRED_AT_OG3 : JUSTIFICATION_REQUIRED };
      }

      const now = new Date();
      let stage: EvaluationStage = gate;
      let detail = `${EVALUATION_STAGE_LABEL[gate]}: ${input.decision === "AUTHORIZE" ? GATE_TEXT[gate].authorize : OUTCOME_TEXT[input.decision]}`;
      if (input.decision === "AUTHORIZE") {
        if (gate === "OG3") {
          await tx.system.update({ where: { id: systemId }, data: { status: "APPROVED" } });
        } else {
          stage = NEXT_STAGE[gate];
          await tx.system.update({ where: { id: systemId }, data: { evaluationStage: stage, evaluationStageEnteredAt: now } });
        }
      } else if (input.decision === "REJECT") {
        await tx.system.update({ where: { id: systemId }, data: { status: "REJECTED", evaluationClosedAt: now } });
      } else {
        const target = input.sendBackTo!;
        if (!sendBackTargets(system.evaluationTrack, gate).includes(target)) return { ok: false, status: 409, error: SEND_BACK_TARGET_REFUSED };
        await sendBackTo(tx, systemId, system.evaluationTrack, target, `The System was sent back at ${EVALUATION_STAGE_LABEL[gate]}`, now);
        stage = target;
        detail += ` to ${EVALUATION_STAGE_LABEL[target]}`;
      }
      await tx.gateDecision.create({
        data: {
          systemId,
          gate,
          outcome: input.decision,
          sentBackTo: input.decision === "SEND_BACK" ? stage : null,
          comment: input.comment,
          justification: proceeding ? (input.justification ?? null) : null,
          decidedById: actor.id,
          decidedAt: now,
        },
      });
      await logChangeEvent(systemId, "GATE_DECIDED", `${detail}: ${input.comment}`, actor.id, tx);
      if (input.decision === "AUTHORIZE" && gate !== "OG3") {
        await logChangeEvent(systemId, "EVALUATION_STAGE_CHANGED", `${EVALUATION_STAGE_LABEL[gate]} passed: moved to ${EVALUATION_STAGE_LABEL[stage]}`, actor.id, tx);
      }
      return { ok: true, outcome: input.decision, stage };
    },
    { timeout: 15_000 },
  );
}

/** The decision at OG3 (#330). */
export const decideAtOg3 = (systemId: string, actor: Actor, input: GateDecisionInput) => decideAtGate(systemId, "OG3", actor, input);

/**
 * Moves the System to `target` with a fresh entry time. To the first round or OG1 the Track goes and the live OG1 verdicts are voided,
 * so OG1 runs again; for each OAG review the Track has, a target at or before it voids its live Recommendations, so it runs again (a
 * send-back to or before the first review voids both, one to the second round or later only the second; the first review's, which
 * informed OG2, stay live). Voided Recommendations stay as history. `reason` is the text the voided rows carry (a gate's send-back, or a revoked ATO, #334).
 */
export async function sendBackTo(tx: Prisma.TransactionClient, systemId: string, track: EvaluationTrack | null, target: EvaluationStage, reason: string, now: Date) {
  const reopensOg1 = target === "FIRST_ROUND" || target === "OG1";
  if (reopensOg1) {
    await tx.trackVerdict.updateMany({ where: { systemId, voidedAt: null }, data: { voidedAt: now, voidReason: reason } });
  }
  const keys = stepKeysFor(track);
  const rerun = OAG_STAGES.filter((review) => keys.includes(review) && keys.indexOf(target) <= keys.indexOf(review));
  await voidRecommendations(tx, systemId, rerun, reason, now);
  await tx.system.update({
    where: { id: systemId },
    data: { evaluationStage: target, evaluationStageEnteredAt: now, ...(reopensOg1 ? { evaluationTrack: null } : {}) },
  });
}

export type GateDecisionView = {
  gate: EvaluationStage;
  outcome: GateOutcome;
  sentBackTo: EvaluationStage | null;
  comment: string;
  /** The written justification for proceeding (OG2) or authorizing (OG3) against an Advise-against, else null. */
  justification: string | null;
  decidedAt: string;
  by: string;
};

/** The decisions made on a System, oldest first, for the Evaluation tab. Read on `tx`. */
export async function readGateDecisions(tx: Prisma.TransactionClient, systemId: string): Promise<GateDecisionView[]> {
  const rows = await tx.gateDecision.findMany({
    where: { systemId },
    include: { decidedBy: { select: { name: true } } },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ gate: row.gate, outcome: row.outcome, sentBackTo: row.sentBackTo, comment: row.comment, justification: row.justification, decidedAt: row.decidedAt.toISOString(), by: row.decidedBy.name }));
}

/** The Systems waiting at `gate` for `user` as their Business System Owner, for "My tasks". The System's owner never decides, so is left out. */
export async function getGateTasksForUser(user: { id: string }, gate: Gate) {
  return prisma.system.findMany({
    where: { evaluationStage: gate, evaluationClosedAt: null, status: "DRAFT", businessSystemOwnerId: user.id, ownerId: { not: user.id } },
    orderBy: { updatedAt: "asc" },
    select: { id: true, name: true, updatedAt: true },
  });
}

export const getOg3TasksForUser = (user: { id: string }) => getGateTasksForUser(user, "OG3");
