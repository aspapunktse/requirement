import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES, createInformationTypeSchema } from "@/lib/information-type";
import { INFORMATION_TYPE_SELECT, listInformationTypes, toRow } from "@/lib/information-type-data";

/**
 * Information Types (#303, ADR 0012). Any signed-in user reads the catalogue; only the Compliance Manager and
 * an Admin add to it. Not a Change Event: the catalogue is reference data, like the Sensitivity Level labels.
 */

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ informationTypes: await listInformationTypes() });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES);
  if ("response" in auth) return auth.response;

  const parsed = createInformationTypeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });

  try {
    const created = await prisma.informationType.create({ data: parsed.data, select: INFORMATION_TYPE_SELECT });
    return NextResponse.json({ informationType: toRow(created) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "An Information Type with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}
