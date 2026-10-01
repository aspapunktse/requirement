import type { ControlApplicability, ControlAssessmentStatus, Prisma } from "@prisma/client";
import {
  hasOrganizationImplementation,
  ORGANIZATION_IMPLEMENTED_APPLICABILITIES,
} from "./organization-implementation-rules";

/**
 * Reading, creating and editing Organization Control Implementations (PRD 0001
 * F-IN.1, #120). Every function takes the database client (`prisma`, a
 * transaction, or the seed's own client), so the seed and the routes share it.
 * Relative imports and type-only Prisma imports, so the seed can load it.
 *
 * The missing-row rule: an ORGANIZATIONAL or BOTH Control with no row (a test
 * fixture, a Control created outside the API) reads as Not Started with no
 * description, and the first edit creates the row. Every reader goes through
 * `toOrganizationControlRow` or tolerates `null` itself.
 *
 * Nothing here touches a System: no Control Assessment is written. A Both
 * Control's Fulfilled status is inherited live by the Systems it applies to
 * (`effective-status.ts`, #121), and the Change Events that record a System's
 * effective status moving are written by `organization-inheritance.ts`.
 */

type Db = Pick<Prisma.TransactionClient, "control" | "organizationControlImplementation">;

type PublicUser = { id: string; name: string };

export type OrganizationImplementationView = {
  status: ControlAssessmentStatus;
  description: string | null;
  updatedBy: PublicUser | null;
  /** ISO timestamp of the last edit; null while the row doesn't exist yet (or the migration created it and nobody has edited). */
  updatedAt: string | null;
};

/** One Organizational or Both Control with its Control Owner and implementation, as the API and the page show it. */
export type OrganizationControlRow = {
  id: string;
  code: string;
  title: string;
  applicability: Extract<ControlApplicability, "ORGANIZATIONAL" | "BOTH">;
  owner: PublicUser | null;
  implementation: OrganizationImplementationView;
};

/** What a Control without a row reads as. */
export const NOT_STARTED_IMPLEMENTATION: OrganizationImplementationView = {
  status: "NOT_STARTED",
  description: null,
  updatedBy: null,
  updatedAt: null,
};

const ROW_INCLUDE = {
  owner: { select: { id: true, name: true } },
  organizationImplementation: {
    select: {
      status: true,
      description: true,
      updatedAt: true,
      updatedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ControlInclude;

type ControlWithImplementation = Prisma.ControlGetPayload<{ include: typeof ROW_INCLUDE }>;

/** A Control row as the API and the page show it; a missing implementation reads as Not Started. */
export function toOrganizationControlRow(control: ControlWithImplementation): OrganizationControlRow {
  const implementation = control.organizationImplementation;
  return {
    id: control.id,
    code: control.code,
    title: control.title,
    applicability: control.applicability as OrganizationControlRow["applicability"],
    owner: control.owner,
    implementation: implementation
      ? {
          status: implementation.status,
          description: implementation.description,
          updatedBy: implementation.updatedBy,
          updatedAt: implementation.updatedAt.toISOString(),
        }
      : NOT_STARTED_IMPLEMENTATION,
  };
}

/** Every Control the Organization implements (Organizational and Both), by code, with its implementation. */
export async function listOrganizationControls(db: Db): Promise<OrganizationControlRow[]> {
  const controls = await db.control.findMany({
    where: { applicability: { in: ORGANIZATION_IMPLEMENTED_APPLICABILITIES } },
    orderBy: { code: "asc" },
    include: ROW_INCLUDE,
  });
  return controls.map(toOrganizationControlRow);
}

/**
 * One Control the Organization implements, or null when it doesn't exist or is
 * Per-System (it has no implementation, so the API treats it as not found).
 */
export async function getOrganizationControl(db: Db, controlId: string) {
  const control = await db.control.findUnique({ where: { id: controlId }, include: ROW_INCLUDE });
  if (!control || !hasOrganizationImplementation(control.applicability)) return null;
  return control;
}

/**
 * Creates the Not Started implementation of a newly created Control, if it is
 * an Organizational or Both one (nothing for a Per-System one). Idempotent
 * (`skipDuplicates`), so it also fills a gap and never resets an existing row.
 * Called by `POST /api/controls`, the supplementary-control route and the seed.
 */
export async function createOrganizationImplementationFor(
  db: Pick<Prisma.TransactionClient, "organizationControlImplementation">,
  control: { id: string; applicability: ControlApplicability },
) {
  if (!hasOrganizationImplementation(control.applicability)) return;
  await db.organizationControlImplementation.createMany({
    data: [{ controlId: control.id }],
    skipDuplicates: true,
  });
}

export type ImplementationEdit = { status?: ControlAssessmentStatus; description?: string | null };

/** A blank description is no description. */
export function normalizeDescription(description: string | null | undefined): string | null | undefined {
  if (description === undefined) return undefined;
  return description?.trim() ? description.trim() : null;
}

/**
 * Applies an edit on behalf of `userId`: creates the row if the Control has
 * none, otherwise changes only the fields given. An edit that changes nothing
 * on an existing row writes nothing, so "last updated by" isn't bumped by a
 * Save that didn't change anything. Returns the Control as the API shows it.
 * The caller has already checked permission and the description rule.
 */
export async function saveOrganizationImplementation(
  db: Db,
  control: ControlWithImplementation,
  userId: string,
  edit: ImplementationEdit,
): Promise<OrganizationControlRow> {
  const existing = control.organizationImplementation;
  const description = normalizeDescription(edit.description);

  const unchanged =
    existing !== null &&
    (edit.status === undefined || edit.status === existing.status) &&
    (description === undefined || description === existing.description);
  if (unchanged) return toOrganizationControlRow(control);

  await db.organizationControlImplementation.upsert({
    where: { controlId: control.id },
    create: {
      controlId: control.id,
      status: edit.status ?? "NOT_STARTED",
      description: description ?? null,
      updatedById: userId,
    },
    update: {
      ...(edit.status !== undefined && { status: edit.status }),
      ...(description !== undefined && { description }),
      updatedById: userId,
    },
  });
  const saved = await db.control.findUniqueOrThrow({ where: { id: control.id }, include: ROW_INCLUDE });
  return toOrganizationControlRow(saved);
}
