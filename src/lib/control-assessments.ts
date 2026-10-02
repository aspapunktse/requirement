import type { ControlAssessmentStatus, ImpactLevel, Prisma, SelfAssessmentAnswer, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { QUERY_INCLUDE } from "@/lib/assessment-queries";
import { ROLES_ALLOWED_TO_WAIVE, waiveRefusal } from "@/lib/system-permissions";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import {
  describeEffectiveStatusNow,
  inheritanceSourcesFor,
  resetToInheritedRefusal,
  resetToInheritedRefusalMessage,
  resolveEffectiveStatus,
  type EffectiveStatus,
} from "@/lib/effective-status";
import { loadOrganizationStatuses, toOwnAssessment } from "@/lib/effective-status-data";
import { logChangeEvent } from "@/lib/change-events";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

const IMPACT_LEVEL_RANK: Record<ImpactLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Does a System's declared level on one CIA axis meet a Control's
 * minimum threshold on that axis? A null threshold means the Control
 * doesn't care about this axis (always met). A null System level means
 * "not yet classified" on this axis — that only meets an unset threshold.
 * Impact Level thresholds are a >= comparison, not a membership check like
 * facet scoping — see ADR 0003.
 */
function meetsImpactThreshold(systemLevel: ImpactLevel | null, minimum: ImpactLevel | null): boolean {
  if (!minimum) return true;
  if (!systemLevel) return false;
  return IMPACT_LEVEL_RANK[systemLevel] >= IMPACT_LEVEL_RANK[minimum];
}

/** Does `classification` meet every Impact Level threshold `control` sets? */
export function meetsAllImpactThresholds(
  classification: Pick<
    SystemClassification,
    "confidentialityImpactLevel" | "integrityImpactLevel" | "availabilityImpactLevel"
  >,
  control: Pick<
    ControlImpactThresholds,
    "minConfidentialityImpactLevel" | "minIntegrityImpactLevel" | "minAvailabilityImpactLevel"
  >,
): boolean {
  return (
    meetsImpactThreshold(classification.confidentialityImpactLevel, control.minConfidentialityImpactLevel) &&
    meetsImpactThreshold(classification.integrityImpactLevel, control.minIntegrityImpactLevel) &&
    meetsImpactThreshold(classification.availabilityImpactLevel, control.minAvailabilityImpactLevel)
  );
}

export type WaiveGateResult = { ok: true } | { ok: false; status: 403 | 400; error: string };

/**
 * "Untouched": a ControlAssessment still at NOT_STARTED that no human ever
 * edited (assessedById is null). The one definition every recompute uses to
 * decide whether a no-longer-applicable row may be removed; anything else is
 * kept in place as stale (see getStaleAssessments).
 */
export const UNTOUCHED_ASSESSMENT_WHERE = { status: "NOT_STARTED", assessedById: null } as const;

/**
 * The values of an untouched row (#129): what a reset to inherited writes, so
 * the row satisfies `UNTOUCHED_ASSESSMENT_WHERE` again and a recompute treats
 * it as nobody's work. Everything a person or a Capability filled in is cleared.
 */
export const UNTOUCHED_ASSESSMENT_DATA = {
  status: "NOT_STARTED",
  assessedById: null,
  assessedAt: null,
  evidence: null,
  notes: null,
  selfAssessmentAnswer: null,
  fulfilledByCapabilityId: null,
} as const;

/**
 * Diff an old vs new applicable-Control set for a System into the two
 * Prisma ops needed to sync its ControlAssessment rows to match: create
 * rows for newly-applicable Controls, and remove rows for
 * no-longer-applicable ones — but only if untouched (still NOT_STARTED and
 * never manually edited, i.e. assessedById is null). A Control
 * Assessment a human has already worked on is left in place even though
 * it's no longer applicable; it becomes visible via getStaleAssessments so
 * the System Owner can resolve it manually. Returns the ops (rather than
 * running them) so a caller can combine them with its own classification
 * update in one atomic `prisma.$transaction`. Shared by every
 * classification-changing mutation (Deployment Facets, Framework Scope,
 * ...) — see ADR 0003 and ADR 0007.
 *
 * The created rows are NOT_STARTED unless the caller passes `newRows`: the
 * ready-made create data for exactly the newly applicable Controls, which is how
 * Capability auto-fulfilment (#110, `planNewAssessments` in
 * `capability-fulfillment.ts`) makes a Control a declared Capability covers
 * come out FULFILLED in the same createMany. Use
 * `diffApplicabilityOpsWithCapabilities` there rather than building rows by hand.
 */
export function diffApplicabilityOps(
  systemId: string,
  oldApplicable: { id: string }[],
  newApplicable: { id: string }[],
  newRows?: Prisma.ControlAssessmentCreateManyInput[],
) {
  const { newlyApplicableIds, noLongerApplicableIds } = diffApplicability(oldApplicable, newApplicable);

  return {
    added: newlyApplicableIds.length,
    deleteOp: prisma.controlAssessment.deleteMany({
      where: {
        systemId,
        controlId: { in: noLongerApplicableIds },
        ...UNTOUCHED_ASSESSMENT_WHERE,
      },
    }),
    createOp: prisma.controlAssessment.createMany({
      data: newRows ?? newlyApplicableIds.map((controlId) => ({ systemId, controlId })),
      skipDuplicates: true,
    }),
  };
}

/** The Control ids that became applicable and the ones that stopped, between two applicable sets. */
export function diffApplicability(oldApplicable: { id: string }[], newApplicable: { id: string }[]) {
  const newIds = new Set(newApplicable.map((r) => r.id));
  const oldIds = new Set(oldApplicable.map((r) => r.id));
  return {
    newlyApplicableIds: newApplicable.filter((r) => !oldIds.has(r.id)).map((r) => r.id),
    noLongerApplicableIds: oldApplicable.filter((r) => !newIds.has(r.id)).map((r) => r.id),
  };
}

/**
 * The shared gate on setting a Control Assessment to Waived or Not
 * Applicable, used both for direct manual status edits and for answering
 * "N/A" to a Control's Self-Assessment Question: restricted to
 * ADMIN/RISK_OWNER, refusing a RISK_OWNER who owns the System when the
 * Control is mandatory (#97), and requiring a non-empty justification note
 * when the Control is mandatory — server-enforced so a SYSTEM_OWNER can't
 * waive or N/A their own System's mandatory Control through either path.
 * The permission rule itself is `waiveRefusal` in `system-permissions.ts`,
 * shared with the UI; this adds the distinct error messages and the note check.
 */
export function checkWaiveGate(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
  control: { mandatory: boolean },
  notes: string | null | undefined,
): WaiveGateResult {
  const refusal = waiveRefusal(user, system, control);
  if (refusal === "role") {
    return { ok: false, status: 403, error: `Requires role: ${ROLES_ALLOWED_TO_WAIVE.join(", ")}` };
  }
  if (refusal === "owns-system") {
    return {
      ok: false,
      status: 403,
      error: "You own this System, so another Risk Owner or an Admin must waive this mandatory Control",
    };
  }
  if (control.mandatory && !notes?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "A justification note is required to waive or mark a mandatory Control Not Applicable",
    };
  }
  return { ok: true };
}

