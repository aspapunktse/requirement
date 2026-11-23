import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { canCurateBoundaries } from "@/lib/compliance-boundary";
import { getBoundary, loadBoundaryChoices } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "../../compliance-boundaries.css";
import { BoundaryForm } from "../../BoundaryForm";

/** Edit a Compliance Boundary's name, description, Business Unit, Frameworks and Boundary Owner (#418): a Compliance Manager or an Admin. */
export default async function EditComplianceBoundaryPage({ params }: PageProps<"/compliance-boundaries/[id]/edit">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }
  if (!canCurateBoundaries(user)) {
    return <p className="p-6 text-rg-muted">Only Compliance Managers and Admins can edit a Compliance Boundary.</p>;
  }

  const { boundary, choices } = await prisma.$transaction(async (tx) => ({ boundary: await getBoundary(id, tx), choices: await loadBoundaryChoices(tx) }), READ_SNAPSHOT);
  if (!boundary) return <p className="p-6 text-rg-muted">Compliance Boundary not found.</p>;

  return <BoundaryForm key={boundary.id} choices={choices} boundary={boundary} />;
}
