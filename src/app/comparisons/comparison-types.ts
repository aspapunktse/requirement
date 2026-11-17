import type { ControlAssessmentStatus } from "@prisma/client";

/**
 * What `GET /api/comparisons` and `GET /api/comparisons/[id]` send (#372, #373), as the pages receive it: the same shapes as
 * `ComparisonListItem` and `ComparisonView` in `src/lib/comparison.ts`, with dates as strings. Kept apart from those so no
 * client component imports the server module.
 */

export type ComparisonListRow = {
  id: string;
  name: string;
  need: string | null;
  owner: { id: string; name: string };
  candidateCount: number;
  participantCount: number;
  closed: boolean;
  canManage: boolean;
  canAddCandidate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Person = { id: string; name: string };
export type Named = { id: string; name: string };

export type CandidateControl = { controlId: string; code: string; title: string; mandatory: boolean; status: ControlAssessmentStatus };

export type CandidateRow = {
  systemId: string;
  name: string;
  vendor: string | null;
  owner: Person;
  canOpen: boolean;
  stage: string | null;
  rejected: boolean;
  /** Closed as Not selected after a Comparison (#376): shown as Not selected, can't be chosen or closed again. */
  notSelected: boolean;
  /** May the acting user close this Candidate as Not selected now (#376)? Still in evaluation, and theirs or they are an Admin. */
  canCloseAsNotSelected: boolean;
  addedAt: string;
  addedBy: Person | null;
  /** The chosen Candidate of the recorded outcome (#375). */
  chosen: boolean;
  classification: {
    deploymentFacets: Named[];
    sensitivityLevel: number | null;
    integrityImpactLevel: string | null;
    availabilityImpactLevel: string | null;
    frameworkScope: Named[];
  };
  score: {
    score: number | null;
    firstRoundCount: number;
    countedCount: number;
    fulfilledCount: number;
    answeredCount: number;
    complete: boolean;
    mandatoryNotFulfilledCount: number;
    controls: CandidateControl[];
  };
  openRisks: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
};

export type ControlGroup = {
  framework: Named | null;
  controls: { controlId: string; code: string; title: string; mandatory: boolean }[];
};

export type ComparisonDetail = {
  id: string;
  name: string;
  need: string | null;
  owner: Person;
  participants: Person[];
  candidates: CandidateRow[];
  classificationDifferences: string[];
  controlGroups: ControlGroup[];
  closed: boolean;
  /** The recorded outcome of a closed Comparison (#375); null while it is open. The figures are then the frozen ones. */
  outcome: {
    /** null is "None chosen". */
    chosen: Named | null;
    comment: string;
    recordedBy: Person | null;
    recordedAt: string;
    chosenNotTopScorer: boolean;
  } | null;
  canManage: boolean;
  canAddCandidate: boolean;
  createdAt: string;
  updatedAt: string;
};
