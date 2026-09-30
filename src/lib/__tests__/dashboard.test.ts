import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { getAllOpenRisks, getSystemsAwaitingApproval, getSystemsNeedingAttention } from "../dashboard";

const OWNER_EMAIL = "test-dashboard-owner@example.com";
const REVIEWER_EMAIL = "test-dashboard-reviewer@example.com";
const OTHER_OWNER_EMAIL = "test-dashboard-other-owner@example.com";

describe("dashboard", () => {
  let ownerId: string;
  let reviewerId: string;
  let otherOwnerId: string;
  let facetId: string;
  let scopedControlId: string;
  // Two mandatory Controls that apply only to Systems declaring the fixture Facet (and are mapped to the base Framework).
  let mandatoryControlIds: string[];
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
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Dashboard Other Owner", role: "SYSTEM_OWNER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;
    otherOwnerId = otherOwner.id;

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

    mandatoryControlIds = [];
    for (const n of [1, 2]) {
      const mandatory = await prisma.control.create({
        data: {
          code: `DASH-MAND-${n}-${suffix}`,
          title: `Test Dashboard mandatory Control ${n}`,
          description: "desc",
          category: "Security",
          applicability: "PER_SYSTEM",
          mandatory: true,
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      mandatoryControlIds.push(mandatory.id);
    }
    await mapControlsToBase(mandatoryControlIds);
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: [scopedControlId, ...mandatoryControlIds] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL, OTHER_OWNER_EMAIL] } } });
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

    it("never reports 'rejected' for a System that isn't Draft, even with a REJECTED Approval on record", async () => {
      const system = await prisma.system.create({
        data: { name: `Reviewed Elsewhere ${Date.now()}`, ownerId, status: "IN_REVIEW" },
      });
      systemIds.push(system.id);
      await prisma.approval.create({
        data: { systemId: system.id, approverId: reviewerId, decision: "REJECTED" },
      });

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention.filter((entry) => entry.id === system.id && entry.reason === "rejected")).toEqual([]);
    });

    it("never reports 'needs-assessment' for a Draft System, however many mandatory Controls are unassessed", async () => {
      const system = await prisma.system.create({
        data: {
          name: `Unassessed Draft ${Date.now()}`,
          ownerId,
          status: "DRAFT",
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      systemIds.push(system.id);

      const attention = await getSystemsNeedingAttention(ownerId);
      expect(attention.filter((entry) => entry.id === system.id)).toEqual([]);
    });

    describe("continuous compliance: non-Draft Systems (ADR 0006)", () => {
      /** The 'needs-assessment' count for a System (0 when it isn't reported). */
      async function needsAssessmentCount(forOwnerId: string, systemId: string) {
        const entry = (await getSystemsNeedingAttention(forOwnerId)).find(
          (e) => e.id === systemId && e.reason === "needs-assessment",
        );
        return entry?.reason === "needs-assessment" ? entry.count : 0;
      }

      /** A System without the fixture Facet declared; `declareFacet` then makes the two fixture Controls applicable. */
      async function makeSystem(status: "IN_REVIEW" | "APPROVED" | "ONBOARDED") {
        const system = await prisma.system.create({
          data: { name: `Test Dashboard ${status} ${Date.now()}`, ownerId, status },
        });
        systemIds.push(system.id);
        return system;
      }

      const declareFacet = (systemId: string) =>
        prisma.system.update({ where: { id: systemId }, data: { deploymentFacets: { connect: [{ id: facetId }] } } });

      // Every count is compared with the same System's count just before a change, because on the seeded dev DB the
      // seeded catalog's mandatory Controls are unassessed here too, and the delta is what this test controls.
      it.each(["IN_REVIEW", "APPROVED", "ONBOARDED"] as const)(
        "counts the newly applicable mandatory Controls on a %s System, with the right count and only for its owner",
        async (status) => {
          const system = await makeSystem(status);
          const before = await needsAssessmentCount(ownerId, system.id);

          await declareFacet(system.id);

          expect(await needsAssessmentCount(ownerId, system.id)).toBe(before + 2);
          expect(await needsAssessmentCount(otherOwnerId, system.id)).toBe(0);
          expect((await getSystemsNeedingAttention(otherOwnerId)).map((entry) => entry.id)).not.toContain(system.id);
        },
      );

      it("stops counting a Control once its Assessment is touched, but keeps counting an untouched Not Started row", async () => {
        const system = await makeSystem("ONBOARDED");
        await declareFacet(system.id);
        const before = await needsAssessmentCount(ownerId, system.id);

        // An untouched Not Started row (what a recompute creates) still counts.
        await prisma.controlAssessment.create({ data: { systemId: system.id, controlId: mandatoryControlIds[0] } });
        expect(await needsAssessmentCount(ownerId, system.id)).toBe(before);

        await prisma.controlAssessment.update({
          where: { systemId_controlId: { systemId: system.id, controlId: mandatoryControlIds[0] } },
          data: { status: "IN_PROGRESS", assessedById: ownerId },
        });
        expect(await needsAssessmentCount(ownerId, system.id)).toBe(before - 1);
      });

      it("reports a stale Assessment on a non-Draft System as 'stale', alongside 'needs-assessment' rather than instead of it", async () => {
        const system = await makeSystem("ONBOARDED");
        await declareFacet(system.id);
        // scopedControlId is unmapped, so it never applies: a touched Assessment against it is stale.
        await prisma.controlAssessment.create({
          data: { systemId: system.id, controlId: scopedControlId, status: "FULFILLED", assessedById: ownerId },
        });

        const reasons = (await getSystemsNeedingAttention(ownerId))
          .filter((entry) => entry.id === system.id)
          .map((entry) => entry.reason)
          .sort();
        expect(reasons).toEqual(["needs-assessment", "stale"]);
        expect(await needsAssessmentCount(ownerId, system.id)).toBeGreaterThanOrEqual(2);
        expect(
          (await getSystemsNeedingAttention(otherOwnerId)).filter((entry) => entry.id === system.id),
        ).toEqual([]);
      });

      it("reports 'stale' for a non-Draft System whose fixture Controls don't apply", async () => {
        // Declares no Facet, so the mandatory fixture Controls don't apply; its stale Assessment does show.
        const system = await makeSystem("APPROVED");
        await prisma.controlAssessment.create({
          data: { systemId: system.id, controlId: scopedControlId, status: "FULFILLED", assessedById: ownerId },
        });
        const entries = (await getSystemsNeedingAttention(ownerId)).filter((entry) => entry.id === system.id);
        expect(entries.map((entry) => entry.reason)).toContain("stale");
      });
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
