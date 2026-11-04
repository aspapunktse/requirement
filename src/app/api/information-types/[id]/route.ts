import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import {
  IN_USE_MESSAGE,
  ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES,
  updateInformationTypeSchema,
  type DeclaringSystem,
} from "@/lib/information-type";
import { INFORMATION_TYPE_SELECT, SuggestedFrameworksRefused, assertSuggestableFrameworks, getInformationType, toRow } from "@/lib/information-type-data";
import { canSeeDraftFrameworks } from "@/lib/frameworks";
import { visibleSystemsWhere } from "@/lib/system-visibility";

const NOT_FOUND = { error: "Information Type not found." };

/** One type with the Systems that declare it (only those the acting user may see; `systemCount` counts them all). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/information-types/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const informationType = await getInformationType(id, prisma, canSeeDraftFrameworks(auth.user));
  if (!informationType) return NextResponse.json(NOT_FOUND, { status: 404 });

  const where = await visibleSystemsWhere(auth.user);
  const systems: DeclaringSystem[] = await prisma.system.findMany({
    where: { AND: [where, { informationTypes: { some: { id } } }] },
    select: { id: true, name: true, vendor: true, sensitivityLevel: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ informationType, systems });
}

/**
 * Rename, describe, change the level or pick the suggested Frameworks. A level change leaves every System as it is (ADR 0012),
 * and so does a change of Frameworks (ADR 0013): the Systems that declare the type are flagged for their owners by the
 * suggestion rule, nothing is written to them.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/information-types/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateInformationTypeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });

  try {
    const { frameworkIds, ...data } = parsed.data;
    const updated = await prisma.$transaction(async (tx) => {
      if (frameworkIds) await assertSuggestableFrameworks(tx, frameworkIds);
      return tx.informationType.update({
        where: { id },
        data: { ...data, ...(frameworkIds && { suggestedFrameworks: { set: frameworkIds.map((frameworkId) => ({ id: frameworkId })) } }) },
        select: INFORMATION_TYPE_SELECT,
      });
    });
    return NextResponse.json({ informationType: toRow(updated, true) });
  } catch (error) {
    if (error instanceof SuggestedFrameworksRefused) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") return NextResponse.json(NOT_FOUND, { status: 404 });
      if (error.code === "P2002") return NextResponse.json({ error: "An Information Type with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}

/** Refused with 409 while any System declares the type; the check and the delete are one transaction. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/information-types/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const outcome = await prisma.$transaction(async (tx) => {
    // Lock the type's row: declaring it inserts a join row that takes a share lock on it, so no System can
    // start declaring it between the count and the delete.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InformationType" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return { status: "missing" as const };
    const count = await tx.system.count({ where: { informationTypes: { some: { id } } } });
    if (count > 0) return { status: "in-use" as const, count };
    await tx.informationType.delete({ where: { id } });
    return { status: "deleted" as const };
  });

  if (outcome.status === "missing") return NextResponse.json(NOT_FOUND, { status: 404 });
  if (outcome.status === "in-use") return NextResponse.json({ error: IN_USE_MESSAGE(outcome.count) }, { status: 409 });
  return new NextResponse(null, { status: 204 });
}
