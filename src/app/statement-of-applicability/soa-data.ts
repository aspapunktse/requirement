import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks } from "@/lib/frameworks";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import {
  deriveStatementOfApplicability,
  deriveSystemStatuses,
  readStatementInputs,
  type SoaMapping,
} from "@/lib/statement-of-applicability";
import type { SoaLedgerRow, SoaRequirementGroup, SoaSystemStatus, SoaView } from "./soa-types";

const collator = new Intl.Collator("en", { numeric: true });

/** The `sourceKey` of a base Control (one authored for no Framework in particular). */
export const BASE_SOURCE_KEY = "base";
export const BASE_SOURCE_LABEL = "Base Control Library";

/**
 * The Published Frameworks' Requirement codes of a Control's mappings, one group per Framework (by label),
 * the same data as `inclusionJustification` but structured, for the chips. A Draft Framework's mapping is
 * never listed.
 */
export function requirementGroups(mappings: SoaMapping[]): SoaRequirementGroup[] {
  const codesByFramework = new Map<string, Set<string>>();
  for (const { requirement } of mappings) {
    if (requirement.framework.status !== "PUBLISHED") continue;
    const label = frameworkLabel(requirement.framework);
    const codes = codesByFramework.get(label) ?? new Set<string>();
    codes.add(requirement.code);
    codesByFramework.set(label, codes);
  }
  return [...codesByFramework.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([framework, codes]) => ({ framework, codes: [...codes].sort((a, b) => collator.compare(a, b)) }));
}

/**
 * Everything the Statement of Applicability page shows for the acting user (design proposal A "Statement
 * Ledger", issue #272). The rows are the same as the API's, plus the Control's category, Owner and origin,
 * the Requirement codes as data, and the effective status in each System.
 *
 * Rollup counts are over ALL Systems (product-owner decision 3a): they hold no name. The per-System list
 * holds only the Systems `visibleSystemsWhere` lets the acting user see, filtered here on the server, so no
 * System name the user may not see reaches the client; the rest are a count.
 *
 * A Supplementary Control of a Draft Framework is in the Statement like every Control (code and title), but
 * its Framework's name is read out only to those who can see Drafts.
 *
 * One RepeatableRead transaction, every query on `tx`, a constant number of queries however many Controls
 * and Systems there are.
 */
export async function loadSoaView(user: { id: string; role: UserRole }): Promise<SoaView> {
  const showDrafts = canSeeDraftFrameworks(user);
  return prisma.$transaction(
    async (tx) => {
      const inputs = await readStatementInputs(tx);
      const details = await tx.control.findMany({
        select: {
          id: true,
          description: true,
          category: true,
          owner: { select: { name: true } },
          originFramework: { select: { id: true, name: true, version: true, status: true } },
        },
      });
      const visibleSystems = await tx.system.findMany({
        where: await visibleSystemsWhere(user, tx),
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true },
      });

      const detailById = new Map(details.map((detail) => [detail.id, detail]));
      const controlById = new Map(inputs.controls.map((control) => [control.id, control]));
      const indexBySystemId = new Map(visibleSystems.map((system, index) => [system.id, index]));
      const statusesByControlId = deriveSystemStatuses(inputs);

      const rows = deriveStatementOfApplicability(inputs).map((row): SoaLedgerRow => {
        const detail = detailById.get(row.controlId);
        const origin = detail?.originFramework ?? null;
        const systemStatuses: SoaSystemStatus[] = [];
        for (const { systemId, status } of statusesByControlId.get(row.controlId) ?? []) {
          const index = indexBySystemId.get(systemId);
          if (index !== undefined) systemStatuses.push([index, status]);
        }
        return {
          ...row,
          description: detail?.description ?? "",
          category: detail?.category ?? "",
          sourceKey: origin ? origin.id : BASE_SOURCE_KEY,
          sourceLabel: !origin
            ? BASE_SOURCE_LABEL
            : origin.status === "PUBLISHED" || showDrafts
              ? `Supplementary · ${frameworkLabel(origin)}`
              : "Supplementary · Draft Framework",
          ownerName: detail?.owner?.name ?? null,
          requirements: row.included ? requirementGroups(controlById.get(row.controlId)?.mappings ?? []) : [],
          systemStatuses,
          hiddenSystemCount: row.systemRollup ? Math.max(0, row.systemRollup.total - systemStatuses.length) : 0,
        };
      });

      return {
        userId: user.id,
        role: user.role,
        roleLabel: roleLabel(user.role),
        canEdit: ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role),
        rows,
        systems: visibleSystems,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
