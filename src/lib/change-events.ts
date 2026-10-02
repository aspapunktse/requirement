import { prisma } from "@/lib/prisma";
import type { ChangeEventAction, Prisma } from "@prisma/client";

/**
 * actorId sentinel for a transition the backend computed as a side effect of
 * a different, human-initiated action (a Provider's status moving a dependent's
 * effective status, a Risk auto-opened by a "No" Self-Assessment answer) rather than a direct edit to
 * that specific row. See #58.
 */
export const SYSTEM_ACTOR = "system";

/** Either the shared client or a transaction client, so a change and its event can commit together. */
type ChangeEventClient = Pick<Prisma.TransactionClient, "changeEvent">;

/**
 * Records a change for the landing page's "Recent updates" feed. See #58.
 *
 * `systemId` is null for System-less events about the requirement database
 * itself (CONTROL_MAPPING_CHANGED, FRAMEWORK_PUBLISHED) or about the
 * Organization's own Control implementations
 * (ORGANIZATION_IMPLEMENTATION_CHANGED, #122), which belong to no System. Pass a transaction client as `client` to write the event atomically
 * with the change it records.
 */
export function logChangeEvent(
  systemId: string | null,
  action: ChangeEventAction,
  detail: string,
  actorId: string,
  client: ChangeEventClient = prisma,
) {
  return client.changeEvent.create({ data: { systemId, action, detail, actorId } });
}
