import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { changeSystemOwners } from "@/lib/system-owner";

const bodySchema = z.object({
  systemIds: z.array(z.string().min(1)).min(1, "Pick at least one System").max(500),
  ownerId: z.string().min(1),
});

/**
 * Change the owner of one or several Systems (#233), from the System page or the Systems list's bulk bar.
 * Body `{ systemIds, ownerId }`. Allowed for a System's current owner or an Admin; the new owner must have
 * a System-creating role. All-or-nothing: 403 (naming `refusedIds`: unknown, invisible or not changeable,
 * which are not told apart) if any System is refused, 400 for a bad body or an ineligible new owner, 409 if
 * an owner changed concurrently; nothing is written in those cases. A System already owned by `ownerId`
 * is left as it is and records no Change Event. Returns `{ changed, unchanged }`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const result = await changeSystemOwners(auth.user, parsed.data.systemIds, parsed.data.ownerId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, refusedIds: result.refusedIds }, { status: result.status });
  }
  return NextResponse.json({ changed: result.changed, unchanged: result.unchanged });
}
