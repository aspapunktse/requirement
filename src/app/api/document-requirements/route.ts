import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS, createDocumentRequirementSchema } from "@/lib/document-requirement";
import { DOCUMENT_REQUIREMENT_SELECT, listDocumentRequirements, toRow } from "@/lib/document-requirement-data";

/**
 * Document Requirements (#323, PRD 0002 F-DOC.1). Any signed-in user reads the catalogue; only the Compliance
 * Manager and an Admin add to it. Not a Change Event: the catalogue is reference data.
 */

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ documentRequirements: await listDocumentRequirements() });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS);
  if ("response" in auth) return auth.response;

  const parsed = createDocumentRequirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });

  try {
    const created = await prisma.documentRequirement.create({ data: parsed.data, select: DOCUMENT_REQUIREMENT_SELECT });
    return NextResponse.json({ documentRequirement: toRow(created) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Document Requirement with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}
