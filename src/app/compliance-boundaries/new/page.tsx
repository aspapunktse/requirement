import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { canCurateBoundaries } from "@/lib/compliance-boundary";
import { loadBoundaryChoices } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "../compliance-boundaries.css";
import { BoundaryForm } from "../BoundaryForm";

/** "New Compliance Boundary" (#418): a Compliance Manager or an Admin, the roles `POST /api/compliance-boundaries` admits. */
export default async function NewComplianceBoundaryPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }
  if (!canCurateBoundaries(user)) {
    return <p className="p-6 text-rg-muted">Only Compliance Managers and Admins can add a Compliance Boundary.</p>;
  }

  const choices = await prisma.$transaction((tx) => loadBoundaryChoices(tx), READ_SNAPSHOT);
  return <BoundaryForm choices={choices} />;
}
