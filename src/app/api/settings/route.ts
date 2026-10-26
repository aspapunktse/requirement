import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { readAppSettings, saveAppSetting } from "@/lib/app-settings";

/** App Settings (#240): Admin only, both ways. The value is checked against the setting's own schema. */

export async function GET(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ settings: await readAppSettings() });
}

const patchSchema = z.object({ key: z.string().min(1), value: z.unknown() });

export async function PATCH(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "key and value are required" }, { status: 400 });

  const result = await saveAppSetting(auth.user.id, parsed.data.key, parsed.data.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ setting: result.setting, changed: result.changed });
}
