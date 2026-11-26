// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { loadOscalPackage } from "@/lib/oscal/package-builder";
import { validateOscalPackage } from "@/lib/oscal/validate";
import { getSystemAssessments } from "@/lib/control-assessments";
import { POST } from "../route";
import { DELETE } from "../[evidenceId]/route";

/**
 * Evidence records on a Control Assessment (#455): adding and removing them, the rights, and what the System page data and
 * the OSCAL SSP make of them. Own fixtures (CI's DB is not seeded), removed in `afterAll`. A refused request asserts that
 * nothing changed.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["owner", "otherOwner", "riskOwner", "viewer", "admin"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { owner: "SYSTEM_OWNER", otherOwner: "SYSTEM_OWNER", riskOwner: "RISK_OWNER", viewer: "COMPLIANCE_MANAGER", admin: "ADMIN" };
const users = {} as Record<Key, string>;
let facetId: string;
let systemId: string;
let closedSystemId: string;
let controlId: string;
let noPeriodControlId: string;
let requirementId: string;
let otherSystemRequirementId: string;
let systemDocumentId: string;
const DIGEST = createHash("sha256").update("pdf bytes").digest("hex");

beforeAll(async () => {
  for (const key of KEYS) users[key] = (await prisma.user.create({ data: { email: `test-ev-${key}-${suffix}@example.com`, name: `Test Ev ${key}`, role: ROLE[key] } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test Ev Facet ${suffix}` } })).id;
  const system = await prisma.system.create({ data: { name: `Test Ev System ${suffix}`, ownerId: users.owner, status: "DRAFT", deploymentFacets: { connect: [{ id: facetId }] } } });
  systemId = system.id;
  closedSystemId = (await prisma.system.create({ data: { name: `Test Ev Closed ${suffix}`, ownerId: users.owner, status: "REJECTED", evaluationClosedAt: new Date(), deploymentFacets: { connect: [{ id: facetId }] } } })).id;
  const control = await prisma.control.create({
    data: { code: `EV-${suffix}`, title: "Evidence Control", description: "d", category: "Security", applicability: "PER_SYSTEM", evidenceValidityMonths: 12, deploymentFacets: { connect: [{ id: facetId }] } },
  });
  controlId = control.id;
  noPeriodControlId = (await prisma.control.create({
    data: { code: `EVN-${suffix}`, title: "No period", description: "d", category: "Security", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
  })).id;
  await mapControlsToBase([controlId, noPeriodControlId]);
  requirementId = (await prisma.documentRequirement.create({ data: { name: `Test Ev Architecture ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } })).id;
  otherSystemRequirementId = (await prisma.documentRequirement.create({ data: { name: `Test Ev Other ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } })).id;
  const document = await prisma.systemDocument.create({ data: { systemId, documentRequirementId: requirementId, provided: true } });
  systemDocumentId = document.id;
  await prisma.systemDocumentFile.create({ data: { systemDocumentId, fileName: "arch.pdf", contentType: "application/pdf", size: 9, data: Buffer.from("pdf bytes"), sha256: DIGEST } });
});

afterAll(async () => {
  await cleanupFixtureRequirements(); // before the Controls
  const ids = [systemId, closedSystemId];
  await prisma.controlAssessment.deleteMany({ where: { systemId: { in: ids } } }); // cascades its Evidence records
  await prisma.system.deleteMany({ where: { id: { in: ids } } }); // cascades the document and its file
  await prisma.control.deleteMany({ where: { id: { in: [controlId, noPeriodControlId] } } });
  await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const base = (sid: string, cid: string) => `/api/systems/${sid}/assessments/${cid}/evidence`;
const add = (userId: string | null, body: unknown, sid = systemId, cid = controlId) =>
  POST(requestAs(base(sid, cid), userId, "POST", body), { params: Promise.resolve({ id: sid, controlId: cid }) });
const remove = (userId: string | null, evidenceId: string, sid = systemId, cid = controlId) =>
  DELETE(requestAs(`${base(sid, cid)}/${evidenceId}`, userId, "DELETE"), { params: Promise.resolve({ id: sid, controlId: cid, evidenceId }) });
const rows = () => prisma.evidenceItem.findMany({ where: { controlAssessment: { systemId: { in: [systemId, closedSystemId] } } }, orderBy: { id: "asc" } });
const assessments = () => prisma.controlAssessment.findMany({ where: { systemId: { in: [systemId, closedSystemId] } }, orderBy: { id: "asc" } });
const reset = () => prisma.controlAssessment.deleteMany({ where: { systemId: { in: [systemId, closedSystemId] } } });

describe("POST .../evidence", { timeout: 30_000 }, () => {
  it("lets the owner add a link; it creates an untouched Assessment and returns the records with their effective expiry", async () => {
    await reset();
    const response = await add(users.owner, { kind: "LINK", url: "https://wiki.example.com/report", title: "Report", collectedAt: "2026-01-10T00:00:00.000Z" });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ kind: "LINK", url: "https://wiki.example.com/report", title: "Report", expiresAt: null, effectiveExpiresAt: "2027-01-10T00:00:00.000Z", stale: false });
    const [assessment] = await assessments();
    expect(assessment).toMatchObject({ id: body.assessmentId, status: "NOT_STARTED", assessedById: null });
    const [stored] = await rows();
    expect(stored.createdById).toBe(users.owner);
  });

  it("marks evidence collected longer ago than the Control's period as stale, an override as the person's own date, and no period as never", async () => {
    await reset();
    const old = await (await add(users.owner, { kind: "LINK", url: "https://a.example/old", collectedAt: "2020-01-01T00:00:00.000Z" })).json();
    expect(old.evidence[0]).toMatchObject({ stale: true, effectiveExpiresAt: "2021-01-01T00:00:00.000Z" });
    const overridden = await (await add(users.owner, { kind: "LINK", url: "https://a.example/ovr", collectedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" })).json();
    expect(overridden.evidence.find((e: { url: string }) => e.url === "https://a.example/ovr")).toMatchObject({ stale: false, effectiveExpiresAt: "2099-01-01T00:00:00.000Z" });
    const never = await (await add(users.owner, { kind: "LINK", url: "https://a.example/never", collectedAt: "2020-01-01T00:00:00.000Z" }, systemId, noPeriodControlId)).json();
    expect(never.evidence[0]).toMatchObject({ stale: false, effectiveExpiresAt: null });
  });

  it("adds one of the System's documents, naming it after its Document Requirement", async () => {
    await reset();
    const response = await add(users.admin, { kind: "DOCUMENT", documentRequirementId: requirementId });
    expect(response.status).toBe(201);
    const { evidence } = await response.json();
    expect(evidence[0]).toMatchObject({ kind: "DOCUMENT", title: `Test Ev Architecture ${suffix}`, systemDocumentId, documentRequirementId: requirementId });
  });

  it("refuses a document the System doesn't have, and changes nothing", async () => {
    await reset();
    const response = await add(users.owner, { kind: "DOCUMENT", documentRequirementId: otherSystemRequirementId });
    expect(response.status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("refuses bad input (non-http link, bad dates, unknown kind) with 400 and changes nothing", async () => {
    await reset();
    for (const body of [
      { kind: "LINK", url: "javascript:alert(1)" },
      { kind: "LINK", url: "not a url" },
      { kind: "LINK", url: "https://a.example", collectedAt: "yesterday" },
      { kind: "LINK", url: "https://a.example", collectedAt: "2099-01-01T00:00:00.000Z" },
      { kind: "LINK", url: "https://a.example", collectedAt: "2026-01-10T00:00:00.000Z", expiresAt: "2026-01-09T00:00:00.000Z" },
      { kind: "FILE", url: "https://a.example" },
    ]) {
      expect((await add(users.owner, body)).status).toBe(400);
    }
    expect(await rows()).toEqual([]);
    expect(await assessments()).toEqual([]);
  });

  it("refuses everyone but the System's owner and an Admin, and changes nothing", async () => {
    await reset();
    const body = { kind: "LINK", url: "https://a.example/x" };
    expect((await add(null, body)).status).toBe(401);
    expect((await add(users.viewer, body)).status).toBe(403);
    // A Risk Owner who doesn't own the System may not change evidence (#91).
    expect((await add(users.riskOwner, body)).status).toBe(403);
    // Another System Owner can't even see a Draft System: the same 404 as for a System that doesn't exist.
    expect((await add(users.otherOwner, body)).status).toBe(404);
    expect(await rows()).toEqual([]);
    expect(await assessments()).toEqual([]);
  });

  it("answers 404 for a Control that isn't the System's, 409 for a closed System", async () => {
    await reset();
    const body = { kind: "LINK", url: "https://a.example/x" };
    expect((await add(users.owner, body, systemId, "no-such-control")).status).toBe(404);
    expect((await add(users.owner, body, closedSystemId)).status).toBe(409);
    expect(await rows()).toEqual([]);
  });
});

describe("DELETE .../evidence/[evidenceId]", { timeout: 30_000 }, () => {
  it("removes a record and returns the rest; refusals change nothing", async () => {
    await reset();
    const first = await (await add(users.owner, { kind: "LINK", url: "https://a.example/1" })).json();
    const second = await (await add(users.owner, { kind: "LINK", url: "https://a.example/2" })).json();
    const [one, two] = second.evidence as { id: string; url: string }[];
    expect(first.evidence).toHaveLength(1);

    expect((await remove(users.viewer, one.id)).status).toBe(403);
    expect((await remove(users.riskOwner, one.id)).status).toBe(403);
    expect((await remove(users.otherOwner, one.id)).status).toBe(404);
    expect((await remove(null, one.id)).status).toBe(401);
    expect((await remove(users.owner, "nope")).status).toBe(404);
    // The right id under another Control is not found either.
    expect((await remove(users.owner, one.id, systemId, noPeriodControlId)).status).toBe(404);
    expect(await rows()).toHaveLength(2);

    const response = await remove(users.owner, one.id);
    expect(response.status).toBe(200);
    expect((await response.json()).evidence.map((e: { id: string }) => e.id)).toEqual([two.id]);
    expect((await rows()).map((r) => r.id)).toEqual([two.id]);
  });

  it("keeps a DOCUMENT record, with its name, when the document goes away (SetNull)", async () => {
    await reset();
    const extra = await prisma.systemDocument.create({ data: { systemId, documentRequirementId: otherSystemRequirementId, provided: false, link: "https://docs.example/x" } });
    await add(users.owner, { kind: "DOCUMENT", documentRequirementId: otherSystemRequirementId });
    await prisma.systemDocument.delete({ where: { id: extra.id } });
    const [item] = await rows();
    expect(item).toMatchObject({ kind: "DOCUMENT", systemDocumentId: null, title: `Test Ev Other ${suffix}` });
  });
});

describe("what Evidence records feed", { timeout: 30_000 }, () => {
  it("shows up on the System page's Assessment rows, stale where expired", async () => {
    await reset();
    await add(users.owner, { kind: "LINK", url: "https://a.example/old", collectedAt: "2020-01-01T00:00:00.000Z" });
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    const rowsOfSystem = await getSystemAssessments({ ...system, deploymentFacets: [{ id: facetId }], frameworkScopes: [] } as never);
    const row = rowsOfSystem.find((r) => r.control.id === controlId);
    expect(row?.assessment?.evidenceItems).toMatchObject([{ url: "https://a.example/old", stale: true }]);
  });

  it("goes into the OSCAL SSP as back-matter resources, a document with its SHA-256, and the package validates", async () => {
    await reset();
    await add(users.owner, { kind: "LINK", url: "https://wiki.example.com/report", title: "Report" });
    await add(users.owner, { kind: "DOCUMENT", documentRequirementId: requirementId });
    const result = await loadOscalPackage(systemId, { id: users.admin, role: "ADMIN" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const resources = (result.pkg.ssp["system-security-plan"] as { "back-matter": { resources: { title: string; rlinks: { href: string; hashes?: { algorithm: string; value: string }[] }[] }[] } })["back-matter"].resources;
    expect(resources.map((r) => r.title).sort()).toEqual(["Report", `Test Ev Architecture ${suffix}`]);
    const file = resources.find((r) => r.title.startsWith("Test Ev Architecture"))!;
    expect(file.rlinks[0]).toMatchObject({ href: `/api/systems/${systemId}/documents/${requirementId}/file`, hashes: [{ algorithm: "SHA-256", value: DIGEST }] });
    expect(validateOscalPackage(result.pkg)).toEqual([]);
  });
});
