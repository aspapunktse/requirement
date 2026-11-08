import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { canBeControlOwner } from "@/lib/system-permissions";
import { logChangeEvent } from "@/lib/change-events";
import { frameworkLabel } from "@/lib/framework-label";
import { finishRecompute, prepareRecompute, scopeForFramework } from "@/lib/applicability-recompute";

/** Only Compliance Managers and Admins can see (or touch) Draft Frameworks. */
export function canSeeDraftFrameworks(user: { role: UserRole }): boolean {
  return ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role);
}

/**
 * Prisma `where` for the Frameworks a user may see: everything for the
 * curator roles, Published only for everyone else (a Draft Framework is
 * invisible outside the requirement-database roles, see #73). Used where a Framework
 * Owner gets no special sight of their Draft (Home, the Statement of Applicability, Systems);
 * see `visibleOrOwnedFrameworksWhere` for the places that do.
 */
export function visibleFrameworksWhere(user: { role: UserRole }): Prisma.FrameworkWhereInput {
  return canSeeDraftFrameworks(user) ? {} : { status: "PUBLISHED" };
}

/**
 * Like `visibleFrameworksWhere`, but a Framework Owner also sees their own Draft Frameworks (#320: they curate
 * them, so they must be able to open them). Used by the Framework pages and their routes (list, coverage, the
 * Framework itself, its Requirements, first round), nowhere else.
 */
export function visibleOrOwnedFrameworksWhere(user: { id: string; role: UserRole }): Prisma.FrameworkWhereInput {
  return canSeeDraftFrameworks(user) ? {} : { OR: [{ status: "PUBLISHED" }, { ownerId: user.id }] };
}

/**
 * Who may curate a Framework (#320): a Compliance Manager or an Admin on any Framework, and the Framework's owner
 * on a Framework that is not the base. The base Framework is curated only by a Compliance Manager or an Admin; its
 * owner keeps just the first-round marking (#319). The one rule behind every curation route and page: Requirements,
 * Control Mappings, Coverage Gaps, Supplementary Controls, the Framework's descriptive details, its Review Group
 * and publishing. Creating a Framework, changing its owner or base flag and retiring it stay with the curator roles
 * (`canSeeDraftFrameworks`).
 */
export function canCurateFramework(
  user: { id: string; role: UserRole },
  framework: { ownerId: string | null; isBase: boolean },
): boolean {
  if (canSeeDraftFrameworks(user)) return true;
  // A strictly read-only role (Internal Auditor) writes nothing, even as a recorded owner whose role changed later.
  return !framework.isBase && framework.ownerId !== null && framework.ownerId === user.id && canBeControlOwner(user);
}

/**
 * Prisma `where` for the Controls a user may map onto a Requirement of `frameworkId` (#320). A Compliance Manager or
 * an Admin may use any Control. Anyone else (a Framework Owner) may use a Control with no origin Framework, one
 * authored for this Framework, or one whose origin Framework is Published: never a Supplementary Control of another
 * Draft Framework, whose existence stays hidden. The one rule behind the mapping picker lists and the mapping route.
 */
export function mappableControlsWhere(user: { role: UserRole }, frameworkId: string): Prisma.ControlWhereInput {
  if (canSeeDraftFrameworks(user)) return {};
  return { OR: [{ originFrameworkId: null }, { originFrameworkId: frameworkId }, { originFramework: { status: "PUBLISHED" } }] };
}

/**
 * Who may mark first-round Controls for a Framework (#319): a Compliance Manager or an Admin, or its owner, the base
 * Framework's owner included, unless the owner's role has become strictly read-only (Internal Auditor).
 */
export function canMarkFirstRound(user: { id: string; role: UserRole }, framework: { ownerId: string | null }): boolean {
  if (canSeeDraftFrameworks(user)) return true;
  return framework.ownerId !== null && framework.ownerId === user.id && canBeControlOwner(user);
}

/**
 * The Framework with this id if the user may see it, otherwise null (a Draft is
 * "not found" for anyone who can't see Drafts, except its owner). The one visibility check of the
 * Coverage view's JSON route and its CSV export.
 */
export function findVisibleFramework(user: { id: string; role: UserRole }, id: string) {
  return prisma.framework.findFirst({
    where: { id, ...visibleOrOwnedFrameworksWhere(user) },
    select: { id: true, name: true, version: true, status: true, isBase: true },
  });
}

/**
 * Prisma `include` for a Control plus everything the admin UI and API show
 * about it. Its Control Mappings feed both the "Satisfies" line and the
 * reverse view (every Requirement mapped to the Control); mappings into Draft
 * Frameworks are left out for users who can't see Drafts.
 */
export function controlIncludeFor(user: { role: UserRole }) {
  return {
    deploymentFacets: true,
    // The Control Owner (F-CL.3), name only: the id feeds the picker, and no email goes to every reader.
    owner: { select: { id: true, name: true } },
    // The label of the minimum Sensitivity Level (ADR 0011), for display.
    minSensitivity: { select: { label: true } },
    // Set for a Supplementary Control (its origin Framework); `status` is only
    // here so redactDraftOrigin can hide a Draft Framework from users who can't see it.
    originFramework: { select: { id: true, name: true, version: true, status: true } },
    mappings: {
      where: canSeeDraftFrameworks(user) ? {} : { requirement: { framework: { status: "PUBLISHED" as const } } },
      select: {
        id: true,
        coverage: true,
        requirement: {
          select: {
            id: true,
            code: true,
            title: true,
            framework: { select: { id: true, name: true, version: true, status: true } },
          },
        },
      },
    },
  } satisfies Prisma.ControlInclude;
}

