import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs as req } from "@/test/provider-fixtures";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

// Requirement database.
import { GET as listControls, POST as createControl } from "../controls/route";
import { GET as getControl, PATCH as updateControl } from "../controls/[id]/route";
import { GET as listFrameworks, POST as createFramework } from "../frameworks/route";
import { GET as getFramework, PATCH as updateFramework, DELETE as deleteFramework } from "../frameworks/[id]/route";
import { GET as getCoverage } from "../frameworks/[id]/coverage/route";
import { GET as listRequirements, POST as createRequirement } from "../frameworks/[id]/requirements/route";
import { PATCH as updateRequirement, DELETE as deleteRequirement } from "../frameworks/[id]/requirements/[requirementId]/route";
import { POST as publishFramework } from "../frameworks/[id]/publish/route";
import { POST as createMapping } from "../frameworks/[id]/requirements/[requirementId]/mappings/route";
import { PATCH as updateMapping, DELETE as deleteMapping } from "../frameworks/[id]/requirements/[requirementId]/mappings/[mappingId]/route";
import { PUT as acceptGap, DELETE as revokeGapAcceptance } from "../frameworks/[id]/requirements/[requirementId]/gap-acceptance/route";
import { POST as createSupplementaryControl } from "../frameworks/[id]/requirements/[requirementId]/supplementary-control/route";
import { GET as listOrganizationControls } from "../organization/controls/route";
import { PATCH as updateOrganizationImplementation } from "../organization/controls/[controlId]/route";
import { GET as getStatementOfApplicability } from "../statement-of-applicability/route";
import { PUT as saveExclusionJustification } from "../statement-of-applicability/[controlId]/exclusion-justification/route";

// Admin-only catalogs and user admin.
import { POST as createDeploymentFacet } from "../deployment-facets/route";
import { PATCH as updateDeploymentFacet, DELETE as deleteDeploymentFacet } from "../deployment-facets/[id]/route";
import { POST as createBusinessUnit } from "../business-units/route";
import { PATCH as updateBusinessUnit, DELETE as deleteBusinessUnit } from "../business-units/[id]/route";
import { POST as assignBusinessUnitScope } from "../users/[id]/business-unit-scopes/route";
import { DELETE as removeBusinessUnitScope } from "../users/[id]/business-unit-scopes/[businessUnitId]/route";
import { POST as assignFrameworkScopeToUser } from "../users/[id]/framework-scopes/route";
import { DELETE as removeFrameworkScopeFromUser } from "../users/[id]/framework-scopes/[frameworkId]/route";

// Systems: reads.
import { GET as listSystems, POST as createSystem } from "../systems/route";
import { GET as getSystem, PATCH as changeSystemClassification } from "../systems/[id]/route";
import { GET as listAssessments } from "../systems/[id]/assessments/route";
import { GET as listRisks, POST as logRisk } from "../systems/[id]/risks/route";
import { GET as listApprovals, POST as decideApproval } from "../systems/[id]/approvals/route";
import { GET as listOfferings, POST as createOffering } from "../systems/[id]/offerings/route";
import { GET as listDependencies, POST as declareProviderDependency } from "../systems/[id]/dependencies/route";
import { GET as listSystemFrameworkScopes, POST as declareFrameworkScope } from "../systems/[id]/framework-scopes/route";
import { GET as listSystemBusinessUnits, POST as declareBusinessUnit } from "../systems/[id]/business-units/route";

// Systems: writes.
import { PATCH as updateAssessment, DELETE as removeStaleAssessment } from "../systems/[id]/assessments/[controlId]/route";
import { PATCH as answerSelfAssessment } from "../systems/[id]/assessments/[controlId]/answer/route";
import { POST as resetAssessment } from "../systems/[id]/assessments/[controlId]/reset/route";
import { POST as raiseQuery } from "../systems/[id]/assessments/[controlId]/queries/route";
import { POST as replyToQuery } from "../systems/[id]/assessments/[controlId]/queries/[queryId]/messages/route";
import { POST as resolveQuery } from "../systems/[id]/assessments/[controlId]/queries/[queryId]/resolve/route";
import { PATCH as updateRisk } from "../systems/[id]/risks/[riskId]/route";
import { POST as submitSystem } from "../systems/[id]/submit/route";
import { POST as markOnboarded } from "../systems/[id]/onboard/route";
import { PATCH as markProvider } from "../systems/[id]/provider/route";
import { PATCH as updateOffering, DELETE as removeOffering } from "../systems/[id]/offerings/[offeringId]/route";
import { DELETE as removeProviderDependency } from "../systems/[id]/dependencies/[providerId]/route";
import { DELETE as removeBusinessUnit } from "../systems/[id]/business-units/[businessUnitId]/route";
import { DELETE as removeFrameworkScope } from "../systems/[id]/framework-scopes/[frameworkId]/route";

