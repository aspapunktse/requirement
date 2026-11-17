import type { CandidateControl, CandidateRow, ComparisonDetail, ComparisonListRow } from "../comparison-types";

/** Fixtures for the Comparison page tests: the shapes `GET /api/comparisons[/id]` sends. */

export function control(code: string, status: CandidateControl["status"], mandatory = false): CandidateControl {
  return { controlId: `id-${code}`, code, title: `Title of ${code}`, mandatory, status };
}

export function candidate(name: string, over: Partial<Omit<CandidateRow, "score">> & { controls?: CandidateControl[]; score?: Partial<CandidateRow["score"]> } = {}): CandidateRow {
  const { controls = [], score, ...rest } = over;
  const answered = controls.filter((entry) => entry.status !== "NOT_STARTED").length;
  const counted = controls.filter((entry) => entry.status !== "NOT_APPLICABLE");
  const fulfilled = counted.filter((entry) => entry.status === "FULFILLED").length;
  return {
    systemId: `sys-${name}`,
    name,
    vendor: `${name} Vendor`,
    owner: { id: "u-owner", name: "Olive Owner" },
    canOpen: true,
    stage: "FIRST_ROUND",
    rejected: false,
    addedAt: "2026-11-01T10:00:00.000Z",
    addedBy: null,
    classification: { deploymentFacets: [{ id: "f-saas", name: "SaaS" }], sensitivityLevel: 2, integrityImpactLevel: "MODERATE", availabilityImpactLevel: "HIGH", frameworkScope: [{ id: "fw-1", name: "ISO 27001" }] },
    score: {
      score: counted.length === 0 ? null : fulfilled / counted.length,
      firstRoundCount: controls.length,
      countedCount: counted.length,
      fulfilledCount: fulfilled,
      answeredCount: answered,
      complete: controls.length > 0 && answered === controls.length,
      mandatoryNotFulfilledCount: counted.filter((entry) => entry.mandatory && entry.status !== "FULFILLED").length,
      controls,
      ...score,
    },
    openRisks: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    ...rest,
  };
}

export function detail(candidates: CandidateRow[], over: Partial<ComparisonDetail> = {}): ComparisonDetail {
  return {
    id: "cmp-1",
    name: "New HR system 2027",
    need: "A system for HR",
    owner: { id: "u-owner", name: "Olive Owner" },
    participants: [],
    candidates,
    classificationDifferences: [],
    controlGroups: [],
    closed: false,
    canManage: false,
    canAddCandidate: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...over,
  };
}

export function listRow(name: string, over: Partial<ComparisonListRow> = {}): ComparisonListRow {
  return {
    id: `cmp-${name}`,
    name,
    need: `Need of ${name}`,
    owner: { id: "u-owner", name: "Olive Owner" },
    candidateCount: 3,
    participantCount: 0,
    closed: false,
    canManage: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    ...over,
  };
}