/**
 * A Supplementary Control's origin Framework is left out (null) for users who
 * can't see Drafts when that Framework is still a Draft, so a Draft
 * Framework's name doesn't leak through the Control Library.
 */
export function redactDraftOrigin<T extends { originFramework: { status: "DRAFT" | "PUBLISHED" } | null }>(
  user: { role: UserRole },
  control: T,
): T {
  if (canSeeDraftFrameworks(user) || control.originFramework?.status !== "DRAFT") return control;
  return { ...control, originFramework: null };
}

/** Prisma `include` for a Requirement with its Control Mappings (each with its Control). */
export const requirementInclude = {
  mappings: {
    orderBy: { control: { code: "asc" } },
    select: {
      id: true,
      coverage: true,
      rationale: true,
      control: { select: { id: true, code: true, title: true } },
    },
  },
} satisfies Prisma.RequirementInclude;

/**
 * True if pointing `id` at `supersedesId` would close a loop in the supersedes
 * chain. `db` is the client to read with (a transaction client inside one).
 */
export async function wouldCreateSupersedesCycle(
  id: string,
  supersedesId: string,
  db: Pick<Prisma.TransactionClient, "framework"> = prisma,
): Promise<boolean> {
  const seen = new Set<string>();
  let cursor: string | null = supersedesId;
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const next: { supersedesId: string | null } | null = await db.framework.findUnique({
      where: { id: cursor },
      select: { supersedesId: true },
    });
    cursor = next?.supersedesId ?? null;
  }
  return false;
}

export type BaseFrameworkViolation = "BASE_EXISTS" | "LAST_BASE";

/**
 * There is exactly one base Framework (ISO/IEC 27001:2022). Enforced here
 * rather than with a partial unique index, which Prisma can't represent
 * without showing up as schema drift.
 *
 * `next` is what the operation would leave `isBase` as for `frameworkId`
 * (undefined for a create, which has no id yet). Returns why it's not
 * allowed, or null. Making a second Framework the base, or unsetting the only
 * base, are both refused; moving the base is not supported.
 */
export async function checkBaseFrameworkInvariant(
  frameworkId: string | undefined,
  next: { wasBase: boolean; isBase: boolean },
): Promise<BaseFrameworkViolation | null> {
  if (next.isBase && !next.wasBase) {
    const otherBase = await prisma.framework.count({
      where: { isBase: true, ...(frameworkId ? { id: { not: frameworkId } } : {}) },
    });
    if (otherBase > 0) return "BASE_EXISTS";
  }
  if (next.wasBase && !next.isBase) return "LAST_BASE";
  return null;
}

export const BASE_FRAMEWORK_ERRORS: Record<BaseFrameworkViolation, string> = {
  BASE_EXISTS: "There is already a base Framework; exactly one Framework can be the base",
  LAST_BASE: "The base Framework can't be unset or retired; exactly one Framework must be the base",
};

/**
 * The single hook point for "a Framework was just published". Publishing
 * (POST /api/frameworks/[id]/publish) records the FRAMEWORK_PUBLISHED Change
 * Event and then calls this, which recomputes every System that has the
 * Framework in its scope (F-FW.5, ADR 0007): the Draft scope rows those
 * Systems already declared become effective now, so the Controls mapped to the
 * Framework's Requirements become applicable and get Not Started Assessments.
 * The base Framework is in every System's scope, so publishing it (it's normally
 * Published from the start) would recompute every System. Publishing only ever
 * widens applicability, so no "before" snapshot is needed.
 *
 * Returns the recompute summary (null when nothing was affected).
 */
export async function onFrameworkPublished(frameworkId: string) {
  const framework = await prisma.framework.findUnique({
    where: { id: frameworkId },
    select: { id: true, name: true, version: true, isBase: true, status: true },
  });
  if (!framework) return null;
  const pending = await prepareRecompute(await scopeForFramework(framework), { snapshot: false });
  return finishRecompute(pending, `Framework "${frameworkLabel(framework)}" published`);
}

export type MappingChange = "added" | "changed" | "removed";

/**
 * Records a System-less CONTROL_MAPPING_CHANGED Change Event naming the
 * Requirement (Framework label + code), the Control code, and old -> new
 * Coverage ("none" where there was no mapping before / is none after).
 * `note` appends why, e.g. when deleting a Requirement takes its mappings with it.
 */
export function logMappingChange(
  args: {
    change: MappingChange;
    framework: { name: string; version: string };
    requirementCode: string;
    controlCode: string;
    from: "FULL" | "PARTIAL" | null;
    to: "FULL" | "PARTIAL" | null;
    note?: string;
  },
  actorId: string,
  client?: Parameters<typeof logChangeEvent>[4],
) {
  const { change, framework, requirementCode, controlCode, from, to, note } = args;
  const detail =
    `Control Mapping ${change}: Requirement ${frameworkLabel(framework)} ${requirementCode} ` +
    `↔ Control ${controlCode} (${from ?? "none"} → ${to ?? "none"})` +
    (note ? `; ${note}` : "");
  return logChangeEvent(null, "CONTROL_MAPPING_CHANGED", detail, actorId, client);
}
