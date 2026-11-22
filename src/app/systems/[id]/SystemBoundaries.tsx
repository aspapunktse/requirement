import Link from "next/link";
import { frameworkLabel } from "@/lib/framework-label";
import type { SystemBoundaryRow } from "@/lib/compliance-boundary-data";
import "@/app/compliance-boundaries/compliance-boundaries.css";

/**
 * The Compliance Boundaries a System is in (#418), read-only: the System's owner sees membership but can't join or leave one.
 * The Boundary's page does that, for its Boundary Owner, a Compliance Manager or an Admin. Names every signed-in role may see.
 */
export function SystemBoundaries({ boundaries }: { boundaries: SystemBoundaryRow[] }) {
  return (
    <section className="hc-card" aria-labelledby="sc-boundaries-h">
      <div className="hc-card-h">
        <h2 id="sc-boundaries-h">Compliance Boundaries</h2>
        <p>{boundaries.length}</p>
      </div>
      <div className="hc-card-b cb">
        {boundaries.length === 0 ? (
          <p className="cb-empty">This System is not in any Compliance Boundary.</p>
        ) : (
          <ul className="cb-members">
            {boundaries.map((boundary) => (
              <li key={boundary.id} className="cb-member">
                <Link href={`/compliance-boundaries/${boundary.id}`}>{boundary.name}</Link>
                <span className="cb-tags">
                  {boundary.frameworks.map((framework) => (
                    <span key={framework.id} className="cb-tag fw">
                      {frameworkLabel(framework)}
                    </span>
                  ))}
                </span>
                {boundary.ownerName && <small>Boundary Owner: {boundary.ownerName}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
