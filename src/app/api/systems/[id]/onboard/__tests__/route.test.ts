import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST as recordApproval } from "@/app/api/systems/[id]/approvals/route";
import { POST } from "../route";

const OWNER_EMAIL = "test-onboard-owner@example.com";
const OTHER_OWNER_EMAIL = "test-onboard-other-owner@example.com";
const ADMIN_EMAIL = "test-onboard-admin@example.com";
const REVIEWER_EMAIL = "test-onboard-reviewer-flow@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/onboard`;
}

function requestAs(id: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { method: "POST", headers });
}

function requestWith(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/systems/[id]/onboard", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let reviewerId: string;
  let systemTypeId: string;
  let approvedSystemId: string;
  let draftSystemId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Onboard Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Onboard Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Onboard Admin", role: "ADMIN" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Onboard Reviewer Flow", role: "REVIEWER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;
    reviewerId = reviewer.id;

    const systemType = await prisma.systemType.create({
      data: { name: `Test Onboard Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [approvedSystemId, draftSystemId] } } });
    await prisma.systemType.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL, REVIEWER_EMAIL] } },
    });
  });

  beforeEach(async () => {
    const approved = await prisma.system.create({
      data: { name: "Approved System", systemTypeId, ownerId, status: "APPROVED" },
    });
    approvedSystemId = approved.id;
    const draft = await prisma.system.create({
      data: { name: "Draft System", systemTypeId, ownerId, status: "DRAFT" },
    });
    draftSystemId = draft.id;
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [approvedSystemId, draftSystemId] } } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(requestAs(approvedSystemId, null), ctxFor(approvedSystemId));
    expect(response.status).toBe(401);
  });

  it("rejects a role other than SYSTEM_OWNER/ADMIN (e.g. REVIEWER)", async () => {
    const reviewer = await prisma.user.upsert({
      where: { email: "test-onboard-reviewer@example.com" },
      update: {},
      create: { email: "test-onboard-reviewer@example.com", name: "Onboard Reviewer", role: "REVIEWER" },
    });
    const response = await POST(requestAs(approvedSystemId, reviewer.id), ctxFor(approvedSystemId));
    expect(response.status).toBe(403);
    await prisma.user.delete({ where: { id: reviewer.id } });
  });

  it("rejects a SYSTEM_OWNER who doesn't own this System (but can see it)", async () => {
    const onboarded = await prisma.system.create({
      data: { name: "Already Onboarded", systemTypeId, ownerId, status: "ONBOARDED" },
    });

    const response = await POST(requestAs(onboarded.id, otherOwnerId), ctxFor(onboarded.id));
    expect(response.status).toBe(403);

    await prisma.system.delete({ where: { id: onboarded.id } });
  });

  it("rejects a System that isn't Approved", async () => {
    const response = await POST(requestAs(draftSystemId, ownerId), ctxFor(draftSystemId));
    expect(response.status).toBe(400);
  });

  it("lets the owning SYSTEM_OWNER mark an Approved System Onboarded, recording onboardedAt", async () => {
    const response = await POST(requestAs(approvedSystemId, ownerId), ctxFor(approvedSystemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.status).toBe("ONBOARDED");
    expect(body.system.onboardedAt).not.toBeNull();
  });

  it("lets an ADMIN mark any Approved System Onboarded", async () => {
    const response = await POST(requestAs(approvedSystemId, adminId), ctxFor(approvedSystemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.status).toBe("ONBOARDED");
  });

  it("rejects marking an already-Onboarded System Onboarded again", async () => {
    await POST(requestAs(approvedSystemId, ownerId), ctxFor(approvedSystemId));
    const response = await POST(requestAs(approvedSystemId, ownerId), ctxFor(approvedSystemId));
    expect(response.status).toBe(400);
  });

  it("rejects a System that's In Review but not yet decided", async () => {
    const inReview = await prisma.system.create({
      data: { name: "In Review, Not Yet Decided", systemTypeId, ownerId, status: "IN_REVIEW" },
    });

    const response = await POST(requestAs(inReview.id, ownerId), ctxFor(inReview.id));
    expect(response.status).toBe(400);

    await prisma.system.delete({ where: { id: inReview.id } });
  });

  it("only succeeds once a real Approval decision has been recorded through the Approvals endpoint", async () => {
    const inReview = await prisma.system.create({
      data: { name: "Genuinely Approved via the real flow", systemTypeId, ownerId, status: "IN_REVIEW" },
    });

    // Before any decision: onboarding is rejected, same as any other
    // non-Approved status.
    const tooEarly = await POST(requestAs(inReview.id, ownerId), ctxFor(inReview.id));
    expect(tooEarly.status).toBe(400);

    const approvalResponse = await recordApproval(
      requestWith(`http://localhost/api/systems/${inReview.id}/approvals`, "POST", reviewerId, {
        decision: "APPROVED",
        comment: "Cleared to proceed",
      }),
      { params: Promise.resolve({ id: inReview.id }) },
    );
    expect(approvalResponse.status).toBe(201);

    const approvalCount = await prisma.approval.count({ where: { systemId: inReview.id, decision: "APPROVED" } });
    expect(approvalCount).toBe(1);

    const response = await POST(requestAs(inReview.id, ownerId), ctxFor(inReview.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.status).toBe("ONBOARDED");

    await prisma.approval.deleteMany({ where: { systemId: inReview.id } });
    await prisma.system.delete({ where: { id: inReview.id } });
  });
});
