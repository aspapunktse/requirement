import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_READ_CONTROL_PACKS, ROLES_ALLOWED_TO_WRITE_CONTROL_PACKS } from "@/lib/internal-audit-rules";
import { createControlPackSchema, duplicateNameMessage } from "@/lib/control-pack";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { findPackNamed, getControlPack, listControlPacks, missingControlIds } from "@/lib/control-pack-data";

/**
 * Control Packs (#394). Whoever reads Internal Audits reads the packs; only the Internal Auditor creates one. Curation,
 * not compliance evidence, so no Change Event is written.
 */

export async function GET(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_READ_CONTROL_PACKS);
  if ("response" in auth) return auth.response;
  const controlPacks = await prisma.$transaction((tx) => listControlPacks(tx), READ_SNAPSHOT);
  return NextResponse.json({ controlPacks });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_CONTROL_PACKS);
  if ("response" in auth) return auth.response;

  const parsed = createControlPackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { name, note, controlIds } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const clash = await findPackNamed(tx, name);
      if (clash) return { error: duplicateNameMessage(clash.name), status: 409 };
      const missing = await missingControlIds(tx, controlIds);
      if (missing.length > 0) return { error: "Some of those Controls no longer exist. Reload and pick again.", status: 400 };
      const created = await tx.controlPack.create({
        data: { name, note, controls: { create: controlIds.map((controlId) => ({ controlId })) } },
        select: { id: true },
      });
      return { controlPack: await getControlPack(created.id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ controlPack: outcome.controlPack }, { status: 201 });
  } catch (error) {
    // Two creates of the same name racing: the unique index on lower("name") refuses the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: duplicateNameMessage(name) }, { status: 409 });
    }
    throw error;
  }
}
