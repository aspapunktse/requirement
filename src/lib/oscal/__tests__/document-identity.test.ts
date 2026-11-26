// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildOscalPackage, DOCUMENT_ID_SCHEME, OSCAL_APP_NS, UNRELEASED_DOCUMENT_VERSION, type OscalRelease, type OscalSnapshot } from "@/lib/oscal/package-builder";
import { validateOscalPackage } from "@/lib/oscal/validate";
import appPackage from "../../../../package.json";

const snapshot = (systemId = "sys1"): OscalSnapshot => ({
  system: { id: systemId, name: "S", description: null, status: "ONBOARDED", informationTypes: [], deploymentFacets: [], dataLocation: null, integrityImpactLevel: null, availabilityImpactLevel: null, owner: { id: "u1", name: "Owner Name" }, businessSystemOwner: null },
  exportedBy: { id: "u1", name: "Owner Name" },
  controls: [{ id: "c1", code: "A.1", title: "T", description: "D", applicability: "PER_SYSTEM" }],
  applicableControlIds: ["c1"],
  assessments: [],
  organizationImplementations: [],
  providers: [],
  providerSources: [],
  assessmentRisks: [],
});

const metas = (pkg: ReturnType<typeof buildOscalPackage>) => ({
  catalog: pkg.catalog.catalog.metadata as Record<string, unknown>,
  profile: pkg.profile.profile.metadata as Record<string, unknown>,
  ssp: pkg.ssp["system-security-plan"].metadata as Record<string, unknown>,
});

let n = 0;
const fresh = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

describe("OSCAL document identity (#452)", () => {
  it("uses the product owner's namespace and never the placeholder", () => {
    expect(OSCAL_APP_NS).toBe("https://github.com/aspapunktse/requirement/ns/oscal");
    const pkg = buildOscalPackage(snapshot(), new Date("2026-11-26T10:00:00Z"), fresh);
    expect(JSON.stringify(pkg)).not.toContain("requirement.example");
  });

  it("an export that is not a release says so in metadata.version and keeps the app version in a prop", () => {
    const pkg = buildOscalPackage(snapshot(), new Date("2026-11-26T10:00:00Z"), fresh);
    for (const m of Object.values(metas(pkg))) {
      expect(m.version).toBe(UNRELEASED_DOCUMENT_VERSION);
      expect(m.version).not.toBe(appPackage.version);
      expect(m.revisions).toBeUndefined();
      expect(m.published).toBeUndefined();
      expect((m.props as { name: string; value: string }[]).find((p) => p.name === "exporter-version")?.value).toBe(appPackage.version);
    }
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("two exports of the same System: different root UUIDs, same document-ids", () => {
    const a = buildOscalPackage(snapshot(), new Date("2026-11-26T10:00:00Z"));
    const b = buildOscalPackage(snapshot(), new Date("2026-11-26T11:00:00Z"));
    expect(a.ssp["system-security-plan"].uuid).not.toBe(b.ssp["system-security-plan"].uuid);
    expect(a.catalog.catalog.uuid).not.toBe(b.catalog.catalog.uuid);
    const ma = metas(a);
    const mb = metas(b);
    for (const k of ["catalog", "profile", "ssp"] as const) {
      expect(ma[k]["document-ids"]).toEqual(mb[k]["document-ids"]);
      expect(ma[k]["document-ids"]).toEqual([{ scheme: DOCUMENT_ID_SCHEME, identifier: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    }
    expect(DOCUMENT_ID_SCHEME.startsWith(OSCAL_APP_NS)).toBe(true);
  });

  it("document-ids differ per kind and per System; the Catalog's is the same for every System", () => {
    const a = metas(buildOscalPackage(snapshot("sysA"), new Date(), fresh));
    const b = metas(buildOscalPackage(snapshot("sysB"), new Date(), fresh));
    const id = (m: Record<string, unknown>) => (m["document-ids"] as { identifier: string }[])[0].identifier;
    expect(new Set([id(a.catalog), id(a.profile), id(a.ssp)]).size).toBe(3);
    expect(id(a.catalog)).toBe(id(b.catalog));
    expect(id(a.profile)).not.toBe(id(b.profile));
    expect(id(a.ssp)).not.toBe(id(b.ssp));
  });

  it("a release sets version and published and lists the earlier versions as revisions", () => {
    const release: OscalRelease = {
      version: "3",
      published: new Date("2026-11-26T09:00:00Z"),
      previous: [
        { version: "1", published: new Date("2026-10-01T09:00:00Z"), lastModified: new Date("2026-10-01T09:00:00Z") },
        { version: "2", published: new Date("2026-11-01T09:00:00Z"), lastModified: new Date("2026-11-02T09:00:00Z") },
      ],
    };
    const pkg = buildOscalPackage(snapshot(), new Date("2026-11-26T10:00:00Z"), fresh, release);
    for (const m of Object.values(metas(pkg))) {
      expect(m.version).toBe("3");
      expect(m.published).toBe("2026-11-26T09:00:00.000Z");
      expect(m.revisions).toEqual([
        { published: "2026-10-01T09:00:00.000Z", "last-modified": "2026-10-01T09:00:00.000Z", version: "1" },
        { published: "2026-11-01T09:00:00.000Z", "last-modified": "2026-11-02T09:00:00.000Z", version: "2" },
      ]);
    }
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("a first release has no revisions", () => {
    const pkg = buildOscalPackage(snapshot(), new Date("2026-11-26T10:00:00Z"), fresh, { version: "1", published: new Date("2026-11-26T09:00:00Z"), previous: [] });
    expect(metas(pkg).ssp.revisions).toBeUndefined();
    expect(metas(pkg).ssp.version).toBe("1");
    expect(validateOscalPackage(pkg)).toEqual([]);
  });
});
