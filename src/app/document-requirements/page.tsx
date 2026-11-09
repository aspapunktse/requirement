import { getActingUser } from "@/lib/acting-user";
import { canCurateDocumentRequirements } from "@/lib/document-requirement";
import { listDocumentRequirements } from "@/lib/document-requirement-data";
import { DocumentRequirementsRegister } from "./DocumentRequirementsRegister";

/**
 * The Document Requirement catalogue (#323, PRD 0002 F-DOC.1): a register with a drawer, in the look of the
 * Information Types catalogue. Every signed-in role reads it; the Compliance Manager and Admin curate it.
 */
export default async function DocumentRequirementsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  // Keyed on the acting user, so switching user starts from a clean state (no open drawer carried over).
  return <DocumentRequirementsRegister key={user.id} initialRequirements={await listDocumentRequirements()} canCurate={canCurateDocumentRequirements(user)} />;
}
