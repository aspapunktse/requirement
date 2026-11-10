import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** The 409 text for any write on a System the Business System Owner rejected at OG3 (#330). */
export const SYSTEM_CLOSED_REFUSAL = "This System was rejected at OG3 and is closed: it can no longer be changed";

/**
 * The one check behind "a Rejected System is closed and read-only for every role" (#330). Every route that writes on a System, or on a row
 * that belongs to one, calls this first (after authentication) and returns the response when it is not null; a test walks the write routes
 * to keep that true. Reads stay allowed. A System that doesn't exist is not closed: the route's own 404 follows.
 */
export async function refuseIfSystemClosed(systemId: string): Promise<NextResponse | null> {
  const system = await prisma.system.findUnique({ where: { id: systemId }, select: { evaluationClosedAt: true } });
  return system?.evaluationClosedAt ? NextResponse.json({ error: SYSTEM_CLOSED_REFUSAL }, { status: 409 }) : null;
}
