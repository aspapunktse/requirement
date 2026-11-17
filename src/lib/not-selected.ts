import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { finishRecompute } from "@/lib/applicability-recompute";

/**
 * Reopening a System closed as Not selected (#376, ADR 0015; closing is in `comparison.ts`, with the Comparison's outcome). An Admin only,
 * with a required comment. The System returns to Draft at the stage it was in: its stage, Track, Assessments, Risks and documents are not
 * touched, only its status and its closed marker. One Change Event (SYSTEM_REOPENED, the comment in its detail) is written in the same
 * transaction. Continuous Compliance (ADR 0006) then recomputes the System's applicable Controls, since the catalogue may have changed
 * while it was closed: `finishRecompute`, the helper the catalogue changes use, after the commit. A System that is not Not selected
 * (Rejected is final) is refused with 409. Every query inside the transaction is on `tx`.
 */

export const reopenCommentSchema = z.string().trim().min(1, "A comment is required").max(5000);

export const NOT_NOT_SELECTED_REFUSAL = "Only a System closed as Not selected can be reopened";

type Reopened = { ok: true; status: "DRAFT" } | { ok: false; status: 403 | 404 | 409; error: string };

class Abort extends Error {
  constructor(readonly result: Extract<Reopened, { ok: false }>) {
    super(result.error);
  }
}

export async function reopenNotSelected(actor: { id: string; role: string }, systemId: string, comment: string): Promise<Reopened> {
  if (actor.role !== "ADMIN") return { ok: false, status: 403, error: "Only an Admin can reopen a Not selected System" };
  let name: string;
  try {
    name = await prisma.$transaction(async (tx) => {
      const system = await tx.system.findUnique({ where: { id: systemId }, select: { name: true, status: true } });
      if (!system) throw new Abort({ ok: false, status: 404, error: "System not found" });
      if (system.status !== "NOT_SELECTED") throw new Abort({ ok: false, status: 409, error: NOT_NOT_SELECTED_REFUSAL });
      const reopened = await tx.system.updateMany({ where: { id: systemId, status: "NOT_SELECTED" }, data: { status: "DRAFT", evaluationClosedAt: null } });
      if (reopened.count !== 1) throw new Abort({ ok: false, status: 409, error: NOT_NOT_SELECTED_REFUSAL });
      await logChangeEvent(systemId, "SYSTEM_REOPENED", `Reopened from Not selected: ${comment}`, actor.id, tx);
      return system.name;
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { ok: false, status: 409, error: "The System was changed at the same time. Try again." };
    throw error;
  }
  // The catalogue may have changed while the System was closed: recompute which Controls apply to it, over every Control.
  const controls = await prisma.control.findMany({ select: { id: true } });
  await finishRecompute({ scope: { systemsWhere: { id: systemId }, controlIds: controls.map((control) => control.id) } }, `System "${name}" reopened from Not selected`);
  return { ok: true, status: "DRAFT" };
}
