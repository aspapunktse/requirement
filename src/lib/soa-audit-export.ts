import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readOrganizationName } from "@/lib/app-settings";
import { frameworkLabel } from "@/lib/framework-label";
import {
  deriveStatementOfApplicability,
  readStatementInputs,
  type StatementOfApplicabilityRow,
} from "@/lib/statement-of-applicability";

/**
 * The Statement of Applicability exported for audit (PRD 0001 F-OUT.6, #273): a print page of the whole
 * Statement with a cover. The cover holds only what the app already knows: the Organization name (an App
 * Setting, left out while unset), when it was generated and by whom, the Published Frameworks behind the
 * Statement with their versions, and the included / excluded / excluded-without-justification counts.
 * Never a System name: the rows carry rollup counts only, so the output is the same for every role.
 */

export type AuditCover = {
  /** Null while the "Organization name" App Setting is unset. */
  organizationName: string | null;
  generatedAt: string;
  generatedByName: string;
  /** "ISO/IEC 27001:2022", the base Framework first, then by label. */
  frameworks: string[];
  total: number;
  included: number;
  excluded: number;
  excludedWithoutJustification: number;
};

export type AuditExport = { cover: AuditCover; rows: StatementOfApplicabilityRow[] };

type FrameworkRef = { id: string; name: string; version: string; status: string; isBase: boolean };

const collator = new Intl.Collator("en", { numeric: true });

/**
 * The Published Frameworks the Statement is derived from: those a Control maps a Requirement of. A Framework
 * with no Control Mapping feeds nothing into the Statement, and a Draft Framework is never named.
 */
export function frameworksBehind(controls: { mappings: { requirement: { framework: FrameworkRef } }[] }[]): string[] {
  const byId = new Map<string, FrameworkRef>();
  for (const control of controls) {
    for (const { requirement } of control.mappings) {
      if (requirement.framework.status === "PUBLISHED") byId.set(requirement.framework.id, requirement.framework);
    }
  }
  return [...byId.values()]
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || collator.compare(frameworkLabel(a), frameworkLabel(b)))
    .map(frameworkLabel);
}

/** The cover from the Statement's rows and its inputs. Pure. */
export function buildAuditCover(args: {
  rows: StatementOfApplicabilityRow[];
  frameworks: string[];
  organizationName: string | null;
  generatedAt: Date;
  generatedByName: string;
}): AuditCover {
  const { rows } = args;
  const excluded = rows.filter((row) => !row.included);
  return {
    organizationName: args.organizationName?.trim() ? args.organizationName.trim() : null,
    generatedAt: args.generatedAt.toISOString(),
    generatedByName: args.generatedByName,
    frameworks: args.frameworks,
    total: rows.length,
    included: rows.length - excluded.length,
    excluded: excluded.length,
    excludedWithoutJustification: excluded.filter((row) => row.justificationMissing).length,
  };
}

/** The whole Statement and its cover, read in one RepeatableRead snapshot (every query on `tx`). */
export async function loadAuditExport(user: { name: string; role: UserRole }): Promise<AuditExport> {
  return prisma.$transaction(
    async (tx) => {
      const inputs = await readStatementInputs(tx);
      const organizationName = await readOrganizationName(tx);
      const rows = deriveStatementOfApplicability(inputs);
      return {
        rows,
        cover: buildAuditCover({
          rows,
          frameworks: frameworksBehind(inputs.controls),
          organizationName,
          generatedAt: new Date(),
          generatedByName: user.name,
        }),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
