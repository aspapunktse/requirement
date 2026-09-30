import type { ImpactLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApplicableControls, UNTOUCHED_ASSESSMENT_WHERE, type SystemClassification } from "@/lib/control-assessments";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { systemsInScopeOf } from "@/lib/framework-scope";

/**
 * Recompute of applicability when the requirement database changes under
 * Systems (PRD 0001 F-AP.3, F-FW.5, F-CL.7; ADR 0006/0007), as opposed to the
 * owner changing a System's own classification (`diffApplicabilityOps`'s
 * callers). Triggers: a Framework is published, a Control Mapping on a
 * Published Framework is added or removed (a Requirement delete is a removal),
 * a Control's scoping is edited.
 *
 * Unlike a classification change there is no old/new classification to diff, so
 * the recompute compares each affected System's *current Assessment rows* with
 * its freshly computed applicable set, restricted to the Controls the change
 * touched (`controlIds`):
 * - applicable and no row: a Not Started row is created;
 * - a row for a Control that no longer applies: removed if untouched (the same
 *   definition `diffApplicabilityOps` uses, UNTOUCHED_ASSESSMENT_WHERE), else
 *   kept in place as stale;
 * so it also heals a System an earlier failed recompute left behind.
 *
 * A changed System's Assessment changes and its `"system"`-actor
 * APPLICABILITY_RECOMPUTED Change Event commit in the same transaction (a batch
 * of up to WRITE_BATCH Systems shares one). Systems whose set didn't change get
 * no event and no write. Only Assessment rows
 * are written: `System.status`, `onboardedAt` and Approvals are never touched
 * (F-AP.4). As with every other recompute, Capability auto-fulfilment is not
 * re-run: a newly applicable Control starts Not Started.
 */

export type RecomputeScope = {
  /** Which Systems are affected. */
  systemsWhere: Prisma.SystemWhereInput;
  /** The Controls whose applicability the change may have moved. */
  controlIds: string[];
};

/** Per System: which of the scope's Controls applied at a moment in time. */
export type ApplicabilitySnapshot = Map<string, Set<string>>;

/** A recompute that has been prepared (optionally with a "before" snapshot) but not yet run. */
export type PendingRecompute = { scope: RecomputeScope; before?: ApplicabilitySnapshot };

export type RecomputeSummary = {
  /** Systems examined. */
  systems: number;
  /** Systems whose applicable set (or Assessment rows) changed; each got a Change Event. */
  changed: number;
  /** Not Started Assessments created, across all Systems. */
  added: number;
  /** Untouched Assessments removed, across all Systems. */
  removed: number;
  /** Touched Assessments kept in place because their Control stopped applying. */
  stale: number;
};

const CLASSIFICATION_SELECT = {
  id: true,
  confidentialityImpactLevel: true,
  integrityImpactLevel: true,
  availabilityImpactLevel: true,
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemSelect;

type ClassifiedSystem = SystemClassification & { id: string };

/** How many classification groups (or write batches) are worked on at once; the rest queue on Prisma's pool. */
const CONCURRENCY = 16;

/** Changed Systems written per transaction. */
const WRITE_BATCH = 50;

async function inChunks<T>(items: T[], work: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(work));
  }
}

/** Systems that share a classification share an applicable set, so it's computed once per distinct one. */
function classificationKey(s: ClassifiedSystem): string {
  const ids = (list: { id: string }[]) => list.map((x) => x.id).sort().join(",");
  const level = (l: ImpactLevel | null) => l ?? "-";
  return [
    ids(s.deploymentFacets),
    ids(s.frameworkScopes),
    level(s.confidentialityImpactLevel),
    level(s.integrityImpactLevel),
    level(s.availabilityImpactLevel),
  ].join("|");
}

