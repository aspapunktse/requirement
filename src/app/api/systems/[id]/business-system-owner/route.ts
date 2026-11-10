import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { changeBusinessSystemOwner } from "@/lib/business-system-owner";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const bodySchema = z.object({ businessSystemOwnerId: z.string().min(1).nullable() });

/**
 * Set, change or clear a System's Business System Owner (#321, PRD 0002 F-BSO.2). Body
 * `{ businessSystemOwnerId: string | null }`. Allowed for the System's owner or an Admin, at any Onboarding
 * Status; anyone else (and a System that doesn't exist or can't be seen, which are not told apart) gets 403 and
 * nothing changes. 400 for a bad body, an unknown user or the System's owner as Business System Owner; 409 if
 * it changed concurrently. One Change Event when the value really changes, none when it is the same.
 * Returns `{ changed, businessSystemOwner }`.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/business-system-owner">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "businessSystemOwnerId must be a user id or null" }, { status: 400 });
  }

  const result = await changeBusinessSystemOwner(auth.user, id, parsed.data.businessSystemOwnerId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ changed: result.changed, businessSystemOwner: result.businessSystemOwner });
}
