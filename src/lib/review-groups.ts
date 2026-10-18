import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** What a Review Group's members and tied Frameworks are returned as. */
export const reviewGroupInclude = {
  members: { select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } },
  frameworks: {
    select: { id: true, name: true, version: true, status: true, isBase: true },
    orderBy: [{ name: "asc" }, { version: "asc" }],
  },
} satisfies Prisma.ReviewGroupInclude;

/** A Review Group with its members and tied Frameworks, or null if it doesn't exist. */
export function loadReviewGroup(id: string) {
  return prisma.reviewGroup.findUnique({ where: { id }, include: reviewGroupInclude });
}

/** Names are trimmed, so " GDPR " and "GDPR" can't both exist. A blank description is stored as none. */
export const reviewGroupNameSchema = z.string().trim().min(1);
export const reviewGroupDescriptionSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

export const INTERNAL_AUDITOR_MEMBER_ERROR = "An Internal Auditor can't be a member of a Review Group";
export const BASE_FRAMEWORK_TIE_ERROR =
  "The base Framework is reviewed by the base Review Step and can't be tied to a Review Group";