/** Which of `controlIds` apply to each of `systems`, one applicability query per distinct classification. */
async function applicableAmong(systems: ClassifiedSystem[], controlIds: string[]): Promise<ApplicabilitySnapshot> {
  const result: ApplicabilitySnapshot = new Map();
  if (controlIds.length === 0) {
    for (const s of systems) result.set(s.id, new Set());
    return result;
  }
  const groups = new Map<string, ClassifiedSystem[]>();
  for (const s of systems) {
    const key = classificationKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  await inChunks([...groups.values()], async (members) => {
    const applicable = new Set((await getApplicableControls(members[0], { controlIds })).map((c) => c.id));
    for (const s of members) result.set(s.id, applicable);
  });
  return result;
}

/**
 * Capture which of the scope's Controls currently apply to each affected
 * System. Take it *before* the catalog change is written, so that afterwards
 * the recompute can tell a Control that just stopped applying (a touched
 * Assessment is then kept as stale) from one that was already stale.
 */
export async function snapshotApplicability(scope: RecomputeScope): Promise<ApplicabilitySnapshot> {
  const systems = await prisma.system.findMany({ where: scope.systemsWhere, select: CLASSIFICATION_SELECT });
  return applicableAmong(systems, scope.controlIds);
}

/**
 * Prepare a recompute: null when there's nothing to do (`scope` null, e.g. a
 * change on a Draft Framework), otherwise the scope plus, with `snapshot`, the
 * "before" applicability. Narrowing triggers (mapping removed, Control scoping
 * edited) pass `snapshot: true` and call this before writing the change.
 */
export async function prepareRecompute(
  scope: RecomputeScope | null,
  options: { snapshot: boolean },
): Promise<PendingRecompute | null> {
  if (!scope || scope.controlIds.length === 0) return null;
  return { scope, before: options.snapshot ? await snapshotApplicability(scope) : undefined };
}

/**
 * Run a prepared recompute, after the catalog change is committed. `trigger`
 * names what changed, e.g. `Framework "X" published`; it lands in the detail of
 * each System's Change Event. A no-op (returns null) for a null `pending`.
 */
export async function finishRecompute(
  pending: PendingRecompute | null,
  trigger: string,
): Promise<RecomputeSummary | null> {
  if (!pending) return null;
  const { scope, before } = pending;
  const summary: RecomputeSummary = { systems: 0, changed: 0, added: 0, removed: 0, stale: 0 };

  const systems = await prisma.system.findMany({ where: scope.systemsWhere, select: CLASSIFICATION_SELECT });
  summary.systems = systems.length;
  if (systems.length === 0) return summary;

  const [applicable, rows] = await Promise.all([
    applicableAmong(systems, scope.controlIds),
    prisma.controlAssessment.findMany({
      where: { systemId: { in: systems.map((s) => s.id) }, controlId: { in: scope.controlIds } },
      select: { systemId: true, controlId: true, status: true, assessedById: true },
    }),
  ]);
  const rowsBySystem = new Map<string, typeof rows>();
  for (const row of rows) rowsBySystem.set(row.systemId, [...(rowsBySystem.get(row.systemId) ?? []), row]);

  // Plan every System first (pure, in memory), then write the ones that changed.
  const plans: SystemPlan[] = [];
  for (const system of systems) {
    const now = applicable.get(system.id) ?? new Set<string>();
    const was = before?.get(system.id);
    const systemRows = rowsBySystem.get(system.id) ?? [];
    const rowControlIds = new Set(systemRows.map((r) => r.controlId));

    const toCreate = [...now].filter((controlId) => !rowControlIds.has(controlId));
    const notApplicableRows = systemRows.filter((r) => !now.has(r.controlId));
    const untouched = (r: (typeof systemRows)[number]) =>
      r.status === UNTOUCHED_ASSESSMENT_WHERE.status && r.assessedById === UNTOUCHED_ASSESSMENT_WHERE.assessedById;
    const toDelete = notApplicableRows.filter(untouched).map((r) => r.controlId);
    // Touched rows kept in place: with a snapshot, only those whose Control *just* stopped applying.
    const stale = notApplicableRows.filter((r) => !untouched(r) && (was ? was.has(r.controlId) : true)).length;
    const setChanged = was ? [...now].some((c) => !was.has(c)) || [...was].some((c) => !now.has(c)) : false;

    if (toCreate.length > 0 || toDelete.length > 0 || setChanged) {
      plans.push({ systemId: system.id, toCreate, toDelete, stale });
    }
  }

  // Written in batches of WRITE_BATCH Systems, one transaction per batch: a System's deletes, creates
  // and Change Event always commit together, and batching is measurably faster than one transaction
  // per System (about 1.5x on a 500-System benchmark, see #87).
  // The counts in each event are the planned ones: the delete is guarded on "still untouched" and the
  // create on skipDuplicates, so a concurrent edit can only make them a little high.
  const batches: SystemPlan[][] = [];
  for (let i = 0; i < plans.length; i += WRITE_BATCH) batches.push(plans.slice(i, i + WRITE_BATCH));
  await inChunks(batches, async (batch) => {
    const deletes = batch.filter((p) => p.toDelete.length > 0);
    const creates = batch.flatMap((p) => p.toCreate.map((controlId) => ({ systemId: p.systemId, controlId })));
    await prisma.$transaction([
      ...(deletes.length > 0
        ? [
            prisma.controlAssessment.deleteMany({
              where: {
                OR: deletes.map((p) => ({ systemId: p.systemId, controlId: { in: p.toDelete } })),
                ...UNTOUCHED_ASSESSMENT_WHERE,
              },
            }),
          ]
        : []),
      ...(creates.length > 0
        ? [prisma.controlAssessment.createMany({ data: creates, skipDuplicates: true })]
        : []),
      prisma.changeEvent.createMany({
        data: batch.map((p) => ({
          systemId: p.systemId,
          action: "APPLICABILITY_RECOMPUTED" as const,
          detail:
            `Applicability recomputed, ${trigger} (+${p.toCreate.length}/-${p.toDelete.length} Control Assessment(s)` +
            `${p.stale > 0 ? `, ${p.stale} kept as stale` : ""})`,
          actorId: SYSTEM_ACTOR,
        })),
      }),
    ]);
  });
  for (const p of plans) {
    summary.changed += 1;
    summary.added += p.toCreate.length;
    summary.removed += p.toDelete.length;
    summary.stale += p.stale;
  }

  return summary;
}

type SystemPlan = { systemId: string; toCreate: string[]; toDelete: string[]; stale: number };

// --- Scope builders: which Systems and Controls does each trigger affect? ---

/**
 * Scope for a Framework being published: the Controls mapped to any of its
 * Requirements, on the Systems that have it in scope. Null for a Draft
 * Framework (a Draft is inert, F-FW.5 / ADR 0007) and for one with no mapped Controls.
 */
export async function scopeForFramework(framework: {
  id: string;
  isBase: boolean;
  status: "DRAFT" | "PUBLISHED";
}): Promise<RecomputeScope | null> {
  if (framework.status !== "PUBLISHED") return null;
  const controls = await prisma.control.findMany({
    where: { mappings: { some: { requirement: { frameworkId: framework.id } } } },
    select: { id: true },
  });
  if (controls.length === 0) return null;
  return { systemsWhere: systemsInScopeOf(framework), controlIds: controls.map((c) => c.id) };
}

/**
 * Scope for Control Mappings being added to or removed from a Framework's
 * Requirements: those Controls, on the Systems that have the Framework in
 * scope. Null when the Framework is a Draft, since a Draft's mappings are inert
 * until it's published. A Coverage change (Full <-> Partial) isn't a trigger:
 * the gate is "mapped at any Coverage".
 */
export function scopeForMappedControls(
  framework: { id: string; isBase: boolean; status: "DRAFT" | "PUBLISHED" },
  controlIds: string[],
): RecomputeScope | null {
  if (framework.status !== "PUBLISHED" || controlIds.length === 0) return null;
  return { systemsWhere: systemsInScopeOf(framework), controlIds };
}

/**
 * Scope for editing a Control's own scoping: that Control, on every System that
 * has in scope some Published Framework the Control is mapped to (every System
 * if that includes the base Framework). Null when the Control is mapped to no
 * Published Framework, since then it applies to nothing whatever its scoping.
 */
export async function scopeForControl(controlId: string): Promise<RecomputeScope | null> {
  const frameworks = await prisma.framework.findMany({
    where: { status: "PUBLISHED", requirements: { some: { mappings: { some: { controlId } } } } },
    select: { id: true, isBase: true },
  });
  if (frameworks.length === 0) return null;
  const systemsWhere: Prisma.SystemWhereInput = frameworks.some((f) => f.isBase)
    ? {}
    : { frameworkScopes: { some: { id: { in: frameworks.map((f) => f.id) } } } };
  return { systemsWhere, controlIds: [controlId] };
}
