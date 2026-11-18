import type { PlanPreview } from "@/lib/check-ups";

export type { PlanPreview };

/** The view of the Controls list: all of them, the ones due for audit, or the ones picked. */
export type ControlView = "all" | "due" | "picked";

/** The picks the planner sends to the preview and to the save. */
export type PlannerSelection = {
  controlIds: string[];
  systemIds: string[];
  includeOrganization: boolean;
};
