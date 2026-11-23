import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { readBoundaryStatement } from "@/lib/boundary-statement";
import "@/app/home/home.css";
import "../../compliance-boundaries.css";
import { StatementPanel } from "../StatementPanel";

/**
 * The Statement of Applicability of one Compliance Boundary on its own page (#420): the same statement the Boundary page shows as
 * its section 3, for printing and linking. Every signed-in role reads it; the Boundary Owner, a Compliance Manager and an Admin
 * write the justifications. One snapshot.
 */
export default async function BoundaryStatementPage({ params }: PageProps<"/compliance-boundaries/[id]/statement">) {
  const { id } = await params;
  const user = await getActingUser();
  if (!user) return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;

  const statement = await prisma.$transaction((tx) => readBoundaryStatement(id, user, tx), READ_SNAPSHOT);
  if (!statement) {
    return (
      <div className="hc">
        <div className="hc-card hc-done" role="status">
          <h1 className="text-xl font-semibold">Compliance Boundary not found</h1>
          <p>
            It doesn&apos;t exist. <Link href="/compliance-boundaries">Back to the Compliance Boundaries</Link>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="hc cb">
      <p className="cb-crumbs">
        <Link href="/compliance-boundaries">Compliance Boundaries</Link> / <Link href={`/compliance-boundaries/${id}`}>{statement.boundary.name}</Link> / Statement of Applicability
      </p>
      <section className="hc-hero" aria-labelledby="cb-st-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Statement of Applicability</span>
          </div>
          <h1 id="cb-st-title">{statement.boundary.name}</h1>
        </div>
      </section>
      {/* Keyed on the acting user, so switching user starts from a clean state. */}
      <StatementPanel key={user.id} statement={statement} headingId="cb-st-h" />
    </div>
  );
}
