import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { assessmentEditAccess } from "@/lib/system-permissions";
import { getControlForAssessmentEdit } from "@/lib/control-assessments";
import { runAssessmentEdit, reopenStepsAfterEdit } from "@/lib/assessment-edit";
import { refuseIfSystemClosed } from "@/lib/system-closed";
import { listEvidence } from "@/lib/evidence-data";
import { ensureAssessment } from "@/lib/status-history";

type Ctx = RouteContext<"/api/systems/[id]/assessments/[controlId]/evidence">;

const date = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a date")
  .transform((value) => new Date(value));

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Evidence links must be http or https URLs");

const common = {
  title: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  collectedAt: date.optional(),
  expiresAt: date.nullable().optional(),
};
const addEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LINK"), url: httpUrl, ...common }),
  z.object({ kind: z.literal("DOCUMENT"), documentRequirementId: z.string().min(1), ...common }),
]);

const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Adds one Evidence record (a link, or one of the System's documents, named by its Document Requirement) to a Control Assessment (#455). Who may: the System's
 * owner or an Admin, the same as editing the Assessment's evidence today (a non-owning Risk Owner may not change evidence,
 * #91); 403 otherwise and nothing changes, 404 for a System the user can't see or a Control that isn't the System's, 409 for
 * a closed System. The Assessment is created untouched (Not Started, nobody recorded as the assessor) if there is none yet,
 * so Evidence never makes an inherited Control person-set. Like any evidence edit it reopens approved Review Steps on a
 * System In Review, and writes no Change Event (an evidence edit never has). Returns `{ assessmentId, evidence }`: the Assessment's Evidence records.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (assessmentEditAccess(auth.user, system) !== "full") {
    return NextResponse.json({ error: "Only the System's owner or an Admin can change this System's evidence" }, { status: 403 });
  }
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = addEvidenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
  const body = parsed.data;
  const now = new Date();
  const collectedAt = body.collectedAt ?? now;
  if (collectedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    return NextResponse.json({ error: "The collected date can't be in the future" }, { status: 400 });
  }
  if (body.expiresAt && body.expiresAt.getTime() <= collectedAt.getTime()) {
    return NextResponse.json({ error: "The expiry date must be after the collected date" }, { status: 400 });
  }

  const control = await getControlForAssessmentEdit(system, controlId);
  if (!control) return NextResponse.json({ error: "Control not found" }, { status: 404 });

  const result = await runAssessmentEdit(system, controlId, async (db, locked) => {
    let title = body.title || null;
    let systemDocumentId: string | null = null;
    if (body.kind === "DOCUMENT") {
      const document = await db.systemDocument.findUnique({
        where: { systemId_documentRequirementId: { systemId: system.id, documentRequirementId: body.documentRequirementId } },
        select: { id: true, documentRequirement: { select: { name: true } } },
      });
      if (!document) return null;
      systemDocumentId = document.id;
      title = title ?? document.documentRequirement.name;
    }
    // `db` is the transaction `runAssessmentEdit` opened, so the row and its creation record commit together.
    const assessment = await ensureAssessment(db as Prisma.TransactionClient, { systemId: system.id, controlId }, auth.user.id);
    await db.evidenceItem.create({
      data: {
        controlAssessmentId: assessment.id,
        kind: body.kind,
        url: body.kind === "LINK" ? body.url : null,
        systemDocumentId,
        title,
        description: body.description || null,
        collectedAt,
        expiresAt: body.expiresAt ?? null,
        createdById: auth.user.id,
      },
    });
    await reopenStepsAfterEdit(db, locked, system, control, auth.user, true);
    return { assessmentId: assessment.id, evidence: await listEvidence(db, assessment.id, control.evidenceValidityMonths, now) };
  });
  if (!result) return NextResponse.json({ error: "Document not found on this System" }, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}
