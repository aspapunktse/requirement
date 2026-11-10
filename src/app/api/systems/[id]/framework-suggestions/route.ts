import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageFrameworkScopes } from "@/lib/framework-scope";
import { NOT_SUGGESTED_FRAMEWORK, leaveSuggestionOut, readSuggestions } from "@/lib/framework-suggestions-data";
import type { Suggestion } from "@/lib/framework-suggestions";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * The Frameworks the System's Information Types suggest (#300, ADR 0013), and the owner's decision to leave one out.
 * Adding a suggested Framework to the scope is the existing Framework Scope route; this route never changes a scope.
 * Leaving a suggestion out is not a Change Event: it changes nothing about the System's Controls.
 */

/** A suggestion as the API shows it: the Framework, the declared types that suggest it and what became of it. */
function toJson(suggestion: Suggestion) {
  return {
    framework: { id: suggestion.framework.id, name: suggestion.framework.name, version: suggestion.framework.version },
    types: suggestion.types,
    state: suggestion.state,
  };
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/framework-suggestions">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  // Types, scope and declines are read on one snapshot, so a concurrent delete can't show a decided suggestion as open.
  const suggestions = await prisma.$transaction((tx) => readSuggestions(tx, system.id), { isolationLevel: "RepeatableRead" });
  return NextResponse.json({ suggestions: suggestions.map(toJson) });
}

const leaveOutSchema = z.object({ frameworkId: z.string().min(1) });

/** Leave a suggested Framework out: records a decline for every declared type that suggests it. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/framework-suggestions">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  if (!canManageFrameworkScopes(auth.user, system)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can leave out a suggested Framework" }, { status: 403 });
  }

  const parsed = leaveOutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A frameworkId is required" }, { status: 400 });

  // The read of what is suggested and the write of the decline see one snapshot of the System's declared types.
  const outcome = await prisma.$transaction(
    async (tx) => {
      const recorded = await leaveSuggestionOut(tx, system.id, parsed.data.frameworkId);
      if (recorded === 0) return null;
      return readSuggestions(tx, system.id);
    },
    { isolationLevel: "RepeatableRead" },
  );
  if (!outcome) return NextResponse.json({ error: NOT_SUGGESTED_FRAMEWORK }, { status: 400 });
  return NextResponse.json({ suggestions: outcome.map(toJson) }, { status: 201 });
}
