import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { listControlPacks } from "@/lib/control-pack-data";
import { canReadControlPacks, canWriteControlPacks } from "@/lib/internal-audit-rules";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { ControlPacksManager, type PackControl } from "./ControlPacksManager";

const codeCollator = new Intl.Collator("en", { numeric: true });

/**
 * Control Packs (#394): the named sets of Controls the audit planner offers under "Start from". Whoever reads Internal
 * Audits sees them; only the Internal Auditor creates, renames, fills and deletes one. Packs and Controls are read in one snapshot.
 */
export default async function ControlPacksPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canReadControlPacks(user)) {
    return <p className="p-6 text-rg-muted">Your role can&apos;t see Control Packs.</p>;
  }

  const { packs, controls } = await prisma.$transaction(
    async (tx) => ({
      packs: await listControlPacks(tx),
      controls: await tx.control.findMany({ select: { id: true, code: true, title: true, category: true } }),
    }),
    READ_SNAPSHOT,
  );
  const sorted: PackControl[] = controls.sort((a, b) => codeCollator.compare(a.code, b.code));

  // Keyed on the acting user, so switching user starts from a clean state.
  return <ControlPacksManager key={user.id} initialPacks={packs} controls={sorted} canWrite={canWriteControlPacks(user)} />;
}
