// Pure (no Prisma), safe to import from client components.

/** The most Controls one bulk Assign owner (`PATCH /api/controls`) may name. */
export const CONTROL_BULK_OWNER_MAX = 500;

/** The text shown when more are selected. */
export const controlBulkLimitMessage = (count: number) =>
  `Assign owner takes at most ${CONTROL_BULK_OWNER_MAX} Controls at a time; ${count} are selected.`;
