import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Prisma `include` for a Control plus everything the admin UI and API show about it. */
export const controlInclude = {
  deploymentFacets: true,
  regulatoryOverlays: true,
  capabilities: true,
  mappings: {
    select: {
      id: true,
      coverage: true,
      requirement: {
        select: {
          id: true,
          code: true,
          title: true,
          framework: { select: { id: true, name: true, version: true } },
        },
      },
    },
  },
} satisfies Prisma.ControlInclude;

export type BaseFrameworkViolation = "BASE_EXISTS" | "LAST_BASE";

/**
 * There is exactly one base Framework (ISO/IEC 27001:2022). Enforced here
 * rather than with a partial unique index, which Prisma can't represent
 * without showing up as schema drift.
 *
 * `next` is what the operation would leave `isBase` as for `frameworkId`
 * (undefined for a create, which has no id yet). Returns why it's not
 * allowed, or null. Making a second Framework the base, or unsetting the only
 * base, are both refused; moving the base is not supported.
 */
export async function checkBaseFrameworkInvariant(
  frameworkId: string | undefined,
  next: { wasBase: boolean; isBase: boolean },
): Promise<BaseFrameworkViolation | null> {
  if (next.isBase && !next.wasBase) {
    const otherBase = await prisma.framework.count({
      where: { isBase: true, ...(frameworkId ? { id: { not: frameworkId } } : {}) },
    });
    if (otherBase > 0) return "BASE_EXISTS";
  }
  if (next.wasBase && !next.isBase) return "LAST_BASE";
  return null;
}

export const BASE_FRAMEWORK_ERRORS: Record<BaseFrameworkViolation, string> = {
  BASE_EXISTS: "There is already a base Framework; exactly one Framework can be the base",
  LAST_BASE: "The base Framework can't be unset or retired; exactly one Framework must be the base",
};
