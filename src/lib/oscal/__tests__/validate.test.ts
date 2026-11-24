// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { catalogControlIds, resolveProfile, validateOscalPackage } from "../validate";
import { FIXTURE_UUID, goodCatalog, goodPackage, goodProfile } from "./fixtures";

const sspRoot = (pkg: ReturnType<typeof goodPackage>) => pkg.ssp["system-security-plan"];
const requirements = (pkg: ReturnType<typeof goodPackage>) =>
  sspRoot(pkg)["control-implementation"]["implemented-requirements"];

describe("pinned schema", () => {
  it("is NIST's v1.2.3 file, unmodified", () => {
    const file = readFileSync(path.join(__dirname, "../schema/oscal_complete_schema.json"));
    expect(createHash("sha256").update(file).digest("hex")).toBe(
      "384324105c7a817af0f65b120a963146caa0e0d55d969cf0daf60e063b87a206",
    );
  });
});

describe("validateOscalPackage", () => {
  it("accepts the good package", () => {
    expect(validateOscalPackage(goodPackage())).toEqual([]);
  });

  it("passes the schema layer but fails the reference layer for a control outside the Profile and an undefined component", () => {
    const pkg = goodPackage();
    requirements(pkg)[0]["control-id"] = "A.7.8"; // in the Catalog, not selected
    requirements(pkg)[1]["by-components"]![0]["component-uuid"] = FIXTURE_UUID.ghost;
    const errors = validateOscalPackage(pkg);
    expect(errors.every((e) => e.layer === "reference" && e.document === "ssp")).toBe(true);
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringContaining('control "A.7.8" is not in the set selected by the Profile'),
      expect.stringContaining(`component "${FIXTURE_UUID.ghost}" is not defined in the SSP`),
    ]);
    expect(errors[0].path).toContain("/implemented-requirements/0/control-id");
  });

  it("fails an import-profile pointing outside the package", () => {
    for (const href of ["https://example.com/profile.json", "../profile.json", "#abc", "other.json"]) {
      const pkg = goodPackage();
      pkg.ssp["system-security-plan"]["import-profile"].href = href;
      const errors = validateOscalPackage(pkg);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ layer: "reference", document: "ssp" });
      expect(errors[0].message).toContain("inside the package");
    }
  });

  it("accepts a leading ./ on in-package hrefs", () => {
    const pkg = goodPackage();
    pkg.ssp["system-security-plan"]["import-profile"].href = "./profile.json";
    pkg.profile.profile.imports[0].href = "./catalog.json";
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("fails a Profile import pointing outside the package", () => {
    const pkg = goodPackage();
    pkg.profile.profile.imports[0].href = "https://example.com/catalog.json";
    const errors = validateOscalPackage(pkg);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ layer: "reference", document: "profile", path: "/profile/imports/0/href" });
  });

  it('fails the schema layer for status.state "approved"', () => {
    const pkg = goodPackage();
    sspRoot(pkg)["system-characteristics"].status.state = "approved";
    const errors = validateOscalPackage(pkg);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.layer === "schema" && e.document === "ssp")).toBe(true);
    expect(errors.some((e) => e.path.endsWith("/status/state"))).toBe(true);
  });

  it("fails the schema layer for a control id with a space", () => {
    const pkg = goodPackage();
    pkg.catalog.catalog.controls[0].id = "5.1 Policy";
    const errors = validateOscalPackage(pkg);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.layer === "schema" && e.document === "catalog")).toBe(true);
    expect(errors[0].path).toBe("/catalog/controls/0/id");
  });

  it("fails the schema layer for a malformed document-level $schema", () => {
    for (const bad of [123, "not a uri ::"]) {
      const pkg = goodPackage();
      Object.assign(pkg.catalog, { $schema: bad });
      const errors = validateOscalPackage(pkg);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((e) => e.layer === "schema" && e.document === "catalog" && e.path === "/$schema")).toBe(true);
    }
  });

  it("accepts a valid URI as $schema", () => {
    const pkg = goodPackage();
    Object.assign(pkg.catalog, {
      $schema: "http://csrc.nist.gov/ns/oscal/1.0/1.2.3/oscal-complete-schema.json",
    });
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("does not run the reference layer when a schema error exists", () => {
    const pkg = goodPackage();
    pkg.catalog.catalog.controls[0].id = "5.1 Policy";
    requirements(pkg)[0]["control-id"] = "A.7.8";
    expect(validateOscalPackage(pkg).every((e) => e.layer === "schema")).toBe(true);
  });

  it("reports a document without its root key", () => {
    const pkg = { ...goodPackage(), catalog: {} };
    expect(validateOscalPackage(pkg)).toEqual([
      { layer: "schema", document: "catalog", path: "", message: 'must be an object with a "catalog" property' },
    ]);
  });

  it("reports a with-ids entry missing from the Catalog", () => {
    const pkg = goodPackage();
    pkg.profile.profile.imports[0]["include-controls"][0]["with-ids"].push("NOPE-1");
    const errors = validateOscalPackage(pkg);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ layer: "reference", document: "profile" });
    expect(errors[0].message).toContain('control "NOPE-1" is not in the Catalog');
  });

  it("reports an undefined role and party", () => {
    const pkg = goodPackage();
    const rp = sspRoot(pkg)["system-characteristics"]["responsible-parties"][0];
    rp["role-id"] = "ghost-role";
    rp["party-uuids"] = [FIXTURE_UUID.ghost];
    const messages = validateOscalPackage(pkg).map((e) => e.message);
    expect(messages).toEqual([
      'role "ghost-role" is not defined in the SSP',
      `party "${FIXTURE_UUID.ghost}" is not defined in the SSP`,
    ]);
  });

  it("reports an undefined component in a statement's by-components", () => {
    const pkg = goodPackage();
    requirements(pkg)[2].statements![0]["by-components"][0]["component-uuid"] = FIXTURE_UUID.ghost;
    const errors = validateOscalPackage(pkg);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toContain("/statements/0/by-components/0/component-uuid");
  });

  describe("unsupported Profile features", () => {
    const unsupportedCases: Array<[string, (p: ReturnType<typeof goodProfile>) => void]> = [
      ["include-all", (p) => Object.assign(p.profile.imports[0], { "include-all": {} })],
      ["exclude-controls", (p) => Object.assign(p.profile.imports[0], { "exclude-controls": [{ "with-ids": ["A.8.5"] }] })],
      ["merge", (p) => Object.assign(p.profile, { merge: { "as-is": true } })],
      ["modify", (p) => Object.assign(p.profile, { modify: { "set-parameters": [{ "param-id": "p1", values: ["x"] }] } })],
    ];
    it.each(unsupportedCases)("reports %s as unsupported", (feature, mutate) => {
      const pkg = goodPackage();
      mutate(pkg.profile);
      if (feature === "include-all") delete (pkg.profile.profile.imports[0] as Record<string, unknown>)["include-controls"];
      const errors = validateOscalPackage(pkg);
      expect(errors.some((e) => e.layer === "reference" && e.document === "profile" && e.message.startsWith(`unsupported: ${feature}`))).toBe(true);
      expect(errors.every((e) => e.layer === "reference")).toBe(true);
    });
  });
});

describe("resolveProfile", () => {
  it("selects the with-ids controls, including grouped and nested ones", () => {
    const { ids, errors } = resolveProfile(goodProfile(), goodCatalog());
    expect(errors).toEqual([]);
    expect(ids).toEqual(["A.5.15", "A.5.15.e1", "A.5.30", "A.8.5", "SEC-001"]);
  });

  it("lists every Catalog control id, in groups, nested groups and enhancements", () => {
    expect([...catalogControlIds(goodCatalog())].sort()).toEqual(
      ["A.5.15", "A.5.15.e1", "A.5.30", "A.7.8", "A.8.5", "SEC-001"].sort(),
    );
  });

  it("de-duplicates ids", () => {
    const profile = goodProfile();
    profile.profile.imports[0]["include-controls"][0]["with-ids"] = ["A.8.5", "A.8.5"];
    expect(resolveProfile(profile, goodCatalog()).ids).toEqual(["A.8.5"]);
  });
});
