import { PrismaClient } from "@prisma/client";

/**
 * Vitest globalSetup: makes sure the database the tests run against has
 * exactly one base Framework (ADR 0007: a Control only applies to a System
 * through a Requirement of a Published Framework in scope, and the base
 * Framework is always in scope, so nearly every applicability test needs one).
 *
 * - A seeded database (the dev DB) already has ISO/IEC 27001:2022 as its base:
 *   this is a no-op, and nothing is ever flipped, renamed or deleted.
 * - CI's database is migrated but not seeded and has no Framework at all: this
 *   creates one base, once, before any test file starts, and removes it again
 *   when the run ends.
 *
 * It runs once in the main process before the (concurrent) test files, so test
 * files never create their own base and can't briefly leave two behind or
 * delete one another's. The check-and-create runs under a Postgres advisory
 * lock, so two vitest processes started together can't both create one either.
 * It never creates a second base (it only creates when the count is 0), and the
 * fixture uses the seed's own name/version, so if a killed run skips teardown a
 * later `prisma db seed` adopts the row instead of adding another base.
 */
const SEEDED_BASE = { name: "ISO/IEC 27001", version: "2022" };
const ADVISORY_LOCK_KEY = 850_085;

export default async function setup() {
  const prisma = new PrismaClient();
  let createdBaseId: string | null = null;
  try {
    createdBaseId = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
      if ((await tx.framework.count({ where: { isBase: true } })) > 0) return null;
      const nameTaken = await tx.framework.findUnique({ where: { name_version: SEEDED_BASE } });
      const framework = await tx.framework.create({
        data: {
          name: nameTaken ? `Test Base Framework ${Date.now()}` : SEEDED_BASE.name,
          version: nameTaken ? "1" : SEEDED_BASE.version,
          isBase: true,
          status: "PUBLISHED",
        },
      });
      return framework.id;
    });
  } finally {
    await prisma.$disconnect();
  }

  // Teardown: only ever remove the base this run created, never a pre-existing (seeded) one.
  return async function teardown() {
    if (!createdBaseId) return;
    const cleanup = new PrismaClient();
    try {
      await cleanup.framework.deleteMany({ where: { id: createdBaseId, isBase: true } });
    } catch (error) {
      console.warn("vitest globalSetup: couldn't remove the fixture base Framework", error);
    } finally {
      await cleanup.$disconnect();
    }
  };
}
