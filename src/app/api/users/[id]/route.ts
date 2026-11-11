import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { updateUser, updateUserSchema } from "@/lib/user-admin";

/**
 * Admin -> Users (#364): an Admin changes a User's name, email and/or role. Any role is allowed whatever the User
 * still holds (product-owner decision 1a), except that the last Admin can't be demoted (409).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/users/[id]">) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const { id } = await ctx.params;
  const result = await updateUser(auth.user.id, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ user: result.user, changed: result.changed });
}
