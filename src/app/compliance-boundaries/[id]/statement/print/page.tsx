import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { readOrganizationName } from "@/lib/app-settings";
import { readBoundaryStatement } from "@/lib/boundary-statement";
import { exportHeader, selectSections } from "@/lib/boundary-statement-export";
import { PrintBoundaryStatement } from "./PrintBoundaryStatement";

/**
 * The Statement of Applicability of one Compliance Boundary as a document for the print dialog (#421): the whole statement, or one
 * Framework's section with `?framework=<id>`. Readable by every signed-in role, built from the same snapshot as the page. A retired
 * Boundary has no statement, and a Framework the Boundary doesn't hold is not found.
 */
export default async function BoundaryStatementPrintPage({ params, searchParams }: PageProps<"/compliance-boundaries/[id]/statement/print">) {
  const { id } = await params;
  const { framework } = await searchParams;
  const user = await getActingUser();
  if (!user) return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;

  const frameworkId = typeof framework === "string" ? framework : null;
  const loaded = await prisma.$transaction(async (tx) => ({ statement: await readBoundaryStatement(id, user, tx), organizationName: await readOrganizationName(tx) }), READ_SNAPSHOT);
  const { statement, organizationName } = loaded;
  const sections = statement && !statement.boundary.retired ? selectSections(statement, frameworkId) : null;
  if (!statement || !sections) {
    const message = !statement ? "Compliance Boundary not found" : statement.boundary.retired ? "A retired Compliance Boundary has no Statement of Applicability" : "This Compliance Boundary doesn't hold that Framework";
    return (
      <p className="p-6" role="status">
        {message}. <Link href={statement ? `/compliance-boundaries/${id}/statement` : "/compliance-boundaries"}>Back</Link>
      </p>
    );
  }
  const header = exportHeader(statement, sections, frameworkId === null, new Date());
  return <PrintBoundaryStatement header={header} sections={sections} organizationName={organizationName} generatedByName={user.name} />;
}
