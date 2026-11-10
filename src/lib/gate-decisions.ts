import type { EvaluationStage, EvaluationTrack, GateOutcome, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { lockSystem } from "@/lib/system-lock";
import { EVALUATION_STAGE_LABEL, stepKeysFor } from "@/lib/evaluation-stages";

/**
 * The Business System Owner's decision at a gate (#330, PRD 0002 F-ST.5-7, F-BSO.3), built for OG3. Each decision is a `GateDecision` row
 * plus a GATE_DECIDED Change Event, written in the one transaction that applies it, so Qualification and OG2 (#331) can reuse the model.
 *
 * - AUTHORIZE: the System gets its ATO, which is `OnboardingStatus` APPROVED on a System still at OG3 (the migration rule "Approved
 *   Systems count as ATO"). Its owner or an Admin then marks it Onboarded as today.
 * - REJECT: final. `evaluationClosedAt` is set and the status is REJECTED; every write on the System is refused (409, `system-closed.ts`).
 * - SEND_BACK: to the first round (clears the Track and voids the OG1 verdicts, so OG1 runs again), to OG1, or to a later stage on the
 *   Track; the System re-enters that stage now, so the Risk Analysis and the verdicts that count are the ones given after it.
 *   Assessments, Risks, Documents and Risk Analyses are kept.
 * Open Risks never block a decision.
 */

type Actor = { id: string; role: UserRole };
type DecidableSystem = { ownerId: string; businessSystemOwnerId: string | null };

/** Only the System's Business System Owner or an Admin decides, and never on a System they own. */
export function canDecideAtGate(user: Actor, system: DecidableSystem): boolean {
  if (user.id === system.ownerId) return false;
  return user.role === "ADMIN" || (system.businessSystemOwnerId !== null && system.businessSystemOwnerId === user.id);
}

export const GATE_DECISION_REFUSED = "Only the System's Business System Owner or an Admin who isn't its owner can decide at OG3";
export const NOT_AT_OG3 = "This System isn't at OG3";
export const ALREADY_AUTHORIZED = "This System already has its authorization to operate";
export const SEND_BACK_TARGET_REFUSED = "A System can only be sent back to an earlier stage on its Track";

/** The stages a System at OG3 on `track` can be sent back to: every stored stage of the Track before OG3 (the derived Risk Analysis step is not one). */
export function sendBackTargets(track: EvaluationTrack | null): EvaluationStage[] {
  const keys = stepKeysFor(track);
  return keys.slice(0, keys.indexOf("OG3")).filter((key): key is EvaluationStage => key !== "RISK_ANALYSIS_1" && key !== "TRACK");
}

export const og3DecisionSchema = z
  .object({
    decision: z.enum(["AUTHORIZE", "REJECT", "SEND_BACK"]),
    comment: z.string().trim().min(1, "A comment is required").max(2000),
    sendBackTo: z
      .enum(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2", "OG3"])
      .optional(),
  })
  .strict()
  .refine((value) => (value.decision === "SEND_BACK") === (value.sendBackTo !== undefined), {
    message: "Say which stage to send the System back to, and only when sending it back",
    path: ["sendBackTo"],
  });
export type Og3DecisionInput = z.infer<typeof og3DecisionSchema>;

export type Og3DecisionResult = { ok: true; outcome: GateOutcome; stage: EvaluationStage } | { ok: false; status: 403 | 409; error: string };

const OUTCOME_TEXT: Record<GateOutcome, string> = { AUTHORIZE: "authorized to operate", REJECT: "rejected", SEND_BACK: "sent back" };

/**
 * Applies the decision at OG3. Locks the System first, then refuses (nothing written) unless the actor may decide (checked on the
 * locked row, so a concurrent change of Business System Owner counts), the System is open, at OG3, and not yet authorized.
 */
export async function decideAtOg3(systemId: string, actor: Actor, input: Og3DecisionInput): Promise<Og3DecisionResult> {
  return prisma.$transaction(
    async (tx): Promise<Og3DecisionResult> => {
      await lockSystem(tx, systemId);
      const system = await tx.system.findUnique({
        where: { id: systemId },
        select: { ownerId: true, businessSystemOwnerId: true, status: true, evaluationStage: true, evaluationTrack: true, evaluationClosedAt: true },
      });
      if (!system || !canDecideAtGate(actor, system)) return { ok: false, status: 403, error: GATE_DECISION_REFUSED };
      if (system.evaluationClosedAt) return { ok: false, status: 409, error: "This System is closed" };
      if (system.evaluationStage !== "OG3") return { ok: false, status: 409, error: NOT_AT_OG3 };
      if (system.status !== "DRAFT") return { ok: false, status: 409, error: ALREADY_AUTHORIZED };

      const now = new Date();
      let stage: EvaluationStage = "OG3";
      let detail = `OG3: ${OUTCOME_TEXT[input.decision]}`;
      if (input.decision === "AUTHORIZE") {
        await tx.system.update({ where: { id: systemId }, data: { status: "APPROVED" } });
      } else if (input.decision === "REJECT") {
        await tx.system.update({ where: { id: systemId }, data: { status: "REJECTED", evaluationClosedAt: now } });
      } else {
        const target = input.sendBackTo!;
        if (!sendBackTargets(system.evaluationTrack).includes(target)) return { ok: false, status: 409, error: SEND_BACK_TARGET_REFUSED };
        await sendBackTo(tx, systemId, target, now);
        stage = target;
        detail += ` to ${EVALUATION_STAGE_LABEL[target]}`;
      }
      await tx.gateDecision.create({
        data: { systemId, gate: "OG3", outcome: input.decision, sentBackTo: input.decision === "SEND_BACK" ? stage : null, comment: input.comment, decidedById: actor.id, decidedAt: now },
      });
      await logChangeEvent(systemId, "GATE_DECIDED", `${detail}: ${input.comment}`, actor.id, tx);
      return { ok: true, outcome: input.decision, stage };
    },
    { timeout: 15_000 },
  );
}

/** Moves the System to `target` with a fresh entry time; to the first round or OG1 the Track goes and the live OG1 verdicts are voided, so OG1 runs again. */
async function sendBackTo(tx: Prisma.TransactionClient, systemId: string, target: EvaluationStage, now: Date) {
  const reopensOg1 = target === "FIRST_ROUND" || target === "OG1";
  if (reopensOg1) {
    await tx.trackVerdict.updateMany({ where: { systemId, voidedAt: null }, data: { voidedAt: now, voidReason: "The System was sent back at OG3" } });
  }
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
  return rows.map((row) => ({ gate: row.gate, outcome: row.outcome, sentBackTo: row.sentBackTo, comment: row.comment, decidedAt: row.decidedAt.toISOString(), by: row.decidedBy.name }));
}

/** The Systems waiting at OG3 for `user` as their Business System Owner, for "My tasks". The System's owner never decides, so is left out. */
export async function getOg3TasksForUser(user: { id: string }) {
  return prisma.system.findMany({
    where: { evaluationStage: "OG3", evaluationClosedAt: null, status: "DRAFT", businessSystemOwnerId: user.id, ownerId: { not: user.id } },
    orderBy: { updatedAt: "asc" },
    select: { id: true, name: true, updatedAt: true },
  });
}
