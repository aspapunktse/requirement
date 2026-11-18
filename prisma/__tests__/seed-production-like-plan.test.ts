import { describe, expect, it } from "vitest";
import { MARKER, NAMES, STATUS_SHARES, allocateCounts, buildEstatePlan, describeDatabaseTarget, formatReplaceCheck, isLocalDatabaseUrl, nonEmpty, type CatalogInput } from "../seed-production-like-plan";

const catalogs = (overrides: Partial<CatalogInput> = {}): CatalogInput => ({
  facets: [
    { id: "f-saas", name: "SaaS", requiresVendorDetails: true },
    { id: "f-cloud", name: "Cloud IaaS/PaaS", requiresVendorDetails: false },
    { id: "f-onprem", name: "On-Premises Datacenter", requiresVendorDetails: false },
  ],
  businessUnits: ["Engineering", "IT Operations", "HR", "Finance"].map((name) => ({ id: `bu-${name}`, name })),
  informationTypes: [
    { id: "it-1", name: "Customer data", sensitivityLevel: 3, suggestedFrameworkIds: ["fw-gdpr"] },
    { id: "it-2", name: "Public content", sensitivityLevel: 1, suggestedFrameworkIds: [] },
  ],
  frameworks: [
    { id: "fw-base", name: "ISO/IEC 27001", version: "2022", status: "PUBLISHED", isBase: true },
    { id: "fw-gdpr", name: "GDPR", version: "1", status: "PUBLISHED", isBase: false },
  ],
  sensitivityLevels: [1, 2, 3, 4, 5],
  existingSystemNames: [],
  existingUsers: [],
  stagedEvaluationEnabled: false,
  ...overrides,
});

describe("isLocalDatabaseUrl", () => {
  it.each([
    "postgresql://app:pw@localhost:5432/requirement",
    "postgresql://app:pw@127.0.0.1:5432/requirement",
    "postgresql://app:pw@[::1]:5432/requirement",
    "postgresql://app:pw@dev.localhost:5432/requirement",
    "postgresql://app:pw@db:5432/requirement",
  ])("treats %s as local", (url) => expect(isLocalDatabaseUrl(url)).toBe(true));

  it.each([
    "postgresql://app:pw@ep-cool-123.eu-central-1.aws.neon.tech/requirement?sslmode=require",
    "postgresql://app:pw@example.invalid:5432/z",
    "postgresql://app:pw@localhost.evil.com:5432/requirement",
    "postgresql://app:pw@notlocalhost:5432/requirement",
    "not a url",
    "",
    undefined,
    null,
  ])("treats %s as not local", (url) => expect(isLocalDatabaseUrl(url)).toBe(false));
});

describe("describeDatabaseTarget", () => {
  it("names host, port and database and never the credentials", () => {
    const text = describeDatabaseTarget("postgresql://app:s3cret@localhost:5432/requirement_385?schema=public");
    expect(text).toBe("localhost:5432/requirement_385");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("app:");
  });
});

describe("allocateCounts", () => {
  it("adds up exactly", () => {
    for (const total of [7, 93, 100, 111]) {
      const counts = allocateCounts(total, STATUS_SHARES);
      expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(total);
    }
  });
});

