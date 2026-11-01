import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { createControlSchema } from "@/lib/control-schema";
import { controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { loadControlsFor } from "@/lib/control-library";
import { createOrganizationImplementationFor } from "@/lib/organization-implementation";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const controls = await loadControlsFor(auth.user);
  return NextResponse.json({ controls: controls.map((control) => redactDraftOrigin(auth.user, control)) });
}

/**
 * Creates a new Control Library entry — bare, with no facet/
 * Impact Level tagging yet (use `PATCH /api/controls/[id]`
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
    // An Organizational or Both Control starts with a Not Started Organization Control
    // Implementation (#120), in the same transaction so a failure leaves neither behind.
    const control = await prisma.$transaction(async (tx) => {
      const created = await tx.control.create({
        data: {
          ...rest,
          mandatory: mandatory ?? true,
          examples: examples ?? [],
        },
        include: controlIncludeFor(auth.user),
      });
      await createOrganizationImplementationFor(tx, created);
      return created;
    });
    return NextResponse.json({ control }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Control with that code already exists" }, { status: 409 });
    }
    throw error;
  }
}
