import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { canReadOrganizationRisks } from "@/lib/risk-roles";
import { SYSTEM_RISK_WHERE } from "@/lib/risks";
import type { RiskSourceValue } from "@/lib/risk-source";

/** One row of the cross-System Risk register (#322). Plain values, so the page can hand it to a client component. */
export type RiskRegisterRow = {
  id: string;
  title: string;
  /** The System, or null for an Organization Risk. */
  system: { id: string; name: string } | null;
  source: RiskSourceValue;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  likelihood: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "MITIGATED" | "ACCEPTED" | "TRANSFERRED" | "CLOSED";
  owner: { id: string; name: string } | null;
  /** ISO timestamp. */
  createdAt: string;
};

/**
 * Every Risk the user may see, newest first: those on Systems they may see (`visibleSystemsWhere`, the
 * rule `GET /api/systems/[id]/risks` uses) and, for the roles that may read them, the Organization Risks.
 * Read-only; managing a Risk stays on its System page or `/risks/organization`. The reads share one
 * RepeatableRead snapshot, every query on the transaction client.
 */
export async function loadRiskRegister(user: { id: string; role: UserRole }): Promise<RiskRegisterRow[]> {
  const rows = await prisma.$transaction(
    async (tx) => {
      const systemWhere = await visibleSystemsWhere(user, tx);
      return tx.risk.findMany({
        where: {
          OR: [
            { ...SYSTEM_RISK_WHERE, system: systemWhere },
            ...(canReadOrganizationRisks(user) ? [{ systemId: null }] : []),
          ],
        },
        select: {
          id: true,
          title: true,
          source: true,
          severity: true,
          likelihood: true,
          status: true,
          createdAt: true,
          system: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
    },
    { isolationLevel: "RepeatableRead" },
  );
  return rows.map((risk) => ({ ...risk, createdAt: risk.createdAt.toISOString() }));
}
