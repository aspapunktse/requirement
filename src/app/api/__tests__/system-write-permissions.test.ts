import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { PATCH as updateAssessment } from "../systems/[id]/assessments/[controlId]/route";
import { PATCH as answerSelfAssessment } from "../systems/[id]/assessments/[controlId]/answer/route";
import { POST as submitSystem } from "../systems/[id]/submit/route";

/**
 * Seeing a System is not the same as writing to it (#78). Editing a Control
 * Assessment / answering a Self-Assessment Question is the System's owner or
 * an ADMIN, plus a RISK_OWNER for the waive-gated Waived / Not Applicable
 * transitions only; submitting for review is the owner or an ADMIN. Every
 * other role is refused with 403 and nothing changes.
 *
 * Fixtures are self-contained (the CI test database isn't seeded) and the
 * Controls are scoped to this file's own Deployment Facet so they don't leak
 * into Systems other test files create.
 */

const SUFFIX = Date.now();
const email = (tag: string) => `test-sys-write-${tag}-${SUFFIX}@example.com`;

function req(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("System write permissions (#78)", () => {
  const users = {} as Record<string, string>;
  let facetId: string;
  let businessUnitId: string;
  let optionalControlId: string;
  let mandatoryControlId: string;
  /** Onboarded: every role can see it (a Business Risk Owner via Business Unit scope). */
  let onboardedId: string;
  /** Draft with the Business Unit declared: only some roles can see it. */
  let draftId: string;
  /** A System owned by a RISK_OWNER (who is then simply its owner). */
  let riskOwnerOwnedId: string;
  const systemIds: string[] = [];

  async function makeSystem(ownerKey: string, status: "DRAFT" | "ONBOARDED") {
    const system = await prisma.system.create({
      data: {
        name: `Test SysWrite System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[ownerKey],
        status,
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }

  async function cleanSystemData() {
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
  }

  beforeAll(async () => {
    const roles: [string, UserRole][] = [
      ["owner", "SYSTEM_OWNER"],
      ["otherOwner", "SYSTEM_OWNER"],
      ["admin", "ADMIN"],
      ["riskOwner", "RISK_OWNER"],
      ["reviewer", "REVIEWER"],
      ["viewer", "VIEWER"],
      ["bro", "BUSINESS_RISK_OWNER"],
      ["cm", "COMPLIANCE_MANAGER"],
    ];
    businessUnitId = (await prisma.businessUnit.create({ data: { name: `Test SysWrite BU ${SUFFIX}` } })).id;
    for (const [key, role] of roles) {
      const user = await prisma.user.create({
        data: {
          email: email(key),
          name: `Test SysWrite ${key}`,
          role,
          ...(role === "BUSINESS_RISK_OWNER" ? { businessUnitScopes: { connect: { id: businessUnitId } } } : {}),
        },
      });
      users[key] = user.id;
    }

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test SysWrite Facet ${SUFFIX}` } })).id;
    const controlBase = {
      description: "desc",
      category: "Test",
      applicability: "PER_SYSTEM" as const,
      question: "Does it?",
      deploymentFacets: { connect: { id: facetId } },
    };
    optionalControlId = (
      await prisma.control.create({
        data: { ...controlBase, code: `TEST-SW-OPT-${SUFFIX}`, title: "Optional", mandatory: false },
      })
    ).id;
    mandatoryControlId = (
      await prisma.control.create({
        data: { ...controlBase, code: `TEST-SW-MAND-${SUFFIX}`, title: "Mandatory", mandatory: true },
      })
    ).id;
    await mapControlsToBase([optionalControlId, mandatoryControlId]);

    onboardedId = await makeSystem("owner", "ONBOARDED");
    draftId = await makeSystem("owner", "DRAFT");
    riskOwnerOwnedId = await makeSystem("riskOwner", "ONBOARDED");
  });

  afterEach(async () => {
    await cleanSystemData();
    await prisma.system.update({ where: { id: draftId }, data: { status: "DRAFT" } });
  });

  afterAll(async () => {
    await cleanSystemData();
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: [optionalControlId, mandatoryControlId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
  });

  const patchAssessment = (systemId: string, controlId: string, userKey: string, body: unknown) =>
    updateAssessment(req(`/api/systems/${systemId}/assessments/${controlId}`, "PATCH", users[userKey], body), {
      params: Promise.resolve({ id: systemId, controlId }),
    });
  const answer = (systemId: string, controlId: string, userKey: string, body: unknown) =>
    answerSelfAssessment(
      req(`/api/systems/${systemId}/assessments/${controlId}/answer`, "PATCH", users[userKey], body),
      { params: Promise.resolve({ id: systemId, controlId }) },
    );
  const submit = (systemId: string, userKey: string) =>
    submitSystem(req(`/api/systems/${systemId}/submit`, "POST", users[userKey]), {
      params: Promise.resolve({ id: systemId }),
    });

  async function expectNothingChanged(systemId: string) {
    expect(await prisma.controlAssessment.count({ where: { systemId } })).toBe(0);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(0);
    expect(await prisma.changeEvent.count({ where: { systemId } })).toBe(0);
  }

  describe("PATCH .../assessments/[controlId]", () => {
    it.each(["owner", "admin"])("lets %s set Fulfilled with evidence", async (who) => {
      const response = await patchAssessment(onboardedId, optionalControlId, who, {
        status: "FULFILLED",
        evidence: "proof",
      });
      expect(response.status).toBe(200);
      expect((await response.json()).assessment).toMatchObject({ status: "FULFILLED", evidence: "proof" });
    });

    it("lets a RISK_OWNER who owns the System edit it like any owner", async () => {
      const response = await patchAssessment(riskOwnerOwnedId, optionalControlId, "riskOwner", {
        status: "FULFILLED",
      });
      expect(response.status).toBe(200);
    });

    it.each(["admin", "riskOwner"])("lets %s waive a mandatory Control with a justification", async (who) => {
      const response = await patchAssessment(onboardedId, mandatoryControlId, who, {
        status: "WAIVED",
        notes: "accepted risk",
      });
      expect(response.status).toBe(200);
      expect((await response.json()).assessment.status).toBe("WAIVED");
    });

    it("lets a non-owner RISK_OWNER mark a Control Not Applicable", async () => {
      const response = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
        status: "NOT_APPLICABLE",
      });
      expect(response.status).toBe(200);
    });

    it("still applies the waive gate to a non-owner RISK_OWNER (a mandatory Control needs a note)", async () => {
      const response = await patchAssessment(onboardedId, mandatoryControlId, "riskOwner", { status: "WAIVED" });
      expect(response.status).toBe(400);
      await expectNothingChanged(onboardedId);
    });

    it("keeps the waive gate for the owner: a SYSTEM_OWNER still can't waive", async () => {
      const response = await patchAssessment(onboardedId, optionalControlId, "owner", { status: "WAIVED", notes: "n" });
      expect(response.status).toBe(403);
      await expectNothingChanged(onboardedId);
    });

    describe("evidence on a waive-only edit (#91)", () => {
      it("rejects a non-owner RISK_OWNER's evidence on a new Assessment with 400 and changes nothing", async () => {
        const response = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
          status: "NOT_APPLICABLE",
          evidence: "smuggled in",
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/can't change evidence/);
        await expectNothingChanged(onboardedId);
      });

      it("rejects a changed evidence on an existing Assessment, leaving the row and its history untouched", async () => {
        await prisma.controlAssessment.create({
          data: { systemId: onboardedId, controlId: optionalControlId, status: "FULFILLED", evidence: "original" },
        });
        for (const evidence of ["replaced", "", null]) {
          const response = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
            status: "WAIVED",
            evidence,
            notes: "accepted risk",
          });
          expect(response.status).toBe(400);
        }
        const row = await prisma.controlAssessment.findUniqueOrThrow({
          where: { systemId_controlId: { systemId: onboardedId, controlId: optionalControlId } },
        });
        expect(row).toMatchObject({ status: "FULFILLED", evidence: "original", notes: null, assessedById: null });
        expect(await prisma.changeEvent.count({ where: { systemId: onboardedId } })).toBe(0);
      });

      it("allows evidence that is absent, or re-sent unchanged (that's not a change)", async () => {
        await prisma.controlAssessment.create({
          data: { systemId: onboardedId, controlId: optionalControlId, status: "FULFILLED", evidence: "original" },
        });
        const unchanged = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
          status: "WAIVED",
          evidence: "original",
          notes: "accepted risk",
        });
        expect(unchanged.status).toBe(200);
        const absent = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
          status: "NOT_APPLICABLE",
          notes: "n/a here",
        });
        expect(absent.status).toBe(200);
        expect((await absent.json()).assessment).toMatchObject({ status: "NOT_APPLICABLE", evidence: "original" });
      });

      it("treats a missing row's evidence as null: sending null is not a change", async () => {
        const response = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
          status: "NOT_APPLICABLE",
          evidence: null,
        });
        expect(response.status).toBe(200);
      });

      it.each([
        ["owner", "the owner's System"],
        ["admin", "the owner's System"],
        ["riskOwner", "their own System"],
      ])("still lets %s (owner or Admin) change evidence on %s", async (who, which) => {
        const systemId = which === "their own System" ? riskOwnerOwnedId : onboardedId;
        const response = await patchAssessment(systemId, optionalControlId, who, {
          status: "FULFILLED",
          evidence: "new proof",
        });
        expect(response.status).toBe(200);
        expect((await response.json()).assessment.evidence).toBe("new proof");
      });
    });

    it.each(["FULFILLED", "IN_PROGRESS", "NOT_STARTED"])(
      "forbids a non-owner RISK_OWNER from setting %s",
      async (status) => {
        const response = await patchAssessment(onboardedId, optionalControlId, "riskOwner", {
          status,
          evidence: "sneaky",
          notes: "n",
        });
        expect(response.status).toBe(403);
        await expectNothingChanged(onboardedId);
      },
    );

    it.each(["otherOwner", "reviewer", "viewer", "bro", "cm"])(
      "forbids %s on a System they can see, whatever the status",
      async (who) => {
        for (const status of ["FULFILLED", "WAIVED", "NOT_APPLICABLE"]) {
          const response = await patchAssessment(onboardedId, optionalControlId, who, { status, notes: "n" });
          expect(response.status).toBe(403);
        }
        await expectNothingChanged(onboardedId);
      },
    );

    it("checks permission before validating the body", async () => {
      const response = await patchAssessment(onboardedId, optionalControlId, "reviewer", { status: "NOPE" });
      expect(response.status).toBe(403);
    });

    it.each(["otherOwner", "viewer"])("returns 404, not 403, for %s on a Draft System they can't see", async (who) => {
      const response = await patchAssessment(draftId, optionalControlId, who, { status: "FULFILLED" });
      expect(response.status).toBe(404);
      await expectNothingChanged(draftId);
    });

    it.each(["reviewer", "bro", "cm"])("forbids %s on a Draft System they can see", async (who) => {
      const response = await patchAssessment(draftId, optionalControlId, who, { status: "FULFILLED" });
      expect(response.status).toBe(403);
      await expectNothingChanged(draftId);
    });
  });

  describe("PATCH .../assessments/[controlId]/answer", () => {
    it.each(["owner", "admin"])("lets %s answer Yes", async (who) => {
      const response = await answer(onboardedId, optionalControlId, who, { answer: "YES" });
      expect(response.status).toBe(200);
      expect((await response.json()).assessment.status).toBe("FULFILLED");
    });

    it("lets the owner answer No, auto-opening a Risk", async () => {
      const response = await answer(onboardedId, optionalControlId, "owner", { answer: "NO" });
      expect(response.status).toBe(200);
      expect(await prisma.risk.count({ where: { systemId: onboardedId } })).toBe(1);
    });

    it("lets a RISK_OWNER who owns the System answer Yes", async () => {
      expect((await answer(riskOwnerOwnedId, optionalControlId, "riskOwner", { answer: "YES" })).status).toBe(200);
    });

    it.each(["admin", "riskOwner"])("lets %s answer N/A on a mandatory Control with a justification", async (who) => {
      const response = await answer(onboardedId, mandatoryControlId, who, { answer: "NA", notes: "not relevant" });
      expect(response.status).toBe(200);
      expect((await response.json()).assessment.status).toBe("NOT_APPLICABLE");
    });

    it("still applies the waive gate to a non-owner RISK_OWNER's N/A (a mandatory Control needs a note)", async () => {
      const response = await answer(onboardedId, mandatoryControlId, "riskOwner", { answer: "NA" });
      expect(response.status).toBe(400);
      await expectNothingChanged(onboardedId);
    });

    it("keeps the waive gate for the owner: a SYSTEM_OWNER still can't answer N/A", async () => {
      const response = await answer(onboardedId, mandatoryControlId, "owner", { answer: "NA", notes: "n" });
      expect(response.status).toBe(403);
      await expectNothingChanged(onboardedId);
    });

    it.each(["YES", "NO"])("forbids a non-owner RISK_OWNER from answering %s", async (value) => {
      const response = await answer(onboardedId, optionalControlId, "riskOwner", { answer: value });
      expect(response.status).toBe(403);
      await expectNothingChanged(onboardedId);
    });

    it.each(["otherOwner", "reviewer", "viewer", "bro", "cm"])(
      "forbids %s from answering anything on a System they can see",
      async (who) => {
        for (const value of ["YES", "NO", "NA"]) {
          const response = await answer(onboardedId, optionalControlId, who, { answer: value, notes: "n" });
          expect(response.status).toBe(403);
        }
        await expectNothingChanged(onboardedId);
      },
    );

    it("checks permission before validating the body", async () => {
      expect((await answer(onboardedId, optionalControlId, "viewer", { answer: "MAYBE" })).status).toBe(403);
    });

    it.each(["otherOwner", "viewer"])("returns 404 for %s on a Draft System they can't see", async (who) => {
      expect((await answer(draftId, optionalControlId, who, { answer: "YES" })).status).toBe(404);
      await expectNothingChanged(draftId);
    });
  });

  describe("POST .../submit", () => {
    async function fulfillAllMandatoryControls(systemId: string) {
      const unaddressed = await getUnaddressedMandatoryControls({
        id: systemId,
        deploymentFacets: [{ id: facetId }],
        regulatoryOverlays: [],
        frameworkScopes: [],
        confidentialityImpactLevel: null,
        integrityImpactLevel: null,
        availabilityImpactLevel: null,
      });
      await prisma.controlAssessment.createMany({
        data: unaddressed.map((control) => ({ systemId, controlId: control.id, status: "FULFILLED" as const })),
        skipDuplicates: true,
      });
    }

    it.each([
      ["owner", "owner"],
      ["admin", "owner"],
      ["riskOwner", "riskOwner"],
    ])("lets %s submit a Draft System owned by %s", async (who, ownerKey) => {
      const systemId = await makeSystem(ownerKey, "DRAFT");
      await fulfillAllMandatoryControls(systemId);
      const response = await submit(systemId, who);
      expect(response.status).toBe(200);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status).toBe("IN_REVIEW");
    });

    it.each(["riskOwner", "reviewer", "bro", "cm"])(
      "forbids %s from submitting a Draft System they can see but don't own",
      async (who) => {
        await fulfillAllMandatoryControls(draftId);
        const response = await submit(draftId, who);
        expect(response.status).toBe(403);
        expect((await prisma.system.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");
        expect(await prisma.changeEvent.count({ where: { systemId: draftId } })).toBe(0);
      },
    );

    it.each(["otherOwner", "viewer"])("returns 404 for %s on a Draft System they can't see", async (who) => {
      const response = await submit(draftId, who);
      expect(response.status).toBe(404);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");
    });

    it.each(["otherOwner", "reviewer", "viewer", "riskOwner", "bro", "cm"])(
      "checks permission before lifecycle state: %s gets 403, not 400, on an Onboarded System",
      async (who) => {
        expect((await submit(onboardedId, who)).status).toBe(403);
      },
    );
  });
});
