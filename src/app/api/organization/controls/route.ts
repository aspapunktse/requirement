import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { listOrganizationControls } from "@/lib/organization-implementation";

/**
 * Every Control the Organization implements (Organizational and Both), by code,
 * each with its Control Owner and its Organization Control Implementation
 * (PRD 0001 F-IN.1, #120). Readable by every signed-in role. A Control with no
 * implementation row reads as Not Started.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ controls: await listOrganizationControls(prisma) });
}
