import type { Prisma } from "@prisma/client";
import {
  declinesToLeaveOut,
  suggestionsFor,
  type Suggestion,
  type SuggestingType,
  type SuggestionDecline,
} from "@/lib/framework-suggestions";

/**
 * Reading what a System's Information Types suggest (#300, ADR 0013) and recording the owner's decisions. The rule
 * itself is the pure `framework-suggestions.ts`. Every function takes the client to read with, so a caller inside a
 * transaction passes `tx` (a query on the global client inside an interactive transaction needs a second connection).
 */

type ReadDb = Pick<Prisma.TransactionClient, "informationType" | "frameworkSuggestionDecline" | "framework">;

/** What a declared Information Type carries for the suggestion rule. */
export const SUGGESTING_TYPE_SELECT = {
  id: true,
  name: true,
  suggestedFrameworks: { select: { id: true, name: true, version: true, status: true, isBase: true }, orderBy: { name: "asc" } },
} satisfies Prisma.InformationTypeSelect;

/** The System fields a list or page loader adds to its own select to work out the suggestions in memory. */
export const SYSTEM_SUGGESTION_SELECT = {
  informationTypes: { select: SUGGESTING_TYPE_SELECT, orderBy: { name: "asc" } },
  frameworkScopes: { select: { id: true } },
  frameworkSuggestionDeclines: { select: { informationTypeId: true, frameworkId: true } },
} satisfies Prisma.SystemSelect;

/** A System's declared types (with their suggested Frameworks), its Framework Scope ids and its recorded declines. */
export async function readSuggestionInputs(
  db: ReadDb,
  systemId: string,
): Promise<{ declared: SuggestingType[]; scopeIds: string[]; declines: SuggestionDecline[] }> {
  // Sequential: a transaction client has one connection.
  const declared = await db.informationType.findMany({ where: { systems: { some: { id: systemId } } }, select: SUGGESTING_TYPE_SELECT, orderBy: { name: "asc" } });
  const scope = await db.framework.findMany({ where: { scopedSystems: { some: { id: systemId } } }, select: { id: true } });
  const declines = await db.frameworkSuggestionDecline.findMany({ where: { systemId }, select: { informationTypeId: true, frameworkId: true } });
  return { declared, scopeIds: scope.map((framework) => framework.id), declines };
}

/** The suggestions for a System, in every state. */
export async function readSuggestions(db: ReadDb, systemId: string): Promise<Suggestion[]> {
  const { declared, scopeIds, declines } = await readSuggestionInputs(db, systemId);
  return suggestionsFor(declared, scopeIds, declines);
}

/**
 * Records that the owner left `frameworkId` out for every declared type that suggests it (idempotent). Returns how many
 * types suggest it; 0 means nothing was recorded because no declared type suggests that Framework. The caller holds the
 * permission check and passes the client to write with.
 */
export async function leaveSuggestionOut(
  db: ReadDb,
  systemId: string,
  frameworkId: string,
): Promise<number> {
  const { declared } = await readSuggestionInputs(db, systemId);
  const declines = declinesToLeaveOut(declared, frameworkId);
  if (declines.length > 0) {
    await db.frameworkSuggestionDecline.createMany({ data: declines.map((decline) => ({ systemId, ...decline })), skipDuplicates: true });
  }
  return declines.length;
}

/**
 * The rows that record declines for the Framework's current suggesting types, for a caller that writes them in a
 * `prisma.$transaction([...])` next to a Framework Scope removal (decision 2 on #300: removing a suggested Framework
 * while the type is still declared must not flag the System again). Empty when no declared type suggests it.
 */
export async function declinesForRemoval(db: ReadDb, systemId: string, frameworkId: string): Promise<Prisma.FrameworkSuggestionDeclineCreateManyInput[]> {
  const { declared } = await readSuggestionInputs(db, systemId);
  return declinesToLeaveOut(declared, frameworkId).map((decline) => ({ systemId, ...decline }));
}

export const NOT_SUGGESTED_FRAMEWORK = "No Information Type this System declares suggests that Framework";

/**
 * The declines a create request asks for, checked against what the declared types really suggest (the client is not
 * trusted): every id must be a Framework that a declared type suggests and that is not in the scope being created.
 * Returns the (type, Framework) pairs to record, or null when any id is not such a Framework.
 */
export function declinesForCreate(
  declared: readonly SuggestingType[],
  declinedFrameworkIds: readonly string[],
  scopeIds: readonly string[],
): SuggestionDecline[] | null {
  const inScope = new Set(scopeIds);
  const result: SuggestionDecline[] = [];
  for (const frameworkId of new Set(declinedFrameworkIds)) {
    const declines = declinesToLeaveOut(declared, frameworkId);
    if (declines.length === 0 || inScope.has(frameworkId)) return null;
    result.push(...declines);
  }
  return result;
}
