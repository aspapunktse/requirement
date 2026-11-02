import { NextRequest, NextResponse } from "next/server";
import { authenticate, authorize } from "@/lib/api-authz";
import { listSensitivityLevels, saveSensitivityLevel } from "@/lib/sensitivity-level-data";

/**
 * Sensitivity Levels (#291). Any signed-in user reads the five levels; only an Admin changes one. A save takes one
 * level (`level`, `label`, `description`, `textColor`, `backgroundColor`), is checked as a whole (unique label, text
 * contrast, derived dark contrast) and is all-or-nothing. It is not a Change Event: the levels are display wording.
 */

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ levels: await listSensitivityLevels() });
}

export async function PATCH(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const result = await saveSensitivityLevel(body);
  if (!result.ok) return NextResponse.json({ error: result.errors.join(" "), errors: result.errors }, { status: result.status });
  return NextResponse.json({ level: result.level });
}
