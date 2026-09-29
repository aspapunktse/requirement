import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";

// Requirement database — allowed.
import { POST as createControl } from "../controls/route";
import { PATCH as updateControl } from "../controls/[id]/route";
import { POST as createFramework } from "../frameworks/route";
import { PATCH as updateFramework, DELETE as deleteFramework } from "../frameworks/[id]/route";

// Admin-only catalogs and user/role admin — forbidden.
import { POST as createDeploymentFacet } from "../deployment-facets/route";
import { PATCH as updateDeploymentFacet, DELETE as deleteDeploymentFacet } from "../deployment-facets/[id]/route";
import { POST as createCapability } from "../capabilities/route";
import { PATCH as updateCapability, DELETE as deleteCapability } from "../capabilities/[id]/route";
import { POST as createRegulatoryOverlay } from "../regulatory-overlays/route";
import {
  PATCH as updateRegulatoryOverlay,
  DELETE as deleteRegulatoryOverlay,
} from "../regulatory-overlays/[id]/route";
import { POST as createBusinessUnit } from "../business-units/route";
import { PATCH as updateBusinessUnit, DELETE as deleteBusinessUnit } from "../business-units/[id]/route";
import { POST as assignBusinessUnitScope } from "../users/[id]/business-unit-scopes/route";
import { DELETE as removeBusinessUnitScope } from "../users/[id]/business-unit-scopes/[businessUnitId]/route";
import { POST as assignFrameworkScopeToUser } from "../users/[id]/framework-scopes/route";
import { DELETE as removeFrameworkScopeFromUser } from "../users/[id]/framework-scopes/[frameworkId]/route";

// Systems — readable.
import { GET as listSystems, POST as createSystem } from "../systems/route";
import { GET as getSystem, PATCH as changeSystemClassification } from "../systems/[id]/route";
import { GET as listAssessments } from "../systems/[id]/assessments/route";
import { GET as listRisks, POST as logRisk } from "../systems/[id]/risks/route";

// Systems — every mutation forbidden.
import { PATCH as updateAssessment } from "../systems/[id]/assessments/[controlId]/route";
import { PATCH as answerSelfAssessment } from "../systems/[id]/assessments/[controlId]/answer/route";
import { POST as raiseQuery } from "../systems/[id]/assessments/[controlId]/queries/route";
import { POST as replyToQuery } from "../systems/[id]/assessments/[controlId]/queries/[queryId]/messages/route";
import { POST as resolveQuery } from "../systems/[id]/assessments/[controlId]/queries/[queryId]/resolve/route";
import { PATCH as updateRisk } from "../systems/[id]/risks/[riskId]/route";
import { POST as submitSystem } from "../systems/[id]/submit/route";
import { POST as decideApproval } from "../systems/[id]/approvals/route";
import { POST as markOnboarded } from "../systems/[id]/onboard/route";
import { POST as declareOverlay } from "../systems/[id]/regulatory-overlays/route";
import { DELETE as removeOverlay } from "../systems/[id]/regulatory-overlays/[overlayId]/route";
import { POST as declareCapability } from "../systems/[id]/capabilities/route";
import { DELETE as removeCapability } from "../systems/[id]/capabilities/[capabilityId]/route";
import { POST as declareBusinessUnit } from "../systems/[id]/business-units/route";
import { DELETE as removeBusinessUnit } from "../systems/[id]/business-units/[businessUnitId]/route";
import { POST as declareFrameworkScope } from "../systems/[id]/framework-scopes/route";
import { DELETE as removeFrameworkScope } from "../systems/[id]/framework-scopes/[frameworkId]/route";

/**
 * The Compliance Manager role (#71) end to end: curates the Control Library
 * and Framework catalog; is refused the Admin-only catalogs and user/role
 * admin; reads every System but can't change any of it.
 */

const SUFFIX = Date.now();
const CM_EMAIL = `test-cm-role-cm-${SUFFIX}@example.com`;
const OWNER_EMAIL = `test-cm-role-owner-${SUFFIX}@example.com`;
const BRO_EMAIL = `test-cm-role-bro-${SUFFIX}@example.com`;

