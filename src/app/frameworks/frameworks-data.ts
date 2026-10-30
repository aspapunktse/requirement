import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { loadCoverageBreakdowns } from "@/lib/framework-coverage";
import { frameworkFamily, latestChange } from "@/lib/framework-family";
import { canSeeDraftFrameworks, visibleFrameworksWhere } from "@/lib/frameworks";
import { buildLineages } from "@/lib/framework-lineage";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import type { CatalogView } from "./frameworks-types";

/**
 * Everything the Framework list shows for the acting user (design proposal A "Catalog table", issue #266).
 * Visibility is unchanged: Drafts only for those who manage the requirement database
 * (`visibleFrameworksWhere`), and the Systems count includes only Systems the user can see
 * (`visibleSystemsWhere`). The Frameworks, their counts, the Systems and the lineage are read in one
 * RepeatableRead transaction, every query on `tx`, so the figures agree even while the data changes.
 */
export async function loadFrameworksView(user: { id: string; role: UserRole }): Promise<CatalogView> {
  const canCurate = canSeeDraftFrameworks(user);
  const rows = await prisma.$transaction(
    async (tx) => {
      const frameworks = await tx.framework.findMany({
        where: visibleFrameworksWhere(user),
        select: {
          id: true,
          name: true,
          version: true,
          description: true,
          isBase: true,
          strictComplianceRequired: true,
          status: true,
          createdAt: true,
          reviewGroup: { select: { name: true } },
          _count: { select: { originatedControls: true } },
        },
      });
      const breakdowns = await loadCoverageBreakdowns(
        frameworks.map((framework) => framework.id),
        tx,
      );
      // The lineage follows supersedes links through Drafts this user can't see before filtering them out (#146);
      // only the filtered result is rendered, so a hidden Draft's name and version never leave the server.
      const lineages = buildLineages(
        await tx.framework.findMany({ select: { id: true, name: true, version: true, status: true, supersedesId: true } }),
        canCurate,
      );
      // Which Systems the user may see have which Framework in their scope; the base Framework is in every System's.
      const systems = await tx.system.findMany({
        where: await visibleSystemsWhere(user, tx),
        select: { frameworkScopes: { select: { id: true } } },
      });
      const scopeCounts = new Map<string, number>();
      for (const system of systems) {
        for (const scope of system.frameworkScopes) scopeCounts.set(scope.id, (scopeCounts.get(scope.id) ?? 0) + 1);
      }

      return frameworks.map((framework) => {
        const breakdown = breakdowns[framework.id];
        const family = frameworkFamily(framework);
        return {
          id: framework.id,
          name: framework.name,
          version: framework.version,
          description: framework.description,
          isBase: framework.isBase,
          strict: framework.strictComplianceRequired,
          status: framework.status,
          group: family.group,
          family: family.family,
          level: family.level,
          requirements: breakdown.total,
          covered: breakdown.covered,
          accepted: breakdown.accepted,
          gaps: breakdown.gaps,
          partialOnly: breakdown.partialOnly,
          systems: framework.status === "DRAFT" ? null : framework.isBase ? systems.length : (scopeCounts.get(framework.id) ?? 0),
          reviewGroup: framework.reviewGroup?.name ?? null,
          supplementary: framework.status === "DRAFT" ? framework._count.originatedControls : 0,
          updatedAt: latestChange(framework.createdAt, [breakdown.latestChange]).toISOString(),
          lineage: lineages.get(framework.id) ?? [],
        };
      });
    },
    { isolationLevel: "RepeatableRead" },
  );

  return { userId: user.id, role: user.role, roleLabel: roleLabel(user.role), canCurate, rows };
}
