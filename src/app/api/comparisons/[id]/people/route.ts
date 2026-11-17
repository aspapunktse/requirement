import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { listComparisonPeople } from "@/lib/comparison";

/**
 * The users the Comparison's owner or an Admin can pick as a participant or (an Admin) a new owner (#373): everyone with a
 * System-creating role. 404 when the Comparison doesn't exist or the acting user can't see it, 403 when they can't manage it.
 * Returns `{ users: [{ id, name, email, role }] }`.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/people">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const result = await listComparisonPeople(auth.user, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ users: result.users });
}
