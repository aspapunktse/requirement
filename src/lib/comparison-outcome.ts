import { ControlAssessmentStatus } from "@prisma/client";
import { z } from "zod";

/**
 * The outcome of a Comparison (#375; docs/how-it-works/comparison.md "Record the outcome"). No database or server imports, so the
 * Comparison page can share it.
 *
 * Recording the outcome closes the Comparison and freezes what the page shows: per Candidate its Comparison Score and counts, its
 * open Risks by severity, its classification (Deployment Facets and Framework Scope by name) and its status on every first-round
 * Control; for the whole Comparison the Control-by-Control table's grouping and the classification differences. They are stored in one
 * JSON column, `Comparison.outcomeSnapshot`, and validated with `outcomeSnapshotSchema` when read, so a malformed value fails loudly
 * instead of showing wrong figures. Reopening clears it. The Candidate's name, vendor, owner and stage are not frozen: they say who
 * the System is now, not how it scored.
 */

const named = z.object({ id: z.string(), name: z.string() });
const count = z.number().int().nonnegative();

export const candidateFiguresSchema = z.object({
  score: z.object({
    score: z.number().nullable(),
    firstRoundCount: count,
    countedCount: count,
    fulfilledCount: count,
    answeredCount: count,
    complete: z.boolean(),
    mandatoryNotFulfilledCount: count,
    controls: z.array(z.object({ controlId: z.string(), code: z.string(), title: z.string(), mandatory: z.boolean(), status: z.nativeEnum(ControlAssessmentStatus) })),
  }),
  openRisks: z.object({ LOW: count, MEDIUM: count, HIGH: count, CRITICAL: count }),
  classification: z.object({
    deploymentFacets: z.array(named),
    sensitivityLevel: z.number().nullable(),
    integrityImpactLevel: z.string().nullable(),
    availabilityImpactLevel: z.string().nullable(),
    frameworkScope: z.array(named),
  }),
});

export type CandidateFigures = z.infer<typeof candidateFiguresSchema>;

export const controlGroupsSchema = z.array(
  z.object({
    framework: named.nullable(),
    controls: z.array(z.object({ controlId: z.string(), code: z.string(), title: z.string(), mandatory: z.boolean() })),
  }),
);

export type ControlGroups = z.infer<typeof controlGroupsSchema>;

export const outcomeSnapshotSchema = z.object({
  version: z.literal(1),
  /** The chosen Candidate when the outcome was recorded, by id and name (the System may be deleted later); null is "None chosen". */
  chosen: named.nullable(),
  candidates: z.record(z.string(), candidateFiguresSchema),
  controlGroups: controlGroupsSchema,
  classificationDifferences: z.array(z.string()),
});

export type OutcomeSnapshot = z.infer<typeof outcomeSnapshotSchema>;

/** The comment of a recorded outcome: required. */
export const outcomeCommentSchema = z.string().trim().min(1, "A comment is required").max(5000);

/**
 * True when `chosenId` is a Candidate that did not have the highest Comparison Score: the page says so, and never blocks it. A
 * Candidate tied for the highest score is a top scorer. When no Candidate has a score nothing can be said, so false.
 */
export function isNotTopScorer(chosenId: string | null, candidates: readonly { systemId: string; score: { score: number | null } }[]): boolean {
  if (chosenId === null) return false;
  const scores = candidates.flatMap((candidate) => (candidate.score.score === null ? [] : [candidate.score.score]));
  if (scores.length === 0) return false;
  const chosen = candidates.find((candidate) => candidate.systemId === chosenId);
  return !chosen || chosen.score.score === null || chosen.score.score < Math.max(...scores);
}