describe("buildEstatePlan", () => {
  it("is identical for the same input", () => {
    expect(buildEstatePlan(catalogs())).toEqual(buildEstatePlan(catalogs()));
  });

  it("plans about 100 Systems with unique marker ids and names", () => {
    const plan = buildEstatePlan(catalogs());
    expect(plan.systems).toHaveLength(100);
    expect(new Set(plan.systems.map((system) => system.id)).size).toBe(100);
    expect(new Set(plan.systems.map((system) => system.name.toLowerCase())).size).toBe(100);
    expect(plan.systems.every((system) => system.id.startsWith(MARKER))).toBe(true);
    expect(plan.users.every((user) => user.id.startsWith(MARKER) || !user.create)).toBe(true);
  });

  it("has every status at about the intended share", () => {
    const plan = buildEstatePlan(catalogs());
    const share = (status: string) => plan.systems.filter((system) => system.status === status).length / plan.systems.length;
    expect(share("DRAFT")).toBeCloseTo(0.18, 1);
    expect(share("IN_REVIEW")).toBeCloseTo(0.18, 1);
    expect(share("APPROVED")).toBeCloseTo(0.14, 1);
    expect(share("ONBOARDED")).toBeCloseTo(0.44, 1);
    expect(share("REJECTED")).toBeCloseTo(0.06, 1);
  });

  it("skips names that already exist, whatever their case", () => {
    const plan = buildEstatePlan(catalogs({ existingSystemNames: ["jira", "Confluence"] }));
    expect(plan.skippedNames).toEqual(["Jira", "Confluence"]);
    expect(plan.systems.map((system) => system.name)).not.toContain("Jira");
    expect(plan.systems).toHaveLength(100);
    expect(NAMES.length).toBeGreaterThan(100);
  });

  it("plans Providers, always Onboarded, and dependents that point at them", () => {
    const plan = buildEstatePlan(catalogs());
    const providers = plan.systems.filter((system) => system.isProvider);
    expect(providers.length).toBeGreaterThanOrEqual(4);
    expect(providers.every((system) => system.status === "ONBOARDED" && system.providerKind !== null)).toBe(true);
    const providerIds = new Set(providers.map((system) => system.id));
    const dependents = plan.systems.filter((system) => system.dependsOnIds.length > 0);
    expect(dependents.length).toBeGreaterThan(10);
    expect(dependents.every((system) => !system.isProvider && system.dependsOnIds.every((id) => providerIds.has(id)))).toBe(true);
  });

  it("respects the Information Type floor and the vendor-details rule", () => {
    const input = catalogs();
    const plan = buildEstatePlan(input);
    for (const system of plan.systems) {
      const floor = Math.max(0, ...system.informationTypeIds.map((id) => input.informationTypes.find((type) => type.id === id)!.sensitivityLevel));
      if (system.informationTypeIds.length > 0) expect(system.sensitivityLevel).not.toBeNull();
      if (system.sensitivityLevel !== null) expect(system.sensitivityLevel).toBeGreaterThanOrEqual(floor);
      if (system.facetIds.includes("f-saas")) {
        expect(system.vendor).not.toBeNull();
        expect(system.details?.serviceUrl).toBeTruthy();
      }
    }
  });

  it("adds or declines every suggested Framework, never leaving one open", () => {
    const plan = buildEstatePlan(catalogs());
    for (const system of plan.systems) {
      const suggested = system.informationTypeIds.includes("it-1");
      const added = system.scopeFrameworkIds.includes("fw-gdpr");
      const declined = system.declinedSuggestions.some((row) => row.frameworkId === "fw-gdpr");
      if (suggested) expect(added !== declined).toBe(true);
      expect(system.scopeFrameworkIds).not.toContain("fw-base");
    }
  });

  it("creates marker catalog entries only for an empty catalog", () => {
    expect(buildEstatePlan(catalogs()).catalogsToCreate).toEqual({ facets: [], businessUnits: [], informationTypes: [] });
    const empty = buildEstatePlan(catalogs({ facets: [], businessUnits: [], informationTypes: [] }));
    expect(empty.catalogsToCreate.facets).toHaveLength(3);
    expect(empty.catalogsToCreate.businessUnits.length).toBeGreaterThan(0);
    expect(empty.catalogsToCreate.facets.every((row) => row.id.startsWith(MARKER))).toBe(true);
    expect(empty.systems).toHaveLength(100);
  });

  it("reuses an existing User with the same email and never plans to create it", () => {
    const plan = buildEstatePlan(catalogs({ existingUsers: [{ id: "u-priya", email: "priya.shah@example.com" }] }));
    const priya = plan.users.find((user) => user.email === "priya.shah@example.com")!;
    expect(priya).toMatchObject({ id: "u-priya", create: false });
  });

  it("plans Comparisons and staged Drafts only when staged evaluation is on", () => {
    expect(buildEstatePlan(catalogs()).comparisons).toHaveLength(0);
    expect(buildEstatePlan(catalogs()).systems.some((system) => system.staged)).toBe(false);
    const on = buildEstatePlan(catalogs({ stagedEvaluationEnabled: true }));
    expect(on.comparisons).toHaveLength(2);
    expect(on.comparisons.filter((comparison) => comparison.outcome === null)).toHaveLength(1);
    const staged = new Set(on.systems.filter((system) => system.staged && system.status === "DRAFT").map((system) => system.id));
    expect(on.comparisons.flatMap((comparison) => comparison.candidateIds).every((id) => staged.has(id))).toBe(true);
  });

  it("gives Rejected Systems a Business System Owner who is not their owner", () => {
    const plan = buildEstatePlan(catalogs());
    for (const system of plan.systems.filter((entry) => entry.status === "REJECTED")) {
      expect(system.businessSystemOwnerId).not.toBeNull();
      expect(system.businessSystemOwnerId).not.toBe(system.ownerId);
    }
  });
});

describe("formatReplaceCheck", () => {
  it("is empty when there is nothing to report", () => {
    expect(formatReplaceCheck({ blockers: [], willDelete: [] })).toBe("");
    expect(nonEmpty([{ table: "x", count: 0, examples: [] }])).toEqual([]);
  });

  it("names every blocker with its count and examples and says nothing was changed", () => {
    const text = formatReplaceCheck({
      blockers: [{ table: "Provider dependencies", count: 2, examples: ["Test #385 System on Okta"] }],
      willDelete: [{ table: "Risks", count: 3, examples: [] }],
    });
    expect(text).toContain("Provider dependencies: 2 (e.g. Test #385 System on Okta)");
    expect(text).toContain("Nothing was changed");
    expect(text).toContain("Will be deleted with the demo Systems");
    expect(text).toContain("Risks: 3");
  });

  it("lists only what will be deleted when nothing blocks", () => {
    const text = formatReplaceCheck({ blockers: [], willDelete: [{ table: "Risks", count: 1, examples: [] }] });
    expect(text).not.toContain("Cannot replace");
    expect(text).toContain("Risks: 1");
  });
});
