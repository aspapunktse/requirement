/**
 * What a read of an Assessment Query loads: its messages with their authors, and who resolved it.
 * Raw: it carries the people behind a Review Group's or the base step's attribution, so it must go
 * through `redactQueries` (`assessment-queries.ts`) before anything reaches a client. Kept in its own
 * module so `control-assessments.ts` can use it without a cycle through the Review Step code.
 */
export const QUERY_INCLUDE = {
  messages: { include: { author: true }, orderBy: { createdAt: "asc" } },
  resolvedBy: true,
} as const;
