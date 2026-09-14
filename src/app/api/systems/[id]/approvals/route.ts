import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_APPROVE, getApprovalHistory } from "@/lib/approvals";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const approvals = await getApprovalHistory(system.id);
  return NextResponse.json({ approvals });
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().min(1),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/approvals">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_APPROVE]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (system.status !== "IN_REVIEW") {
    return NextResponse.json(
      { error: "Only a System In Review can receive an Approval decision" },
      { status: 400 },
    );
  }

  const parsed = decisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A decision (Approved or Rejected) and comment are required" }, { status: 400 });
  }
  const { decision, comment } = parsed.data;

  const [approval] = await prisma.$transaction([
    prisma.approval.create({
      data: { systemId: system.id, approverId: auth.user.id, decision, comment },
      include: { approver: true },
    }),
    prisma.system.update({
      where: { id: system.id },
      data: { status: decision === "APPROVED" ? "APPROVED" : "DRAFT" },
    }),
  ]);

  return NextResponse.json({ approval }, { status: 201 });
}
