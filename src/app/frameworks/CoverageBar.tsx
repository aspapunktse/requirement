import type { Totals } from "./frameworks-logic";

/** The stacked coverage bar (shared by the Framework list and the Framework coverage page): covered, accepted, gap with Partial mappings only, gap with no mapping. */
export function CoverageBar({ totals, thin = false }: { totals: Totals; thin?: boolean }) {
  if (totals.requirements === 0) return <div className={`fc-bar empty${thin ? " thin" : ""}`} role="img" aria-label="No Requirements yet" />;
  const segments: [number, string][] = [
    [totals.covered, "covered"],
    [totals.accepted, "accepted"],
    [totals.partialOnly, "partial"],
    [totals.gaps - totals.partialOnly, "none"],
  ];
  return (
    <div
      className={`fc-bar${thin ? " thin" : ""}`}
      role="img"
      aria-label={`${totals.covered} covered, ${totals.accepted} accepted, ${totals.gaps} open gaps of ${totals.requirements} Requirements`}
    >
      {segments
        .filter(([n]) => n > 0)
        .map(([n, kind]) => (
          <i key={kind} className={`st-${kind}`} style={{ flexGrow: n }} />
        ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className="fc-legend" aria-label="Coverage colours">
      <span>
        <i className="st-covered" aria-hidden="true" />
        Covered
      </span>
      <span>
        <i className="st-accepted" aria-hidden="true" />
        Accepted gap
      </span>
      <span>
        <i className="st-partial" aria-hidden="true" />
        Gap, Partial mappings only
      </span>
      <span>
        <i className="st-none" aria-hidden="true" />
        Gap, no mapping
      </span>
    </div>
  );
}
