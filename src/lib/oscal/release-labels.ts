import type { OscalReleaseTrigger } from "@prisma/client";

/** How a release was made, in words. A plain module so server pages and client components can both import it. */
export const TRIGGER_LABEL: Record<OscalReleaseTrigger, string> = { MANUAL: "By hand", INTERNAL_AUDIT_CLOSE: "Internal Audit closed" };