/**
 * A System's declared classification, as far as applicability filtering cares.
 * `frameworkScopes` is the System's *declared* Framework Scope rows (ids
 * only); the base Framework is always in scope on top of them and needn't be
 * listed. Required, not optional, so that a caller which forgets to load it
 * fails typecheck instead of silently dropping every non-base Framework's
 * Controls (ADR 0007).
 */
export type SystemClassification = {
  deploymentFacets: { id: string }[];
  frameworkScopes: { id: string }[];
  confidentialityImpactLevel: ImpactLevel | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
};

/** A Control's Impact Level thresholds, as far as applicability filtering cares. */
type ControlImpactThresholds = {
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
};

/**
 * The DB-side applicability conditions for `classification`, ANDed together:
 * - Framework gate (ADR 0007): the Control is mapped, at any Coverage, to a
 *   Requirement of a PUBLISHED Framework that's either the base Framework
 *   (always in scope, stored scope row or not) or one of the System's declared
 *   Framework Scope rows. A declared row pointing at a Draft Framework matches
 *   nothing, so it's inert until that Framework is published.
 * - Deployment Facet scoping: unscoped, or scoped to include at least one of
 *   the System's declared facets.
 * Impact Level thresholds are applied in application code afterwards.
 */
const APPLICABILITY_SCOPING = (classification: Pick<SystemClassification, "deploymentFacets" | "frameworkScopes">) => {
  const facetIds = classification.deploymentFacets.map((f) => f.id);
  const scopedFrameworkIds = classification.frameworkScopes.map((f) => f.id);
  return [
    {
      mappings: {
        some: {
          requirement: {
            framework: { status: "PUBLISHED" as const, OR: [{ isBase: true }, { id: { in: scopedFrameworkIds } }] },
          },
        },
      },
    },
    { OR: [{ deploymentFacets: { none: {} } }, { deploymentFacets: { some: { id: { in: facetIds } } } }] },
  ];
};

