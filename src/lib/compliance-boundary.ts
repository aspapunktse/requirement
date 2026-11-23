import { z } from "zod";
import type { Prisma, UserRole } from "@prisma/client";

/**
 * Compliance Boundaries (#418, ADR 0016): the shapes, validation and permission rules shared by the routes and the pages.
 * Prisma-free. A Boundary is a named set of Systems held to one or more Published Frameworks, optionally by a Business Unit,
 * with a Boundary Owner (CONTEXT.md). A Boundary's Frameworks join each member System's
 * effective Framework Scope (#419, `effective-framework-scope.ts`).
 *
 * Who may do what:
 * - Every signed-in role reads the list, each Boundary and its members' names.
 * - A Compliance Manager or an Admin creates a Boundary and edits its name, description, Business Unit, Frameworks and Boundary Owner.
 * - The Boundary Owner of that Boundary, a Compliance Manager or an Admin adds and removes member Systems, and retires the Boundary (#424).
 * Curating a Boundary is not a Change Event; a System joining or leaving, or a Boundary gaining or dropping a Framework, is a scope change that recomputes applicability.
 */

export const ROLES_ALLOWED_TO_CURATE_BOUNDARIES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

export const MAX_BOUNDARY_NAME_LENGTH = 120;
export const MAX_BOUNDARY_DESCRIPTION_LENGTH = 1000;

export const canCurateBoundaries = (user: { role: UserRole }) => ROLES_ALLOWED_TO_CURATE_BOUNDARIES.includes(user.role);

/** Adding and removing Systems: the Boundary's own owner, a Compliance Manager or an Admin. Another Boundary's owner is refused. */
export const canManageBoundaryMembers = (user: { id: string; role: UserRole }, boundary: { boundaryOwnerId: string | null }) =>
  canCurateBoundaries(user) || (boundary.boundaryOwnerId !== null && boundary.boundaryOwnerId === user.id);

export const NOT_FOUND_MESSAGE = "Compliance Boundary not found.";
export const MEMBERS_FORBIDDEN_MESSAGE = "Only the Boundary Owner, a Compliance Manager or an Admin can add or remove Systems.";
export const duplicateNameMessage = (existing: string) => `A Compliance Boundary named "${existing}" already exists.`;
export const CLOSED_MEMBER_REFUSAL = "A closed System (Rejected or Not selected) can't be added to a Compliance Boundary.";
export const RETIRE_FORBIDDEN_MESSAGE = "Only the Boundary Owner, a Compliance Manager or an Admin can retire a Compliance Boundary.";
/** The 409 every write on a retired Boundary answers with (#424): retiring is final, the Boundary is a read-only record. */
export const RETIRED_REFUSAL = "This Compliance Boundary is retired. It is a read-only record: create a new Compliance Boundary instead.";
export const ALREADY_RETIRED_REFUSAL = "This Compliance Boundary is already retired.";
export const MAX_RETIREMENT_COMMENT_LENGTH = 1000;
export const ALREADY_MEMBER_REFUSAL = "That System is already in this Compliance Boundary.";

/** What a System's state means for a Boundary (CONTEXT.md): closed Systems are shown but never counted; Systems still in evaluation are "not yet operating". */
export type MemberState = "OPERATING" | "NOT_YET_OPERATING" | "CLOSED";

/** Counted means having an ATO (Approved) or being Onboarded. The one rule `memberState` and `countedMembersWhere` share. */
export const COUNTED_STATUSES = ["APPROVED", "ONBOARDED"] as const;

export function memberState(system: { status: string; evaluationClosedAt: Date | null }): MemberState {
  if (system.evaluationClosedAt !== null) return "CLOSED";
  return (COUNTED_STATUSES as readonly string[]).includes(system.status) ? "OPERATING" : "NOT_YET_OPERATING";
}

/** The Systems of a Boundary that are counted (state OPERATING): members with an ATO or Onboarded, not closed. */
export const countedMembersWhere = (boundaryId: string): Prisma.SystemWhereInput => ({
  boundaryMemberships: { some: { boundaryId } },
  status: { in: [...COUNTED_STATUSES] },
  evaluationClosedAt: null,
});

/** A Boundary Framework's pooled Compliance Percentage over the counted Systems (#422): null when nothing is applicable. */
export type BoundaryFrameworkCompliance = { frameworkId: string; met: number; applicable: number; percentage: number | null };

export const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  OPERATING: "Operating",
  NOT_YET_OPERATING: "Not yet operating",
  CLOSED: "Closed",
};

export type BoundaryFrameworkRow = { id: string; name: string; version: string };
export type BoundaryMemberRow = {
  systemId: string;
  name: string;
  state: MemberState;
  /** The Onboarding Status, for the closed reason (Rejected or Not selected). */
  status: string;
  addedAt: string;
  addedByName: string | null;
};

export type BoundaryListRow = {
  id: string;
  name: string;
  description: string | null;
  businessUnit: { id: string; name: string } | null;
  boundaryOwner: { id: string; name: string } | null;
  frameworks: BoundaryFrameworkRow[];
  systemCount: number;
  /** When the Boundary was retired (ISO), or null while it is active (#424). */
  retiredAt: string | null;
};

/** Who retired a Compliance Boundary, when and why (#424). */
export type BoundaryRetirement = { retiredAt: string; retiredByName: string | null; comment: string };

/** One Framework held by at least one active Boundary, with how many active Boundaries hold it (#433). */
export type FrameworkCount = BoundaryFrameworkRow & { count: number };

/**
 * The list's counters (#433): one per Framework held by at least one **active** Boundary, with the number of active Boundaries
 * holding it. A Boundary holding two Frameworks counts under both, and a retired Boundary counts under none (even when the list
 * shows retired ones). Ordered by Framework name and version. No counters by state.
 */
