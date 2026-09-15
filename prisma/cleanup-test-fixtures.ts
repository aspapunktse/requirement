/**
 * Best-effort cleanup for test-fixture rows that leak into the dev database
 * when a background `vitest` run gets killed mid-flight, before its
 * `afterAll` cleanup executes (tests run against the same Postgres database
 * as `npm run dev` — see HANDOFF.md's "Conventions and gotchas" section).
 *
 * Looks for the naming convention the test suite uses for throwaway fixtures
 * — `test-*` emails, `Test *` catalog names, `TEST*` Requirement codes —
 * across User/Requirement/DeploymentFacet/RegulatoryOverlay/Capability/
 * BusinessUnit/Framework, and deletes whatever isn't still referenced
 * elsewhere (a System, Assessment, Risk, or Approval). Anything that *is*
 * still referenced is reported, not force-deleted — that's more likely a
 * genuinely orphaned fixture worth a human look than something safe to
 * silently cascade away.
 *
 * Not part of the normal seed flow. Run on demand:
 *   npx tsx prisma/cleanup-test-fixtures.ts
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const insensitiveStartsWith = (value: string): Prisma.StringFilter => ({
  startsWith: value,
  mode: "insensitive",
});

async function cleanup<T extends { id: string }>(
  label: string,
  candidates: T[],
  describe: (row: T) => string,
  remove: (id: string) => Promise<unknown>,
) {
  if (candidates.length === 0) {
    console.log(`${label}: none found.`);
    return;
  }
  let deleted = 0;
  for (const row of candidates) {
    try {
      await remove(row.id);
      deleted++;
      console.log(`${label}: deleted ${describe(row)}`);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        console.log(`${label}: skipped ${describe(row)} — still referenced elsewhere, not force-deleting.`);
      } else {
        throw e;
      }
    }
  }
  console.log(`${label}: ${deleted}/${candidates.length} deleted.`);
}

async function main() {
  await cleanup(
    "User",
    await prisma.user.findMany({ where: { email: insensitiveStartsWith("test-") } }),
    (u) => u.email,
    (id) => prisma.user.delete({ where: { id } }),
  );

  await cleanup(
    "Requirement",
    await prisma.requirement.findMany({ where: { code: insensitiveStartsWith("test") } }),
    (r) => `${r.code} (${r.title})`,
    (id) => prisma.requirement.delete({ where: { id } }),
  );

  await cleanup(
    "DeploymentFacet",
    await prisma.deploymentFacet.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (f) => f.name,
    (id) => prisma.deploymentFacet.delete({ where: { id } }),
  );

  await cleanup(
    "RegulatoryOverlay",
    await prisma.regulatoryOverlay.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (o) => o.name,
    (id) => prisma.regulatoryOverlay.delete({ where: { id } }),
  );

  await cleanup(
    "Capability",
    await prisma.capability.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (c) => c.name,
    (id) => prisma.capability.delete({ where: { id } }),
  );

  await cleanup(
    "BusinessUnit",
    await prisma.businessUnit.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (b) => b.name,
    (id) => prisma.businessUnit.delete({ where: { id } }),
  );

  await cleanup(
    "Framework",
    await prisma.framework.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (f) => f.name,
    (id) => prisma.framework.delete({ where: { id } }),
  );

  await cleanup(
    "System",
    await prisma.system.findMany({ where: { name: insensitiveStartsWith("test ") } }),
    (s) => s.name,
    (id) => prisma.system.delete({ where: { id } }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