/**
 * The in-memory twin of `getApplicableControls`' rules, for callers that have
 * already bulk-loaded Controls and need the answer for many Systems without a
 * query per System (the derived Requirement status, #89). MUST stay in sync
 * with APPLICABILITY_SCOPING and the applicability filter above; a DB test
 * asserts the two agree on fixtures. `control.mappings` must list the
 * Framework of every Requirement the Control is mapped to (any Coverage).
 */
export function controlAppliesToSystem(
  control: ControlImpactThresholds & {
    applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH";
    deploymentFacets: { id: string }[];
    mappings: { requirement: { framework: { id: string; status: string; isBase: boolean } } }[];
  },
  classification: SystemClassification,
): boolean {
  if (!(APPLICABLE_APPLICABILITIES as readonly string[]).includes(control.applicability)) return false;

  const scopedFrameworkIds = new Set(classification.frameworkScopes.map((f) => f.id));
  const inScopePublishedFramework = control.mappings.some(({ requirement: { framework } }) => {
    return framework.status === "PUBLISHED" && (framework.isBase || scopedFrameworkIds.has(framework.id));
  });
  if (!inScopePublishedFramework) return false;

  if (control.deploymentFacets.length > 0) {
    const facetIds = new Set(classification.deploymentFacets.map((f) => f.id));
    if (!control.deploymentFacets.some((f) => facetIds.has(f.id))) return false;
  }

  return meetsAllImpactThresholds(classification, control);
}

/**
 * Controls that apply to a System with the given classification: scoped
 * PER_SYSTEM or BOTH; either unscoped by Deployment Facet (applies
 * regardless) or explicitly scoped to include at least one of the System's
 * declared facets (a union, e.g. a Hybrid System declaring both On-Prem and
 * Cloud gets everything either facet requires); and meeting every Impact Level
 * threshold the Control sets (a >= comparison per CIA axis, not a
 * membership check). All conditions AND together — see ADR 0003.
 * ORGANIZATIONAL-scoped Controls are never assessed per System, so
 * they're excluded here. Impact Level thresholds can't be expressed as a
 * portable Prisma enum filter, so they're applied in application code after
 * the DB-side fetch. `options.controlIds` narrows the answer to those
 * Controls (used by the catalog-change recompute, which only needs to know
 * about the Controls a change touched).
 *
 * On top of that, a Control only applies if it's mapped to a Requirement of a
 * Published Framework in the System's effective Framework Scope (its declared
 * scope rows plus the always-in-scope base Framework), and a Control mapped to
 * no Published Framework in scope applies to nothing — see
 * APPLICABILITY_SCOPING and ADR 0007.
 */
export async function getApplicableControls(
  classification: SystemClassification,
  options: { controlIds?: string[] } = {},
) {
  const controls = await prisma.control.findMany({
    where: {
      ...(options.controlIds !== undefined && { id: { in: options.controlIds } }),
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(classification),
    },
    orderBy: { code: "asc" },
  });
  return controls.filter((control) => meetsAllImpactThresholds(classification, control));
}

/**
 * Every Control applicable to a System, each paired with its current
 * ControlAssessment (null when the Control has no row yet, which reads as an
 * untouched Not Started one) and its `effective` status and sources (#121). The
 * `assessment` is the System's own stored row, unchanged; `effective` is what
 * the System is judged by, including what it inherits from the Organization.
 */
