// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { prisma } from "@/lib/prisma";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { validateOscalPackage } from "@/lib/oscal/validate";
import { createOscalRelease, type OscalReleaseManifest } from "@/lib/oscal/releases";
import * as listRoute from "../[id]/oscal-releases/route";
import * as releaseRoute from "../[id]/oscal-releases/[number]/route";

/**
 * OSCAL Releases (#453), against real Postgres. Fixtures only (`Test #453 ...`): a Control mapped to the base Framework, a
 * System with an Assessment holding DOCUMENT Evidence (a stored file with a digest), a Rejected System, and one User per role.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #453 releases ${label} ${suffix}`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (userId: string | null, systemId: string) => listRoute.POST(requestAs(`/api/systems/${systemId}/oscal-releases`, userId, "POST"), idCtx(systemId));
const list = (userId: string | null, systemId: string) => listRoute.GET(requestAs(`/api/systems/${systemId}/oscal-releases`, userId, "GET"), idCtx(systemId));
const download = (userId: string | null, systemId: string, number: string | number) =>
  releaseRoute.GET(requestAs(`/api/systems/${systemId}/oscal-releases/${number}`, userId, "GET"), { params: Promise.resolve({ id: systemId, number: String(number) }) });
function unzip(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const doc = (name: string) => JSON.parse(strFromU8(files[name])) as Doc;
  return { files, catalog: doc("catalog.json"), profile: doc("profile.json"), ssp: doc("ssp.json"), manifest: doc("manifest.json") as OscalReleaseManifest };
}

describe("OSCAL Releases (#453)", { timeout: 90_000 }, () => {
  const users: Record<string, string> = {};
  const systemIds: string[] = [];
  const controlIds: string[] = [];
  let facetId = "";
  let requirementId = "";
  let system = "";
  let rejected = "";
  const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);

  beforeAll(async () => {
    const roles: Record<string, UserRole> = { owner: "SYSTEM_OWNER", other: "SYSTEM_OWNER", admin: "ADMIN", cm: "COMPLIANCE_MANAGER", auditor: "INTERNAL_AUDITOR" };
    for (const [key, role] of Object.entries(roles)) {
      users[key] = (await prisma.user.create({ data: { email: `test-453-rel-${key}-${suffix}@example.com`, name: N(key), role } })).id;
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: N("Facet") } })).id;
    const control = await prisma.control.create({
      data: { code: `T453-${suffix}`, title: N("title"), description: "Description", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
    });
    controlIds.push(control.id);
    await mapControlsToBase([control.id]);
    system = (await prisma.system.create({ data: { name: N("System"), ownerId: users.owner, status: "DRAFT", deploymentFacets: { connect: [{ id: facetId }] } } })).id;
    rejected = (await prisma.system.create({ data: { name: N("Rejected"), ownerId: users.owner, status: "REJECTED", deploymentFacets: { connect: [{ id: facetId }] } } })).id;
    systemIds.push(system, rejected);

    const requirement = await prisma.documentRequirement.create({ data: { name: N("Document"), stage: "FIRST_DOCUMENTATION" } });
    requirementId = requirement.id;
    const document = await prisma.systemDocument.create({ data: { systemId: system, documentRequirementId: requirement.id, provided: true } });
    await prisma.systemDocumentFile.create({ data: { systemDocumentId: document.id, fileName: "policy.pdf", contentType: "application/pdf", size: fileBytes.length, data: fileBytes, sha256: sha(fileBytes) } });
    const assessment = await prisma.controlAssessment.create({ data: { systemId: system, controlId: control.id, status: "FULFILLED", notes: "Done." } });
    await prisma.evidenceItem.create({ data: { controlAssessmentId: assessment.id, kind: "DOCUMENT", systemDocumentId: document.id, title: "The policy" } });
    await prisma.evidenceItem.create({ data: { controlAssessmentId: assessment.id, kind: "LINK", url: "https://example.com/e" } });
  }, 60_000);

  afterAll(async () => {
    // Releases first: the System foreign key is Restrict.
    await prisma.oscalRelease.deleteMany({ where: { systemId: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.documentRequirement.deleteMany({ where: { id: requirementId } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  }, 60_000);

  const count = (systemId: string) => prisma.oscalRelease.count({ where: { systemId } });
  const events = (systemId: string) => prisma.changeEvent.count({ where: { systemId, action: "OSCAL_RELEASE_MADE" } });

  // Another System Owner can't see the System, so they get the same 404 as for an unknown one; a Compliance Manager and an Internal Auditor see it but may not make a release.
  describe("refused makers change nothing", () => {
    it.each([["other", 404], ["cm", 403], ["auditor", 403], [null, 401]] as const)("%s gets %i", async (who, status) => {
      const before = { releases: await count(system), events: await events(system) };
      const response = await post(who ? users[who] : null, system);
      expect(response.status).toBe(status);
      expect({ releases: await count(system), events: await events(system) }).toEqual(before);
    });

    it("refuses a Rejected System with 409 and an unknown System with 404", async () => {
      expect((await post(users.owner, rejected)).status).toBe(409);
      expect(await count(rejected)).toBe(0);
      expect((await post(users.admin, "does-not-exist")).status).toBe(404);
    });
  });

  it("lists nothing before the first release, and says who may make one", async () => {
    const asOwner = await (await list(users.owner, system)).json();
    expect(asOwner).toEqual({ releases: [], canCreate: true });
    expect((await (await list(users.cm, system)).json()).canCreate).toBe(false);
    expect((await (await list(users.admin, rejected)).json()).canCreate).toBe(false);
    expect((await list(null, system)).status).toBe(401);
  });

  it("makes release 1 for the owner, stores it, and downloads the identical bytes", async () => {
    const response = await post(users.owner, system);
    expect(response.status).toBe(201);
    const { release } = await response.json();
    expect(release).toMatchObject({ number: 1, trigger: "MANUAL", systemId: system });
    expect(await events(system)).toBe(1);

    const stored = await prisma.oscalRelease.findUniqueOrThrow({ where: { systemId_number: { systemId: system, number: 1 } } });
    expect(stored.createdById).toBe(users.owner);
    expect(stored.sha256).toBe(release.sha256);
    expect(sha(stored.data)).toBe(stored.sha256);

    const got = await download(users.cm, system, 1);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("application/zip");
    expect(got.headers.get("content-disposition")).toMatch(/^attachment; filename="oscal-release-1-Test-453-releases-System-[\w-]+-\d{4}-\d{2}-\d{2}\.zip"$/);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(Buffer.from(bytes).equals(Buffer.from(stored.data))).toBe(true);
    expect(sha(bytes)).toBe(stored.sha256);

    const zip = unzip(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["catalog.json", "manifest.json", "profile.json", "ssp.json"]);
    expect(zip.manifest).toEqual(stored.manifest);
    expect(zip.manifest.release).toBe(1);
    for (const file of zip.manifest.files) expect(file.sha256, file.name).toBe(sha(zip.files[file.name]));
    expect(zip.manifest.files.map((f) => f.name)).toEqual(["catalog.json", "profile.json", "ssp.json"]);
    // The evidence file by hash only, and no copy of it in the zip.
    expect(zip.manifest.evidence).toEqual([{ title: "The policy", fileName: "policy.pdf", sha256: sha(fileBytes) }]);
    expect(Object.keys(zip.files)).not.toContain("policy.pdf");
    for (const doc of [zip.catalog.catalog, zip.profile.profile, zip.ssp["system-security-plan"]]) {
      expect(doc.metadata.version).toBe("1");
      expect(doc.metadata.published).toBe(release.createdAt);
      expect(doc.metadata.revisions).toBeUndefined();
    }
    expect(validateOscalPackage({ catalog: zip.catalog, profile: zip.profile, ssp: zip.ssp })).toEqual([]);
  });

  it("makes release 2 for an Admin, listing release 1 in every document's revisions", async () => {
    const response = await post(users.admin, system);
    expect(response.status).toBe(201);
    expect((await response.json()).release.number).toBe(2);
    const first = await prisma.oscalRelease.findUniqueOrThrow({ where: { systemId_number: { systemId: system, number: 1 } }, select: { createdAt: true } });

    const stored = await prisma.oscalRelease.findUniqueOrThrow({ where: { systemId_number: { systemId: system, number: 2 } } });
    const zip = unzip(new Uint8Array(stored.data));
    for (const doc of [zip.catalog.catalog, zip.profile.profile, zip.ssp["system-security-plan"]]) {
      expect(doc.metadata.version).toBe("2");
      expect(doc.metadata.revisions).toEqual([{ published: first.createdAt.toISOString(), "last-modified": first.createdAt.toISOString(), version: "1" }]);
    }
    expect(validateOscalPackage({ catalog: zip.catalog, profile: zip.profile, ssp: zip.ssp })).toEqual([]);
    // Release 1 is untouched by release 2.
    const one = await prisma.oscalRelease.findUniqueOrThrow({ where: { systemId_number: { systemId: system, number: 1 } } });
    expect(unzip(new Uint8Array(one.data)).ssp["system-security-plan"].metadata.version).toBe("1");
  });

  it("lists releases newest first and downloads for anyone who sees the System, 404 for the rest", async () => {
    const body = await (await list(users.auditor, system)).json();
    expect(body.releases.map((r: { number: number }) => r.number)).toEqual([2, 1]);
    expect(body.releases[0]).not.toHaveProperty("data");
    expect(body.releases[0].createdBy).toEqual({ id: users.admin, name: N("admin") });
    expect((await download(users.other, system, 1)).status).toBe(404);
    expect((await download(users.owner, system, 3)).status).toBe(404);
    expect((await download(users.owner, system, "abc")).status).toBe(404);
    expect((await download(users.owner, system, "0")).status).toBe(404);
    expect((await download(null, system, 1)).status).toBe(401);
  });

  it("keeps releases downloadable after the System is closed, and refuses new ones", async () => {
    await prisma.system.update({ where: { id: system }, data: { status: "REJECTED" } });
    try {
      expect((await download(users.owner, system, 1)).status).toBe(200);
      expect((await list(users.owner, system)).status).toBe(200);
      const before = await count(system);
      expect((await post(users.owner, system)).status).toBe(409);
      expect(await count(system)).toBe(before);
    } finally {
      await prisma.system.update({ where: { id: system }, data: { status: "DRAFT" } });
    }
  });

  it("has no way to change or delete a release through the API", async () => {
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      expect(method in listRoute, `list ${method}`).toBe(false);
      expect(method in releaseRoute, `release ${method}`).toBe(false);
    }
    const before = await prisma.oscalRelease.findMany({ where: { systemId: system }, orderBy: { number: "asc" } });
    expect(before).toHaveLength(2);
    expect(await prisma.oscalRelease.findMany({ where: { systemId: system }, orderBy: { number: "asc" } })).toEqual(before);
  });

  it("restricts deleting a System that has a release", async () => {
    await expect(prisma.system.delete({ where: { id: system } })).rejects.toThrow();
    expect(await count(system)).toBe(2);
  });

  it("gives concurrent makers distinct consecutive numbers", async () => {
    const results = await Promise.all([1, 2, 3].map(() => createOscalRelease({ systemId: system, actorId: users.owner, trigger: "MANUAL" })));
    const numbers = results.map((r) => (r.kind === "ok" ? r.release.number : -1)).sort();
    expect(numbers).toEqual([3, 4, 5]);
    expect(await count(system)).toBe(5);
  });

  it("joins the caller's transaction, rolling back with it", async () => {
    const before = await count(system);
    await expect(
      prisma.$transaction(async (tx) => {
        const made = await createOscalRelease({ systemId: system, actorId: users.owner, trigger: "MANUAL" }, tx);
        expect(made.kind).toBe("ok");
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(await count(system)).toBe(before);
  });
});
