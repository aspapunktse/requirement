import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { frameworkLabel } from "@/lib/framework-label";
import { canCurateBoundaries, emptyListMessage } from "@/lib/compliance-boundary";
import { listBoundaries } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "./compliance-boundaries.css";

/**
 * Compliance Boundaries (#418, ADR 0016): the named perimeters, each a set of Systems held to one or more Published
 * Frameworks. Every signed-in role reads the list; a Compliance Manager or an Admin starts a new one. Plain kit UI for now:
 * the Boundary's statement and the design proposal's polish come later.
 */
export default async function ComplianceBoundariesPage({ searchParams }: PageProps<"/compliance-boundaries">) {
  const showRetired = (await searchParams).retired === "1";
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const { boundaries, hiddenRetired } = await prisma.$transaction(async (tx) => {
    const rows = await listBoundaries(tx, { includeRetired: showRetired });
    return { boundaries: rows, hiddenRetired: showRetired ? 0 : await tx.complianceBoundary.count({ where: { retiredAt: { not: null } } }) };
  }, READ_SNAPSHOT);

  return (
    <div className="hc cb">
      <section className="hc-hero" aria-labelledby="cb-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Compliance</span>
          </div>
          <h1 id="cb-title">Compliance Boundaries</h1>
          <p className="hc-lede">
            A Compliance Boundary is a named set of Systems held to one or more Published Frameworks together, for one purpose, such as a contract or an ISMS scope.
          </p>
        </div>
        {canCurateBoundaries(user) && (
          <div className="cb-actions">
            <Link href="/compliance-boundaries/new" className="hc-btn primary">
              New Compliance Boundary
            </Link>
          </div>
        )}
      </section>

      <section className="hc-card" aria-labelledby="cb-list-h">
        <div className="hc-card-h">
          <h2 id="cb-list-h">{showRetired ? "All Compliance Boundaries, retired included" : "Compliance Boundaries"}</h2>
          <p>{boundaries.length}</p>
        </div>
        <p className="cb-filter">
          {showRetired ? (
            <Link href="/compliance-boundaries">Hide retired Compliance Boundaries</Link>
          ) : (
            <Link href="/compliance-boundaries?retired=1">Show retired Compliance Boundaries</Link>
          )}
        </p>
        {boundaries.length === 0 ? (
          <p className="cb-empty">{emptyListMessage(hiddenRetired)}</p>
        ) : (
          <ul className="cb-list">
            {boundaries.map((boundary) => (
              <li key={boundary.id}>
                <Link href={`/compliance-boundaries/${boundary.id}`} className="cb-row">
                  <b>
                    {boundary.name}
                    {boundary.retiredAt && <span className="cb-tag warn cb-retired-tag">Retired</span>}
                  </b>
                  {boundary.description && <small>{boundary.description}</small>}
                  <small>
                    {boundary.businessUnit ? `${boundary.businessUnit.name} · ` : ""}
                    {boundary.boundaryOwner ? `Boundary Owner: ${boundary.boundaryOwner.name}` : "No Boundary Owner"}
                  </small>
                  <span className="cb-tags">
                    {boundary.frameworks.map((framework) => (
                      <span key={framework.id} className="cb-tag fw">
                        {frameworkLabel(framework)}
                      </span>
                    ))}
                  </span>
                  <span className="cb-count">
                    {boundary.systemCount} {boundary.systemCount === 1 ? "System" : "Systems"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
