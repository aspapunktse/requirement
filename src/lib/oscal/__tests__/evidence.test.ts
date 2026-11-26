import { describe, expect, it } from "vitest";
import { buildOscalPackage, OSCAL_APP_NS, type OscalEvidence, type OscalSnapshot } from "@/lib/oscal/package-builder";
import { oscalUuid } from "@/lib/oscal/ids";
import { referenceErrors, validateOscalPackage } from "@/lib/oscal/validate";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const link: OscalEvidence = {
  id: "ev1",
  kind: "LINK",
  url: "https://wiki.example.com/pen-test",
  title: "Pen test report",
  description: null,
  collectedAt: new Date("2026-01-10T00:00:00Z"),
  expiresAt: null,
  document: null,
};
const documentEvidence: OscalEvidence = {
  id: "ev2",
  kind: "DOCUMENT",
  url: null,
  title: "Architecture",
  description: "Latest architecture description",
  collectedAt: new Date("2026-02-01T00:00:00Z"),
  expiresAt: new Date("2026-12-31T23:59:59Z"),
  document: { documentRequirementId: "dr1", link: null, file: { fileName: "arch.pdf", contentType: "application/pdf", sha256: "ab".repeat(32) } },
};

function snapshot(evidenceItems: OscalEvidence[], evidence: string | null = null): OscalSnapshot {
  return {
    system: { id: "sys", name: "S", description: null, status: "ONBOARDED", informationTypes: [], deploymentFacets: [], dataLocation: null, integrityImpactLevel: null, availabilityImpactLevel: null, owner: { id: "u1", name: "Owner" }, businessSystemOwner: null },
    exportedBy: { id: "u1", name: "Owner" },
    controls: [{ id: "c1", code: "A.1", title: "T", description: "D", applicability: "PER_SYSTEM", evidenceValidityMonths: 12 }],
    applicableControlIds: ["c1"],
    assessments: [{ id: "a1", controlId: "c1", status: "FULFILLED", notes: null, evidence, evidenceItems, personSet: true }],
    organizationImplementations: [],
    providers: [],
    providerSources: [],
    assessmentRisks: [],
  };
}
const build = (s: OscalSnapshot) => buildOscalPackage(s, new Date("2026-11-24T10:00:00Z"), () => "00000000-0000-4000-8000-000000000000");
const sspOf = (s: OscalSnapshot) => build(s).ssp["system-security-plan"] as Doc;

describe("OSCAL SSP: Evidence records (#455)", () => {
  it("lists each record as a back-matter resource with a stable UUID, collected and expiry props, and a hash for a stored file", () => {
    const ssp = sspOf(snapshot([link, documentEvidence]));
    const resources = ssp["back-matter"].resources as Doc[];
    expect(resources).toHaveLength(2);

    const [l, doc] = resources;
    expect(l.uuid).toBe(oscalUuid("Evidence", "ev1"));
    expect(l.title).toBe("Pen test report");
    expect(l.rlinks).toEqual([{ href: "https://wiki.example.com/pen-test" }]);
    // No override: the Control's 12 months after 2026-01-10.
    expect(l.props).toEqual([
      { name: "evidence-kind", ns: OSCAL_APP_NS, value: "LINK" },
      { name: "collected", ns: OSCAL_APP_NS, value: "2026-01-10T00:00:00.000Z" },
      { name: "expires", ns: OSCAL_APP_NS, value: "2027-01-10T00:00:00.000Z" },
    ]);

    expect(doc.uuid).toBe(oscalUuid("Evidence", "ev2"));
    expect(doc.description).toBe("Latest architecture description");
    expect(doc.rlinks).toEqual([{ href: "/api/systems/sys/documents/dr1/file", "media-type": "application/pdf", hashes: [{ algorithm: "SHA-256", value: "ab".repeat(32) }] }]);
    // The person's own expiry wins.
    expect(doc.props.find((p: Doc) => p.name === "expires").value).toBe("2026-12-31T23:59:59.000Z");
  });

  it("links the implemented requirement to its resources and passes validation with zero errors", () => {
    const pkg = build(snapshot([link, documentEvidence]));
    const requirement = pkg.ssp["system-security-plan"]["control-implementation"]["implemented-requirements"][0] as Doc;
    expect(requirement.links).toEqual([
      { href: `#${oscalUuid("Evidence", "ev1")}`, rel: "evidence" },
      { href: `#${oscalUuid("Evidence", "ev2")}`, rel: "evidence" },
    ]);
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("leaves out expiry for a Control with no period and no override, and the hash for a document with no stored digest or file", () => {
    const s = snapshot([link, { ...documentEvidence, expiresAt: null, document: { documentRequirementId: "dr1", link: "https://docs.example.com/a", file: null } }]);
    s.controls[0].evidenceValidityMonths = null;
    const resources = sspOf(s)["back-matter"].resources as Doc[];
    expect(resources[0].props.map((p: Doc) => p.name)).toEqual(["evidence-kind", "collected"]);
    expect(resources[1].rlinks).toEqual([{ href: "https://docs.example.com/a" }]);
    expect(validateOscalPackage(build(s))).toEqual([]);
  });

  it("keeps a resource, with no link, for a document that was deleted since", () => {
    const resources = sspOf(snapshot([{ ...documentEvidence, document: null }]))["back-matter"].resources as Doc[];
    expect(resources[0]).toMatchObject({ title: "Architecture" });
    expect(resources[0].rlinks).toBeUndefined();
  });

  it("has no back-matter and no links without Evidence records", () => {
    const pkg = build(snapshot([]));
    expect(pkg.ssp["system-security-plan"]).not.toHaveProperty("back-matter");
    expect(pkg.ssp["system-security-plan"]["control-implementation"]["implemented-requirements"][0]).not.toHaveProperty("links");
  });

  it("prints the Evidence note only when it says more than the URLs that are records, so a backfilled link isn't printed twice", () => {
    const description = (s: OscalSnapshot) =>
      (sspOf(s)["control-implementation"]["implemented-requirements"][0]["by-components"][0] as Doc).description as string;
    expect(description(snapshot([link], "https://wiki.example.com/pen-test"))).toBe("No implementation description recorded.");
    expect(description(snapshot([link], "Pen test: https://wiki.example.com/pen-test"))).toBe("Evidence: Pen test: https://wiki.example.com/pen-test");
    expect(description(snapshot([], "https://wiki.example.com/pen-test"))).toBe("Evidence: https://wiki.example.com/pen-test");
  });

  it("the validator reports a #link that points at no back-matter resource", () => {
    const pkg = build(snapshot([link]));
    const ssp = pkg.ssp["system-security-plan"] as Doc;
    ssp["control-implementation"]["implemented-requirements"][0].links[0].href = "#00000000-0000-4000-8000-0000000000ff";
    const errors = referenceErrors(pkg);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ layer: "reference", document: "ssp", message: expect.stringContaining("resource") });
  });
});
