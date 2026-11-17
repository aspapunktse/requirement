import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { addParticipant } from "@/lib/comparison";

const bodySchema = z.object({ userId: z.string().min(1) });

/** Names a participant. Body `{ userId }`. The owner or an Admin (403 otherwise, 404 when hidden); 400 for an unknown user or the owner; 409 for a repeat. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/participants">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  const result = await addParticipant(auth.user, id, parsed.data.userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ participant: { userId: result.value.userId } }, { status: 201 });
}
