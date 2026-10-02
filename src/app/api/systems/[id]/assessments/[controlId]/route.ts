import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { assessmentEditAccess, canEditAssessment, isSystemOwnerOrAdmin, WAIVE_GATED_STATUSES } from "@/lib/system-permissions";
import { checkWaiveGate, getControlForAssessmentEdit, removeStaleAssessment } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";
import { runProviderAssessmentWrite } from "@/lib/provider-inheritance";
import { loadEffectiveStatus, toOwnAssessment } from "@/lib/effective-status-data";
import { describeOwnEditEffect } from "@/lib/effective-status";

const updateAssessmentSchema = z.object({
  status: z.enum(ControlAssessmentStatus),
  evidence: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  // Seeing a System is not enough to edit its Assessments (#78).
  if (assessmentEditAccess(auth.user, system) === "none") {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can edit this System's Control Assessments" },
      { status: 403 },
    );
  }

  const parsed = updateAssessmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, evidence, notes } = parsed.data;

  // A Risk Owner who doesn't own the System may only waive / mark Not Applicable.
  if (!canEditAssessment(auth.user, system, status)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can edit this System's Control Assessments" },
      { status: 403 },
    );
  }

  const control = await getControlForAssessmentEdit(system, controlId);
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }

  const existing = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
  });

  // A Risk Owner who doesn't own the System may change only the status and
  // the justification note, never the evidence (#91). Reject rather than
  // silently ignore, so the client learns it wasn't applied. Re-sending the
  // stored value is not a change.
  if (
    assessmentEditAccess(auth.user, system) === "waive-only" &&
    evidence !== undefined &&
    evidence !== (existing?.evidence ?? null)
  ) {
    return NextResponse.json(
      { error: "A Risk Owner who doesn't own this System can't change evidence" },
      { status: 400 },
    );
  }

  if (WAIVE_GATED_STATUSES.includes(status)) {
    const gate = checkWaiveGate(auth.user, system, control, notes);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  // A Provider's own status is what the Systems depending on it inherit from (#124, F-IN.7):
  // for a Provider the write, its event and the events on the dependents it moves are one
  // transaction under the Provider lock (re-reading the previous status inside it). For
  // any other System this is the plain write it always was.
  const assessment = await runProviderAssessmentWrite(system, controlId, async (db, locked) => {
    const previous = locked
      ? await db.controlAssessment.findUnique({ where: { systemId_controlId: { systemId: system.id, controlId } } })
      : existing;
    const saved = await db.controlAssessment.upsert({
      where: { systemId_controlId: { systemId: system.id, controlId } },
      create: {
        systemId: system.id,
        controlId,
        status,
        evidence,
        notes,
        assessedById: auth.user.id,
        assessedAt: new Date(),
      },
      update: {
        status,
        evidence,
        notes,
        assessedById: auth.user.id,
        assessedAt: new Date(),
        // Any manual edit marks this Assessment human-owned, immune to
        // future automatic reversion if it was previously auto-fulfilled
        // by a Capability (see #16).
        fulfilledByCapabilityId: null,
      },
      include: { assessedBy: true },
    });

    if ((previous?.status ?? "NOT_STARTED") !== status) {
      // The stored status can differ from what the Control effectively is (a Fulfilled
      // own half held at In Progress while a Shared Provider hasn't done its half, #125):
      // say so in the same event. Read on `db`, so inside the Provider's transaction it is `tx`.
      const effect = describeOwnEditEffect(status, await loadEffectiveStatus(system.id, control, toOwnAssessment(saved), db));
      await logChangeEvent(
        system.id,
        "ASSESSMENT_STATUS_CHANGED",
        `${control.code} status changed from ${previous?.status ?? "NOT_STARTED"} to ${status}${effect ? ` (${effect})` : ""}`,
        auth.user.id,
        db,
      );
    }
    return saved;
  });

  return NextResponse.json({ assessment });
}

/**
 * Remove a *stale* Control Assessment (#109): one whose Control no longer
 * applies to the System. The System's owner or an Admin only; a Control that
 * still applies keeps its row (409), and so does one with an open Assessment
 * Query (409). The removal is recorded in a Change Event (see
 * `removeStaleAssessment`).
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!isSystemOwnerOrAdmin(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can remove a stale Control Assessment" },
      { status: 403 },
    );
  }

  const result = await removeStaleAssessment(system, controlId, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ removed: true });
}
