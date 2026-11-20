import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_READ_CONTROL_PACKS, ROLES_ALLOWED_TO_WRITE_CONTROL_PACKS } from "@/lib/internal-audit-rules";
import { duplicateNameMessage, updateControlPackSchema } from "@/lib/control-pack";
import { findPackNamed, getControlPack, missingControlIds } from "@/lib/control-pack-data";

const NOT_FOUND = { error: "Control Pack not found." };

export async function GET(request: NextRequest, ctx: RouteContext<"/api/control-packs/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_READ_CONTROL_PACKS);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const controlPack = await getControlPack(id);
  if (!controlPack) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json({ controlPack });
}

/** Rename, change the note, or replace the Controls (the whole new list). No Internal Audit is touched: audits don't remember the pack. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/control-packs/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_CONTROL_PACKS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateControlPackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { name, note, controlIds } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.controlPack.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return { error: NOT_FOUND.error, status: 404 };
      if (name !== undefined) {
        const clash = await findPackNamed(tx, name, id);
        if (clash) return { error: duplicateNameMessage(clash.name), status: 409 };
      }
      if (controlIds) {
        const missing = await missingControlIds(tx, controlIds);
        if (missing.length > 0) return { error: "Some of those Controls no longer exist. Reload and pick again.", status: 400 };
      }
      await tx.controlPack.update({ where: { id }, data: { ...(name !== undefined && { name }), ...(note !== undefined && { note }) } });
      if (controlIds) {
        await tx.controlPackControl.deleteMany({ where: { controlPackId: id, controlId: { notIn: controlIds } } });
        await tx.controlPackControl.createMany({ data: controlIds.map((controlId) => ({ controlPackId: id, controlId })), skipDuplicates: true });
      }
      return { controlPack: await getControlPack(id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ controlPack: outcome.controlPack });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && name !== undefined) {
      return NextResponse.json({ error: duplicateNameMessage(name) }, { status: 409 });
    }
    // A Control or the pack deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025")) {
      return NextResponse.json({ error: "The Control Pack or one of its Controls changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

/** Deletes the pack and its join rows. Every Internal Audit, draft or launched, stays as it is. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/control-packs/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_CONTROL_PACKS);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const { count } = await prisma.controlPack.deleteMany({ where: { id } });
  if (count === 0) return NextResponse.json(NOT_FOUND, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
