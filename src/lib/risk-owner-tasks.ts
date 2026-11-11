import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { OPEN_RISK_STATUS } from "@/lib/risk-analysis";
import { systemRiskHref } from "@/lib/risk-roles";
import { riskSeverityTone } from "@/lib/status-tones";
import { STRICTLY_READ_ONLY_ROLES } from "@/lib/system-permissions";
import { visibleSystemsWhere } from "@/lib/system-visibility";

/**
 * The "My tasks" rows a user has as the Risk owner of Risks (#360, product-owner decision of 2026-11-11): one per Open Risk on a
 * System they own the Risk of, linking to the opened Risk (`#risk-<id>`). Keyed on `ownerId` alone, whatever the user's role. The row
 * goes when the Risk is no longer Open (Accepted counts as no longer open, as in the Open Risks figure) or someone else becomes its owner.
 * Only Risks on Systems the user can see (`visibleSystemsWhere`) produce a row, and an Organization Risk, which has no System, never
 * does. A strictly read-only role (the Internal Auditor, #147) gets none, as for Control Owner tasks.
 *
 * The row id is the Risk's id, the same as the Risk Owner's and Business Risk Owner's own "open Risk" rows, so merging keeps this one
 * (it says why the user is on the hook) and drops the duplicate.
 */
export async function getRiskOwnerTasks(user: { id: string; role: UserRole }): Promise<TaskRow[]> {
  if (STRICTLY_READ_ONLY_ROLES.includes(user.role)) return [];
  const visible = await visibleSystemsWhere(user);
  const risks = await prisma.risk.findMany({
    where: { ownerId: user.id, status: OPEN_RISK_STATUS, system: { is: visible } },
    select: { id: true, title: true, severity: true, updatedAt: true, system: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return risks.flatMap((risk): TaskRow[] =>
    risk.system
      ? [
          {
            id: risk.id,
            kind: "Risk",
            title: risk.title,
            subtitle: `${risk.system.name} · you are the owner`,
            tone: riskSeverityTone(risk.severity),
            status: risk.severity.charAt(0) + risk.severity.slice(1).toLowerCase(),
            updatedAt: risk.updatedAt,
            href: systemRiskHref(risk.system.id, risk.id),
          },
        ]
      : [],
  );
}
