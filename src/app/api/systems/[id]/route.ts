import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  return NextResponse.json({ system });
}