export async function getSystemAssessments(system: SystemClassification & { id: string }) {
  return assessmentRowsFor(system.id, await getApplicableControls(system));
}

/**
 * One row of `getSystemAssessments`, exactly as it shows there, or null when the
 * Control doesn't apply to the System. What a reset to inherited returns (#129),
 * so the UI can replace the row without refetching the list.
 */
export async function getSystemAssessmentRow(system: SystemClassification & { id: string }, controlId: string) {
  const controls = await getApplicableControls(system, { controlIds: [controlId] });
  const [row] = await assessmentRowsFor(system.id, controls, controlId);
  return row ?? null;
}

async function assessmentRowsFor(
  systemId: string,
  controls: Awaited<ReturnType<typeof getApplicableControls>>,
  onlyControlId?: string,
) {
  const assessments = await prisma.controlAssessment.findMany({
    where: { systemId, ...(onlyControlId !== undefined && { controlId: onlyControlId }) },
    include: { assessedBy: true, queries: { include: QUERY_INCLUDE, orderBy: { createdAt: "asc" } } },
  });

  const assessmentByControlId = new Map(assessments.map((a) => [a.controlId, a]));
  const organizationStatuses = await loadOrganizationStatuses(
    controls.filter((control) => control.applicability === "BOTH").map((control) => control.id),
  );

  return controls.map((control) => {
    const assessment = assessmentByControlId.get(control.id) ?? null;
    return {
      control,
      assessment,
      effective: resolveEffectiveStatus(
        assessment ? toOwnAssessment(assessment) : null,
        inheritanceSourcesFor(control, organizationStatuses.get(control.id)),
      ),
    };
  });
}

/**
 * The Control `controlId`, if it's applicable to `system` — null if
 * it doesn't exist or isn't scoped to one of this System's declared
 * Deployment Facets/applicability.
 */
export async function getApplicableControl(system: SystemClassification, controlId: string) {
  const control = await prisma.control.findFirst({
    where: {
      id: controlId,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
    },
  });
  if (!control || !meetsAllImpactThresholds(system, control)) return null;
  return control;
}

/**
 * The Control behind `controlId` for the purpose of editing a
 * ControlAssessment: either the normal applicable-Control lookup, or
 * — if that Control is no longer applicable to the System's current
 * declared facets — the Control behind an *existing* Assessment row, so
 * a stale Assessment left behind by a facet change stays resolvable rather
 * than becoming permanently stuck (see #15).
 */
export async function getControlForAssessmentEdit(
  system: SystemClassification & { id: string },
  controlId: string,
) {
  const applicable = await getApplicableControl(system, controlId);
  if (applicable) return applicable;

  const existing = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    include: { control: true },
  });
  return existing?.control ?? null;
}

/**
 * ControlAssessments still recorded for `system` whose Control is no
 * longer applicable to its current declared-facets/applicability scope —
 * left in place by a facet change (rather than deleted) because a human had
 * already worked on them. Surfaced so the System Owner can resolve them.
 */
export async function getStaleAssessments(system: SystemClassification & { id: string }) {
  const applicable = await getApplicableControls(system);
  const applicableIds = applicable.map((r) => r.id);

  return prisma.controlAssessment.findMany({
    where: { systemId: system.id, controlId: { notIn: applicableIds } },
    include: {
      control: true,
      assessedBy: true,
      queries: { include: QUERY_INCLUDE, orderBy: { createdAt: "asc" } },
    },
  });
}

/**
 * The mandatory Controls applicable to `system` that haven't been
 * addressed yet — no ControlAssessment row at all, or one still sitting
 * at NOT_STARTED. This is the gate for submitting a System for review: it
 * only cares that each has been touched, not that it's Fulfilled. A Control
 * whose *effective* status is past Not Started counts as addressed, so an
 * untouched Both Control the Organization has Fulfilled does too (#121); a
 * person-set Not Started Assessment still does not.
 */
