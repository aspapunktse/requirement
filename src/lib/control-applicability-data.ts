import type { Prisma } from "@prisma/client";
import { APPLICABLE_APPLICABILITIES, controlAppliesToSystem } from "@/lib/control-applicability";

/**
 * Every Control a System can be assessed on (PER_SYSTEM or BOTH), with what `controlAppliesToSystem` needs
 * to decide, for a caller that judges many Systems in memory instead of one Control query per System.
 * A constant number of queries however many Systems there are. Pass a transaction client to read in the
 * caller's snapshot.
 */
export async function loadControlsForApplicability(db: Pick<Prisma.TransactionClient, "control">) {
  return db.control.findMany({
    where: { applicability: { in: [...APPLICABLE_APPLICABILITIES] } },
    include: {
      deploymentFacets: { select: { id: true } },
      mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
    },
  });
}

export type ControlForApplicability = Awaited<ReturnType<typeof loadControlsForApplicability>>[number];

/** The Controls of `controls` that apply to the System (the in-memory twin of `getApplicableControls`). */
export function applicableControlsOf(controls: ControlForApplicability[], system: Parameters<typeof controlAppliesToSystem>[1]) {
  return controls.filter((control) => controlAppliesToSystem(control, system));
}
