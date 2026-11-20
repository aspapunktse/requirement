import { prisma } from "@/lib/prisma";
import { closeInternalAudit } from "@/lib/internal-audit-closing";
import { createInternalAudit } from "@/lib/internal-audits";
import { launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import type { createCheckUpScenario } from "@/test/check-up-fixtures";

type Scenario = Awaited<ReturnType<typeof createCheckUpScenario>>;

/**
 * More Internal Audits over a Check-up scenario's Controls and System (#398), in the three states the list
 * shows. `cleanup` of the scenario removes them (they are all created by its Internal Auditor).
 * A closed audit has every Check-up withdrawn, so it can be closed.
 */
export async function addAudit(
  scenario: Scenario,
  options: { title: string; state: "draft" | "launched" | "closed"; dueInDays?: number; scope?: string; controlIds?: string[]; includeOrganization?: boolean },
) {
  const auditor = scenario.roleUser.INTERNAL_AUDITOR;
  const dueDate = new Date(Date.now() + (options.dueInDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
  const id = await createInternalAudit(
    {
      title: options.title,
      scopeDescription: options.scope ?? "",
      dueDate,
      includeOrganization: options.includeOrganization ?? false,
      controlIds: options.controlIds ?? scenario.systemControls.map((c) => c.id),
      systemIds: [scenario.systemId],
    },
    auditor,
  );
  if (options.state === "draft") return id;
  await launchInternalAudit(id, auditor);
  if (options.state === "closed") {
    for (const checkUp of await listCheckUps(id)) {
      await prisma.checkUpWithdrawal.create({ data: { checkUpId: checkUp.id, reason: "Test #398 withdrawn", withdrawnById: auditor } });
    }
    await closeInternalAudit(id, auditor);
  }
  return id;
}
