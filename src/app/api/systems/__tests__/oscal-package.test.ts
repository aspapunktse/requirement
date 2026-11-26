// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus, OnboardingStatus, UserRole } from "@prisma/client";
import { strFromU8, unzipSync } from "fflate";
import { prisma } from "@/lib/prisma";
import { getApplicableControls } from "@/lib/control-assessments";
import { withEffectiveScope, EFFECTIVE_SCOPE_SELECT } from "@/lib/effective-framework-scope";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { controlId, oscalUuid } from "@/lib/oscal/ids";
import { buildOscalPackage, NO_DESCRIPTION_TEXT, OSCAL_APP_NS } from "@/lib/oscal/package-builder";
import { validateOscalPackage } from "@/lib/oscal/validate";
import { GET } from "../[id]/oscal-package/route";

/**
 * GET /api/systems/[id]/oscal-package (#442), against real Postgres. Fixtures only (`Test #442 ...`): a Deployment Facet, five
 * Controls scoped to it and one scoped to another Facet (all mapped to the base Framework), and Systems at every Onboarding Status.
 * The base Framework's seeded Controls (in a seeded database) are in the package too, so the tests look at the fixtures and
 * compare the Profile with the applicability rule itself.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #442 oscal ${label} ${suffix}`;

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function download(userId: string | null, systemId: string) {
  return GET(requestAs(`/api/systems/${systemId}/oscal-package`, userId, "GET"), { params: Promise.resolve({ id: systemId }) });
}
async function unzip(response: Response) {
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const doc = (name: string) => JSON.parse(strFromU8(files[name])) as Doc;
  return { names: Object.keys(files).sort(), catalog: doc("catalog.json"), profile: doc("profile.json"), ssp: doc("ssp.json") };
}
const requirementFor = (ssp: Doc, code: string) =>
  ssp["system-security-plan"]["control-implementation"]["implemented-requirements"].find((r: Doc) => r["control-id"] === controlId(code));

describe("GET OSCAL Package (#442)", { timeout: 90_000 }, () => {
  const users: Record<string, string> = {};
  const facets: string[] = [];
  const controlIds: string[] = [];
  const informationTypeIds: string[] = [];
  const systemIds: string[] = [];
  const code = {
    fulfilled: `T442-FULL-${suffix}`,
    progress: `T442-PROG-${suffix}`,
    notApplicable: `T442-NA-${suffix}`,
    waived: `T442-WAIVED-${suffix}`,
    notStarted: `T442 5.1 NS-${suffix}`, // a space: not a valid OSCAL token, so the id is escaped
    elsewhere: `T442-ELSEWHERE-${suffix}`,
  };
  const status: Record<string, OnboardingStatus> = {};
  const system: Record<string, string> = {};

  beforeAll(async () => {
    const roles: Record<string, UserRole> = {
      owner: "SYSTEM_OWNER",
      other: "SYSTEM_OWNER",
      admin: "ADMIN",
      cm: "COMPLIANCE_MANAGER",
      auditor: "INTERNAL_AUDITOR",
      bro: "BUSINESS_RISK_OWNER",
    };
    for (const [key, role] of Object.entries(roles)) {
      users[key] = (await prisma.user.create({ data: { email: `test-442-oscal-${key}-${suffix}@example.com`, name: N(key), role } })).id;
    }
    for (const label of ["in", "out"]) facets.push((await prisma.deploymentFacet.create({ data: { name: N(`Facet ${label}`) } })).id);
    const make = async (c: string, facet: string) => {
      const control = await prisma.control.create({
        data: { code: c, title: N(`title ${c}`), description: `Description of ${c}`, category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facet }] } },
      });
      controlIds.push(control.id);
      return control.id;
    };
    const ids: Record<string, string> = {};
    for (const [key, c] of Object.entries(code)) ids[key] = await make(c, facets[key === "elsewhere" ? 1 : 0]);
    await mapControlsToBase(Object.values(ids));

    const states: [string, OnboardingStatus][] = [
      ["draft", "DRAFT"],
      ["inReview", "IN_REVIEW"],
      ["approved", "APPROVED"],
      ["onboarded", "ONBOARDED"],
      ["rejected", "REJECTED"],
      ["notSelected", "NOT_SELECTED"],
    ];
    for (const [key, st] of states) {
      status[key] = st;
      const row = await prisma.system.create({
        data: { name: N(key), description: key === "draft" ? "A fixture System." : null, ownerId: users.owner, status: st, deploymentFacets: { connect: [{ id: facets[0] }] } },
      });
      system[key] = row.id;
      systemIds.push(row.id);
    }
    const type = await prisma.informationType.create({ data: { name: N("Payroll"), description: "Salary data.", sensitivityLevel: 2 } });
    informationTypeIds.push(type.id);
    await prisma.system.update({ where: { id: system.draft }, data: { informationTypes: { connect: [{ id: type.id }] } } });
    const assess = (key: string, controlKey: string, st: ControlAssessmentStatus, extra: { notes?: string; evidence?: string } = {}) =>
      prisma.controlAssessment.create({ data: { systemId: system[key], controlId: ids[controlKey], status: st, ...extra } });
    await assess("draft", "fulfilled", "FULFILLED", { notes: "Reviewed quarterly.", evidence: "https://example.com/evidence" });
    await assess("draft", "progress", "IN_PROGRESS");
    await assess("draft", "notApplicable", "NOT_APPLICABLE", { notes: "We run no such service." });
    await assess("draft", "waived", "WAIVED", { notes: "Accepted for now." });
    // `notStarted` has no row at all: it reads as untouched Not Started.
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtureRequirements();
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.informationType.deleteMany({ where: { id: { in: informationTypeIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facets } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  }, 60_000);

  it("gives the owner and every full-visibility role a zip of the three documents", async () => {
    for (const who of ["owner", "admin", "cm", "auditor"]) {
      const response = await download(users[who], system.draft);
      expect(response.status, who).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/zip");
      expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="oscal-package-Test-442-oscal-draft-[\w-]+-\d{4}-\d{2}-\d{2}\.zip"$/);
      expect((await unzip(response)).names).toEqual(["catalog.json", "profile.json", "ssp.json"]);
    }
  });

  it("answers 404 to a Business Risk Owner outside the portfolio, an unrelated System Owner, an unknown System, and 401 to nobody", async () => {
    for (const who of ["bro", "other"]) {
      const response = await download(users[who], system.draft);
      expect(response.status, who).toBe(404);
      expect(await response.json()).toEqual({ error: "System not found" });
    }
    expect((await download(users.admin, "does-not-exist")).status).toBe(404);
    expect((await download(null, system.draft)).status).toBe(401);
  });

  it("refuses a Rejected and a Not selected System with 409", async () => {
    for (const key of ["rejected", "notSelected"]) {
      const response = await download(users.owner, system[key]);
      expect(response.status, key).toBe(409);
      expect((await response.json()).error).toMatch(/closed/);
    }
  });

  it("sets status.state from the Onboarding Status and keeps the exact status in an app prop", async () => {
    const expected: Record<string, string> = { draft: "under-development", inReview: "under-development", approved: "under-development", onboarded: "operational" };
    for (const [key, state] of Object.entries(expected)) {
      const { ssp } = await unzip(await download(users.owner, system[key]));
      const characteristics = ssp["system-security-plan"]["system-characteristics"];
      expect(characteristics.status.state, key).toBe(state);
      expect(characteristics.props).toContainEqual({ name: "onboarding-status", ns: OSCAL_APP_NS, value: status[key] });
      expect(ssp["system-security-plan"]["system-implementation"].components[0].status.state, key).toBe(state);
    }
  });

  it("puts the whole Control Library in the Catalog, each Control with its code as label", async () => {
    const before = await prisma.control.count();
    const { catalog } = await unzip(await download(users.owner, system.draft));
    const controls: Doc[] = catalog.catalog.controls;
    for (const c of Object.values(code)) {
      const control = controls.find((x) => x.id === controlId(c));
      expect(control, c).toBeDefined();
      expect(control!.props).toContainEqual({ name: "label", value: c });
    }
    expect(controls.find((x) => x.id === controlId(code.notStarted))!.id).toMatch(/^_T442_x20_5\.1_x20_NS-/);
    // Other test files create and delete fixture Controls while this one runs, so the count is bracketed, not exact.
    expect(controls.length).toBeGreaterThanOrEqual(Math.min(before, await prisma.control.count()));
    expect(controls.length).toBeLessThanOrEqual(Math.max(before, await prisma.control.count()) + 20);
  });

  it("selects exactly the applicable Controls in the Profile, a Not Applicable one included", async () => {
    const { profile } = await unzip(await download(users.owner, system.draft));
    const imports = profile.profile.imports;
    expect(imports).toHaveLength(1);
    expect(imports[0].href).toBe("catalog.json");
    const selected: string[] = imports[0]["include-controls"][0]["with-ids"];

    for (const key of ["fulfilled", "progress", "notApplicable", "waived", "notStarted"] as const) expect(selected, key).toContain(controlId(code[key]));
    expect(selected).not.toContain(controlId(code.elsewhere));

    const row = await prisma.system.findUniqueOrThrow({ where: { id: system.draft }, include: { deploymentFacets: true, ...EFFECTIVE_SCOPE_SELECT } });
    const applicable = await getApplicableControls(withEffectiveScope(row));
    expect([...selected].sort()).toEqual(applicable.map((c) => controlId(c.code)).sort());
  });

  it("maps all five statuses, always with the raw status in an app prop", async () => {
    const { ssp } = await unzip(await download(users.owner, system.draft));
    const by = (key: keyof typeof code) => requirementFor(ssp, code[key])["by-components"][0] as Doc;
    const expectations: [keyof typeof code, string, string | undefined][] = [
      ["fulfilled", "FULFILLED", "implemented"],
      ["progress", "IN_PROGRESS", "partial"],
      ["notApplicable", "NOT_APPLICABLE", "not-applicable"],
      ["waived", "WAIVED", undefined],
      ["notStarted", "NOT_STARTED", undefined],
    ];
    for (const [key, raw, oscal] of expectations) {
      const entry = by(key);
      expect(entry.props, key).toContainEqual({ name: "control-assessment-status", ns: OSCAL_APP_NS, value: raw });
      if (oscal) expect(entry["implementation-status"], key).toEqual({ state: oscal });
      else expect(entry, key).not.toHaveProperty("implementation-status");
    }
    expect(by("notApplicable").remarks).toBe("We run no such service.");
    expect(by("fulfilled").description).toBe("Reviewed quarterly.\n\nEvidence: https://example.com/evidence");
    expect(by("fulfilled")).not.toHaveProperty("remarks");
    // No notes and no evidence: the gap is said, nothing is invented. A Waived Control's notes are the only text it has.
    expect(by("progress").description).toBe(NO_DESCRIPTION_TEXT);
    expect(by("notStarted").description).toBe(NO_DESCRIPTION_TEXT);
    expect(by("notApplicable").description).toBe(NO_DESCRIPTION_TEXT);
    expect(by("waived").description).toBe("Accepted for now.");
  });

  it("gives the same record the same UUID in two builds, and each document a fresh one", async () => {
    const first = await unzip(await download(users.owner, system.draft));
    const second = await unzip(await download(users.admin, system.draft));
    const req = (pkg: typeof first) => requirementFor(pkg.ssp, code.fulfilled);
    expect(req(first).uuid).toBe(req(second).uuid);
    expect(req(first)["by-components"][0].uuid).toBe(req(second)["by-components"][0].uuid);
    const component = (pkg: typeof first) => pkg.ssp["system-security-plan"]["system-implementation"].components[0].uuid;
    expect(component(first)).toBe(component(second));
    expect(component(first)).toBe(oscalUuid("System", system.draft));
    expect(req(first).uuid).not.toBe(requirementFor(first.ssp, code.progress).uuid);
    expect(first.ssp["system-security-plan"].uuid).not.toBe(second.ssp["system-security-plan"].uuid);
    expect(first.catalog.catalog.uuid).not.toBe(second.catalog.catalog.uuid);
    // The record's id never appears in the package.
    expect(JSON.stringify(first)).not.toContain(system.draft);
  });

  it("describes a declared Information Type with its Sensitivity Level, and says so when there is none", async () => {
    const declared = (await unzip(await download(users.owner, system.draft))).ssp["system-security-plan"]["system-characteristics"]["system-information"]["information-types"];
    expect(declared).toHaveLength(1);
    expect(declared[0].title).toBe(N("Payroll"));
    expect(declared[0].description).toBe("Salary data.");
    expect(declared[0]["confidentiality-impact"].base).toBe("Internal");
    const none = (await unzip(await download(users.owner, system.onboarded))).ssp["system-security-plan"]["system-characteristics"]["system-information"]["information-types"];
    expect(none[0].title).toBe("No Information Type declared");
  });

  it("records the document metadata and never an email address", async () => {
    const pkg = await unzip(await download(users.owner, system.draft));
    for (const doc of [pkg.catalog.catalog, pkg.profile.profile, pkg.ssp["system-security-plan"]]) {
      expect(doc.metadata["oscal-version"]).toBe("1.2.3");
      expect(doc.metadata.version).toBe("unreleased");
      expect(Date.parse(doc.metadata["last-modified"])).not.toBeNaN();
      const props = Object.fromEntries(doc.metadata.props.map((p: Doc) => [p.name, p.value]));
      expect(props["app-commit"]).toEqual(expect.any(String));
      expect(props["exporter-version"]).not.toBe(doc.metadata.version);
      expect(doc.metadata.parties.map((p: Doc) => p.name)).toContain(N("owner"));
    }
    expect(JSON.stringify(pkg)).not.toContain("@example.com");
  });

  it("builds a package the validator accepts (schema and references)", async () => {
    for (const key of ["draft", "onboarded"]) {
      const { catalog, profile, ssp } = await unzip(await download(users.owner, system[key]));
      expect(validateOscalPackage({ catalog, profile, ssp }), key).toEqual([]);
    }
  });

  it("writes no Change Event", async () => {
    const before = await prisma.changeEvent.count();
    expect((await download(users.owner, system.draft)).status).toBe(200);
    expect((await download(users.owner, system.rejected)).status).toBe(409);
    expect(await prisma.changeEvent.count()).toBe(before);
  });
});

describe("buildOscalPackage", () => {
  it("gives a Control with no Assessment row the Not Started status, and a System with no Information Type a placeholder one", () => {
    const pkg = buildOscalPackage(
      {
        system: { id: "sys1", name: "S", description: null, status: "DRAFT", informationTypes: [], deploymentFacets: [], dataLocation: null, integrityImpactLevel: null, availabilityImpactLevel: null, owner: { id: "u1", name: "Owner Name" }, businessSystemOwner: null },
    exportedBy: { id: "u1", name: "Owner Name" },
        controls: [{ id: "c1", code: "A.1", title: "T", description: "D", applicability: "PER_SYSTEM" }],
        applicableControlIds: ["c1"],
        assessments: [],
        organizationImplementations: [],
        providers: [],
        providerSources: [],
        assessmentRisks: [],
      },
      new Date("2026-11-24T10:00:00Z"),
      () => "00000000-0000-4000-8000-000000000000",
    );
    expect(validateOscalPackage(pkg)).toEqual([]);
    expect(pkg.ssp["system-security-plan"]["system-characteristics"]["system-information"]["information-types"][0].title).toBe("No Information Type declared");
    expect(pkg.ssp["system-security-plan"]["control-implementation"]["implemented-requirements"][0]["by-components"][0].props[0].value).toBe("NOT_STARTED");
    expect(pkg.profile.profile.metadata["last-modified"]).toBe("2026-11-24T10:00:00.000Z");
  });
});

describe("OSCAL Package: system characteristics and provenance (#444)", { timeout: 90_000 }, () => {
  const sfx = `${process.pid}-${Date.now()}-444`;
  const T = (label: string) => `Test #444 ${label} ${sfx}`;
  const userIds: string[] = [];
  const systemIds: string[] = [];
  const typeIds: string[] = [];
  const controlIds444: string[] = [];
  let facetIds: string[] = [];
  let owner: { id: string; name: string };
  let bso: { id: string; name: string };
  let admin: { id: string; name: string };
  let providerName = "";
  let pkg: { catalog: Doc; profile: Doc; ssp: Doc };

  beforeAll(async () => {
    const mk = async (key: string, role: UserRole) => {
      const u = await prisma.user.create({ data: { email: `test-444-${key}-${sfx}@example.com`, name: T(key), role } });
      userIds.push(u.id);
      return { id: u.id, name: u.name };
    };
    owner = await mk("owner", "SYSTEM_OWNER");
    bso = await mk("bso", "SYSTEM_OWNER");
    admin = await mk("admin", "ADMIN");
    facetIds = [(await prisma.deploymentFacet.create({ data: { name: T("Facet Cloud") } })).id, (await prisma.deploymentFacet.create({ data: { name: T("Facet Mobile") } })).id];
    const control = await prisma.control.create({
      data: { code: `T444-${sfx}`, title: T("Control"), description: "Fixture", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetIds[0] }] } },
    });
    controlIds444.push(control.id);
    await mapControlsToBase([control.id]);
    providerName = T("Provider");
    const provider = await prisma.system.create({ data: { name: providerName, ownerId: owner.id, status: "ONBOARDED" } });
    const system = await prisma.system.create({
      data: {
        name: T("System"),
        ownerId: owner.id,
        businessSystemOwnerId: bso.id,
        status: "DRAFT",
        dataLocation: "EU_EEA",
        integrityImpactLevel: "MODERATE",
        availabilityImpactLevel: "HIGH",
        deploymentFacets: { connect: facetIds.map((id) => ({ id })) },
      },
    });
    systemIds.push(provider.id, system.id);
    await prisma.providerDependency.create({ data: { dependentId: system.id, providerId: provider.id } });
    for (const [label, level] of [["Payroll", 2], ["Health", 4]] as const) {
      const t = await prisma.informationType.create({ data: { name: T(label), sensitivityLevel: level } });
      typeIds.push(t.id);
      await prisma.system.update({ where: { id: system.id }, data: { informationTypes: { connect: [{ id: t.id }] } } });
    }
    pkg = await unzip(await download(admin.id, system.id));
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtureRequirements();
    await prisma.providerDependency.deleteMany({ where: { dependentId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds444 } } });
    await prisma.informationType.deleteMany({ where: { id: { in: typeIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facetIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }, 60_000);

  it("generates the boundary text from Deployment Facets, Data Location and Provider dependencies, and says it is generated", () => {
    const text = pkg.ssp["system-security-plan"]["system-characteristics"]["authorization-boundary"].description as string;
    expect(text).toMatch(/^Generated from the System's record/);
    expect(text).toContain(T("Facet Cloud"));
    expect(text).toContain(T("Facet Mobile"));
    expect(text).toContain("EU/EEA");
    expect(text).toContain(providerName);
  });

  it("gives each Information Type the three app-named impacts and no fips-199 value", () => {
    const types = pkg.ssp["system-security-plan"]["system-characteristics"]["system-information"]["information-types"] as Doc[];
    expect(types).toHaveLength(2);
    const byTitle = Object.fromEntries(types.map((t) => [t.title, t]));
    expect(byTitle[T("Payroll")]["confidentiality-impact"].base).toBe("Internal");
    expect(byTitle[T("Health")]["confidentiality-impact"].base).toBe("Highly Sensitive");
    for (const t of types) {
      expect(t["integrity-impact"].base).toBe("Moderate");
      expect(t["availability-impact"].base).toBe("High");
    }
    expect(JSON.stringify(pkg)).not.toContain("fips-199");
  });

  it("names the owner, Business System Owner and exporting user by name and role, with no email anywhere", () => {
    const meta = pkg.ssp["system-security-plan"].metadata;
    const party = (id: string) => meta.parties.find((p: Doc) => p.uuid === oscalUuid("User", id));
    expect(party(owner.id)).toEqual({ uuid: oscalUuid("User", owner.id), type: "person", name: owner.name });
    expect(party(bso.id).name).toBe(bso.name);
    expect(party(admin.id).name).toBe(admin.name);
    const holders = (role: string) => meta["responsible-parties"].find((r: Doc) => r["role-id"] === role)["party-uuids"];
    expect(holders("system-owner")).toEqual([oscalUuid("User", owner.id)]);
    expect(holders("business-system-owner")).toEqual([oscalUuid("User", bso.id)]);
    expect(holders("exporting-user")).toEqual([oscalUuid("User", admin.id)]);
    expect(meta.roles.map((r: Doc) => r.title)).toEqual(expect.arrayContaining(["System Owner", "Business System Owner"]));
    expect(JSON.stringify(pkg)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });

  it("stamps every document with generation time, commit, exporter version and the exporting user's name", () => {
    for (const doc of [pkg.catalog.catalog, pkg.profile.profile, pkg.ssp["system-security-plan"]]) {
      const props = Object.fromEntries(doc.metadata.props.map((p: Doc) => [p.name, p.value]));
      expect(Date.parse(doc.metadata["last-modified"])).not.toBeNaN();
      expect(props["app-commit"]).toMatch(/\S/);
      expect(props["exporter-version"]).toMatch(/^\d+\.\d+\.\d+/);
      expect(doc.metadata.parties.map((p: Doc) => p.name)).toContain(admin.name);
    }
  });

  it("validates with zero errors", () => {
    expect(validateOscalPackage(pkg)).toEqual([]);
  });
});