/**
 * The Internal Auditor role (#147) end to end: reads every System and the
 * requirement database, and writes nothing through any existing route, also
 * when recorded as a System's owner or a Control's Control Owner. Fixtures
 * only (CI's database is migrated but not seeded); the Internal Auditor user
 * is created here.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const IA_EMAIL = `test-147-ia-${SUFFIX}@example.com`;
const OWNER_EMAIL = `test-147-owner-${SUFFIX}@example.com`;
const BRO_EMAIL = `test-147-bro-${SUFFIX}@example.com`;

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) } as never;
}

describe("INTERNAL_AUDITOR role (#147)", () => {
  let iaId: string;
  let ownerId: string;
  let broId: string;
  let facetId: string;
  let businessUnitId: string;
  let draftFrameworkId: string;
  let publishedFrameworkId: string;
  let requirementId: string;
  let mappingId: string;
  let controlId: string;
  let orgControlId: string;
  let providerId: string;
  let offeringId: string;
  /** A Draft System owned by someone else, one Approved, one In Review. */
  let draftId: string;
  let approvedId: string;
  let inReviewId: string;
  /** A Draft and an Approved System the Internal Auditor is recorded as the owner of. */
  let iaDraftId: string;
  let iaApprovedId: string;
  const queryIds: Record<string, string> = {};
  const riskIds: Record<string, string> = {};
  const systemIds: string[] = [];
  const controlIds: string[] = [];
  let before: unknown;

  /** Everything the writes below could touch, for the "no DB change" check. */
  async function snapshot() {
    const systems = await prisma.system.findMany({
      where: { id: { in: systemIds } },
      orderBy: { id: "asc" },
      include: {
        businessUnits: { select: { id: true } },
        frameworkScopes: { select: { id: true } },
        deploymentFacets: { select: { id: true } },
        providerDependencies: true,
        offerings: true,
        assessments: { orderBy: { id: "asc" }, include: { queries: { include: { messages: true } } } },
        risks: { orderBy: { id: "asc" } },
        approvals: true,
        changeEvents: true,
      },
    });
    const controls = await prisma.control.findMany({
      where: { id: { in: controlIds } },
      orderBy: { id: "asc" },
      include: { organizationImplementation: true, mappings: true },
    });
    const frameworks = await prisma.framework.findMany({
      where: { id: { in: [draftFrameworkId, publishedFrameworkId] } },
      orderBy: { id: "asc" },
      include: { requirements: { include: { mappings: true } } },
    });
    return JSON.parse(
      JSON.stringify({
        systems,
        controls,
        frameworks,
        facet: await prisma.deploymentFacet.findUnique({ where: { id: facetId } }),
        businessUnit: await prisma.businessUnit.findUnique({ where: { id: businessUnitId } }),
        bro: await prisma.user.findUnique({
          where: { id: broId },
          include: { businessUnitScopes: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
        }),
        iaAuthoredChangeEvents: await prisma.changeEvent.count({ where: { actorId: iaId } }),
        systemsOwnedByIa: await prisma.system.count({ where: { ownerId: iaId } }),
        controlsWithTestCode: await prisma.control.count({ where: { code: { startsWith: `TEST-147-NEW-${SUFFIX}` } } }),
        frameworksWithTestName: await prisma.framework.count({ where: { name: { startsWith: `Test 147 New ${SUFFIX}` } } }),
        facetsWithTestName: await prisma.deploymentFacet.count({ where: { name: { startsWith: `Test 147 New ${SUFFIX}` } } }),
        businessUnitsWithTestName: await prisma.businessUnit.count({ where: { name: { startsWith: `Test 147 New ${SUFFIX}` } } }),
      }),
    );
  }

  /** One Draft-like System with an Assessment, a Query, a Risk, and each relation declared. */
  async function makeSystem(name: string, owner: string, status: "DRAFT" | "APPROVED" | "IN_REVIEW") {
    const system = await prisma.system.create({
      data: {
        name: `Test 147 ${name} ${SUFFIX}`,
        ownerId: owner,
        status,
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: { id: publishedFrameworkId } },
        providerDependencies: { create: { providerId } },
      },
    });
    systemIds.push(system.id);
    const assessment = await prisma.controlAssessment.create({
      data: { systemId: system.id, controlId, status: "IN_PROGRESS", assessedById: ownerId },
    });
    const query = await prisma.assessmentQuery.create({
      data: {
        controlAssessmentId: assessment.id,
        lastMessageAuthorId: ownerId,
        messages: { create: { authorId: ownerId, body: "A question" } },
      },
    });
    queryIds[system.id] = query.id;
    const risk = await prisma.risk.create({
      data: { systemId: system.id, title: `Test 147 Risk ${name}`, description: "d", severity: "LOW", likelihood: "LOW" },
    });
    riskIds[system.id] = risk.id;
    return system.id;
  }

  beforeAll(async () => {
    const [ia, owner, bro] = await Promise.all([
      prisma.user.create({ data: { email: IA_EMAIL, name: "Test 147 Internal Auditor", role: "INTERNAL_AUDITOR" } }),
      prisma.user.create({ data: { email: OWNER_EMAIL, name: "Test 147 Owner", role: "SYSTEM_OWNER" } }),
      prisma.user.create({ data: { email: BRO_EMAIL, name: "Test 147 BRO", role: "BUSINESS_RISK_OWNER" } }),
    ]);
    iaId = ia.id;
    ownerId = owner.id;
    broId = bro.id;

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 147 Facet ${SUFFIX}` } })).id;
    businessUnitId = (await prisma.businessUnit.create({ data: { name: `Test 147 BU ${SUFFIX}` } })).id;

    // A Published Framework (the Internal Auditor reads it) and a Draft one (it must not).
    publishedFrameworkId = (await createFixtureFramework("147")).id;
    draftFrameworkId = (await prisma.framework.create({ data: { name: `Test 147 Draft Framework ${SUFFIX}`, version: "1" } })).id;

    // A Per-System Control scoped to this test's own Deployment Facet only (so it applies to no other file's
    // System), and an Organizational Control, owned by the Internal Auditor, mapped to no Framework.
    const control = await prisma.control.create({
      data: {
        code: `TEST-147-${SUFFIX}`,
        title: "Test 147 Control",
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: false,
        question: "Does it?",
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    controlId = control.id;
    const orgControl = await prisma.control.create({
      data: {
        code: `TEST-147-ORG-${SUFFIX}`,
        title: "Test 147 Organizational Control",
        description: "d",
        category: "Test",
        applicability: "ORGANIZATIONAL",
        ownerId: iaId,
      },
    });
    orgControlId = orgControl.id;
    controlIds.push(controlId, orgControlId);

    // The Draft Framework's Requirement and mapping, for the Framework authoring routes.
    const requirement = await prisma.requirement.create({
      data: { frameworkId: draftFrameworkId, code: `TEST-147-R-${SUFFIX}`, section: "Test", title: "Test 147 Requirement", text: "t" },
    });
    requirementId = requirement.id;
    mappingId = (await prisma.controlMapping.create({ data: { requirementId, controlId, coverage: "PARTIAL" } })).id;
    await mapControlsToFramework(publishedFrameworkId, [controlId]);

    const provider = await prisma.system.create({
      data: { name: `Test 147 Provider ${SUFFIX}`, ownerId, status: "ONBOARDED", isProvider: true },
    });
    providerId = provider.id;
    systemIds.push(providerId);
    offeringId = (await prisma.controlOffering.create({ data: { providerId, controlId, type: "FULL" } })).id;

    draftId = await makeSystem("Draft System", ownerId, "DRAFT");
    approvedId = await makeSystem("Approved System", ownerId, "APPROVED");
    inReviewId = await makeSystem("In Review System", ownerId, "IN_REVIEW");
    iaDraftId = await makeSystem("IA-owned Draft System", iaId, "DRAFT");
    iaApprovedId = await makeSystem("IA-owned Approved System", iaId, "APPROVED");

    before = await snapshot();
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { OR: [{ systemId: { in: systemIds } }, { actorId: iaId }] } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds.filter(Boolean) } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds.filter(Boolean) } } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    await prisma.user.deleteMany({ where: { email: { in: [IA_EMAIL, OWNER_EMAIL, BRO_EMAIL] } } });
  });

  describe("reads", () => {
    it("lists Systems in every status, owned by anyone, including its own", async () => {
      const response = await listSystems(req("/api/systems", iaId, "GET"));
      expect(response.status).toBe(200);
      const ids = (await response.json()).systems.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([draftId, approvedId, inReviewId, providerId, iaDraftId]));
    });

    it("opens a Draft System and its Assessments, Risks, Approvals, relations and Provider data", async () => {
      const base = `/api/systems/${draftId}`;
      const reads = await Promise.all([
        getSystem(req(base, iaId, "GET"), ctx({ id: draftId })),
        listAssessments(req(`${base}/assessments`, iaId, "GET"), ctx({ id: draftId })),
        listRisks(req(`${base}/risks`, iaId, "GET"), ctx({ id: draftId })),
        listApprovals(req(`${base}/approvals`, iaId, "GET"), ctx({ id: draftId })),
        listDependencies(req(`${base}/dependencies`, iaId, "GET"), ctx({ id: draftId })),
        listSystemFrameworkScopes(req(`${base}/framework-scopes`, iaId, "GET"), ctx({ id: draftId })),
        listSystemBusinessUnits(req(`${base}/business-units`, iaId, "GET"), ctx({ id: draftId })),
        listOfferings(req(`/api/systems/${providerId}/offerings`, iaId, "GET"), ctx({ id: providerId })),
      ]);
      expect(reads.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
      const risks = await reads[2].json();
      expect(risks.risks.map((r: { id: string }) => r.id)).toContain(riskIds[draftId]);
      const assessments = await reads[1].json();
      expect(assessments.assessments.map((a: { control: { id: string } }) => a.control.id)).toContain(controlId);
    });

    it("reads the Control Library, the Published Framework and its Coverage, the Organization Control Implementations and the Statement of Applicability", async () => {
      const controls = await listControls(req("/api/controls", iaId, "GET"));
      expect(controls.status).toBe(200);
      expect((await controls.json()).controls.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([controlId, orgControlId]));
      expect((await getControl(req(`/api/controls/${controlId}`, iaId, "GET"), ctx({ id: controlId }))).status).toBe(200);

      const frameworks = await listFrameworks(req("/api/frameworks", iaId, "GET"));
      expect((await frameworks.json()).frameworks.map((f: { id: string }) => f.id)).toContain(publishedFrameworkId);
      expect((await getFramework(req(`/api/frameworks/${publishedFrameworkId}`, iaId, "GET"), ctx({ id: publishedFrameworkId }))).status).toBe(200);
      expect((await getCoverage(req(`/api/frameworks/${publishedFrameworkId}/coverage`, iaId, "GET"), ctx({ id: publishedFrameworkId }))).status).toBe(200);
      expect((await listRequirements(req(`/api/frameworks/${publishedFrameworkId}/requirements`, iaId, "GET"), ctx({ id: publishedFrameworkId }))).status).toBe(200);

      const organization = await listOrganizationControls(req("/api/organization/controls", iaId, "GET"));
      expect(organization.status).toBe(200);
      expect((await organization.json()).controls.map((c: { id: string }) => c.id)).toContain(orgControlId);

      const soa = await getStatementOfApplicability(req("/api/statement-of-applicability", iaId, "GET"));
      expect(soa.status).toBe(200);
      expect((await soa.json()).rows.map((r: { controlId: string }) => r.controlId)).toContain(orgControlId);
    });

    it("does not see a Draft Framework (the issue's rule; flagged if it ever blocks an audit)", async () => {
      const frameworks = await listFrameworks(req("/api/frameworks", iaId, "GET"));
      expect((await frameworks.json()).frameworks.map((f: { id: string }) => f.id)).not.toContain(draftFrameworkId);
      const draft = await getFramework(req(`/api/frameworks/${draftFrameworkId}`, iaId, "GET"), ctx({ id: draftFrameworkId }));
      expect(draft.status).toBe(404);
      const coverage = await getCoverage(req(`/api/frameworks/${draftFrameworkId}/coverage`, iaId, "GET"), ctx({ id: draftFrameworkId }));
      expect(coverage.status).toBe(404);
    });
  });

  describe("can't change the requirement database", () => {
    const fw = () => `/api/frameworks/${draftFrameworkId}`;
    const rq = () => `${fw()}/requirements/${requirementId}`;
    it.each([
      ["POST /api/controls", () => createControl(req("/api/controls", iaId, "POST", { code: `TEST-147-NEW-${SUFFIX}`, title: "x", description: "x", category: "Test", applicability: "ORGANIZATIONAL" }))],
      ["PATCH /api/controls/[id]", () => updateControl(req(`/api/controls/${controlId}`, iaId, "PATCH", { title: "Renamed" }), ctx({ id: controlId }))],
      ["POST /api/frameworks", () => createFramework(req("/api/frameworks", iaId, "POST", { name: `Test 147 New ${SUFFIX}`, version: "1" }))],
      ["PATCH /api/frameworks/[id]", () => updateFramework(req(fw(), iaId, "PATCH", { strictComplianceRequired: true }), ctx({ id: draftFrameworkId }))],
      ["DELETE /api/frameworks/[id]", () => deleteFramework(req(fw(), iaId, "DELETE"), ctx({ id: draftFrameworkId }))],
      ["POST /api/frameworks/[id]/publish", () => publishFramework(req(`${fw()}/publish`, iaId, "POST"), ctx({ id: draftFrameworkId }))],
      ["POST .../requirements", () => createRequirement(req(`${fw()}/requirements`, iaId, "POST", { code: "NEW", section: "s", title: "t", text: "t" }), ctx({ id: draftFrameworkId }))],
      ["PATCH .../requirements/[requirementId]", () => updateRequirement(req(rq(), iaId, "PATCH", { title: "Renamed" }), ctx({ id: draftFrameworkId, requirementId }))],
      ["DELETE .../requirements/[requirementId]", () => deleteRequirement(req(rq(), iaId, "DELETE"), ctx({ id: draftFrameworkId, requirementId }))],
      ["POST .../mappings", () => createMapping(req(`${rq()}/mappings`, iaId, "POST", { controlId: orgControlId, coverage: "FULL" }), ctx({ id: draftFrameworkId, requirementId }))],
      ["PATCH .../mappings/[mappingId]", () => updateMapping(req(`${rq()}/mappings/${mappingId}`, iaId, "PATCH", { coverage: "FULL" }), ctx({ id: draftFrameworkId, requirementId, mappingId }))],
      ["DELETE .../mappings/[mappingId]", () => deleteMapping(req(`${rq()}/mappings/${mappingId}`, iaId, "DELETE"), ctx({ id: draftFrameworkId, requirementId, mappingId }))],
      ["PUT .../gap-acceptance", () => acceptGap(req(`${rq()}/gap-acceptance`, iaId, "PUT", { justification: "Accepted" }), ctx({ id: draftFrameworkId, requirementId }))],
      ["DELETE .../gap-acceptance", () => revokeGapAcceptance(req(`${rq()}/gap-acceptance`, iaId, "DELETE"), ctx({ id: draftFrameworkId, requirementId }))],
      ["POST .../supplementary-control", () => createSupplementaryControl(req(`${rq()}/supplementary-control`, iaId, "POST", { code: `TEST-147-NEW-${SUFFIX}-S`, title: "x", description: "x", category: "Test" }), ctx({ id: draftFrameworkId, requirementId }))],
      ["PUT /api/statement-of-applicability/[controlId]/exclusion-justification", () => saveExclusionJustification(req(`/api/statement-of-applicability/${orgControlId}/exclusion-justification`, iaId, "PUT", { justification: "Not needed" }), ctx({ controlId: orgControlId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });

    it("returns 403 for an Organization Control Implementation edit, also as the recorded Control Owner", async () => {
      const response = await updateOrganizationImplementation(
        req(`/api/organization/controls/${orgControlId}`, iaId, "PATCH", { status: "FULFILLED", description: "Done" }),
        ctx({ controlId: orgControlId }),
      );
      expect(response.status).toBe(403);
      expect(await prisma.organizationControlImplementation.findUnique({ where: { controlId: orgControlId } })).toBeNull();
    });
  });

  describe("can't change the Admin-only catalogs or users", () => {
    it.each([
      ["POST /api/deployment-facets", () => createDeploymentFacet(req("/api/deployment-facets", iaId, "POST", { name: `Test 147 New ${SUFFIX}` }))],
      ["PATCH /api/deployment-facets/[id]", () => updateDeploymentFacet(req(`/api/deployment-facets/${facetId}`, iaId, "PATCH", { name: `Test 147 New ${SUFFIX}` }), ctx({ id: facetId }))],
      ["DELETE /api/deployment-facets/[id]", () => deleteDeploymentFacet(req(`/api/deployment-facets/${facetId}`, iaId, "DELETE"), ctx({ id: facetId }))],
      ["POST /api/business-units", () => createBusinessUnit(req("/api/business-units", iaId, "POST", { name: `Test 147 New ${SUFFIX}` }))],
      ["PATCH /api/business-units/[id]", () => updateBusinessUnit(req(`/api/business-units/${businessUnitId}`, iaId, "PATCH", { name: `Test 147 New ${SUFFIX}` }), ctx({ id: businessUnitId }))],
      ["DELETE /api/business-units/[id]", () => deleteBusinessUnit(req(`/api/business-units/${businessUnitId}`, iaId, "DELETE"), ctx({ id: businessUnitId }))],
      ["POST /api/users/[id]/business-unit-scopes", () => assignBusinessUnitScope(req(`/api/users/${broId}/business-unit-scopes`, iaId, "POST", { businessUnitId }), ctx({ id: broId }))],
      ["DELETE /api/users/[id]/business-unit-scopes/[businessUnitId]", () => removeBusinessUnitScope(req(`/api/users/${broId}/business-unit-scopes/${businessUnitId}`, iaId, "DELETE"), ctx({ id: broId, businessUnitId }))],
      ["POST /api/users/[id]/framework-scopes", () => assignFrameworkScopeToUser(req(`/api/users/${broId}/framework-scopes`, iaId, "POST", { frameworkId: publishedFrameworkId }), ctx({ id: broId }))],
      ["DELETE /api/users/[id]/framework-scopes/[frameworkId]", () => removeFrameworkScopeFromUser(req(`/api/users/${broId}/framework-scopes/${publishedFrameworkId}`, iaId, "DELETE"), ctx({ id: broId, frameworkId: publishedFrameworkId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });
  });

  /**
   * Every System write, against a System owned by someone else and against Systems the Internal
   * Auditor is recorded as the owner of. The owner rule gives it nothing (`isSystemOwnerOrAdmin`).
   */
  describe.each([
    ["a System it doesn't own", () => draftId, () => approvedId, () => inReviewId],
    ["a Draft System it is recorded as the owner of", () => iaDraftId, () => iaApprovedId, () => iaDraftId],
  ])("can't change %s", (_name, draft, approved, inReview) => {
    const base = () => `/api/systems/${draft()}`;
    it.each([
      ["PATCH /api/systems/[id] (classification)", () => changeSystemClassification(req(base(), iaId, "PATCH", { confidentialityImpactLevel: "HIGH" }), ctx({ id: draft() }))],
      ["PATCH /api/systems/[id] (deployment facets)", () => changeSystemClassification(req(base(), iaId, "PATCH", { deploymentFacetIds: [] }), ctx({ id: draft() }))],
      ["PATCH .../assessments/[controlId]", () => updateAssessment(req(`${base()}/assessments/${controlId}`, iaId, "PATCH", { status: "FULFILLED" }), ctx({ id: draft(), controlId }))],
      ["PATCH .../assessments/[controlId] (waive)", () => updateAssessment(req(`${base()}/assessments/${controlId}`, iaId, "PATCH", { status: "WAIVED", notes: "x" }), ctx({ id: draft(), controlId }))],
      ["PATCH .../assessments/[controlId]/answer", () => answerSelfAssessment(req(`${base()}/assessments/${controlId}/answer`, iaId, "PATCH", { answer: "YES" }), ctx({ id: draft(), controlId }))],
      ["POST .../assessments/[controlId]/reset", () => resetAssessment(req(`${base()}/assessments/${controlId}/reset`, iaId, "POST"), ctx({ id: draft(), controlId }))],
      ["DELETE .../assessments/[controlId] (stale)", () => removeStaleAssessment(req(`${base()}/assessments/${controlId}`, iaId, "DELETE"), ctx({ id: draft(), controlId }))],
      ["POST .../queries (raise)", () => raiseQuery(req(`${base()}/assessments/${controlId}/queries`, iaId, "POST", { body: "Why?" }), ctx({ id: draft(), controlId }))],
      ["POST .../queries/[queryId]/messages (reply)", () => replyToQuery(req(`${base()}/assessments/${controlId}/queries/${queryIds[draft()]}/messages`, iaId, "POST", { body: "Because" }), ctx({ id: draft(), controlId, queryId: queryIds[draft()] }))],
      ["POST .../queries/[queryId]/resolve", () => resolveQuery(req(`${base()}/assessments/${controlId}/queries/${queryIds[draft()]}/resolve`, iaId, "POST"), ctx({ id: draft(), controlId, queryId: queryIds[draft()] }))],
      ["POST .../risks (log)", () => logRisk(req(`${base()}/risks`, iaId, "POST", { title: "x", description: "x", severity: "LOW", likelihood: "LOW" }), ctx({ id: draft() }))],
      ["PATCH .../risks/[riskId]", () => updateRisk(req(`${base()}/risks/${riskIds[draft()]}`, iaId, "PATCH", { status: "CLOSED" }), ctx({ id: draft(), riskId: riskIds[draft()] }))],
      ["POST .../submit", () => submitSystem(req(`${base()}/submit`, iaId, "POST"), ctx({ id: draft() }))],
      ["POST .../approvals (decide)", () => decideApproval(req(`/api/systems/${inReview()}/approvals`, iaId, "POST", { decision: "APPROVED", comment: "ok" }), ctx({ id: inReview() }))],
      ["POST .../onboard", () => markOnboarded(req(`/api/systems/${approved()}/onboard`, iaId, "POST"), ctx({ id: approved() }))],
      ["PATCH .../provider", () => markProvider(req(`${base()}/provider`, iaId, "PATCH", { isProvider: true }), ctx({ id: draft() }))],
      ["POST .../offerings", () => createOffering(req(`${base()}/offerings`, iaId, "POST", { controlId, type: "FULL" }), ctx({ id: draft() }))],
      ["PATCH .../offerings/[offeringId]", () => updateOffering(req(`/api/systems/${providerId}/offerings/${offeringId}`, iaId, "PATCH", { type: "SHARED", customerResponsibility: "x" }), ctx({ id: providerId, offeringId }))],
      ["DELETE .../offerings/[offeringId]", () => removeOffering(req(`/api/systems/${providerId}/offerings/${offeringId}`, iaId, "DELETE"), ctx({ id: providerId, offeringId }))],
      ["POST .../dependencies (declare)", () => declareProviderDependency(req(`${base()}/dependencies`, iaId, "POST", { providerId }), ctx({ id: draft() }))],
      ["DELETE .../dependencies/[providerId]", () => removeProviderDependency(req(`${base()}/dependencies/${providerId}`, iaId, "DELETE"), ctx({ id: draft(), providerId }))],
      ["POST .../business-units (declare)", () => declareBusinessUnit(req(`${base()}/business-units`, iaId, "POST", { businessUnitId }), ctx({ id: draft() }))],
      ["DELETE .../business-units/[businessUnitId]", () => removeBusinessUnit(req(`${base()}/business-units/${businessUnitId}`, iaId, "DELETE"), ctx({ id: draft(), businessUnitId }))],
      ["POST .../framework-scopes (declare)", () => declareFrameworkScope(req(`${base()}/framework-scopes`, iaId, "POST", { frameworkId: publishedFrameworkId }), ctx({ id: draft() }))],
      ["DELETE .../framework-scopes/[frameworkId]", () => removeFrameworkScope(req(`${base()}/framework-scopes/${publishedFrameworkId}`, iaId, "DELETE"), ctx({ id: draft(), frameworkId: publishedFrameworkId }))],
    ] as const)("%s returns 403", async (_label, call) => {
      expect((await call()).status).toBe(403);
    });
  });

  it("can't create a System", async () => {
    const response = await createSystem(req("/api/systems", iaId, "POST", { name: `Test 147 New ${SUFFIX}`, deploymentFacetIds: [facetId] }));
    expect(response.status).toBe(403);
  });

  it("leaves every System, Assessment, Query, Risk, Control, Framework, catalog and user exactly as it was", async () => {
    expect(await snapshot()).toEqual(before);
  });
});
