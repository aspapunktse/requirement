import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { countedMembersWhere, memberState } from "@/lib/compliance-boundary";
import { EFFECTIVE_SCOPE_SELECT, withEffectiveScope } from "@/lib/effective-framework-scope";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { deriveStatusesFromData, readFrameworkDerivationDataWhere, type DerivationDb } from "@/lib/requirement-status";
import { compliancePercentage, deriveRequirementStatus, type DerivedRequirementStatus } from "@/lib/requirement-status-rules";
import { resolveImplementedByOrganization } from "@/lib/effective-status";
import {
  canWriteJustifications,
  deriveStatementRow,
  type BoundaryStatement,
  type BoundaryStatementSection,
  type StatementStatus,
} from "@/lib/boundary-statement-rules";

export * from "@/lib/boundary-statement-rules";

/**
 * The Statement of Applicability of one Compliance Boundary (#420), in one RepeatableRead transaction (every query, in the helpers
 * too, runs on `tx`): the Boundary, its members by state, then per Framework the derivation for the counted Systems and the
 * justifications stored for the Boundary. A retired Boundary has no statement (#424): `sections` is empty. Null when there is no
 * such Boundary. `user` decides which counted Systems the drill-down names (System visibility, ADR 0004).
 */
export async function loadBoundaryStatement(boundaryId: string, user: { id: string; role: UserRole }): Promise<BoundaryStatement | null> {
  return prisma.$transaction((tx) => readBoundaryStatement(boundaryId, user, tx), READ_SNAPSHOT);
}

export async function readBoundaryStatement(boundaryId: string, user: { id: string; role: UserRole }, tx: Prisma.TransactionClient): Promise<BoundaryStatement | null> {
  const boundary = await tx.complianceBoundary.findUnique({
    where: { id: boundaryId },
    select: {
      id: true,
      name: true,
      retiredAt: true,
      boundaryOwnerId: true,
      boundaryOwner: { select: { name: true } },
      frameworks: { select: { framework: { select: { id: true, name: true, version: true, isBase: true } } }, orderBy: [{ framework: { name: "asc" } }, { framework: { version: "asc" } }] },
      systems: { select: { system: { select: { id: true, name: true, status: true, evaluationClosedAt: true } } } },
    },
  });
  if (!boundary) return null;

  const retired = boundary.retiredAt !== null;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const members = boundary.systems.map((entry) => ({ ...entry.system, state: memberState(entry.system) }));
  const countedSystems = members.filter((m) => m.state === "OPERATING").map(({ id, name }) => ({ id, name })).sort(byName);
  const notYetOperating = members.filter((m) => m.state === "NOT_YET_OPERATING").map(({ id, name }) => ({ id, name })).sort(byName);
  const closed = members.filter((m) => m.state === "CLOSED").map(({ id, name, status }) => ({ id, name, status })).sort(byName);

  const base = {
    boundary: { id: boundary.id, name: boundary.name, retired, ownerName: boundary.boundaryOwner?.name ?? null },
    canEdit: !retired && canWriteJustifications(user, boundary),
    countedSystems,
    notYetOperating,
    closed,
  };
  if (retired) return { ...base, systems: [], sections: [] };

  // Counted Systems the acting user may see: named in the drill-down. The others count but are never named.
  const visibleWhere = await visibleSystemsWhere(user, tx);
  const visibleIds = new Set(
    (await tx.system.findMany({ where: { AND: [countedMembersWhere(boundary.id), visibleWhere] }, select: { id: true } })).map((s) => s.id),
  );
  const systems = countedSystems.filter((s) => visibleIds.has(s.id));
  const systemIndex = new Map(systems.map((s, i) => [s.id, i]));

  const classified = (
    await tx.system.findMany({
      where: countedMembersWhere(boundary.id),
      select: {
        id: true,
        sensitivityLevel: true,
        integrityImpactLevel: true,
        availabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        ...EFFECTIVE_SCOPE_SELECT,
      },
    })
  )
    .map(withEffectiveScope)
    .sort((a, b) => (countedSystems.findIndex((s) => s.id === a.id)) - (countedSystems.findIndex((s) => s.id === b.id)));

  const stored = await tx.boundaryExclusionJustification.findMany({ where: { boundaryId: boundary.id }, select: { requirementId: true, text: true } });
  const storedByRequirement = new Map(stored.map((j) => [j.requirementId, j.text]));

  const db = tx as DerivationDb;
  const sections: BoundaryStatementSection[] = [];
  for (const { framework } of boundary.frameworks) {
    const data = await readFrameworkDerivationDataWhere({ id: framework.id }, db);
    if (!data) continue;
    const { bySystem } = await deriveStatusesFromData(data, classified, db);
    const rowsBySystem = classified.map((system) => new Map((bySystem.get(system.id) ?? []).map((row) => [row.requirementId, row.status])));

    let met = 0;
    let applicable = 0;
    const rows = data.requirements.map((requirement) => {
      const perSystem: DerivedRequirementStatus[] = rowsBySystem.map((statuses) => statuses.get(requirement.id) ?? "NOT_APPLICABLE");
      for (const status of perSystem) {
        if (status === "NOT_APPLICABLE") continue;
        applicable += 1;
        if (status === "MET") met += 1;
      }
      const organizational = requirement.controls.filter((control) => control.applicability === "ORGANIZATIONAL");
      const organizationStatus: StatementStatus | null =
        organizational.length === 0
          ? null
          : (deriveRequirementStatus({
              framework: data.framework,
              mappings: organizational.map((control) => ({
                coverage: control.coverage,
                applicable: true,
                status: resolveImplementedByOrganization(data.organizationStatusByControlId.get(control.id)).status,
              })),
              gapAcceptedAt: requirement.gapAcceptedAt,
            }).status as StatementStatus);
      return deriveStatementRow({
        requirement,
        perSystem,
        visible: classified.map((system) => systemIndex.get(system.id) ?? null),
        organizationStatus,
        organizationOnly: requirement.controls.length > 0 && organizational.length === requirement.controls.length,
        storedJustification: storedByRequirement.get(requirement.id) ?? null,
      });
    });
    sections.push({ framework, rows, met, applicable, percentage: compliancePercentage({ MET: met, applicable }) });
  }
  return { ...base, systems, sections };
}

/**
 * Is one Requirement included in a Boundary's statement right now (applies to a counted System, or met by Organizational Controls)?
 * The write route refuses a justification on an included one. Reads on the caller's transaction, the same derivation as the page.
 */
export async function isRequirementIncluded(tx: Prisma.TransactionClient, boundaryId: string, frameworkId: string, requirementId: string): Promise<boolean> {
  const db = tx as DerivationDb;
  const data = await readFrameworkDerivationDataWhere({ id: frameworkId }, db);
  const requirement = data?.requirements.find((r) => r.id === requirementId);
  if (!data || !requirement) return false;
  if (requirement.controls.some((control) => control.applicability === "ORGANIZATIONAL")) return true;
  const classified = (
    await tx.system.findMany({
      where: countedMembersWhere(boundaryId),
      select: { id: true, sensitivityLevel: true, integrityImpactLevel: true, availabilityImpactLevel: true, deploymentFacets: { select: { id: true } }, ...EFFECTIVE_SCOPE_SELECT },
    })
  ).map(withEffectiveScope);
  const { bySystem } = await deriveStatusesFromData(data, classified, db);
  return classified.some((system) => (bySystem.get(system.id) ?? []).some((row) => row.requirementId === requirementId && row.status !== "NOT_APPLICABLE"));
}