function req(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("COMPLIANCE_MANAGER role (#71)", () => {
  let cmId: string;
  let ownerId: string;
  let broId: string;
  let facetId: string;
  let capabilityId: string;
  let overlayId: string;
  let businessUnitId: string;
  let frameworkId: string;
  let systemId: string;
  let approvedSystemId: string;
  let inReviewSystemId: string;
  let controlId: string;
  let riskId: string;
  let queryId: string;
  const createdControlIds: string[] = [];
  const createdFrameworkIds: string[] = [];

  beforeAll(async () => {
    const [cm, owner, bro] = await Promise.all([
      prisma.user.create({ data: { email: CM_EMAIL, name: "Test CM", role: "COMPLIANCE_MANAGER" } }),
      prisma.user.create({ data: { email: OWNER_EMAIL, name: "Test CM Owner", role: "SYSTEM_OWNER" } }),
      prisma.user.create({ data: { email: BRO_EMAIL, name: "Test CM BRO", role: "BUSINESS_RISK_OWNER" } }),
    ]);
    cmId = cm.id;
    ownerId = owner.id;
    broId = bro.id;

    const [facet, capability, overlay, businessUnit, framework] = await Promise.all([
      prisma.deploymentFacet.create({ data: { name: `Test CM Facet ${SUFFIX}` } }),
      prisma.capability.create({ data: { name: `Test CM Capability ${SUFFIX}` } }),
      prisma.regulatoryOverlay.create({ data: { name: `Test CM Overlay ${SUFFIX}` } }),
      prisma.businessUnit.create({ data: { name: `Test CM BU ${SUFFIX}` } }),
      prisma.framework.create({ data: { name: `Test CM Framework ${SUFFIX}` } }),
    ]);
    facetId = facet.id;
    capabilityId = capability.id;
    overlayId = overlay.id;
    businessUnitId = businessUnit.id;
    frameworkId = framework.id;

    // A Control scoped to this test's own Deployment Facet only, so it
    // doesn't leak into Systems other test files create.
    const control = await prisma.control.create({
      data: {
        code: `TEST-CM-${SUFFIX}`,
        title: "Test CM Control",
        description: "desc",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: false,
        question: "Does it?",
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    controlId = control.id;

    // A Draft System the Compliance Manager doesn't own, with a Business
    // Unit, Framework Scope, Regulatory Overlay and Capability declared so
    // the remove endpoints have something to remove.
    const system = await prisma.system.create({
      data: {
        name: `Test CM Draft System ${SUFFIX}`,
        ownerId,
        status: "DRAFT",
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: { id: frameworkId } },
        regulatoryOverlays: { connect: { id: overlayId } },
        capabilities: { connect: { id: capabilityId } },
      },
    });
    systemId = system.id;

    const [approved, inReview] = await Promise.all([
      prisma.system.create({ data: { name: `Test CM Approved System ${SUFFIX}`, ownerId, status: "APPROVED" } }),
      prisma.system.create({ data: { name: `Test CM In Review System ${SUFFIX}`, ownerId, status: "IN_REVIEW" } }),
    ]);
    approvedSystemId = approved.id;
    inReviewSystemId = inReview.id;

    const assessment = await prisma.controlAssessment.create({
      data: { systemId, controlId, status: "IN_PROGRESS" },
    });
    const query = await prisma.assessmentQuery.create({
      data: {
        controlAssessmentId: assessment.id,
        lastMessageAuthorId: ownerId,
        messages: { create: { authorId: ownerId, body: "A question" } },
      },
    });
    queryId = query.id;

    const risk = await prisma.risk.create({
      data: { systemId, title: "Test CM Risk", description: "desc", severity: "LOW", likelihood: "LOW" },
    });
    riskId = risk.id;
  });

  afterAll(async () => {
    const systemIds = [systemId, approvedSystemId, inReviewSystemId].filter(Boolean);
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: [controlId, ...createdControlIds].filter(Boolean) } } });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkId, ...createdFrameworkIds].filter(Boolean) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.regulatoryOverlay.deleteMany({ where: { id: overlayId } });
    await prisma.user.deleteMany({ where: { email: { in: [CM_EMAIL, OWNER_EMAIL, BRO_EMAIL] } } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
  });

  describe("curates the Control Library", () => {
    it("creates a Control via POST /api/controls", async () => {
      const response = await createControl(
        req("/api/controls", "POST", cmId, {
          code: `TEST-CM-NEW-${SUFFIX}`,
          title: "Authored by a Compliance Manager",
          description: "desc",
          category: "Test",
          applicability: "ORGANIZATIONAL",
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.json();
      createdControlIds.push(body.control.id);
      expect(body.control.title).toBe("Authored by a Compliance Manager");
    });

    it("edits a Control via PATCH /api/controls/[id], including its Framework tags", async () => {
      const response = await updateControl(
        req(`/api/controls/${controlId}`, "PATCH", cmId, { title: "Renamed by CM", frameworkIds: [frameworkId] }),
        ctx({ id: controlId }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.control.title).toBe("Renamed by CM");
      expect(body.control.frameworks.map((f: { id: string }) => f.id)).toEqual([frameworkId]);
    });
  });

  describe("curates the Framework catalog", () => {
    it("creates, edits and retires a Framework", async () => {
      const created = await createFramework(
        req("/api/frameworks", "POST", cmId, { name: `Test CM Created Framework ${SUFFIX}` }),
      );
      expect(created.status).toBe(201);
      const { framework } = await created.json();
      createdFrameworkIds.push(framework.id);

      const updated = await updateFramework(
        req(`/api/frameworks/${framework.id}`, "PATCH", cmId, { strictComplianceRequired: true }),
        ctx({ id: framework.id }),
      );
      expect(updated.status).toBe(200);
      expect((await updated.json()).framework.strictComplianceRequired).toBe(true);

      const deleted = await deleteFramework(
        req(`/api/frameworks/${framework.id}`, "DELETE", cmId),
        ctx({ id: framework.id }),
      );
      expect(deleted.status).toBe(204);
      expect(await prisma.framework.findUnique({ where: { id: framework.id } })).toBeNull();
    });
  });

  describe("is refused the Admin-only catalogs", () => {
    it.each([
      ["POST /api/deployment-facets", () => createDeploymentFacet(req("/api/deployment-facets", "POST", cmId, { name: `x ${SUFFIX}` }))],
      ["PATCH /api/deployment-facets/[id]", () => updateDeploymentFacet(req(`/api/deployment-facets/${facetId}`, "PATCH", cmId, { name: `x ${SUFFIX}` }), ctx({ id: facetId }))],
      ["DELETE /api/deployment-facets/[id]", () => deleteDeploymentFacet(req(`/api/deployment-facets/${facetId}`, "DELETE", cmId), ctx({ id: facetId }))],
      ["POST /api/capabilities", () => createCapability(req("/api/capabilities", "POST", cmId, { name: `x ${SUFFIX}` }))],
      ["PATCH /api/capabilities/[id]", () => updateCapability(req(`/api/capabilities/${capabilityId}`, "PATCH", cmId, { name: `x ${SUFFIX}` }), ctx({ id: capabilityId }))],
      ["DELETE /api/capabilities/[id]", () => deleteCapability(req(`/api/capabilities/${capabilityId}`, "DELETE", cmId), ctx({ id: capabilityId }))],
      ["POST /api/regulatory-overlays", () => createRegulatoryOverlay(req("/api/regulatory-overlays", "POST", cmId, { name: `x ${SUFFIX}` }))],
      ["PATCH /api/regulatory-overlays/[id]", () => updateRegulatoryOverlay(req(`/api/regulatory-overlays/${overlayId}`, "PATCH", cmId, { name: `x ${SUFFIX}` }), ctx({ id: overlayId }))],
      ["DELETE /api/regulatory-overlays/[id]", () => deleteRegulatoryOverlay(req(`/api/regulatory-overlays/${overlayId}`, "DELETE", cmId), ctx({ id: overlayId }))],
      ["POST /api/business-units", () => createBusinessUnit(req("/api/business-units", "POST", cmId, { name: `x ${SUFFIX}` }))],
      ["PATCH /api/business-units/[id]", () => updateBusinessUnit(req(`/api/business-units/${businessUnitId}`, "PATCH", cmId, { name: `x ${SUFFIX}` }), ctx({ id: businessUnitId }))],
      ["DELETE /api/business-units/[id]", () => deleteBusinessUnit(req(`/api/business-units/${businessUnitId}`, "DELETE", cmId), ctx({ id: businessUnitId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });

    it("leaves those catalogs untouched", async () => {
      expect((await prisma.deploymentFacet.findUniqueOrThrow({ where: { id: facetId } })).name).toBe(`Test CM Facet ${SUFFIX}`);
      expect(await prisma.capability.findUnique({ where: { id: capabilityId } })).not.toBeNull();
      expect(await prisma.regulatoryOverlay.findUnique({ where: { id: overlayId } })).not.toBeNull();
      expect(await prisma.businessUnit.findUnique({ where: { id: businessUnitId } })).not.toBeNull();
    });
  });

  describe("is refused user/role admin (Business Risk Owner assignment)", () => {
    it.each([
      ["POST /api/users/[id]/business-unit-scopes", () => assignBusinessUnitScope(req(`/api/users/${broId}/business-unit-scopes`, "POST", cmId, { businessUnitId }), ctx({ id: broId }))],
      ["DELETE /api/users/[id]/business-unit-scopes/[businessUnitId]", () => removeBusinessUnitScope(req(`/api/users/${broId}/business-unit-scopes/${businessUnitId}`, "DELETE", cmId), ctx({ id: broId, businessUnitId }))],
      ["POST /api/users/[id]/framework-scopes", () => assignFrameworkScopeToUser(req(`/api/users/${broId}/framework-scopes`, "POST", cmId, { frameworkId }), ctx({ id: broId }))],
      ["DELETE /api/users/[id]/framework-scopes/[frameworkId]", () => removeFrameworkScopeFromUser(req(`/api/users/${broId}/framework-scopes/${frameworkId}`, "DELETE", cmId), ctx({ id: broId, frameworkId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });

    it("leaves the Business Risk Owner's portfolio unassigned", async () => {
      const bro = await prisma.user.findUniqueOrThrow({
        where: { id: broId },
        include: { businessUnitScopes: true, frameworkScopes: true },
      });
      expect(bro.businessUnitScopes).toEqual([]);
      expect(bro.frameworkScopes).toEqual([]);
    });
  });

  describe("reads every System", () => {
    it("lists Systems it doesn't own, in any status", async () => {
      const response = await listSystems(req("/api/systems", "GET", cmId));
      expect(response.status).toBe(200);
      const ids = (await response.json()).systems.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([systemId, approvedSystemId, inReviewSystemId]));
    });

    it("opens a Draft System's detail, Assessments and Risks", async () => {
      const system = await getSystem(req(`/api/systems/${systemId}`, "GET", cmId), ctx({ id: systemId }));
      expect(system.status).toBe(200);

      const assessments = await listAssessments(
        req(`/api/systems/${systemId}/assessments`, "GET", cmId),
        ctx({ id: systemId }),
      );
      expect(assessments.status).toBe(200);

      const risks = await listRisks(req(`/api/systems/${systemId}/risks`, "GET", cmId), ctx({ id: systemId }));
      expect(risks.status).toBe(200);
      expect((await risks.json()).risks.map((r: { id: string }) => r.id)).toContain(riskId);
    });
  });

  describe("can't change any System", () => {
    const base = () => `/api/systems/${systemId}`;
    it.each([
      ["POST /api/systems (create)", () => createSystem(req("/api/systems", "POST", cmId, { name: `CM System ${SUFFIX}`, deploymentFacetIds: [facetId] }))],
      ["PATCH /api/systems/[id] (classification)", () => changeSystemClassification(req(base(), "PATCH", cmId, { confidentialityImpactLevel: "HIGH" }), ctx({ id: systemId }))],
      ["PATCH .../assessments/[controlId]", () => updateAssessment(req(`${base()}/assessments/${controlId}`, "PATCH", cmId, { status: "FULFILLED" }), ctx({ id: systemId, controlId }))],
      ["PATCH .../assessments/[controlId]/answer", () => answerSelfAssessment(req(`${base()}/assessments/${controlId}/answer`, "PATCH", cmId, { answer: "YES" }), ctx({ id: systemId, controlId }))],
      ["POST .../queries (raise)", () => raiseQuery(req(`${base()}/assessments/${controlId}/queries`, "POST", cmId, { body: "Why?" }), ctx({ id: systemId, controlId }))],
      ["POST .../queries/[queryId]/messages (reply)", () => replyToQuery(req(`${base()}/assessments/${controlId}/queries/${queryId}/messages`, "POST", cmId, { body: "Because" }), ctx({ id: systemId, controlId, queryId }))],
      ["POST .../queries/[queryId]/resolve", () => resolveQuery(req(`${base()}/assessments/${controlId}/queries/${queryId}/resolve`, "POST", cmId), ctx({ id: systemId, controlId, queryId }))],
      ["POST .../risks (log)", () => logRisk(req(`${base()}/risks`, "POST", cmId, { title: "x", description: "x", severity: "LOW", likelihood: "LOW" }), ctx({ id: systemId }))],
      ["PATCH .../risks/[riskId]", () => updateRisk(req(`${base()}/risks/${riskId}`, "PATCH", cmId, { status: "CLOSED" }), ctx({ id: systemId, riskId }))],
      ["POST .../submit", () => submitSystem(req(`${base()}/submit`, "POST", cmId), ctx({ id: systemId }))],
      ["POST .../approvals (decide)", () => decideApproval(req(`/api/systems/${inReviewSystemId}/approvals`, "POST", cmId, { decision: "APPROVED" }), ctx({ id: inReviewSystemId }))],
      ["POST .../onboard", () => markOnboarded(req(`/api/systems/${approvedSystemId}/onboard`, "POST", cmId), ctx({ id: approvedSystemId }))],
      ["POST .../regulatory-overlays (declare)", () => declareOverlay(req(`${base()}/regulatory-overlays`, "POST", cmId, { regulatoryOverlayId: overlayId }), ctx({ id: systemId }))],
      ["DELETE .../regulatory-overlays/[overlayId]", () => removeOverlay(req(`${base()}/regulatory-overlays/${overlayId}`, "DELETE", cmId), ctx({ id: systemId, overlayId }))],
      ["POST .../capabilities (declare)", () => declareCapability(req(`${base()}/capabilities`, "POST", cmId, { capabilityId }), ctx({ id: systemId }))],
      ["DELETE .../capabilities/[capabilityId]", () => removeCapability(req(`${base()}/capabilities/${capabilityId}`, "DELETE", cmId), ctx({ id: systemId, capabilityId }))],
      ["POST .../business-units (declare)", () => declareBusinessUnit(req(`${base()}/business-units`, "POST", cmId, { businessUnitId }), ctx({ id: systemId }))],
      ["DELETE .../business-units/[businessUnitId]", () => removeBusinessUnit(req(`${base()}/business-units/${businessUnitId}`, "DELETE", cmId), ctx({ id: systemId, businessUnitId }))],
      ["POST .../framework-scopes (declare)", () => declareFrameworkScope(req(`${base()}/framework-scopes`, "POST", cmId, { frameworkId }), ctx({ id: systemId }))],
      ["DELETE .../framework-scopes/[frameworkId]", () => removeFrameworkScope(req(`${base()}/framework-scopes/${frameworkId}`, "DELETE", cmId), ctx({ id: systemId, frameworkId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });

    it("leaves every System, Assessment, Risk and Query as it was", async () => {
      const system = await prisma.system.findUniqueOrThrow({
        where: { id: systemId },
        include: { businessUnits: true, frameworkScopes: true, regulatoryOverlays: true, capabilities: true },
      });
      expect(system.status).toBe("DRAFT");
      expect(system.confidentialityImpactLevel).toBeNull();
      expect(system.businessUnits.map((b) => b.id)).toEqual([businessUnitId]);
      expect(system.frameworkScopes.map((f) => f.id)).toEqual([frameworkId]);
      expect(system.regulatoryOverlays.map((o) => o.id)).toEqual([overlayId]);
      expect(system.capabilities.map((c) => c.id)).toEqual([capabilityId]);

      expect((await prisma.system.findUniqueOrThrow({ where: { id: approvedSystemId } })).status).toBe("APPROVED");
      expect((await prisma.system.findUniqueOrThrow({ where: { id: inReviewSystemId } })).status).toBe("IN_REVIEW");
      expect(await prisma.system.count({ where: { ownerId: cmId } })).toBe(0);

      const assessment = await prisma.controlAssessment.findUniqueOrThrow({
        where: { systemId_controlId: { systemId, controlId } },
      });
      expect(assessment.status).toBe("IN_PROGRESS");

      expect((await prisma.risk.findUniqueOrThrow({ where: { id: riskId } })).status).toBe("OPEN");
      expect(await prisma.risk.count({ where: { systemId } })).toBe(1);

      const query = await prisma.assessmentQuery.findUniqueOrThrow({
        where: { id: queryId },
        include: { messages: true },
      });
      expect(query.resolved).toBe(false);
      expect(query.messages).toHaveLength(1);
      expect(await prisma.assessmentQuery.count({ where: { controlAssessment: { systemId } } })).toBe(1);

      expect(await prisma.changeEvent.count({ where: { actorId: cmId } })).toBe(0);
    });
  });
});
