import type { Prisma, UserRole } from "@prisma/client";
import { memberState } from "@/lib/compliance-boundary";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import type { BoundaryPerimeter, PerimeterMember, PerimeterProvider } from "@/lib/boundary-perimeter-rules";

export * from "@/lib/boundary-perimeter-rules";

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1);

/**
 * Reads a Boundary's perimeter (#433) on the caller's transaction `tx` (every query runs on it): the members by state, and the
 * Provider dependencies of the counted and not-yet-operating members (closed members are not drawn, so their dependencies aren't
 * either). Visibility (ADR 0004, `visibleSystemsWhere`): member names are read by every role, as on the rest of the page, and
 * `linkable` says whether the acting user may open one. A Provider outside the perimeter that the acting user may not see is
 * returned without its id, name or Onboarded state (`name: null`), keyed by its position, so nothing about it reaches the page.
 * Null when there is no such Boundary.
 */
export async function readBoundaryPerimeter(boundaryId: string, user: { id: string; role: UserRole }, tx: Prisma.TransactionClient): Promise<BoundaryPerimeter | null> {
  const boundary = await tx.complianceBoundary.findUnique({
    where: { id: boundaryId },
    select: { systems: { select: { system: { select: { id: true, name: true, status: true, evaluationClosedAt: true } } } } },
  });
  if (!boundary) return null;

  const drawnStates = new Set(["OPERATING", "NOT_YET_OPERATING"]);
  const members = boundary.systems.map(({ system }) => ({ ...system, state: memberState(system) }));
  const drawn = members.filter((member) => drawnStates.has(member.state));
  const drawnIds = new Set(drawn.map((member) => member.id));

  const dependencies = drawn.length === 0 ? [] : await tx.providerDependency.findMany({ where: { dependentId: { in: [...drawnIds] } }, select: { dependentId: true, providerId: true } });
  const outsideIds = [...new Set(dependencies.map((dependency) => dependency.providerId).filter((id) => !drawnIds.has(id)))];

  const visibleWhere = await visibleSystemsWhere(user, tx);
  const candidateIds = [...new Set([...members.map((member) => member.id), ...outsideIds])];
  const visibleIds = new Set((await tx.system.findMany({ where: { AND: [{ id: { in: candidateIds } }, visibleWhere] }, select: { id: true } })).map((row) => row.id));
  const providerRows = outsideIds.length === 0 ? [] : await tx.system.findMany({ where: { id: { in: outsideIds } }, select: { id: true, name: true, status: true } });

  const toMember = (member: (typeof members)[number]): PerimeterMember => ({ id: member.id, name: member.name, state: member.state, status: member.status, linkable: visibleIds.has(member.id) });
  const dependentsOf = (providerId: string) => dependencies.filter((dependency) => dependency.providerId === providerId).map((dependency) => dependency.dependentId);

  const visibleProviders: PerimeterProvider[] = providerRows
    .filter((row) => visibleIds.has(row.id))
    .sort(byName)
    .map((row) => ({ key: row.id, id: row.id, name: row.name, onboarded: row.status === "ONBOARDED", dependentIds: dependentsOf(row.id) }));
  // Hidden ones are ordered by id (not by name, which would order by something the user may not read) and keyed by position.
  const hiddenProviders: PerimeterProvider[] = providerRows
    .filter((row) => !visibleIds.has(row.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((row, index) => ({ key: `hidden-${index + 1}`, id: null, name: null, onboarded: null, dependentIds: dependentsOf(row.id) }));

  return {
    inside: members.filter((member) => member.state === "OPERATING").map(toMember).sort(byName),
    edge: members.filter((member) => member.state === "NOT_YET_OPERATING").map(toMember).sort(byName),
    closed: members.filter((member) => member.state === "CLOSED").map(toMember).sort(byName),
    providers: [...visibleProviders, ...hiddenProviders],
    inherits: dependencies.filter((dependency) => drawnIds.has(dependency.providerId)).map((dependency) => ({ from: dependency.providerId, to: dependency.dependentId })),
  };
}
