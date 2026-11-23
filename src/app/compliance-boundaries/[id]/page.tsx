import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { canCurateBoundaries, canManageBoundaryMembers } from "@/lib/compliance-boundary";
import { readBoundaryStatement } from "@/lib/boundary-statement";
import { getBoundary, getBoundaryCompliance, loadMemberCandidates, loadPreparedCandidates } from "@/lib/compliance-boundary-data";
import "@/app/home/home.css";
import "../compliance-boundaries.css";
import { BoundaryView } from "./BoundaryView";

/**
 * One Compliance Boundary (#418): its Frameworks, Business Unit, Boundary Owner and members. Every signed-in role reads it and
 * sees every member's name; a member links to its System page only when the acting user may see that System
 * (`visibleSystemsWhere`). The Boundary Owner, a Compliance Manager and an Admin add and remove Systems; a Compliance Manager
 * and an Admin edit the Boundary. Read in one snapshot.
 */
export default async function ComplianceBoundaryPage({ params }: PageProps<"/compliance-boundaries/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const data = await prisma.$transaction(async (tx) => {
    const boundary = await getBoundary(id, tx);
    if (!boundary) return null;
    const where = await visibleSystemsWhere(user, tx);
    const visible = await tx.system.findMany({ where: { AND: [{ id: { in: boundary.members.map((member) => member.systemId) } }, where] }, select: { id: true } });
    const manage = canManageBoundaryMembers(user, { boundaryOwnerId: boundary.boundaryOwner?.id ?? null });
    // A retired Boundary is a read-only record: no Compliance Percentage, no candidates (#424).
    const active = boundary.retirement === null;
    const compliance = active ? await getBoundaryCompliance(id, boundary.frameworks.map((framework) => framework.id), tx) : [];
    const statement = (await readBoundaryStatement(id, user, tx))!;
    return { boundary, compliance, statement, linkableSystemIds: visible.map((system) => system.id), candidates: manage && active ? await loadMemberCandidates(id, tx) : [], prepared: manage && active ? await loadPreparedCandidates(id, tx) : [] };
  }, READ_SNAPSHOT);

  if (!data) {
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

  const { boundary, compliance, statement, linkableSystemIds, candidates, prepared } = data;
  const canManageMembers = canManageBoundaryMembers(user, { boundaryOwnerId: boundary.boundaryOwner?.id ?? null });
  // Keyed on the acting user and the members, so switching user, or a refresh after a change, starts from a clean state.
  return (
    <BoundaryView
      key={`${user.id}:${boundary.members.map((member) => member.systemId).join(",")}`}
      boundary={boundary}
      compliance={compliance}
      statement={statement}
      linkableSystemIds={linkableSystemIds}
      candidates={candidates}
      prepared={prepared}
      canManageMembers={canManageMembers}
      canCurate={canCurateBoundaries(user)}
    />
  );
}
