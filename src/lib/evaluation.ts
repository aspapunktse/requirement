import type { EvaluationStage, EvaluationTrack, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { canSeeDecider, memberGroupIds } from "@/lib/approvals";
import { firstRoundControlIdsForSystem } from "@/lib/first-round";
import { getApplicableControls, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { hasCompletedRiskAnalysisSince } from "@/lib/risk-analysis";
import { canSubmit } from "@/lib/system-permissions";
import { lockSystem } from "@/lib/system-lock";
import { isBelowInformationTypes } from "@/lib/information-type-floor";
import { readSystemInformationTypes } from "@/lib/system-information-types";
import { belowInformationTypesMessage } from "@/lib/submit-classification";
import { BASE_REVIEW_STEP_NAME } from "@/lib/review-participation";
import { readOg1, trackFromVerdicts, userCanGiveVerdict } from "@/lib/evaluation-og1";

/**
 * Staged evaluation, up to OG1 (#328, PRD 0002, ADR 0014): the first-round readiness checklist, the submit that moves a System from
 * its first round to OG1, and the view the Evaluation tab reads. The OG1 verdicts themselves are in `evaluation-og1.ts`.
 */

type Tx = Prisma.TransactionClient;

/** The text of the 409 the first-round submit gives when a System isn't in its first round. */
export const NOT_IN_FIRST_ROUND = "This System isn't in its first round";

export type FirstRoundReadiness = {
  hasBusinessSystemOwner: boolean;
  /** The System has a Sensitivity Level (ADR 0011), which decides which Controls apply. */
  hasSensitivityLevel: boolean;
  /** Set when the level is below the System's Information Types (ADR 0012): the text naming the types and the level to raise to. */
  belowInformationTypes: string | null;
  riskAnalysisCompleted: boolean;
  mandatoryTotal: number;
  /** The mandatory first-round Controls that have no Assessment yet. */
  mandatoryMissing: { code: string; title: string }[];
  ready: boolean;
};

/**
 * What a System still lacks before its first round can be submitted (F-ST.2): a Business System Owner, a Risk Analysis completed
 * since it entered the first round, and an Assessment on every mandatory first-round Control (the classic submit's rule, over the
 * first-round Controls only). Read on `tx`.
 */
export async function readFirstRoundReadiness(tx: Tx, systemId: string): Promise<FirstRoundReadiness | null> {
  const system = await tx.system.findUnique({
    where: { id: systemId },
    include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
  });
  if (!system || !system.evaluationStage) return null;
  const firstRound = await firstRoundControlIdsForSystem(systemId, { db: tx });
  const applicable = await getApplicableControls(system, { controlIds: [...firstRound] }, tx);
  const mandatoryTotal = applicable.filter((control) => control.mandatory).length;
  const unaddressed = await getUnaddressedMandatoryControls(system, tx);
  const mandatoryMissing = unaddressed.filter((control) => firstRound.has(control.id)).map((control) => ({ code: control.code, title: control.title }));
  const riskAnalysisCompleted = system.evaluationStageEnteredAt
    ? await hasCompletedRiskAnalysisSince(tx, systemId, system.evaluationStageEnteredAt)
    : false;
  const hasBusinessSystemOwner = system.businessSystemOwnerId !== null;
  const hasSensitivityLevel = system.sensitivityLevel !== null;
  const types = await readSystemInformationTypes(tx, systemId);
  const belowInformationTypes = hasSensitivityLevel && isBelowInformationTypes(system.sensitivityLevel, types) ? await belowInformationTypesMessage(tx, types) : null;
  return {
    hasBusinessSystemOwner,
    hasSensitivityLevel,
    belowInformationTypes,
    riskAnalysisCompleted,
    mandatoryTotal,
    mandatoryMissing,
    ready: hasBusinessSystemOwner && hasSensitivityLevel && belowInformationTypes === null && riskAnalysisCompleted && mandatoryMissing.length === 0,
  };
}

/** The 409 text naming everything that is missing. */
export function firstRoundRefusal(readiness: FirstRoundReadiness): string {
  const missing: string[] = [];
  if (!readiness.hasBusinessSystemOwner) missing.push("a Business System Owner");
  if (!readiness.hasSensitivityLevel) missing.push("a Sensitivity Level (it decides which Controls apply)");
  if (readiness.belowInformationTypes) missing.push(`a Sensitivity Level that meets its Information Types (${readiness.belowInformationTypes.replace(/^Cannot submit: /, "")})`);
  if (!readiness.riskAnalysisCompleted) missing.push("a completed Risk Analysis");
  if (readiness.mandatoryMissing.length > 0) {
    missing.push(`an Assessment on the mandatory first-round Controls ${readiness.mandatoryMissing.map((c) => `${c.code} (${c.title})`).join(", ")}`);
  }
  return `Cannot submit the first round: it needs ${missing.join("; ")}`;
}

export type SubmitFirstRoundResult = { ok: true; stage: "OG1" } | { ok: false; status: 409; error: string };

/**
 * Moves a System from its first round to OG1, for its owner or an Admin (the route checks that). Takes the System lock first, so two
 * submits can't both pass; refuses with 409 (nothing written) when the System isn't in its first round or the readiness isn't met;
 * otherwise sets the stage and the time it was entered, and writes the Change Event, in the one transaction.
 */
export async function submitFirstRound(systemId: string, actorId: string): Promise<SubmitFirstRoundResult> {
  return prisma.$transaction(
    async (tx): Promise<SubmitFirstRoundResult> => {
      await lockSystem(tx, systemId);
      const system = await tx.system.findUnique({ where: { id: systemId }, select: { evaluationStage: true } });
      if (system?.evaluationStage !== "FIRST_ROUND") return { ok: false, status: 409, error: NOT_IN_FIRST_ROUND };
      const readiness = await readFirstRoundReadiness(tx, systemId);
      if (!readiness || !readiness.ready) {
        return { ok: false, status: 409, error: readiness ? firstRoundRefusal(readiness) : NOT_IN_FIRST_ROUND };
      }
      await tx.system.update({ where: { id: systemId }, data: { evaluationStage: "OG1", evaluationStageEnteredAt: new Date() } });
      await logChangeEvent(systemId, "EVALUATION_STAGE_CHANGED", "First round submitted: moved to OG1", actorId, tx);
      return { ok: true, stage: "OG1" };
    },
    { timeout: 15_000 },
  );
}

export type EvaluationVerdictView = {
  verdict: EvaluationTrack;
  comment: string;
  givenAt: string;
  /** The person's name, only for a viewer who may see who decided; otherwise null (shown as the group's). */
  by: string | null;
};

export type EvaluationParticipantView = {
  reviewGroupId: string | null;
  name: string;
  verdict: EvaluationVerdictView | null;
  reopened: { at: string; reason: string } | null;
  /** Whether the viewer may give this participant's verdict now. */
  canGive: boolean;
};

export type EvaluationView = {
  stage: EvaluationStage;
  track: EvaluationTrack | null;
  stageEnteredAt: string;
  /** The viewer may submit the first round (owner or Admin). */
  canSubmit: boolean;
  /** Present while the System is in its first round. */
  firstRound: FirstRoundReadiness | null;
  /** The OG1 participants: live while at OG1, the closed verdicts after. */
  og1: { open: boolean; participants: EvaluationParticipantView[]; track: EvaluationTrack | null } | null;
};

/**
 * What the Evaluation tab shows, in one RepeatableRead snapshot. Null unless the System is staged. A verdict is shown as its
 * participant's (the group's); the person's name only to a viewer `canSeeDecider` allows.
 */
export async function loadEvaluationView(viewer: { id: string; role: UserRole }, systemId: string): Promise<EvaluationView | null> {
  const groupIds = await memberGroupIds(viewer.id);
  return prisma.$transaction(
    async (tx) => {
      const system = await tx.system.findUnique({ where: { id: systemId }, select: { id: true, ownerId: true, evaluationStage: true, evaluationTrack: true, evaluationStageEnteredAt: true } });
      if (!system || !system.evaluationStage || !system.evaluationStageEnteredAt) return null;
      const stage = system.evaluationStage;
      const groups = new Set(groupIds);
      const nameOfPerson = async (ids: string[]) => new Map((await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

      let og1: EvaluationView["og1"] = null;
      if (stage === "OG1") {
        const state = await readOg1(tx, systemId);
        const people = await nameOfPerson(state?.participants.flatMap((p) => (p.verdict ? [p.verdict.verdictById] : [])) ?? []);
        og1 = {
          open: true,
          track: null,
          participants: (state?.participants ?? []).map((p) => ({
            reviewGroupId: p.reviewGroupId,
            name: p.name,
            verdict: p.verdict
              ? {
                  verdict: p.verdict.verdict,
                  comment: p.verdict.comment,
                  givenAt: p.verdict.givenAt.toISOString(),
                  by: canSeeDecider(viewer, system.ownerId, groups, p) ? (people.get(p.verdict.verdictById) ?? null) : null,
                }
              : null,
            reopened: p.reopened ? { at: p.reopened.at.toISOString(), reason: p.reopened.reason } : null,
            canGive: p.verdict === null && userCanGiveVerdict(viewer, system.ownerId, groups, p.reviewGroupId),
          })),
        };
      } else if (stage !== "FIRST_ROUND") {
        // OG1 has closed: show the verdicts that decided it (the live ones), as the groups'.
        const rows = await tx.trackVerdict.findMany({
          where: { systemId, voidedAt: null },
          include: { reviewGroup: { select: { name: true } } },
          orderBy: [{ givenAt: "asc" }, { id: "asc" }],
        });
        const people = await nameOfPerson(rows.map((row) => row.verdictById));
        og1 = {
          open: false,
          track: rows.length > 0 ? trackFromVerdicts(rows) : system.evaluationTrack,
          participants: rows
            .sort((a, b) => (a.reviewGroupId === null ? -1 : b.reviewGroupId === null ? 1 : (a.reviewGroup?.name ?? "").localeCompare(b.reviewGroup?.name ?? "")))
            .map((row) => ({
              reviewGroupId: row.reviewGroupId,
              name: row.reviewGroup?.name ?? BASE_REVIEW_STEP_NAME,
              verdict: {
                verdict: row.verdict,
                comment: row.comment,
                givenAt: row.givenAt.toISOString(),
                by: canSeeDecider(viewer, system.ownerId, groups, row) ? (people.get(row.verdictById) ?? null) : null,
              },
              reopened: null,
              canGive: false,
            })),
        };
      }

      return {
        stage,
        track: system.evaluationTrack,
        stageEnteredAt: system.evaluationStageEnteredAt.toISOString(),
        canSubmit: canSubmit(viewer, system),
        firstRound: stage === "FIRST_ROUND" ? await readFirstRoundReadiness(tx, systemId) : null,
        og1,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
