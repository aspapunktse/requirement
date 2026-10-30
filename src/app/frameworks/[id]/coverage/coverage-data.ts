import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { countVisibleSystemsByFramework } from "@/app/frameworks/frameworks-data";
import { deriveCoverageState } from "@/lib/coverage-state";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, visibleFrameworksWhere } from "@/lib/frameworks";
import type { CoverageRow, CoverageView } from "./coverage-types";

/**
 * Everything the Framework coverage page shows for the acting user (design proposal A "Gap ledger", issue #269),
 * or null when the Framework does not exist or the user may not see it (a Draft is "not found" for anyone who
 * can't see Drafts, `visibleFrameworksWhere`). The Framework, its Requirements with their Control Mappings, the
 * Frameworks for the switcher, the Control Library and the Systems count are read in one RepeatableRead
 * transaction, every query on `tx`, so the figures agree even while the data changes.
 *
 * The Control Library is only sent to Compliance Managers and Admins, who are the only ones to map Controls:
 * nobody else needs it, and a Supplementary Control of a Draft Framework stays out of other roles' hands.
 */
export async function loadCoverageView(
  user: { id: string; role: UserRole },
  frameworkId: string,
  requestedSection: string | null = null,
): Promise<CoverageView | null> {
  const canCurate = canSeeDraftFrameworks(user);
  return prisma.$transaction(
    async (tx) => {
      const framework = await tx.framework.findFirst({
        where: { id: frameworkId, ...visibleFrameworksWhere(user) },
        select: {
          id: true,
          name: true,
          version: true,
          status: true,
          isBase: true,
          strictComplianceRequired: true,
          reviewGroup: { select: { name: true } },
        },
      });
      if (!framework) return null;

      const rows = await tx.requirement.findMany({
        where: { frameworkId },
        orderBy: [{ section: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          section: true,
          title: true,
          text: true,
          gapAcceptedAt: true,
          gapJustification: true,
          gapAcceptedBy: { select: { name: true } },
          mappings: {
            orderBy: { control: { code: "asc" } },
            select: {
              id: true,
              coverage: true,
              rationale: true,
              control: { select: { id: true, code: true, title: true, originFrameworkId: true } },
            },
          },
        },
      });
      const requirements = rows.map(
        (row): CoverageRow => ({
          id: row.id,
          code: row.code,
          section: row.section,
          title: row.title,
          text: row.text,
          state: deriveCoverageState(row),
          justification: row.gapJustification,
          acceptedBy: row.gapAcceptedBy?.name ?? null,
          acceptedAt: row.gapAcceptedAt?.toISOString() ?? null,
          mappings: row.mappings.map((mapping) => ({
            id: mapping.id,
            controlId: mapping.control.id,
            code: mapping.control.code,
            title: mapping.control.title,
            coverage: mapping.coverage,
            rationale: mapping.rationale,
            supplementary: mapping.control.originFrameworkId !== null,
          })),
        }),
      );

      const switcher = await tx.framework.findMany({
        where: visibleFrameworksWhere(user),
        select: { id: true, name: true, version: true, status: true },
      });
      const controlRows = canCurate
        ? await tx.control.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, title: true, originFrameworkId: true } })
        : [];
      const controls = controlRows.map((c) => ({ id: c.id, code: c.code, title: c.title, supplementary: c.originFrameworkId !== null }));
      const systems = framework.status === "DRAFT" ? null : (await countVisibleSystemsByFramework(user, tx)).countFor(framework);

      return {
        userId: user.id,
        role: user.role,
        roleLabel: roleLabel(user.role),
        canCurate,
        framework: {
          id: framework.id,
          name: framework.name,
          version: framework.version,
          status: framework.status,
          isBase: framework.isBase,
          strict: framework.strictComplianceRequired,
          reviewGroup: framework.reviewGroup?.name ?? null,
          systems,
        },
        frameworks: switcher
          .map((row) => ({ id: row.id, label: frameworkLabel(row), status: row.status }))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
        requirements,
        controls,
        initialSection: requestedSection,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
