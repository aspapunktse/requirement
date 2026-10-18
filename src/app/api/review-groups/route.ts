import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import {
  loadReviewGroup,
  reviewGroupDescriptionSchema,
  reviewGroupInclude,
  reviewGroupNameSchema,
} from "@/lib/review-groups";

/** Every Review Group with its members and tied Frameworks. Admins and Compliance Managers only: they manage the groups and the ties. */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const reviewGroups = await prisma.reviewGroup.findMany({ orderBy: { name: "asc" }, include: reviewGroupInclude });
  return NextResponse.json({ reviewGroups });
}

const createReviewGroupSchema = z.object({
  name: reviewGroupNameSchema,
  description: reviewGroupDescriptionSchema.optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const parsed = createReviewGroupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const created = await prisma.reviewGroup.create({ data: parsed.data });
    return NextResponse.json({ reviewGroup: await loadReviewGroup(created.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Review Group with that name already exists" }, { status: 409 });
    }
    throw error;
  }
}
