import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInternalAudit } from "@/lib/internal-audits";
import { launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * A launched Internal Audit with Check-ups, built from fixtures only (CI's database is migrated,
 * not seeded). Every name and code carries `tag` and this run's suffix, so test files never meet
 * each other's rows. The fixture Controls apply to the fixture Systems through a fixture Framework
 * that only the fixture Systems have in scope, so nothing here touches the base Framework.
 *
 * Created: one user per role, a System Owner and a Control Owner, `systemControls` Per-System
 * Controls and `organizationControls` Organizational Controls (owned by the Control Owner), one
 * System, and a launched audit over all of them. That is `systemControls` System-level and
 * `organizationControls` Organization-level Check-ups. `cleanup` removes everything in an order
 * the RESTRICT keys allow.
 */

export const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];

export async function createCheckUpScenario(tag: string, shape: { systemControls: number; organizationControls: number }) {
  const suffix = `${process.pid}-${Date.now()}`;
  const makeUser = async (label: string, role: UserRole) =>
    (await prisma.user.create({ data: { email: `test-${tag}-${label}-${suffix}@example.com`, name: `Test ${tag} ${label}`, role } })).id;

  const roleUser = {} as Record<UserRole, string>;
  for (const role of ALL_ROLES) roleUser[role] = await makeUser(role.toLowerCase(), role);
  const secondAuditor = await makeUser("second-auditor", "INTERNAL_AUDITOR");
  const systemOwner = await makeUser("system-owner", "SYSTEM_OWNER");
  const controlOwner = await makeUser("control-owner", "RISK_OWNER");

  const makeControl = async (label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM", ownerId?: string) => {
    const code = `TEST-${tag}-${label}-${suffix}`;
    const control = await prisma.control.create({
      data: { code, title: `Test ${tag} Control ${label}`, description: "d", category: "Security", applicability, question: `Is ${label} in place?`, ...(ownerId && { ownerId }) },
    });
    return { id: control.id, code };
  };
  const systemControls = [];
  for (let i = 1; i <= shape.systemControls; i++) systemControls.push(await makeControl(`SYS${i}`, "PER_SYSTEM"));
  const organizationControls = [];
  for (let i = 1; i <= shape.organizationControls; i++) organizationControls.push(await makeControl(`ORG${i}`, "ORGANIZATIONAL", controlOwner));

  const framework = await createFixtureFramework(tag);
  await mapControlsToFramework(framework.id, systemControls.map((c) => c.id));
  const systemName = `Test ${tag} System ${suffix}`;
  const system = await prisma.system.create({ data: { name: systemName, ownerId: systemOwner, frameworkScopes: { connect: [{ id: framework.id }] } } });

  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const auditTitle = `Test ${tag} Audit ${suffix}`;
  const auditId = await createInternalAudit(
    {
      title: auditTitle,
      dueDate,
      includeOrganization: organizationControls.length > 0,
      controlIds: [...systemControls, ...organizationControls].map((c) => c.id),
      systemIds: [system.id],
    },
    roleUser.INTERNAL_AUDITOR,
  );
  await launchInternalAudit(auditId, roleUser.INTERNAL_AUDITOR);
  const checkUps = await listCheckUps(auditId);

  return {
    suffix,
    roleUser,
    secondAuditor,
    systemOwner,
    controlOwner,
    systemControls,
    organizationControls,
    systemId: system.id,
    systemName,
    auditId,
    auditTitle,
    dueDate,
    checkUps,
    /** The Check-up of `controlCode` for the System (`organization` false) or the Organization. */
    find: (controlCode: string, organization = false) =>
      checkUps.find((c) => c.control.code === controlCode && (organization ? c.target.kind === "organization" : c.target.kind === "system"))!,
    /** Creates the response of a Check-up directly (one Yes answer per question), as its recipient. */
    answer: async (checkUpId: string, userId: string) => {
      const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId } });
      await prisma.checkUpResponse.create({
        data: {
          checkUpId,
          respondedById: userId,
          lastChangedById: userId,
          evidenceLinks: [],
          answers: { create: questions.map((q) => ({ questionId: q.id, answer: "YES" as const, description: "" })) },
        },
      });
    },
    /** Removes everything this scenario created, evaluations and responses with their Check-ups. */
    cleanup: async () => {
      const audits = await prisma.internalAudit.findMany({ where: { createdById: roleUser.INTERNAL_AUDITOR }, select: { id: true } });
      const ids = audits.map((a) => a.id);
      await prisma.changeEvent.deleteMany({ where: { systemId: null, action: "CHECK_UP_EVALUATED", detail: { contains: suffix } } });
      await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: ids } } });
      await prisma.internalAudit.deleteMany({ where: { id: { in: ids } } });
      await prisma.system.deleteMany({ where: { name: { endsWith: suffix } } });
      await prisma.control.deleteMany({ where: { code: { endsWith: suffix } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `test-${tag}-`, endsWith: `${suffix}@example.com` } } });
    },
  };
}
