import { prisma } from "@/lib/prisma";
import type { ChangeEventAction } from "@prisma/client";

/**
 * actorId sentinel for a transition the backend computed as a side effect of
 * a different, human-initiated action (Capability auto-fulfillment, a Risk
 * auto-opened by a "No" Self-Assessment answer) rather than a direct edit to
 * that specific row. See #58.
 */
export const SYSTEM_ACTOR = "system";

/** Records a System-lifecycle change for the landing page's "Recent updates" feed. See #58. */
export function logChangeEvent(systemId: string, action: ChangeEventAction, detail: string, actorId: string) {
  return prisma.changeEvent.create({ data: { systemId, action, detail, actorId } });
}
