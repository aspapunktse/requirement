import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** The 409 text for any write on a System the Business System Owner rejected at a gate (#330, #331). */
export const SYSTEM_CLOSED_REFUSAL = "This System was rejected and is closed: it can no longer be changed";

/** The 409 text for a write on a System closed as Not selected after a Comparison (#376, ADR 0015); an Admin can reopen it. */
export const SYSTEM_NOT_SELECTED_REFUSAL = "This System was not selected and is closed: it can no longer be changed unless an Admin reopens it";

/** The refusal text for a closed System: Rejected (final) or Not selected (an Admin can reopen it). */
export function closedRefusalText(status: string): string {
  return status === "NOT_SELECTED" ? SYSTEM_NOT_SELECTED_REFUSAL : SYSTEM_CLOSED_REFUSAL;
}

/**
 * The one check behind "a closed System (Rejected, or Not selected, #376) is read-only for every role" (#330). Every route that writes on a System, or on a row
 * that belongs to one, calls this first (after authentication) and returns the response when it is not null; a test walks the write routes
 * to keep that true. Reads stay allowed. A System that doesn't exist is not closed: the route's own 404 follows.
 */
export async function refuseIfSystemClosed(systemId: string): Promise<NextResponse | null> {
  const system = await prisma.system.findUnique({ where: { id: systemId }, select: { evaluationClosedAt: true, status: true } });
  return system?.evaluationClosedAt ? NextResponse.json({ error: closedRefusalText(system.status) }, { status: 409 }) : null;
}
