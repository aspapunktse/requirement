import type { ImpactLevel } from "@prisma/client";
import { IMPACT_LABEL, IMPACT_RANK } from "./systems-types";

const levelText = (level: ImpactLevel | null) => (level === null ? "not classified" : IMPACT_LABEL[level].toLowerCase());

/**
 * C · I · A: three small bars, tall for a high Impact Level and dashed when not classified. Shared by the
 * Systems list and the System page's header. The bars' styles (`.cia`) are in `systems.css`, under `.sy`.
 */
export function CiaBars({
  confidentiality,
  integrity,
  availability,
}: {
  confidentiality: ImpactLevel | null;
  integrity: ImpactLevel | null;
  availability: ImpactLevel | null;
}) {
  return (
    <span
      className="cia"
      role="img"
      aria-label={`Confidentiality ${levelText(confidentiality)}, Integrity ${levelText(integrity)}, Availability ${levelText(availability)}`}
      title={`C ${levelText(confidentiality)} · I ${levelText(integrity)} · A ${levelText(availability)}`}
    >
      <i data-l={confidentiality ? IMPACT_RANK[confidentiality] : 0} />
      <i data-l={integrity ? IMPACT_RANK[integrity] : 0} />
      <i data-l={availability ? IMPACT_RANK[availability] : 0} />
    </span>
  );
}
