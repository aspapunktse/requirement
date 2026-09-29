import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { controlIncludeFor } from "@/lib/frameworks";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const controls = await prisma.control.findMany({
    orderBy: { code: "asc" },
    include: controlIncludeFor(auth.user),
  });
  return NextResponse.json({ controls });
}

const createControlSchema = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    mandatory: z.boolean().optional(),
    applicability: z.enum(["ORGANIZATIONAL", "PER_SYSTEM", "BOTH"]),
    question: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
  })
  .refine((data) => data.applicability === "ORGANIZATIONAL" || !!data.question, {
    message: "A PER_SYSTEM or BOTH Control needs a Self-Assessment Question",
    path: ["question"],
  });

/**
 * Creates a new Control Library entry — bare, with no facet/overlay/
 * capability/Impact Level tagging yet (use `PATCH /api/controls/[id]`
 * to tag it once created, same two-step flow as the rest of the admin
 * catalog UI). See #52.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const parsed = createControlSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Control" }, { status: 400 });
  }

  const { mandatory, examples, ...rest } = parsed.data;

  try {
    const control = await prisma.control.create({
      data: {
        ...rest,
        mandatory: mandatory ?? true,
        examples: examples ?? [],
      },
      include: controlIncludeFor(auth.user),
    });
    return NextResponse.json({ control }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Control with that code already exists" }, { status: 409 });
    }
    throw error;
  }
}
