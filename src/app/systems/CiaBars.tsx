import type { ImpactLevel } from "@prisma/client";
import { IMPACT_LABEL, IMPACT_RANK } from "./systems-types";

const levelText = (level: ImpactLevel | null) => (level === null ? "not classified" : IMPACT_LABEL[level].toLowerCase());

/**
 * The Sensitivity Level as plain text, then I · A: two small bars, tall for a high Impact Level and dashed
 * when not classified. Shared by the Systems list and the System page's header. The bars' styles (`.cia`)
 * are in `systems.css`, under `.sy`. Styled Sensitivity Level chips come with the display issue.
 */
export function CiaBars({
  sensitivityLabel,
  integrity,
  availability,
}: {
  /** The label of the System's Sensitivity Level; null when not set. */
  sensitivityLabel: string | null;
  integrity: ImpactLevel | null;
  availability: ImpactLevel | null;
}) {
  const sensitivity = sensitivityLabel ?? "not set";
  return (
    <span
      className="cia"
      role="img"
      aria-label={`Sensitivity Level ${sensitivity.toLowerCase()}, Integrity ${levelText(integrity)}, Availability ${levelText(availability)}`}
      title={`Sensitivity ${sensitivity} · I ${levelText(integrity)} · A ${levelText(availability)}`}
    >
      <span className="cia-s">{sensitivityLabel ?? "Not set"}</span>
      <i data-l={integrity ? IMPACT_RANK[integrity] : 0} />
      <i data-l={availability ? IMPACT_RANK[availability] : 0} />
    </span>
  );
}
