import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { BASE_FRAMEWORK_ERRORS, checkBaseFrameworkInvariant } from "@/lib/frameworks";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const frameworks = await prisma.framework.findMany({
    orderBy: [{ name: "asc" }, { version: "asc" }],
    include: { _count: { select: { requirements: true } } },
  });
  return NextResponse.json({ frameworks });
}

const createFrameworkSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  strictComplianceRequired: z.boolean().optional(),
  licensing: z.enum(["PARAPHRASE_ONLY", "QUOTABLE"]).optional(),
  supersedesId: z.string().min(1).nullable().optional(),
  isBase: z.boolean().optional(),
});

/**
 * Creates a Draft Framework. Publishing is a separate action (#73), so
 * `status` is not accepted here. Exactly one Framework is the base; asking
 * for a second is refused (see checkBaseFrameworkInvariant).
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const parsed = createFrameworkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "name and version are required" }, { status: 400 });
  }

  const violation = await checkBaseFrameworkInvariant(undefined, {
    wasBase: false,
    isBase: parsed.data.isBase ?? false,
  });
  if (violation) {
    return NextResponse.json({ error: BASE_FRAMEWORK_ERRORS[violation] }, { status: 409 });
  }

  try {
    const framework = await prisma.framework.create({ data: parsed.data });
    return NextResponse.json({ framework }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A Framework with that name and version already exists" },
          { status: 409 },
        );
      }
      if (error.code === "P2003") {
        return NextResponse.json({ error: "The superseded Framework does not exist" }, { status: 400 });
      }
    }
    throw error;
  }
}
