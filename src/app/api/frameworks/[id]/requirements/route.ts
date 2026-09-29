import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { requirementInclude, visibleFrameworksWhere } from "@/lib/frameworks";

/**
 * A Framework's Requirements with their Control Mappings, ordered by section
 * then code. A Draft Framework is a 404 for anyone who can't see Drafts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/requirements">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const framework = await prisma.framework.findFirst({ where: { id, ...visibleFrameworksWhere(auth.user) } });
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  const requirements = await prisma.requirement.findMany({
    where: { frameworkId: id },
    orderBy: [{ section: "asc" }, { code: "asc" }],
    include: requirementInclude,
  });
  return NextResponse.json({ requirements });
}

const createRequirementSchema = z.object({
  code: z.string().trim().min(1),
  section: z.string().trim().min(1),
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

/**
 * Adds a Requirement to a Framework, Draft or Published (the base Framework
 * included). For a PARAPHRASE_ONLY Framework `text` must be the author's own
 * words, never verbatim; that's a convention the UI reminds the author of,
 * not something the API can check.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/requirements">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = createRequirementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "code, section, title and text are required" }, { status: 400 });
  }

  const framework = await prisma.framework.findUnique({ where: { id } });
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  try {
    const requirement = await prisma.requirement.create({
      data: { ...parsed.data, frameworkId: id },
      include: requirementInclude,
    });
    return NextResponse.json({ requirement }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "This Framework already has a Requirement with that code" },
        { status: 409 },
      );
    }
    throw error;
  }
}
