import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getAllOpenRisks, getSystemsAwaitingApproval, getSystemsNeedingAttention } from "../dashboard";

const OWNER_EMAIL = "test-dashboard-owner@example.com";
const REVIEWER_EMAIL = "test-dashboard-reviewer@example.com";

describe("dashboard", () => {
  let ownerId: string;
  let reviewerId: string;
  let facetId: string;
  let scopedControlId: string;
  const systemIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Dashboard Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Dashboard Reviewer", role: "REVIEWER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;

    const suffix = Date.now();
    const facet = await prisma.deploymentFacet.create({ data: { name: `Dashboard Facet ${suffix}` } });
    facetId = facet.id;

    const control = await prisma.control.create({
      data: {
        code: `DASH-${suffix}`,
        title: "Only for the Dashboard Facet",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    scopedControlId = control.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: scopedControlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL] } } });
  });

  describe("getSystemsNeedingAttention", () => {
    it("flags a Draft System with a REJECTED Approval as 'rejected'", async () => {
      const system = await prisma.system.create({
        data: { name: `Rejected Draft ${Date.now()}`, ownerId, status: "DRAFT" },
      });
      systemIds.push(system.id);
      await prisma.approval.create({
        data: { systemId: system.id, approverId: reviewerId, decision: "REJECTED" },
      });

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention).toContainEqual({ id: system.id, name: system.name, reason: "rejected" });
    });

    it("flags a Draft System with a stale Control Assessment as 'stale'", async () => {
      // No Facets declared, so the Facet-scoped Control isn't applicable —
      // an existing Assessment against it is therefore stale.
      const system = await prisma.system.create({
        data: { name: `Stale Draft ${Date.now()}`, ownerId, status: "DRAFT" },
      });
      systemIds.push(system.id);
      await prisma.controlAssessment.create({
        data: { systemId: system.id, controlId: scopedControlId, status: "FULFILLED" },
      });

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention).toContainEqual({ id: system.id, name: system.name, reason: "stale" });
    });

    it("does not flag a clean Draft System", async () => {
      const system = await prisma.system.create({
        data: { name: `Clean Draft ${Date.now()}`, ownerId, status: "DRAFT" },
      });
      systemIds.push(system.id);

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention.find((entry) => entry.id === system.id)).toBeUndefined();
    });

    it("ignores Systems that aren't Draft, even with a REJECTED Approval on record", async () => {
      const system = await prisma.system.create({
        data: { name: `Reviewed Elsewhere ${Date.now()}`, ownerId, status: "IN_REVIEW" },
      });
      systemIds.push(system.id);
      await prisma.approval.create({
        data: { systemId: system.id, approverId: reviewerId, decision: "REJECTED" },
      });

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention.find((entry) => entry.id === system.id)).toBeUndefined();
    });
  });

  describe("getSystemsAwaitingApproval", () => {
    it("returns only IN_REVIEW Systems", async () => {
      const inReview = await prisma.system.create({
        data: { name: `Awaiting Review ${Date.now()}`, ownerId, status: "IN_REVIEW" },
      });
      const draft = await prisma.system.create({
        data: { name: `Not Submitted ${Date.now()}`, ownerId, status: "DRAFT" },
      });
      systemIds.push(inReview.id, draft.id);

      const awaiting = await getSystemsAwaitingApproval();
      expect(awaiting.map((s) => s.id)).toContain(inReview.id);
      expect(awaiting.map((s) => s.id)).not.toContain(draft.id);
    });
  });

  describe("getAllOpenRisks", () => {
    it("returns only OPEN Risks, across Systems, with the System name included", async () => {
      const system = await prisma.system.create({
        data: { name: `Risk Host ${Date.now()}`, ownerId, status: "DRAFT" },
      });
      systemIds.push(system.id);
      const openRisk = await prisma.risk.create({
        data: {
          systemId: system.id,
          title: "Open one",
          description: "desc",
          severity: "LOW",
          likelihood: "LOW",
          status: "OPEN",
        },
      });
      await prisma.risk.create({
        data: {
          systemId: system.id,
          title: "Closed one",
          description: "desc",
          severity: "LOW",
          likelihood: "LOW",
          status: "CLOSED",
        },
      });

      const openRisks = await getAllOpenRisks();
      const found = openRisks.find((r) => r.id === openRisk.id);
      expect(found).toBeDefined();
      expect(found?.system.name).toBe(system.name);
      expect(openRisks.every((r) => r.status === "OPEN")).toBe(true);
    });
  });
});
