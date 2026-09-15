import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const requirements = await prisma.requirement.findMany({
    orderBy: { code: "asc" },
    include: { deploymentFacets: true, regulatoryOverlays: true, capabilities: true, frameworks: true },
  });
  return NextResponse.json({ requirements });
}

const createRequirementSchema = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    frameworkIds: z.array(z.string().min(1)).optional(),
    mandatory: z.boolean().optional(),
    applicability: z.enum(["ORGANIZATIONAL", "PER_SYSTEM", "BOTH"]),
    question: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
  })
  .refine((data) => data.applicability === "ORGANIZATIONAL" || !!data.question, {
    message: "A PER_SYSTEM or BOTH Requirement needs a Self-Assessment Question",
    path: ["question"],
  });

/**
 * Creates a new Requirement Catalog entry — bare, with no facet/overlay/
 * capability/Impact Level tagging yet (use `PATCH /api/requirements/[id]`
 * to tag it once created, same two-step flow as the rest of the admin
 * catalog UI). See #52.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const parsed = createRequirementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Requirement" }, { status: 400 });
  }

  const { frameworkIds, mandatory, examples, ...rest } = parsed.data;

  try {
    const requirement = await prisma.requirement.create({
      data: {
        ...rest,
        frameworks: frameworkIds ? { connect: frameworkIds.map((id) => ({ id })) } : undefined,
        mandatory: mandatory ?? true,
        examples: examples ?? [],
      },
      include: { deploymentFacets: true, regulatoryOverlays: true, capabilities: true, frameworks: true },
    });
    return NextResponse.json({ requirement }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Requirement with that code already exists" }, { status: 409 });
    }
    throw error;
  }
}
