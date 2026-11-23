import Link from "next/link";
import { redirect } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { frameworkLabel } from "@/lib/framework-label";
import { listBoundaries } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "../compliance-boundaries/compliance-boundaries.css";

/**
 * The Statement of Applicability is per Compliance Boundary now (#420, ADR 0016). This old address picks one: with exactly one active
 * Boundary it goes straight to that Boundary's statement, otherwise it lists the active Boundaries to choose from. Every signed-in
 * role reads it.
 */
export default async function StatementOfApplicabilityPage() {
  const user = await getActingUser();
  if (!user) return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;

  const boundaries = await prisma.$transaction((tx) => listBoundaries(tx), READ_SNAPSHOT);
  if (boundaries.length === 1) redirect(`/compliance-boundaries/${boundaries[0].id}/statement`);

  return (
    <div className="hc cb">
      <section className="hc-hero" aria-labelledby="soa-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Compliance</span>
          </div>
          <h1 id="soa-title">Statement of Applicability</h1>
          <p className="hc-lede">A Statement of Applicability belongs to a Compliance Boundary. Pick the Boundary whose statement you want.</p>
        </div>
      </section>
      <section className="hc-card" aria-labelledby="soa-pick-h">
        <div className="hc-card-h">
          <h2 id="soa-pick-h">Compliance Boundaries</h2>
        </div>
        {boundaries.length === 0 ? (
          <p className="cb-empty">
            There is no active Compliance Boundary yet. <Link href="/compliance-boundaries">Go to the Compliance Boundaries</Link>
          </p>
        ) : (
          <ul className="cb-list">
            {boundaries.map((boundary) => (
              <li key={boundary.id}>
                <Link href={`/compliance-boundaries/${boundary.id}/statement`} className="cb-row">
                  <b>{boundary.name}</b>
                  <small>{boundary.frameworks.map(frameworkLabel).join(", ")}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
