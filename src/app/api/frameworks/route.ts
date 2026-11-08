import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { loadCoverageSummaries } from "@/lib/framework-coverage";
import { BASE_FRAMEWORK_ERRORS, canSeeDraftFrameworks, checkBaseFrameworkInvariant, visibleFrameworksWhere } from "@/lib/frameworks";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  // Draft Frameworks are only visible to the requirement-database roles (#73). `?curatable=true` lists the
  // Frameworks the user may curate instead (#320: all for those roles, the user's own non-base ones for a Framework
  // Owner, Drafts included), which the Framework admin page reloads after a change.
  const curatable = request.nextUrl.searchParams.get("curatable") === "true";
  const frameworks = await prisma.framework.findMany({
    where: curatable
      ? canSeeDraftFrameworks(auth.user)
        ? {}
        : { ownerId: auth.user.id, isBase: false }
      : visibleFrameworksWhere(auth.user),
    orderBy: [{ name: "asc" }, { version: "asc" }],
    include: { _count: { select: { requirements: true } } },
  });
  // Covered / gap / accepted counts per Framework (F-FW.6, #74).
  const summaries = await loadCoverageSummaries(frameworks.map((framework) => framework.id));
  return NextResponse.json({
    frameworks: frameworks.map((framework) => ({ ...framework, coverage: summaries[framework.id] })),
  });
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
 * Creates a Draft Framework. Publishing is a separate action
 * (POST /api/frameworks/[id]/publish), so `status` is not accepted here. Exactly one Framework is the base; asking
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