export function boundaryFrameworkCounts(rows: Pick<BoundaryListRow, "frameworks" | "retiredAt">[]): FrameworkCount[] {
  const counts = new Map<string, FrameworkCount>();
  for (const row of rows) {
    if (row.retiredAt !== null) continue;
    for (const framework of row.frameworks) {
      const entry = counts.get(framework.id);
      if (entry) entry.count += 1;
      else counts.set(framework.id, { ...framework, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.version.localeCompare(b.version, "en", { numeric: true }));
}

/** The Boundaries holding the Framework (all of them when `frameworkId` is null). */
export function boundariesHolding<T extends Pick<BoundaryListRow, "frameworks">>(rows: T[], frameworkId: string | null): T[] {
  return frameworkId === null ? rows : rows.filter((row) => row.frameworks.some((framework) => framework.id === frameworkId));
}

const STATUS_WORDS: Record<string, string> = { DRAFT: "In evaluation (Draft)", IN_REVIEW: "In evaluation (In Review)", APPROVED: "Has an ATO", ONBOARDED: "Onboarded", REJECTED: "Rejected", NOT_SELECTED: "Not selected" };

/** Where a member sits in the scope statement and why (#433): inside (counted), on the edge (not yet operating) or closed. */
export function memberPosition(member: { state: MemberState; status: string }): { position: "Inside" | "On the edge" | "Closed"; why: string } {
  const status = STATUS_WORDS[member.status] ?? member.status;
  if (member.state === "OPERATING") return { position: "Inside", why: `${status}: counts toward the statement and the Compliance Percentage.` };
  if (member.state === "NOT_YET_OPERATING") return { position: "On the edge", why: `${status}: planned in, not counted until it is Onboarded or has an ATO.` };
  return { position: "Closed", why: `${status}: stays listed because it was added earlier, but is not counted and can't be added again.` };
}

/** A System prepared for (it declared) some of a Boundary's non-base Frameworks, not yet a member (#423). */
export type PreparedCandidate = { id: string; name: string; state: MemberState; preparedFor: { id: string; name: string; version: string }[] };

/**
 * What adding a System to a Boundary would do (#423), read-only. `newControls` are the Controls that would newly apply, each with
 * whether it is already effectively Fulfilled for the System (its own Assessment or inheritance counts); empty means "nothing new
 * applies". `onboarded` is whether the System is Onboarded, and `startsChangeReview` whether joining would start (or widen) a Change
 * Review: Onboarded, open, and the new Controls add to some participant's remit.
 */
export type JoinPreview = {
  systemId: string;
  systemName: string;
  state: MemberState;
  onboarded: boolean;
  startsChangeReview: boolean;
  newControls: { id: string; code: string; title: string; fulfilled: boolean }[];
};

export const MEMBERS_PREVIEW_FORBIDDEN_MESSAGE = "Only the Boundary Owner, a Compliance Manager or an Admin can preview adding a System.";

export type BoundaryDetail = Omit<BoundaryListRow, "systemCount" | "retiredAt"> & {
  members: BoundaryMemberRow[];
  /** Null while the Boundary is active. */
  retirement: BoundaryRetirement | null;
  createdAt: string;
  updatedAt: string;
};

const name = z
  .string({ error: "Give the Compliance Boundary a name." })
  .trim()
  .min(1, "Give the Compliance Boundary a name.")
  .max(MAX_BOUNDARY_NAME_LENGTH, `The name can be at most ${MAX_BOUNDARY_NAME_LENGTH} characters.`);

const description = z
  .string({ error: "The description must be text." })
  .trim()
  .max(MAX_BOUNDARY_DESCRIPTION_LENGTH, `The description can be at most ${MAX_BOUNDARY_DESCRIPTION_LENGTH} characters.`)
  .transform((value) => (value === "" ? null : value));

const id = (message: string) => z.string({ error: message }).min(1, message);

const frameworkIds = z
  .array(id("Choose Frameworks from the list."), { error: "Choose at least one Framework." })
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length > 0, "A Compliance Boundary needs at least one Framework.");

export const createBoundarySchema = z.object({
  name,
  description: description.nullish().transform((value) => value ?? null),
  businessUnitId: id("Choose a Business Unit from the list.").nullish().transform((value) => value ?? null),
  boundaryOwnerId: id("Choose a Boundary Owner from the list.").nullish().transform((value) => value ?? null),
  frameworkIds,
});

/** Every field optional; `frameworkIds`, when sent, is the whole new list (never empty). `null` clears the description, Business Unit or Boundary Owner. */
export const updateBoundarySchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    businessUnitId: id("Choose a Business Unit from the list.").nullable().optional(),
    boundaryOwnerId: id("Choose a Boundary Owner from the list.").nullable().optional(),
    frameworkIds: frameworkIds.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

export const addMemberSchema = z.object({ systemId: id("Choose a System from the list.") });

/** Retiring needs a comment: why the Boundary's purpose ended (#424). */
export const retireBoundarySchema = z.object({
  comment: z
    .string({ error: "Say why the Compliance Boundary is retired." })
    .trim()
    .min(1, "Say why the Compliance Boundary is retired.")
    .max(MAX_RETIREMENT_COMMENT_LENGTH, `The comment can be at most ${MAX_RETIREMENT_COMMENT_LENGTH} characters.`),
});

/** The list's empty state: when only retired Boundaries are hidden, "yet" would be false (#424). */
export const emptyListMessage = (hiddenRetired: number) => (hiddenRetired > 0 ? "No active Compliance Boundaries." : "No Compliance Boundaries yet.");
