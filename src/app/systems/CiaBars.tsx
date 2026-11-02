import type { ImpactLevel } from "@prisma/client";
import { IMPACT_LABEL, IMPACT_RANK } from "./systems-types";

const levelText = (level: ImpactLevel | null) => (level === null ? "not classified" : IMPACT_LABEL[level].toLowerCase());

/**
 * I · A: two small bars, tall for a high Impact Level and dashed when not classified. Shared by the Systems list,
 * the System page's header and the onboarding review. The Sensitivity Level is not drawn here: it has its own
 * chip (`SensitivityChip`, #292). The bars' styles (`.cia`) are in `systems.css`, under `.sy`.
 */
export function CiaBars({ integrity, availability }: { integrity: ImpactLevel | null; availability: ImpactLevel | null }) {
  return (
    <span
      className="cia"
      role="img"
      aria-label={`Integrity ${levelText(integrity)}, Availability ${levelText(availability)}`}
      title={`I ${levelText(integrity)} · A ${levelText(availability)}`}
    >
      <i data-l={integrity ? IMPACT_RANK[integrity] : 0} />
      <i data-l={availability ? IMPACT_RANK[availability] : 0} />
    </span>
  );
}