export async function getUnaddressedMandatoryControls(system: SystemClassification & { id: string }) {
  const candidates = await prisma.control.findMany({
    where: {
      mandatory: true,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
    },
  });
  const mandatoryControls = candidates.filter((control) => meetsAllImpactThresholds(system, control));
  if (mandatoryControls.length === 0) return [];

  const [assessments, organizationStatuses] = await Promise.all([
    prisma.controlAssessment.findMany({
      where: { systemId: system.id, controlId: { in: mandatoryControls.map((r) => r.id) } },
      select: { controlId: true, status: true, assessedById: true },
    }),
    loadOrganizationStatuses(mandatoryControls.filter((r) => r.applicability === "BOTH").map((r) => r.id)),
  ]);
  const assessmentByControlId = new Map(assessments.map((a) => [a.controlId, a]));

  return mandatoryControls.filter((control) => {
    const assessment = assessmentByControlId.get(control.id);
    const effective = resolveEffectiveStatus(
      assessment ? toOwnAssessment(assessment) : null,
      inheritanceSourcesFor(control, organizationStatuses.get(control.id)),
    );
    return effective.status === "NOT_STARTED";
  });
}

/** The longest evidence / notes text kept in a removal's Change Event detail. */
export const REMOVED_ASSESSMENT_TEXT_LIMIT = 200;

function truncateForAudit(text: string) {
  return text.length > REMOVED_ASSESSMENT_TEXT_LIMIT ? `${text.slice(0, REMOVED_ASSESSMENT_TEXT_LIMIT)}…` : text;
}

/** "was In Progress", then the evidence and notes if there are any: the part of a Change Event detail that removal and reset share. */
function describeClearedAssessment(assessment: {
  status: ControlAssessmentStatus;
  evidence: string | null;
  notes: string | null;
}) {
  const parts = [`was ${CONTROL_ASSESSMENT_STATUS_LABEL[assessment.status]}`];
  if (assessment.evidence?.trim()) parts.push(`evidence: "${truncateForAudit(assessment.evidence)}"`);
  if (assessment.notes?.trim()) parts.push(`notes: "${truncateForAudit(assessment.notes)}"`);
  return parts;
}

/**
 * The Change Event detail for a removed stale Assessment (#109). The row is
 * deleted, so this is the only place its last status, evidence and notes
 * survive (long texts are truncated). `resolvedQueryCount` is the number of
 * resolved Assessment Queries that went with the row (their text isn't kept).
 */
export function describeRemovedAssessment(
  controlCode: string,
  assessment: { status: ControlAssessmentStatus; evidence: string | null; notes: string | null },
  resolvedQueryCount: number,
) {
  const parts = describeClearedAssessment(assessment);
  if (resolvedQueryCount > 0) {
    parts.push(`${resolvedQueryCount} resolved ${resolvedQueryCount === 1 ? "Query" : "Queries"} removed with it`);
  }
  return `Stale Assessment for ${controlCode} removed (${parts.join("; ")})`;
}

const SELF_ASSESSMENT_ANSWER_LABEL: Record<SelfAssessmentAnswer, string> = { YES: "Yes", NO: "No", NA: "N/A" };

/**
 * The Change Event detail for an Assessment reset to inherited (#129), e.g.
 * `Assessment for A.5.15 reset to inherited (was In Progress; evidence: "..."; notes: "...");
 * now Fulfilled, inherited from the Organization`. The row is kept but its
 * values are cleared, so this is where they survive (long texts are truncated;
 * the Self-Assessment answer is listed too). `now` is what the Control is
 * effectively once reset.
 */
export function describeResetAssessment(
  controlCode: string,
  assessment: {
    status: ControlAssessmentStatus;
    evidence: string | null;
    notes: string | null;
    selfAssessmentAnswer: SelfAssessmentAnswer | null;
  },
  now: Pick<EffectiveStatus, "status" | "source">,
) {
  const parts = describeClearedAssessment(assessment);
  if (assessment.selfAssessmentAnswer) {
    parts.push(`Self-Assessment answer: ${SELF_ASSESSMENT_ANSWER_LABEL[assessment.selfAssessmentAnswer]}`);
  }
  return `Assessment for ${controlCode} reset to inherited (${parts.join("; ")}); ${describeEffectiveStatusNow(now)}`;
}

export type RemoveStaleAssessmentResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

