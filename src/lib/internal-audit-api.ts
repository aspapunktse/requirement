import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { InternalAuditError } from "@/lib/internal-audits";

/**
 * The body of POST / PATCH /api/internal-audits. Every field is optional here: what a
 * draft still lacks is named by `validateInternalAudit`, which gives a better message
 * than a schema error would. A field of the wrong type is a 400 "Invalid Internal Audit".
 */
export const internalAuditBodySchema = z.object({
  title: z.string().optional(),
  scopeDescription: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  includeOrganization: z.boolean().optional(),
  controlIds: z.array(z.string()).optional(),
  systemIds: z.array(z.string()).optional(),
});

/** The body of POST /api/internal-audits/[id]/systems (#234): the Systems to add to a draft. */
export const addSystemsBodySchema = z.object({ systemIds: z.array(z.string().min(1)).min(1) });

/** Answers an `InternalAuditError` (or a Control / System deleted mid-write, or a concurrent write) as JSON; rethrows anything else. */
export function internalAuditErrorResponse(error: unknown): NextResponse {
  if (error instanceof InternalAuditError) {
    return NextResponse.json({ error: error.message, problems: error.problems }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    return NextResponse.json({ error: "A picked Control or System no longer exists" }, { status: 400 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return NextResponse.json({ error: "The Internal Audit changed at the same moment; try again" }, { status: 409 });
  }
  throw error;
}

/** Reads a request's JSON body, or null if it isn't JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
