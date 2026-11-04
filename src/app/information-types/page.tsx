import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { canCurateInformationTypes } from "@/lib/information-type";
import { listInformationTypes } from "@/lib/information-type-data";
import { listSensitivityLevels } from "@/lib/sensitivity-level-data";
import { InformationTypesRegister } from "./InformationTypesRegister";

/**
 * The Information Type catalogue (#303, ADR 0012), design proposal A "Register and drawer" (#302): a register
 * table with a drawer that edits a type (the Compliance Manager and Admin) or shows which Systems declare it
 * (everyone else). Every signed-in role reads it. The table and the Sensitivity Levels are read in one snapshot.
 */
export default async function InformationTypesPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const { types, levels } = await prisma.$transaction(
    async (tx) => ({ types: await listInformationTypes(tx), levels: await listSensitivityLevels(tx) }),
    { isolationLevel: "RepeatableRead" },
  );

  // Keyed on the acting user, so switching user starts from a clean state (no open drawer carried over).
  return <InformationTypesRegister key={user.id} initialTypes={types} levels={levels} canCurate={canCurateInformationTypes(user)} />;
}
