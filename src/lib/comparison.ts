import { Prisma, type UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { classificationDifferences, orderCandidates } from "@/lib/comparison-score";
import { loadComparisonScores } from "@/lib/comparison-score-data";
import { readLiveMarkingsByFramework } from "@/lib/first-round";
import { listOwnerCandidates } from "@/lib/system-owner";
import { FULL_VISIBILITY_ROLES, visibleSystemsWhere } from "@/lib/system-visibility";
import { canBeSystemOwner, isSystemOwnerOrAdmin, NEW_OWNER_REFUSAL } from "@/lib/system-permissions";

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
 * - Adding and removing a Candidate write one Change Event on that System in the same transaction.
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

export type ComparisonResult<T = object> = ({ ok: true } & T) | { ok: false; status: 400 | 403 | 404 | 409; error: string };

class Abort extends Error {
  constructor(readonly result: { ok: false; status: 400 | 403 | 404 | 409; error: string }) {
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

/** Adds `systemId` as a Candidate, with one Change Event on the System. See the rules at the top of the file. */
export function addCandidate(actor: Actor, id: string, systemId: string) {
  return run(async (tx) => {
    const comparison = await loadVisibleLocked(tx, actor, id);
    const manager = canManage(actor, comparison);
    const participant = isParticipant(actor, comparison);
    if (!manager && !participant) throw refuse(403, "Only the Comparison's owner, a participant or an Admin can add a Candidate");

    const system = await tx.system.findUnique({
      where: { id: systemId },
      select: { id: true, name: true, ownerId: true, evaluationStage: true, evaluationClosedAt: true },
    });
    if (actor.role === "ADMIN") {
      if (!system) throw refuse(404, "System not found");
    } else if (manager) {
      // The owner adds a System they can see; one they can't is not found, as everywhere.
      const visible = system ? await tx.system.findFirst({ where: { AND: [{ id: systemId }, await visibleSystemsWhere(actor, tx)] }, select: { id: true } }) : null;
      if (!system || !visible) throw refuse(404, "System not found");
    } else if (!system || !isSystemOwnerOrAdmin(actor, system)) {
      throw refuse(403, "A participant can add only a System they own");
    }

    if (system.evaluationStage === null) throw refuse(409, NOT_STAGED_REFUSAL);
    if (system.evaluationClosedAt) throw refuse(409, CLOSED_REFUSAL);
    if (await tx.comparisonCandidate.findUnique({ where: { comparisonId_systemId: { comparisonId: id, systemId } }, select: { systemId: true } })) {
      throw refuse(409, DUPLICATE_REFUSAL);
    }
    if ((await tx.comparisonCandidate.count({ where: { comparisonId: id } })) >= MAX_CANDIDATES) throw refuse(409, FULL_REFUSAL);

    const candidate = await tx.comparisonCandidate.create({ data: { comparisonId: id, systemId, addedById: actor.id } });
    await logChangeEvent(systemId, "COMPARISON_CANDIDATE_ADDED", `Added as a Candidate to the Comparison "${comparison.name}"`, actor.id, tx);
    return candidate;
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
