import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { canCurateBoundaries } from "@/lib/compliance-boundary";
import { listBoundaries } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "./compliance-boundaries.css";
import { BoundaryList } from "./BoundaryList";

/**
 * Compliance Boundaries (#418, ADR 0016): the named perimeters, each a set of Systems held to one or more Published
 * Frameworks. Every signed-in role reads the list; a Compliance Manager or an Admin starts a new one. Plain kit UI for now:
 * the Boundary's statement and the design proposal's polish come later.
 */
export default async function ComplianceBoundariesPage({ searchParams }: PageProps<"/compliance-boundaries">) {
  const query = await searchParams;
  const showRetired = query.retired === "1";
  const framework = query.framework;
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

      <BoundaryList boundaries={boundaries} showRetired={showRetired} hiddenRetired={hiddenRetired} initialFramework={typeof framework === "string" ? framework : null} />
    </div>
  );
}