/**
 * Removes the stale ControlAssessment for `controlId` on `system` and records
 * the removal in a Change Event, in one transaction (#109). Authorisation is
 * the caller's job (`isSystemOwnerOrAdmin`). Refuses (nothing changes) when:
 * - there is no Assessment row (404);
 * - the Control still applies to the System, so the row is live, not stale (409);
 * - an Assessment Query on it is still open (409). The check is part of the
 *   delete itself, so a Query raised in the meantime can't be cascaded away.
 * Resolved Queries (and their messages) cascade with the row; only their count
 * goes into the Change Event.
 */
export async function removeStaleAssessment(
  system: SystemClassification & { id: string },
  controlId: string,
  actorId: string,
): Promise<RemoveStaleAssessmentResult> {
  const assessment = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    include: { control: true, queries: { select: { resolved: true } } },
  });
  if (!assessment) return { ok: false, status: 404, error: "Assessment not found" };

  if (await getApplicableControl(system, controlId)) {
    return { ok: false, status: 409, error: "This Control still applies; set its status instead" };
  }

  const openQueryError = {
    ok: false,
    status: 409,
    error: "This Assessment has an open question; resolve it before removing the Assessment",
  } as const;
  if (assessment.queries.some((query) => !query.resolved)) return openQueryError;

  return prisma.$transaction(async (tx): Promise<RemoveStaleAssessmentResult> => {
    const { count } = await tx.controlAssessment.deleteMany({
      where: { id: assessment.id, queries: { none: { resolved: false } } },
    });
    if (count === 0) return openQueryError;
    await logChangeEvent(
      system.id,
      "ASSESSMENT_REMOVED",
      describeRemovedAssessment(assessment.control.code, assessment, assessment.queries.length),
      actorId,
      tx,
    );
    return { ok: true };
  });
}

export type ResetAssessmentResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

/**
 * Returns the System's own person-set Assessment of `controlId` to untouched, so
 * the Control's effective status is again whatever its inheritance sources give
 * (#129, F-IN.5), and records what was cleared in a Change Event, in one
 * transaction. Authorisation is the caller's job (`isSystemOwnerOrAdmin`).
 * Refuses (nothing changes) when the Control doesn't exist (404), or when
 * `resetToInheritedRefusal` says so (409): the Control no longer applies, has no
 * inheritance source for this System, or the Assessment isn't person-set.
 *
 * The row is kept and only its own values are cleared: its Assessment Queries
 * and the Risks linked to it stay as they are, and an open Query doesn't block.
 * The sources are read inside the transaction under the Control's advisory lock,
 * the one `saveOrganizationImplementationWithEvents` takes, so a reset never
 * interleaves with a change of the Organization's status. The update itself is
 * conditional on the row still being person-set, so two resets can't both log.
 */
export async function resetAssessmentToInherited(
  system: SystemClassification & { id: string },
  controlId: string,
  actorId: string,
): Promise<ResetAssessmentResult> {
  const control = await prisma.control.findUnique({ where: { id: controlId } });
  if (!control) return { ok: false, status: 404, error: "Control not found" };
  const applies = (await getApplicableControl(system, controlId)) !== null;

  return prisma.$transaction(async (tx): Promise<ResetAssessmentResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${controlId}))`;
    const assessment = await tx.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId: system.id, controlId } },
    });
    const sources = inheritanceSourcesFor(control, (await loadOrganizationStatuses([controlId], tx)).get(controlId));
    const refusal = resetToInheritedRefusal({
      applies,
      sources,
      own: assessment ? toOwnAssessment(assessment) : null,
    });
    const refused = (reason: NonNullable<typeof refusal>) =>
      ({ ok: false, status: 409, error: resetToInheritedRefusalMessage(reason) }) as const;
    if (refusal) return refused(refusal);
    if (!assessment) return refused("NOT_PERSON_SET");

    const { count } = await tx.controlAssessment.updateMany({
      where: { id: assessment.id, assessedById: { not: null } },
      data: UNTOUCHED_ASSESSMENT_DATA,
    });
    if (count === 0) return refused("NOT_PERSON_SET");

    const now = resolveEffectiveStatus({ status: UNTOUCHED_ASSESSMENT_DATA.status, personSet: false }, sources);
    await logChangeEvent(
      system.id,
      "ASSESSMENT_STATUS_CHANGED",
      describeResetAssessment(control.code, assessment, now),
      actorId,
      tx,
    );
    return { ok: true };
  });
}
