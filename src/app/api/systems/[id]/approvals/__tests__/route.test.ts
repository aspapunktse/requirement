import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[requirementId]/route";
import { POST as logRisk } from "@/app/api/systems/[id]/risks/route";
import { GET, POST } from "../route";

const OWNER_EMAIL = "test-approvals-owner@example.com";
const REVIEWER_EMAIL = "test-approvals-reviewer@example.com";
const VIEWER_EMAIL = "test-approvals-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/approvals`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), {
    method: init?.method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/systems/[id]/approvals", () => {
  let ownerId: string;
  let reviewerId: string;
  let viewerId: string;
  let systemTypeId: string;
  let inReviewSystemId: string;
  let draftSystemId: string;
  let mandatoryRequirementId: string;
  const createdApprovalIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Approvals Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Approvals Reviewer", role: "REVIEWER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Approvals Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;
    viewerId = viewer.id;

    const systemType = await prisma.systemType.create({
      data: { name: `Test Approvals Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const inReviewSystem = await prisma.system.create({
      data: { name: "In Review System", systemTypeId, ownerId, status: "IN_REVIEW" },
    });
    inReviewSystemId = inReviewSystem.id;

    const draftSystem = await prisma.system.create({
      data: { name: "Draft System", systemTypeId, ownerId, status: "DRAFT" },
    });
    draftSystemId = draftSystem.id;

    const mandatoryRequirement = await prisma.requirement.create({
      data: {
        code: `APPROVAL-DISCRETION-${Date.now()}`,
        title: "Open Gap Requirement",
        description: "Deliberately left unaddressed to prove Approval isn't gated by it",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
      },
    });
    mandatoryRequirementId = mandatoryRequirement.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId: { in: [inReviewSystemId, draftSystemId] } } });
    await prisma.requirementAssessment.deleteMany({
      where: { systemId: { in: [inReviewSystemId, draftSystemId] } },
    });
    await prisma.approval.deleteMany({ where: { systemId: { in: [inReviewSystemId, draftSystemId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [inReviewSystemId, draftSystemId] } } });
    await prisma.requirement.deleteMany({ where: { id: mandatoryRequirementId } });
    await prisma.systemType.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL, VIEWER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.risk.deleteMany({ where: { systemId: inReviewSystemId } });
    await prisma.requirementAssessment.deleteMany({ where: { systemId: inReviewSystemId } });
    await prisma.approval.deleteMany({ where: { id: { in: createdApprovalIds } } });
    createdApprovalIds.length = 0;
    await prisma.system.update({ where: { id: inReviewSystemId }, data: { status: "IN_REVIEW" } });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(inReviewSystemId, null), ctxFor(inReviewSystemId));
    expect(response.status).toBe(401);
  });

  it("GET returns 404 for a System the acting user cannot see", async () => {
    const response = await GET(requestAs(inReviewSystemId, viewerId), ctxFor(inReviewSystemId));
    expect(response.status).toBe(404);
  });

  it("POST rejects a non-REVIEWER/ADMIN (e.g. the owning SYSTEM_OWNER)", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, ownerId, {
        method: "POST",
        body: { decision: "APPROVED", comment: "looks fine" },
      }),
      ctxFor(inReviewSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST rejects a decision on a System that isn't In Review", async () => {
    const response = await POST(
      requestAs(draftSystemId, reviewerId, {
        method: "POST",
        body: { decision: "APPROVED", comment: "looks fine" },
      }),
      ctxFor(draftSystemId),
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects a decision without a comment", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, reviewerId, { method: "POST", body: { decision: "APPROVED" } }),
      ctxFor(inReviewSystemId),
    );
    expect(response.status).toBe(400);
  });

  it("Approved moves the System to APPROVED and is recorded", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, reviewerId, {
        method: "POST",
        body: { decision: "APPROVED", comment: "Meets the bar" },
      }),
      ctxFor(inReviewSystemId),
    );
    const body = await response.json();
    createdApprovalIds.push(body.approval.id);

    expect(response.status).toBe(201);
    expect(body.approval).toMatchObject({ decision: "APPROVED", comment: "Meets the bar" });

    const system = await prisma.system.findUnique({ where: { id: inReviewSystemId } });
    expect(system?.status).toBe("APPROVED");
  });

  it("Rejected moves the System back to DRAFT, not a dead end", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, reviewerId, {
        method: "POST",
        body: { decision: "REJECTED", comment: "Missing evidence for A.8.5" },
      }),
      ctxFor(inReviewSystemId),
    );
    const body = await response.json();
    createdApprovalIds.push(body.approval.id);

    expect(response.status).toBe(201);
    const system = await prisma.system.findUnique({ where: { id: inReviewSystemId } });
    expect(system?.status).toBe("DRAFT");
  });

  it("GET returns the full Approval history oldest to newest, surviving resubmission", async () => {
    const first = await prisma.approval.create({
      data: { systemId: inReviewSystemId, approverId: reviewerId, decision: "REJECTED", comment: "first pass" },
    });
    const second = await prisma.approval.create({
      data: { systemId: inReviewSystemId, approverId: reviewerId, decision: "APPROVED", comment: "second pass" },
    });
    createdApprovalIds.push(first.id, second.id);

    const response = await GET(requestAs(inReviewSystemId, ownerId), ctxFor(inReviewSystemId));
    const body = await response.json();
    const ids = body.approvals.map((a: { id: string }) => a.id);

    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });

  it("lets a REVIEWER approve a System despite an open mandatory Requirement gap and an unresolved Risk", async () => {
    // Mandatory Requirement left untouched (NOT_STARTED) and an ad-hoc Risk
    // logged and left OPEN — deliberately unmitigated, real gaps.
    const riskResponse = await logRisk(
      requestAs(inReviewSystemId, ownerId, {
        method: "POST",
        body: {
          title: "Unresolved ad-hoc Risk",
          description: "Deliberately left open to prove Approval is discretionary",
          severity: "HIGH",
          likelihood: "MEDIUM",
        },
      }),
      ctxFor(inReviewSystemId),
    );
    expect(riskResponse.status).toBe(201);

    const response = await POST(
      requestAs(inReviewSystemId, reviewerId, {
        method: "POST",
        body: { decision: "APPROVED", comment: "Accepting the gap and the risk at my discretion" },
      }),
      ctxFor(inReviewSystemId),
    );
    const body = await response.json();
    createdApprovalIds.push(body.approval.id);

    expect(response.status).toBe(201);
    const system = await prisma.system.findUnique({ where: { id: inReviewSystemId } });
    expect(system?.status).toBe("APPROVED");
  });

  it("never sets Approval status or creates an Approval record as a side effect of unrelated System actions", async () => {
    const assessmentPatchResponse = await patchAssessment(
      new NextRequest(
        `http://localhost/api/systems/${inReviewSystemId}/assessments/${mandatoryRequirementId}`,
        {
          method: "PATCH",
          headers: new Headers({
            "Content-Type": "application/json",
            cookie: `${ACTING_USER_COOKIE}=${ownerId}`,
          }),
          body: JSON.stringify({ status: "IN_PROGRESS" }),
        },
      ),
      { params: Promise.resolve({ id: inReviewSystemId, requirementId: mandatoryRequirementId }) },
    );
    expect(assessmentPatchResponse.status).toBe(200);

    const riskResponse = await logRisk(
      requestAs(inReviewSystemId, ownerId, {
        method: "POST",
        body: {
          title: "Side-effect probe Risk",
          description: "Logging this should never touch Approval",
          severity: "LOW",
          likelihood: "LOW",
        },
      }),
      ctxFor(inReviewSystemId),
    );
    expect(riskResponse.status).toBe(201);

    const system = await prisma.system.findUnique({ where: { id: inReviewSystemId } });
    expect(system?.status).toBe("IN_REVIEW");

    const approvalCount = await prisma.approval.count({ where: { systemId: inReviewSystemId } });
    expect(approvalCount).toBe(0);
  });
});
