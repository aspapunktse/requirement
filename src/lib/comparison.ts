import { Prisma, type UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { classificationDifferences, orderCandidates } from "@/lib/comparison-score";
import { loadComparisonScores } from "@/lib/comparison-score-data";
import { readLiveMarkingsByFramework } from "@/lib/first-round";
import { readStagedEvaluationEnabled } from "@/lib/app-settings";
import { listOwnerCandidates } from "@/lib/system-owner";
import { FULL_VISIBILITY_ROLES, visibleSystemsWhere } from "@/lib/system-visibility";
import { canBeSystemOwner, canCreateSystem, isSystemOwnerOrAdmin, NEW_OWNER_REFUSAL } from "@/lib/system-permissions";

/**
 * A Comparison (#372; CONTEXT.md "Evaluation"; docs/how-it-works/comparison.md): its model rules and API logic. The routes
 * under `api/comparisons` resolve the acting user and call these. Terms: Comparison, Candidate (a System in a Comparison),
 * Comparison Score (`comparison-score.ts`). The outcome (Selected / Not selected) is a later issue.
 *
 * - Create: a role that may create a System (`canCreateSystem`); the creator is the owner.
 * - Rename, edit the need, name and remove participants, delete: the owner or an Admin (`isSystemOwnerOrAdmin`, so a
 *   read-only System role is never an owner in effect). Only an Admin changes the owner, to a System-creating role.
 * - Add a Candidate: the owner adds a System they can see (`visibleSystemsWhere`), a participant a System they own, an
 *   Admin any. Refused (409) when the System is not staged, is closed, is already a Candidate or the Comparison has
 *   five. Remove: the owner, an Admin, or the System's owner for their own System.
 * - Who sees a Comparison: see `comparisonsVisibleWhere`. A hidden one is 404.
 * - A reader gets only the limited summary of a Candidate (`CandidateSummary`), built field by field; being a Candidate,
 *   owner or participant gives no right on a System and never widens `visibleSystemsWhere`.
 * - Adding and removing a Candidate write one Change Event on that System in the same transaction. Every way of adding
 *   (one System, several from the Systems list, a new Comparison with Candidates, a new System from the onboarding interview)
 *   runs `planCandidates`, so the rules can't drift; adding several is all or nothing.
 *
 * Deleting a System removes its Candidate rows (database cascade); the Comparison just loses that Candidate. A User who
 * owns a Comparison can't be deleted (Restrict) until it is handed over or deleted; a participant row goes with its User;
 * the "added by" of a Candidate is cleared.
 */

/** A Comparison holds at most this many Candidates (two to five; fewer is allowed while it is being put together). */
export const MAX_CANDIDATES = 5;

export const NOT_STAGED_REFUSAL = "Only a staged System can be a Candidate";
export const CLOSED_REFUSAL = "A closed System can't be added to a Comparison";
export const DUPLICATE_REFUSAL = "This System is already a Candidate in this Comparison";
export const FULL_REFUSAL = `A Comparison holds at most ${MAX_CANDIDATES} Candidates`;
export const STAGING_OFF_REFUSAL = "Staged evaluation for new Systems is off, so a new System would not be staged and can't be a Candidate. An Admin can switch it on in Settings.";

type Actor = { id: string; role: UserRole };
type Tx = Prisma.TransactionClient;

export const comparisonNameSchema = z.string().trim().min(1, "A name is required").max(200);
export const comparisonNeedSchema = z
  .string()
  .trim()
  .max(5000)
  .transform((value) => (value === "" ? null : value));

/** The Comparisons `user` sees: its owner, its participants, the owner and Business System Owner of any Candidate, and the roles that see every System. */
export function comparisonsVisibleWhere(user: Actor): Prisma.ComparisonWhereInput {
  if (FULL_VISIBILITY_ROLES.includes(user.role)) return {};
  return {
    OR: [
      { ownerId: user.id },
      { participants: { some: { userId: user.id } } },
      { candidates: { some: { system: { OR: [{ ownerId: user.id }, { businessSystemOwnerId: user.id }] } } } },
    ],
  };
}

/** Why one System in a bulk add can't be added (the whole add is then refused, and nothing is written). */
export type CandidateFailure = { systemId: string; error: string };

type Refusal = { ok: false; status: 400 | 403 | 404 | 409; error: string; failures?: CandidateFailure[] };
export type ComparisonResult<T = object> = ({ ok: true } & T) | Refusal;

class Abort extends Error {
  constructor(readonly result: Refusal) {
    super(result.error);
  }
}
const refuse = (status: 400 | 403 | 404 | 409, error: string) => new Abort({ ok: false, status, error });
const NOT_FOUND = "Comparison not found";

async function run<T>(work: (tx: Tx) => Promise<T>): Promise<ComparisonResult<{ value: T }>> {
  try {
    return { ok: true, value: await prisma.$transaction(work) };
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

/** Locks the Comparison row for the rest of the transaction (so the Candidate count and a delete can't race); false when it doesn't exist. */
async function lockComparison(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Comparison" WHERE "id" = ${id} FOR UPDATE`;
  return rows.length === 1;
}

/** The Comparison `actor` sees, locked, or a 404 abort (a Comparison they can't see is not found). */
async function loadVisibleLocked(tx: Tx, actor: Actor, id: string) {
  if (!(await lockComparison(tx, id))) throw refuse(404, NOT_FOUND);
  const comparison = await tx.comparison.findFirst({
    where: { AND: [{ id }, comparisonsVisibleWhere(actor)] },
    select: { id: true, name: true, ownerId: true, participants: { select: { userId: true } } },
  });
  if (!comparison) throw refuse(404, NOT_FOUND);
  return comparison;
}

const canManage = (actor: Actor, comparison: { ownerId: string }) => isSystemOwnerOrAdmin(actor, comparison);
const isParticipant = (actor: { id: string }, comparison: { participants: { userId: string }[] }) =>
  comparison.participants.some((participant) => participant.userId === actor.id);

// ---------------------------------------------------------------------------------------------------------------------
// Reads

export type ComparisonListItem = {
  id: string;
  name: string;
  need: string | null;
  owner: { id: string; name: string };
  candidateCount: number;
  participantCount: number;
  /**
   * Closed by a recorded outcome. A Comparison has no outcome yet (that is a later issue, #375), so this is always false; the
   * pages already show an Open and a Closed section.
   */
  closed: boolean;
  canManage: boolean;
  /** `actor` may add a Candidate to it now (the owner, an Admin or a participant, while it is open and has room): for "Add to Comparison". */
  canAddCandidate: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** The Comparisons `actor` sees, newest first (one snapshot). */
export async function listComparisons(actor: Actor): Promise<ComparisonListItem[]> {
  const rows = await prisma.$transaction(
    (tx) =>
      tx.comparison.findMany({
        where: comparisonsVisibleWhere(actor),
        select: {
          id: true,
          name: true,
          need: true,
          ownerId: true,
          owner: { select: { id: true, name: true } },
          createdAt: true,
          updatedAt: true,
          participants: { where: { userId: actor.id }, select: { userId: true } },
          _count: { select: { candidates: true, participants: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
    { isolationLevel: "RepeatableRead" },
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    need: row.need,
    owner: row.owner,
    candidateCount: row._count.candidates,
    participantCount: row._count.participants,
    closed: false,
    canManage: canManage(actor, row),
    canAddCandidate: (canManage(actor, row) || row.participants.length > 0) && row._count.candidates < MAX_CANDIDATES,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * What a reader gets about one Candidate, whether or not they can open it as a System: name, vendor, owner,
 * classification, Comparison Score, counts and the status per first-round Control, Open Risk counts by severity, and
 * `canOpen`. Built field by field; never evidence, notes, Risk details or any other System field.
 */
export type CandidateSummary = {
  systemId: string;
  name: string;
  vendor: string | null;
  owner: { id: string; name: string };
  /** Whether the reader can open the System (`visibleSystemsWhere`). Being in the Comparison doesn't change that. */
  canOpen: boolean;
  /** The System's current evaluation stage (`EvaluationStage`); null when it is no longer staged. */
  stage: string | null;
  /** True when the System was rejected at a gate while in the Comparison (status REJECTED); its stage then no longer says where it is. */
  rejected: boolean;
  addedAt: Date;
  addedBy: { id: string; name: string } | null;
  classification: {
    deploymentFacets: { id: string; name: string }[];
    sensitivityLevel: number | null;
    integrityImpactLevel: string | null;
    availabilityImpactLevel: string | null;
    frameworkScope: { id: string; name: string }[];
  };
  score: {
    score: number | null;
    firstRoundCount: number;
    countedCount: number;
    fulfilledCount: number;
    answeredCount: number;
    complete: boolean;
    mandatoryNotFulfilledCount: number;
    controls: { controlId: string; code: string; title: string; mandatory: boolean; status: string }[];
  };
  openRisks: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
};

const byControlCode = (a: { code: string; controlId: string }, b: { code: string; controlId: string }) =>
  a.code.localeCompare(b.code, "en", { numeric: true }) || (a.controlId < b.controlId ? -1 : 1);

export type ComparisonView = {
  id: string;
  name: string;
  need: string | null;
  owner: { id: string; name: string };
  participants: { id: string; name: string }[];
  /** Complete ones first, highest score first (`orderCandidates`). */
  candidates: CandidateSummary[];
  /** Which parts of the classification differ between the Candidates (`classificationDifferences`). */
  classificationDifferences: string[];
  /**
   * The first-round Controls of any Candidate for the Control-by-Control table, grouped by Framework: a Control sits under the
   * first Framework (the base Framework first, then by name) in a Candidate's scope whose owner marked it first round.
   * Groups follow that order; a Control with no live marking (not expected) is listed under a group with `framework: null`.
   * Controls within a group are in code order. Each Candidate's `score.controls` holds its own status per Control.
   */
  controlGroups: { framework: { id: string; name: string } | null; controls: { controlId: string; code: string; title: string; mandatory: boolean }[] }[];
  closed: boolean;
  canManage: boolean;
  /** The reader may add some System as a Candidate (the owner, an Admin, a participant), while there is room. */
  canAddCandidate: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One Comparison as `actor` sees it, or null when it doesn't exist or they can't see it. Every read is in one
 * RepeatableRead transaction on `tx`, the Comparison Score loader included.
 */
export async function readComparison(actor: Actor, id: string): Promise<ComparisonView | null> {
  return prisma.$transaction(
    async (tx) => {
      const comparison = await tx.comparison.findFirst({
        where: { AND: [{ id }, comparisonsVisibleWhere(actor)] },
        select: {
          id: true,
          name: true,
          need: true,
          ownerId: true,
          owner: { select: { id: true, name: true } },
          createdAt: true,
          updatedAt: true,
          participants: { select: { user: { select: { id: true, name: true } } }, orderBy: [{ addedAt: "asc" }, { userId: "asc" }] },
          candidates: {
            select: {
              systemId: true,
              addedAt: true,
              addedBy: { select: { id: true, name: true } },
              system: { select: { vendor: true, evaluationStage: true, status: true, owner: { select: { id: true, name: true } } } },
            },
            orderBy: [{ addedAt: "asc" }, { systemId: "asc" }],
          },
        },
      });
      if (!comparison) return null;

      const systemIds = comparison.candidates.map((candidate) => candidate.systemId);
      const figures = await loadComparisonScores(systemIds, tx);
      const openable =
        systemIds.length === 0
          ? []
          : await tx.system.findMany({ where: { AND: [{ id: { in: systemIds } }, await visibleSystemsWhere(actor, tx)] }, select: { id: true } });
      const openableIds = new Set(openable.map((system) => system.id));

      const facetIds = new Set<string>();
      const frameworkIds = new Set<string>();
      for (const figure of figures.values()) {
        figure.classification.deploymentFacetIds.forEach((facetId) => facetIds.add(facetId));
        figure.classification.frameworkScopeIds.forEach((frameworkId) => frameworkIds.add(frameworkId));
      }
      const facets = facetIds.size === 0 ? [] : await tx.deploymentFacet.findMany({ where: { id: { in: [...facetIds] } }, select: { id: true, name: true } });
      const frameworks = frameworkIds.size === 0 ? [] : await tx.framework.findMany({ where: { id: { in: [...frameworkIds] } }, select: { id: true, name: true, isBase: true } });
      const facetName = new Map(facets.map((facet) => [facet.id, facet.name]));
      const frameworkName = new Map(frameworks.map((framework) => [framework.id, framework.name]));
      const named = (ids: readonly string[], names: Map<string, string>) =>
        ids.flatMap((entryId) => (names.has(entryId) ? [{ id: entryId, name: names.get(entryId)! }] : [])).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

      const summaries: CandidateSummary[] = [];
      for (const candidate of comparison.candidates) {
        const figure = figures.get(candidate.systemId);
        if (!figure) continue; // The System was deleted after the Comparison was read: the snapshot makes this unreachable, kept as a guard.
        summaries.push({
          systemId: candidate.systemId,
          name: figure.name,
          vendor: candidate.system.vendor,
          owner: candidate.system.owner,
          canOpen: openableIds.has(candidate.systemId),
          stage: candidate.system.evaluationStage,
          rejected: candidate.system.status === "REJECTED",
          addedAt: candidate.addedAt,
          addedBy: candidate.addedBy,
          classification: {
            deploymentFacets: named(figure.classification.deploymentFacetIds, facetName),
            sensitivityLevel: figure.classification.sensitivityLevel,
            integrityImpactLevel: figure.classification.integrityImpactLevel,
            availabilityImpactLevel: figure.classification.availabilityImpactLevel,
            frameworkScope: named(figure.classification.frameworkScopeIds, frameworkName),
          },
          score: {
            score: figure.score,
            firstRoundCount: figure.firstRoundCount,
            countedCount: figure.countedCount,
            fulfilledCount: figure.fulfilledCount,
            answeredCount: figure.answeredCount,
            complete: figure.complete,
            mandatoryNotFulfilledCount: figure.mandatoryNotFulfilledCount,
            controls: figure.controls.map((control) => ({
              controlId: control.controlId,
              code: control.code,
              title: control.title,
              mandatory: control.mandatory,
              status: control.status,
            })),
          },
          openRisks: { ...figure.openRisks },
        });
      }
      const ordered = orderCandidates(
        summaries.map((summary) => ({ ...summary, ...summary.score })),
      ).map((entry) => summaries.find((summary) => summary.systemId === entry.systemId)!);

      // The Control-by-Control table's rows, grouped by the Framework whose owner marked each Control first round.
      const controlsById = new Map<string, { controlId: string; code: string; title: string; mandatory: boolean }>();
      for (const summary of summaries) {
        for (const control of summary.score.controls) {
          controlsById.set(control.controlId, { controlId: control.controlId, code: control.code, title: control.title, mandatory: control.mandatory });
        }
      }
      const markings = controlsById.size === 0 || frameworkIds.size === 0 ? new Map<string, Set<string>>() : await readLiveMarkingsByFramework(tx, [...frameworkIds], [...controlsById.keys()]);
      const orderedFrameworks = [...frameworks].sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.name.localeCompare(b.name, "en", { numeric: true }) || (a.id < b.id ? -1 : 1));
      const grouped = new Set<string>();
      const controlGroups: ComparisonView["controlGroups"] = [];
      for (const framework of orderedFrameworks) {
        const marked = markings.get(framework.id);
        const entries = [...controlsById.values()].filter((control) => marked?.has(control.controlId) && !grouped.has(control.controlId));
        entries.forEach((control) => grouped.add(control.controlId));
        if (entries.length > 0) controlGroups.push({ framework: { id: framework.id, name: framework.name }, controls: entries.sort(byControlCode) });
      }
      const ungrouped = [...controlsById.values()].filter((control) => !grouped.has(control.controlId));
      if (ungrouped.length > 0) controlGroups.push({ framework: null, controls: ungrouped.sort(byControlCode) });

      const manager = canManage(actor, comparison);
      const participant = comparison.participants.some((entry) => entry.user.id === actor.id);
      return {
        id: comparison.id,
        name: comparison.name,
        need: comparison.need,
        owner: comparison.owner,
        participants: comparison.participants.map((entry) => entry.user),
        candidates: ordered,
        classificationDifferences: classificationDifferences(
          ordered.map((candidate) => {
            const figure = figures.get(candidate.systemId)!;
            return figure.classification;
          }),
        ),
        controlGroups,
        closed: false,
        canManage: manager,
        canAddCandidate: (manager || participant) && ordered.length < MAX_CANDIDATES,
        createdAt: comparison.createdAt,
        updatedAt: comparison.updatedAt,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes. Each refusal throws an Abort inside the transaction, so nothing is written; every query is on `tx`.

export type ComparisonBase = { id: string; name: string; need: string | null; ownerId: string; createdAt: Date; updatedAt: Date };

/** Creates a Comparison owned by `actor`. The caller has checked `canCreateSystem`. */
export async function createComparison(actor: Actor, input: { name: string; need: string | null }) {
  return prisma.comparison.create({ data: { name: input.name, need: input.need, ownerId: actor.id } });
}

export type ComparisonUpdate = { name?: string; need?: string | null; ownerId?: string };

/** Renames, edits the need, or (an Admin only) hands the Comparison to another owner who has a System-creating role. */
export function updateComparison(actor: Actor, id: string, update: ComparisonUpdate) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    if (!canManage(actor, comparison)) throw refuse(403, "Only the Comparison's owner or an Admin can change it");
    const handsOver = update.ownerId !== undefined && update.ownerId !== comparison.ownerId;
    if (handsOver && actor.role !== "ADMIN") throw refuse(403, "Only an Admin can change a Comparison's owner");
    if (handsOver) {
      const next = await tx.user.findUnique({ where: { id: update.ownerId }, select: { id: true, role: true } });
      if (!next) throw refuse(400, "The new owner doesn't exist");
      if (!canBeSystemOwner(next)) throw refuse(400, NEW_OWNER_REFUSAL);
      // The new owner no longer needs to be named a participant.
      await tx.comparisonParticipant.deleteMany({ where: { comparisonId: id, userId: next.id } });
    }
    return tx.comparison.update({
      where: { id },
      data: {
        ...(update.name !== undefined ? { name: update.name } : {}),
        ...(update.need !== undefined ? { need: update.need } : {}),
        ...(handsOver ? { ownerId: update.ownerId } : {}),
      },
    });
  });
}

/** Deletes the Comparison and, by cascade, its Candidate and participant rows. The Systems are untouched. */
export function deleteComparison(actor: Actor, id: string) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    if (!canManage(actor, comparison)) throw refuse(403, "Only the Comparison's owner or an Admin can delete it");
    await tx.comparison.delete({ where: { id } });
    return { id };
  });
}

type LoadedComparison = { id: string; name: string; ownerId: string; participants: { userId: string }[] };

/**
 * The one place the rules for adding a System as a Candidate live (see the top of the file); the single add, the bulk add, creating
 * a Comparison with Candidates and creating a System into a Comparison all go through it. Checks `systemIds` (in order, each once)
 * for `actor` and writes nothing: the Systems that can be added, and a failure with its reason for each that can't. Every query is on `tx`.
 * An access failure (403, 404) never names the System, so a hidden one is not revealed.
 */
async function planCandidates(tx: Tx, actor: Actor, comparison: LoadedComparison, systemIds: string[]) {
  const manager = canManage(actor, comparison);
  if (!manager && !isParticipant(actor, comparison)) throw refuse(403, "Only the Comparison's owner, a participant or an Admin can add a Candidate");

  const ids = [...new Set(systemIds)];
  const systems = await tx.system.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true, evaluationStage: true, evaluationClosedAt: true } });
  const found = new Map(systems.map((system) => [system.id, system]));
  const visible =
    actor.role !== "ADMIN" && manager && systems.length > 0
      ? new Set((await tx.system.findMany({ where: { AND: [{ id: { in: ids } }, await visibleSystemsWhere(actor, tx)] }, select: { id: true } })).map((system) => system.id))
      : null;
  const existing = new Set((await tx.comparisonCandidate.findMany({ where: { comparisonId: comparison.id }, select: { systemId: true } })).map((row) => row.systemId));

  const add: { id: string }[] = [];
  const failures: { systemId: string; status: 403 | 404 | 409; error: string }[] = [];
  for (const systemId of ids) {
    const system = found.get(systemId);
    const fail = (status: 403 | 404 | 409, error: string) => failures.push({ systemId, status, error });
    if (actor.role === "ADMIN") {
      if (!system) fail(404, "System not found");
    } else if (manager) {
      // The owner adds a System they can see; one they can't is not found, as everywhere.
      if (!system || !visible?.has(systemId)) fail(404, "System not found");
    } else if (!system || !isSystemOwnerOrAdmin(actor, system)) {
      fail(403, "A participant can add only a System they own");
    }
    if (failures.at(-1)?.systemId === systemId) continue;
    if (system!.evaluationStage === null) fail(409, NOT_STAGED_REFUSAL);
    else if (system!.evaluationClosedAt) fail(409, CLOSED_REFUSAL);
    else if (existing.has(systemId)) fail(409, DUPLICATE_REFUSAL);
    else if (existing.size + add.length >= MAX_CANDIDATES) fail(409, FULL_REFUSAL);
    else add.push({ id: systemId });
  }
  return { add, failures };
}

/** Writes the Candidates `planCandidates` accepted, each with one Change Event on its System, in the caller's transaction. */
async function writeCandidates(tx: Tx, actor: Actor, comparison: LoadedComparison, add: { id: string }[]) {
  const rows = [];
  for (const { id: systemId } of add) {
    rows.push(await tx.comparisonCandidate.create({ data: { comparisonId: comparison.id, systemId, addedById: actor.id } }));
    await logChangeEvent(systemId, "COMPARISON_CANDIDATE_ADDED", `Added as a Candidate to the Comparison "${comparison.name}"`, actor.id, tx);
  }
  return rows;
}

/** All or nothing: adds every System of `systemIds`, or throws an Abort (`single`: the one System's own refusal; several: 409 with the reason for each that can't). */
async function addAll(tx: Tx, actor: Actor, comparison: LoadedComparison, systemIds: string[], single = false) {
  const { add, failures } = await planCandidates(tx, actor, comparison, systemIds);
  if (single && failures.length === 1) throw refuse(failures[0].status, failures[0].error);
  if (failures.length > 0) {
    throw new Abort({
      ok: false,
      status: 409,
      error: failures.length === 1 ? "One System can't be added, so none was added" : `${failures.length} Systems can't be added, so none was added`,
      failures: failures.map(({ systemId, error }) => ({ systemId, error })),
    });
  }
  return writeCandidates(tx, actor, comparison, add);
}

/** Adds `systemId` as a Candidate, with one Change Event on the System. See the rules at the top of the file. */
export function addCandidate(actor: Actor, id: string, systemId: string) {
  return run(async (tx) => (await addAll(tx, actor, await loadVisibleLocked(tx, actor, id), [systemId], true))[0]);
}

/**
 * Adds every System of `systemIds` as a Candidate, or none: when any can't be added the answer is 409 with the reason for each
 * (`failures`) and nothing is written. The bulk "Add to Comparison" of the Systems list. Same rules as `addCandidate`.
 */
export function addCandidates(actor: Actor, id: string, systemIds: string[]) {
  return run(async (tx) => addAll(tx, actor, await loadVisibleLocked(tx, actor, id), systemIds));
}

/**
 * Creates a Comparison owned by `actor` with `systemIds` already its Candidates, in one transaction: when any can't be added, no
 * Comparison is created (409 with the reasons). The caller has checked `canCreateSystem`.
 */
export function createComparisonWithCandidates(actor: Actor, input: { name: string; need: string | null }, systemIds: string[]) {
  return run(async (tx) => {
    const comparison = await tx.comparison.create({ data: { name: input.name, need: input.need, ownerId: actor.id } });
    await addAll(tx, actor, { id: comparison.id, name: comparison.name, ownerId: actor.id, participants: [] }, systemIds);
    return comparison;
  });
}

/**
 * Makes `systemId` a Candidate inside the caller's transaction `tx` (the onboarding interview creates a System and its Candidate
 * together): the same rules and Change Event as `addCandidate`. A refusal is returned, not thrown; the caller rolls back.
 */
export async function addCandidateIn(tx: Tx, actor: Actor, id: string, systemId: string): Promise<ComparisonResult> {
  try {
    await addAll(tx, actor, await loadVisibleLocked(tx, actor, id), [systemId], true);
    return { ok: true };
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

export type AddableSystem = {
  id: string;
  name: string;
  vendor: string | null;
  owner: { id: string; name: string };
  stage: string | null;
  /** Why it can't be added (not staged, closed, already a Candidate); null when it can. */
  reason: string | null;
};

/**
 * The Systems `actor` may pick for the Add Candidate picker of a Comparison, each with the reason it can't be added now (or null):
 * the owner's Systems they can see, a participant's own, an Admin's all. 404 when the Comparison is hidden, 403 when `actor` may not
 * add (neither owner, participant nor Admin). Also whether a new System can be created into it: `stagedEvaluation` (the App
 * Setting) and `canCreateSystem`. One snapshot.
 */
export async function listAddableSystems(
  actor: Actor,
  id: string,
): Promise<ComparisonResult<{ systems: AddableSystem[]; full: boolean; stagedEvaluation: boolean; canCreateSystem: boolean }>> {
  return prisma.$transaction(
    async (tx) => {
      const comparison = await tx.comparison.findFirst({
        where: { AND: [{ id }, comparisonsVisibleWhere(actor)] },
        select: { id: true, ownerId: true, participants: { select: { userId: true } }, candidates: { select: { systemId: true } } },
      });
      if (!comparison) return { ok: false as const, status: 404 as const, error: NOT_FOUND };
      const manager = canManage(actor, comparison);
      if (!manager && !isParticipant(actor, comparison)) return { ok: false as const, status: 403 as const, error: "Only the Comparison's owner, a participant or an Admin can add a Candidate" };
      const scope: Prisma.SystemWhereInput = actor.role === "ADMIN" ? {} : manager ? await visibleSystemsWhere(actor, tx) : { ownerId: actor.id };
      const rows = await tx.system.findMany({
        where: scope,
        select: { id: true, name: true, vendor: true, evaluationStage: true, evaluationClosedAt: true, owner: { select: { id: true, name: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      const taken = new Set(comparison.candidates.map((candidate) => candidate.systemId));
      const listed = rows.map((row) => ({
        id: row.id,
        name: row.name,
        vendor: row.vendor,
        owner: row.owner,
        stage: row.evaluationStage,
        reason: row.evaluationStage === null ? NOT_STAGED_REFUSAL : row.evaluationClosedAt ? CLOSED_REFUSAL : taken.has(row.id) ? DUPLICATE_REFUSAL : null,
      }));
      // The Systems that can be added come first, the ones that can't (with their reasons) after; each group by name.
      const systems = [...listed.filter((system) => system.reason === null), ...listed.filter((system) => system.reason !== null)];
      return { ok: true as const, systems, full: taken.size >= MAX_CANDIDATES, stagedEvaluation: await readStagedEvaluationEnabled(tx), canCreateSystem: canCreateSystem(actor) };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** What the onboarding interview needs to start for a Comparison: its name, the Candidates `actor` can see as Systems (for "Start from"), or the reason a new System can't be created into it. */
export type InterviewContext = { comparison: { id: string; name: string }; candidates: { systemId: string; name: string }[] };

export async function readInterviewContext(actor: Actor, id: string): Promise<ComparisonResult<InterviewContext>> {
  return prisma.$transaction(
    async (tx) => {
      const comparison = await tx.comparison.findFirst({
        where: { AND: [{ id }, comparisonsVisibleWhere(actor)] },
        select: { id: true, name: true, ownerId: true, participants: { select: { userId: true } }, candidates: { select: { systemId: true } } },
      });
      if (!comparison) return { ok: false as const, status: 404 as const, error: NOT_FOUND };
      if (!canManage(actor, comparison) && !isParticipant(actor, comparison)) {
        return { ok: false as const, status: 403 as const, error: "Only the Comparison's owner, a participant or an Admin can add a Candidate" };
      }
      if (!(await readStagedEvaluationEnabled(tx))) return { ok: false as const, status: 409 as const, error: STAGING_OFF_REFUSAL };
      if (comparison.candidates.length >= MAX_CANDIDATES) return { ok: false as const, status: 409 as const, error: FULL_REFUSAL };
      // Only the Candidates `actor` can open as Systems are offered: the rest stay hidden, as everywhere.
      const ids = comparison.candidates.map((candidate) => candidate.systemId);
      const visible =
        ids.length === 0 ? [] : await tx.system.findMany({ where: { AND: [{ id: { in: ids } }, await visibleSystemsWhere(actor, tx)] }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
      return { ok: true as const, comparison: { id: comparison.id, name: comparison.name }, candidates: visible.map((system) => ({ systemId: system.id, name: system.name })) };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** The classification a new System can start from (the Candidate's Deployment Facets, Information Types, levels and Framework Scope, by id; nothing else). */
export type CandidateClassification = {
  deploymentFacetIds: string[];
  informationTypeIds: string[];
  sensitivityLevel: number | null;
  integrityImpactLevel: string | null;
  availabilityImpactLevel: string | null;
  frameworkScopeIds: string[];
};

/**
 * The classification of Candidate `systemId` of Comparison `id`, for "Start from <Candidate>'s classification". Only a Candidate
 * `actor` can open as a System (`visibleSystemsWhere`) is readable, so this can't be used to read another owner's Information
 * Types: anything else is 404, as is a Comparison `actor` can't see, or a System that is not its Candidate.
 */
export async function readCandidateClassification(actor: Actor, id: string, systemId: string): Promise<ComparisonResult<{ classification: CandidateClassification }>> {
  return prisma.$transaction(
    async (tx) => {
      const notFound = { ok: false as const, status: 404 as const, error: "Candidate not found" };
      const candidate = await tx.comparisonCandidate.findFirst({ where: { comparisonId: id, systemId, comparison: comparisonsVisibleWhere(actor) }, select: { systemId: true } });
      if (!candidate) return notFound;
      const system = await tx.system.findFirst({
        where: { AND: [{ id: systemId }, await visibleSystemsWhere(actor, tx)] },
        select: {
          deploymentFacets: { select: { id: true } },
          informationTypes: { select: { id: true } },
          sensitivityLevel: true,
          integrityImpactLevel: true,
          availabilityImpactLevel: true,
          frameworkScopes: { select: { id: true } },
        },
      });
      if (!system) return notFound;
      return {
        ok: true as const,
        classification: {
          deploymentFacetIds: system.deploymentFacets.map((facet) => facet.id),
          informationTypeIds: system.informationTypes.map((type) => type.id),
          sensitivityLevel: system.sensitivityLevel,
          integrityImpactLevel: system.integrityImpactLevel,
          availabilityImpactLevel: system.availabilityImpactLevel,
          frameworkScopeIds: system.frameworkScopes.map((framework) => framework.id),
        },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** The Comparisons `actor` sees in which `systemId` is a Candidate, by name, for the System page ("Candidate in Comparison …"). Reads on `tx`. */
export async function listComparisonsOfCandidate(tx: Tx, actor: Actor, systemId: string) {
  return tx.comparison.findMany({
    where: { AND: [{ candidates: { some: { systemId } } }, comparisonsVisibleWhere(actor)] },
    select: { id: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

/** Removes a Candidate, with one Change Event on the System. The owner, an Admin, or the System's owner. */
export function removeCandidate(actor: Actor, id: string, systemId: string) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    const candidate = await tx.comparisonCandidate.findUnique({
      where: { comparisonId_systemId: { comparisonId: id, systemId } },
      select: { system: { select: { ownerId: true } } },
    });
    if (!candidate) throw refuse(404, "This System is not a Candidate in this Comparison");
    if (!canManage(actor, comparison) && !isSystemOwnerOrAdmin(actor, candidate.system)) {
      throw refuse(403, "Only the Comparison's owner, an Admin or the System's owner can remove a Candidate");
    }
    await tx.comparisonCandidate.delete({ where: { comparisonId_systemId: { comparisonId: id, systemId } } });
    await logChangeEvent(systemId, "COMPARISON_CANDIDATE_REMOVED", `Removed as a Candidate from the Comparison "${comparison.name}"`, actor.id, tx);
    return { systemId };
  });
}

/** Names `userId` a participant. The owner or an Admin; the owner can't also be a participant. */
export function addParticipant(actor: Actor, id: string, userId: string) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    if (!canManage(actor, comparison)) throw refuse(403, "Only the Comparison's owner or an Admin can name participants");
    if (userId === comparison.ownerId) throw refuse(400, "The owner is already part of the Comparison");
    if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw refuse(400, "That user doesn't exist");
    if (isParticipant({ id: userId }, comparison)) throw refuse(409, "This user is already a participant");
    return tx.comparisonParticipant.create({ data: { comparisonId: id, userId } });
  });
}

/** Removes a participant. The owner or an Admin. Candidates the participant added stay. */
export function removeParticipant(actor: Actor, id: string, userId: string) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    if (!canManage(actor, comparison)) throw refuse(403, "Only the Comparison's owner or an Admin can remove participants");
    if (!isParticipant({ id: userId }, comparison)) throw refuse(404, "This user is not a participant");
    await tx.comparisonParticipant.delete({ where: { comparisonId_userId: { comparisonId: id, userId } } });
    return { userId };
  });
}

/**
 * The users the owner or an Admin can pick as a participant or, for an Admin, a new owner: everyone with a System-creating role
 * (a participant adds Systems they own, a new owner must be able to own a System). 404 when the Comparison is hidden from `actor`,
 * 403 when they can't manage it.
 */
export async function listComparisonPeople(actor: Actor, id: string): Promise<ComparisonResult<{ users: Awaited<ReturnType<typeof listOwnerCandidates>> }>> {
  const comparison = await prisma.comparison.findFirst({ where: { AND: [{ id }, comparisonsVisibleWhere(actor)] }, select: { ownerId: true } });
  if (!comparison) return { ok: false, status: 404, error: NOT_FOUND };
  if (!canManage(actor, comparison)) return { ok: false, status: 403, error: "Only the Comparison's owner or an Admin can pick people" };
  return { ok: true, users: await listOwnerCandidates() };
}
