import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  deriveCoverageState,
  emptyCoverageSummary,
  summarizeCoverage,
  type CoverageState,
  type CoverageSummary,
} from "@/lib/coverage-state";

/** A Requirement in the Coverage view: its mapped Controls, derived state and any gap acceptance. */
export type CoverageRequirement = {
  id: string;
  code: string;
  section: string;
  title: string;
  state: CoverageState;
  gapAcceptedAt: string | null;
  gapAcceptedBy: { id: string; name: string } | null;
  gapJustification: string | null;
  mappings: {
    id: string;
    coverage: "FULL" | "PARTIAL";
    rationale: string | null;
    control: {
      id: string;
      code: string;
      title: string;
      originFramework: { id: string; name: string; version: string } | null;
    };
  }[];
};

export type FrameworkCoverage = { summary: CoverageSummary; requirements: CoverageRequirement[] };

/**
 * Every Requirement of a Framework (section, then code), each with its Control
 * Mappings, derived Coverage state and gap acceptance, plus the header counts.
 * See #74, PRD 0001 F-OUT.1.
 */
export async function loadFrameworkCoverage(frameworkId: string): Promise<FrameworkCoverage> {
  const rows = await prisma.requirement.findMany({
    where: { frameworkId },
    orderBy: [{ section: "asc" }, { code: "asc" }],
    include: {
      gapAcceptedBy: { select: { id: true, name: true } },
      mappings: {
        orderBy: { control: { code: "asc" } },
        select: {
          id: true,
          coverage: true,
          rationale: true,
          control: {
            select: {
              id: true,
              code: true,
              title: true,
              originFramework: { select: { id: true, name: true, version: true } },
            },
          },
        },
      },
    },
  });

  const requirements = rows.map((row): CoverageRequirement => ({
    id: row.id,
    code: row.code,
    section: row.section,
    title: row.title,
    state: deriveCoverageState(row),
    gapAcceptedAt: row.gapAcceptedAt?.toISOString() ?? null,
    gapAcceptedBy: row.gapAcceptedBy,
    gapJustification: row.gapJustification,
    mappings: row.mappings,
  }));

  return { summary: summarizeCoverage(requirements.map((requirement) => requirement.state)), requirements };
}

/**
 * Covered/gap/accepted counts for several Frameworks at once (the Framework
 * list, F-FW.6). A Framework with no Requirements gets all-zero counts.
 */
export async function loadCoverageSummaries(
  frameworkIds: string[],
  client: Pick<Prisma.TransactionClient, "requirement"> = prisma,
): Promise<Record<string, CoverageSummary>> {
  const rows = await client.requirement.findMany({
    where: { frameworkId: { in: frameworkIds } },
    select: { frameworkId: true, gapAcceptedAt: true, mappings: { select: { coverage: true } } },
  });

  const statesByFramework = new Map<string, CoverageState[]>();
  for (const row of rows) {
    const states = statesByFramework.get(row.frameworkId) ?? [];
    states.push(deriveCoverageState(row));
    statesByFramework.set(row.frameworkId, states);
  }

  return Object.fromEntries(
    frameworkIds.map((id) => [id, statesByFramework.has(id) ? summarizeCoverage(statesByFramework.get(id)!) : emptyCoverageSummary()]),
  );
}

/**
 * A Requirement that gains a Full mapping is covered, so any gap acceptance
 * on it no longer describes anything: clear it, in the same transaction as the
 * mapping change. (Leaving it would silently resurrect a stale "Accepted gap"
 * if the Full mapping is later removed.) A no-op when nothing was accepted.
 */
export function clearGapAcceptance(tx: Pick<Prisma.TransactionClient, "requirement">, requirementId: string) {
  return tx.requirement.updateMany({
    where: { id: requirementId, gapAcceptedAt: { not: null } },
    data: { gapAcceptedAt: null, gapAcceptedById: null, gapJustification: null },
  });
}
