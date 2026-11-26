// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { prisma } from "@/lib/prisma";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { oscalUuid } from "@/lib/oscal/ids";
import { loadOscalPackage, OSCAL_APP_NS } from "@/lib/oscal/package-builder";
import { validateOscalPackage, type OscalPackage } from "@/lib/oscal/validate";
import { createOscalRelease, type OscalReleaseManifest } from "@/lib/oscal/releases";
import { GET as downloadRoute } from "@/app/api/systems/[id]/oscal-package/route";
import { POST as postClose } from "@/app/api/internal-audits/[id]/close/route";
import { POST as postEvaluation } from "@/app/api/check-ups/[id]/evaluation/route";
import { POST as postWithdrawal } from "@/app/api/check-ups/[id]/withdrawal/route";

/**
 * The Assessment Plan and Assessment Results of a closed Internal Audit (#454), against real Postgres. Fixtures only
 * (`Test 454...`, via `createCheckUpScenario`): one System with four Check-ups (Conforming, Observation, Nonconformity whose Risk is
 * also the Waived Control's Risk, and withdrawn), a Self-Assessment answer given before the close and one changed after it.
 */

// A switch to make the release builder fail, to show a failing build does not undo closing an audit.
const failure = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/oscal/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oscal/releases")>();
  return {
    ...actual,
    createOscalRelease: (...args: Parameters<typeof actual.createOscalRelease>) => {
      if (failure.on) return Promise.reject(new Error("injected failure"));
      return actual.createOscalRelease(...args);
    },
  };
});

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("OSCAL Assessment Plan and Assessment Results (#454)", { timeout: 120_000 }, () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let t: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let admin: { id: string; role: "ADMIN" };
  let riskId = "";
  let selfAssessmentIds: string[] = [];
  const evaluate = (checkUpId: string, userId: string, body: unknown) => postEvaluation(requestAs(`/api/check-ups/${checkUpId}/evaluation`, userId, "POST", body), idCtx(checkUpId));
  const close = (scenario: typeof s) => postClose(requestAs(`/api/internal-audits/${scenario.auditId}/close`, scenario.roleUser.INTERNAL_AUDITOR, "POST"), idCtx(scenario.auditId));

  beforeAll(async () => {
    s = await createCheckUpScenario("454a", { systemControls: 4, organizationControls: 0 });
    t = await createCheckUpScenario("454b", { systemControls: 1, organizationControls: 0 });
    admin = { id: s.roleUser.ADMIN, role: "ADMIN" };
    const auditor = s.roleUser.INTERNAL_AUDITOR;
    const [conforming, observation, nonconformity, withdrawn] = s.systemControls.map((c) => s.find(c.code));

    // The Control of the Nonconformity is Waived, so the SSP cites its Risk.
    const waived = await prisma.controlAssessment.create({
      data: { systemId: s.systemId, controlId: s.systemControls[2].id, status: "WAIVED", notes: "Accepted for now.", assessedById: s.roleUser.RISK_OWNER, assessedAt: new Date() },
    });
    // A response with two evidence links (one unsafe, left out), one with none.
    await s.answer(conforming.id, s.systemOwner);
    await prisma.checkUpResponse.update({ where: { checkUpId: conforming.id }, data: { evidenceLinks: ["https://example.com/evidence", "javascript:alert(1)"] } });
    await s.answer(observation.id, s.systemOwner);
    await s.answer(nonconformity.id, s.systemOwner);
    expect((await evaluate(conforming.id, auditor, { outcome: "CONFORMING" })).status).toBe(201);
    expect((await evaluate(observation.id, auditor, { outcome: "OBSERVATION", comment: "Logs are kept 30 days, not 90." })).status).toBe(201);
    expect((await evaluate(nonconformity.id, auditor, { outcome: "NONCONFORMITY", comment: "No review took place." })).status).toBe(201);
    expect((await postWithdrawal(requestAs(`/api/check-ups/${withdrawn.id}/withdrawal`, auditor, "POST", { reason: "Control no longer used" }), idCtx(withdrawn.id))).status).toBe(201);

    const risk = await prisma.risk.findUniqueOrThrow({ where: { checkUpId: nonconformity.id } });
    riskId = risk.id;
    // The audit's Risk is also the Waived Control's Risk (what the SSP's Waived prop points at).
    await prisma.risk.update({ where: { id: risk.id }, data: { controlAssessmentId: waived.id, mitigationPlan: "Review quarterly." } });

    // Self-Assessments: one before the close (kept), one that changes after it (left out).
    const before = await prisma.controlAssessment.create({
      data: { systemId: s.systemId, controlId: s.systemControls[0].id, status: "FULFILLED", selfAssessmentAnswer: "YES", assessedById: s.systemOwner, assessedAt: new Date(Date.now() - 60_000) },
    });
    const after = await prisma.controlAssessment.create({
      data: { systemId: s.systemId, controlId: s.systemControls[1].id, status: "FULFILLED", selfAssessmentAnswer: "NO", assessedById: s.systemOwner, assessedAt: new Date(Date.now() + 3_600_000) },
    });
    selfAssessmentIds = [before.id, after.id];
  }, 120_000);

  afterAll(async () => {
    failure.on = false;
    for (const x of [s, t]) {
      await prisma.oscalRelease.deleteMany({ where: { system: { name: { endsWith: x.suffix } } } });
      await x.cleanup();
    }
  }, 60_000);

  it("a System whose audit is not closed has no Assessment Plan or Assessment Results, in the page's package or the download", async () => {
    const result = await loadOscalPackage(s.systemId, admin);
    if (result.kind !== "ok") throw new Error("expected a package");
    expect("assessmentPlan" in result.pkg).toBe(false);
    expect("assessmentResults" in result.pkg).toBe(false);
    const response = await downloadRoute(requestAs(`/api/systems/${s.systemId}/oscal-package`, admin.id, "GET"), idCtx(s.systemId));
    expect(Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer()))).sort()).toEqual(["catalog.json", "poam.json", "profile.json", "ssp.json"]);
  });

  describe("after the audit closes", () => {
    let pkg: OscalPackage & { assessmentPlan: Doc; assessmentResults: Doc };
    let launchedAt: Date;
    let closedAt: Date;
    const plan = () => pkg.assessmentPlan["assessment-plan"] as Doc;
    const results = () => pkg.assessmentResults["assessment-results"] as Doc;
    const auditResult = () => results().results[0] as Doc;
    const selfResult = () => results().results[1] as Doc;
    const findingFor = (checkUpId: string) => (auditResult().findings as Doc[]).find((f) => f.uuid === oscalUuid("Finding", checkUpId));

    beforeAll(async () => {
      expect((await close(s)).status).toBe(200);
      const audit = await prisma.internalAudit.findUniqueOrThrow({ where: { id: s.auditId } });
      launchedAt = audit.launchedAt!;
      closedAt = audit.closedAt!;
      const result = await loadOscalPackage(s.systemId, admin);
      if (result.kind !== "ok" || !("assessmentPlan" in result.pkg)) throw new Error("expected a package with an Assessment Plan");
      pkg = result.pkg as typeof pkg;
    });

    it("both documents validate with zero errors", () => {
      expect(validateOscalPackage(pkg)).toEqual([]);
    });

    it("the plan imports the package's SSP, reviews the audit's Controls of the System, and plans the questions as steps", async () => {
      expect(plan()["import-ssp"].href).toBe("ssp.json");
      const reviewed = plan()["reviewed-controls"]["control-selections"][0]["include-controls"] as Doc[];
      expect(reviewed).toHaveLength(4);
      expect(plan()["assessment-subjects"][0]["include-subjects"]).toEqual([{ "subject-uuid": oscalUuid("System", s.systemId), type: "component" }]);
      const task = plan().tasks[0];
      expect(task.timing["within-date-range"].start).toBe(launchedAt.toISOString());
      expect(task.timing["within-date-range"].end).toBe(`${s.dueDate}T23:59:59.000Z`);
      const activities = plan()["local-definitions"].activities as Doc[];
      expect(activities).toHaveLength(4);
      const questionCount = await_count(s);
      expect(activities.reduce((n, a) => n + a.steps.length, 0)).toBe(await questionCount);
    });

    it("the audit's result runs from launch to close, and every finding's state matches the evaluation", async () => {
      expect(auditResult().start).toBe(launchedAt.toISOString());
      expect(auditResult().end).toBe(closedAt.toISOString());
      const [conforming, observation, nonconformity] = s.systemControls.map((c) => s.find(c.code));
      const state = (id: string) => findingFor(id)!.target.status.state;
      expect(state(conforming.id)).toBe("satisfied");
      expect(state(observation.id)).toBe("satisfied");
      expect(state(nonconformity.id)).toBe("not-satisfied");
      expect(findingFor(conforming.id)!.target["target-id"]).toMatch(/_smt$/);
      expect(findingFor(nonconformity.id)!.props).toContainEqual({ name: "check-up-outcome", ns: OSCAL_APP_NS, value: "NONCONFORMITY" });
      expect(auditResult().findings).toHaveLength(3);
    });

    it("the Observation finding links an observation that describes the weakness", () => {
      const f = findingFor(s.find(s.systemControls[1].code).id)!;
      const linked = (f["related-observations"] as Doc[]).map((r) => (auditResult().observations as Doc[]).find((o) => o.uuid === r["observation-uuid"])!);
      expect(linked.map((o) => o.description)).toContain("Logs are kept 30 days, not 90.");
      expect(linked.some((o) => o.methods.includes("INTERVIEW"))).toBe(true);
    });

    it("a response is an observation by its responder: INTERVIEW, plus EXAMINE with the safe evidence link", () => {
      const o = (auditResult().observations as Doc[]).find((x) => x.uuid === oscalUuid("Observation", "response", s.find(s.systemControls[0].code).id))!;
      expect(o.methods).toEqual(["INTERVIEW", "EXAMINE"]);
      expect(o["relevant-evidence"].map((e: Doc) => e.href)).toEqual(["https://example.com/evidence"]);
      expect(o.origins[0].actors[0]["actor-uuid"]).toBe(oscalUuid("User", s.systemOwner));
      const party = (results().metadata.parties as Doc[]).find((p) => p.uuid === oscalUuid("User", s.systemOwner))!;
      expect(party.name).toBe("Test 454a system-owner");
      const interviewOnly = (auditResult().observations as Doc[]).find((x) => x.uuid === oscalUuid("Observation", "response", s.find(s.systemControls[2].code).id))!;
      expect(interviewOnly.methods).toEqual(["INTERVIEW"]);
    });

    it("the withdrawn Check-up has no finding, and its reason is recorded", () => {
      const withdrawn = s.find(s.systemControls[3].code);
      expect(findingFor(withdrawn.id)).toBeUndefined();
      const o = (auditResult().observations as Doc[]).find((x) => x.uuid === oscalUuid("Observation", "withdrawal", withdrawn.id))!;
      expect(o.description).toContain("Control no longer used");
    });

    it("the Risk is in the results, the finding relates it, and the SSP's Waived Risk resolves to it", () => {
      const risks = auditResult().risks as Doc[];
      expect(risks.map((r) => r.uuid)).toEqual([oscalUuid("Risk", riskId)]);
      expect(risks[0].status).toBe("open");
      expect(risks[0].remediations[0].description).toBe("Review quarterly.");
      expect(findingFor(s.find(s.systemControls[2].code).id)!["related-risks"]).toEqual([{ "risk-uuid": oscalUuid("Risk", riskId) }]);
      const waivedProps = (pkg.ssp as Doc)["system-security-plan"]["control-implementation"]["implemented-requirements"]
        .flatMap((r: Doc) => r["by-components"])
        .flatMap((b: Doc) => b.props)
        .filter((p: Doc) => p.name === "risk");
      expect(waivedProps.map((p: Doc) => p.value)).toEqual([oscalUuid("Risk", riskId)]);
    });

    it("the Self-Assessment is a separate result, observations only, credited to the System owner, and survives a later edit by another user", async () => {
      const uuids = () => selfResult().observations.map((o: Doc) => o.uuid).sort();
      expect(results().results).toHaveLength(2);
      expect(selfResult().title).toBe("System Owner self-assessment");
      expect(selfResult().description).toContain("as recorded when this document was made");
      expect(selfResult().findings).toBeUndefined();
      expect(uuids()).toEqual(selfAssessmentIds.map((id) => oscalUuid("Observation", "self-assessment", id)).sort());
      const auditUuids = new Set((auditResult().observations as Doc[]).map((o) => o.uuid));
      expect(uuids().some((u: string) => auditUuids.has(u))).toBe(false);
      const author = (o: Doc) => o.origins[0].actors[0]["actor-uuid"];
      expect(selfResult().observations.map(author)).toEqual([oscalUuid("User", s.systemOwner), oscalUuid("User", s.systemOwner)]);

      // A later edit of the Assessment (author and time overwritten by someone else, after the close) changes neither.
      await prisma.controlAssessment.update({ where: { id: selfAssessmentIds[0] }, data: { assessedById: s.roleUser.RISK_OWNER, assessedAt: new Date(Date.now() + 60_000) } });
      const again = await loadOscalPackage(s.systemId, admin);
      if (again.kind !== "ok" || !("assessmentResults" in again.pkg)) throw new Error("expected a package");
      expect(validateOscalPackage(again.pkg)).toEqual([]);
      const self = (again.pkg.assessmentResults as Doc)["assessment-results"].results[1] as Doc;
      expect(self.observations.map((o: Doc) => o.uuid).sort()).toEqual(uuids());
      expect(self.observations.map(author)).toEqual([oscalUuid("User", s.systemOwner), oscalUuid("User", s.systemOwner)]);
      expect(JSON.stringify(self)).not.toContain(oscalUuid("User", s.roleUser.RISK_OWNER));
    });

    it("the same audit gives the same identifiers on every export", async () => {
      const again = await loadOscalPackage(s.systemId, admin);
      if (again.kind !== "ok" || !("assessmentResults" in again.pkg)) throw new Error("expected a package");
      const ids = (p: Doc) => JSON.stringify(p, (k, v) => (k === "uuid" && typeof v === "string" ? v : v), 0).match(/"uuid":"[^"]+"/g)!.slice(1);
      expect(ids(again.pkg.assessmentResults as Doc)).toEqual(ids(pkg.assessmentResults as Doc));
    });

    it("closing made one release, with the audit-close trigger, whose zip holds the plan and results and lists them in the manifest", async () => {
      const releases = await prisma.oscalRelease.findMany({ where: { systemId: s.systemId } });
      expect(releases).toHaveLength(1);
      const [release] = releases;
      expect(release.trigger).toBe("INTERNAL_AUDIT_CLOSE");
      expect(release.internalAuditId).toBe(s.auditId);
      expect(release.createdById).toBe(s.roleUser.INTERNAL_AUDITOR);
      const files = unzipSync(new Uint8Array(release.data));
      expect(Object.keys(files).sort()).toEqual(["assessment-plan.json", "assessment-results.json", "catalog.json", "manifest.json", "poam.json", "profile.json", "ssp.json"]);
      const doc = (name: string) => JSON.parse(strFromU8(files[name])) as Doc;
      const manifest = doc("manifest.json") as OscalReleaseManifest;
      expect(manifest.files.map((f) => f.name).sort()).toEqual(["assessment-plan.json", "assessment-results.json", "catalog.json", "poam.json", "profile.json", "ssp.json"]);
      expect(doc("assessment-plan.json")["assessment-plan"]["import-ssp"].href).toBe("ssp.json");
      expect(doc("assessment-plan.json")["assessment-plan"].metadata.version).toBe("1");
      expect(validateOscalPackage({ catalog: doc("catalog.json"), profile: doc("profile.json"), ssp: doc("ssp.json"), assessmentPlan: doc("assessment-plan.json"), assessmentResults: doc("assessment-results.json"), poam: doc("poam.json") })).toEqual([]);
    });

    it("a manual release afterwards includes the most recent closed audit too", async () => {
      const made = await createOscalRelease({ systemId: s.systemId, actorId: s.systemOwner, trigger: "MANUAL" });
      if (made.kind !== "ok") throw new Error("expected a release");
      const stored = await prisma.oscalRelease.findUniqueOrThrow({ where: { id: made.release.id } });
      expect(Object.keys(unzipSync(new Uint8Array(stored.data)))).toContain("assessment-results.json");
    });

    it("the download of a System with a closed audit holds the six documents", async () => {
      const response = await downloadRoute(requestAs(`/api/systems/${s.systemId}/oscal-package`, admin.id, "GET"), idCtx(s.systemId));
      expect(Object.keys(unzipSync(new Uint8Array(await response.arrayBuffer()))).sort()).toEqual(["assessment-plan.json", "assessment-results.json", "catalog.json", "poam.json", "profile.json", "ssp.json"]);
    });

    describe("the validator's reference checks", () => {
      const broken = (edit: (p: typeof pkg) => void) => {
        const copy = clone(pkg);
        edit(copy);
        return validateOscalPackage(copy);
      };
      const ar = (p: typeof pkg) => (p.assessmentResults as Doc)["assessment-results"] as Doc;
      it("rejects an import-ssp that is not the package's ssp.json, and an import-ap that is not its plan", () => {
        expect(broken((p) => ((p.assessmentPlan as Doc)["assessment-plan"]["import-ssp"].href = "https://example.com/ssp.json")).map((e) => e.path)).toContain("/assessment-plan/import-ssp/href");
        expect(broken((p) => (ar(p)["import-ap"].href = "other.json")).map((e) => e.path)).toContain("/assessment-results/import-ap/href");
      });
      it("rejects a finding that targets a statement the Catalog lacks, or a control the result did not review", () => {
        expect(broken((p) => (ar(p).results[0].findings[0].target["target-id"] = "NOPE_smt")).map((e) => e.message)).toContain('statement "NOPE_smt" is not in the Catalog');
        const other = (pkg.catalog as Doc).catalog.controls.find((c: Doc) => !JSON.stringify(ar(pkg)).includes(`"${c.id}"`));
        if (other) {
          const errors = broken((p) => (ar(p).results[0].findings[0].target["target-id"] = `${other.id}_smt`));
          expect(errors.map((e) => e.message).join("\n")).toContain("did not review");
        }
      });
      it("rejects an unresolved related-observation, related-risk and actor", () => {
        const ghost = "00000000-0000-4000-8000-000000000000";
        const errors = broken((p) => {
          const f = ar(p).results[0].findings.find((x: Doc) => x["related-risks"]);
          f["related-observations"].push({ "observation-uuid": ghost });
          f["related-risks"].push({ "risk-uuid": ghost });
          f.origins[0].actors[0]["actor-uuid"] = ghost;
        });
        expect(errors.map((e) => e.message).join("\n")).toMatch(/party .* is not defined[\s\S]*observation .* is not in this result[\s\S]*risk .* is not in this result/);
      });
      it("rejects an SSP Waived Risk the results do not hold", () => {
        const errors = broken((p) => {
          ar(p).results[0].risks = undefined;
          for (const f of ar(p).results[0].findings) delete f["related-risks"];
        });
        expect(errors.filter((e) => e.document === "ssp").map((e) => e.message)).toEqual([expect.stringContaining("Waived Control's Risk")]);
      });
      it("rejects a subject that is not an SSP component and an activity the plan does not define", () => {
        const errors = broken((p) => {
          const planDoc = (p.assessmentPlan as Doc)["assessment-plan"];
          planDoc["assessment-subjects"][0]["include-subjects"][0]["subject-uuid"] = "00000000-0000-4000-8000-000000000000";
          planDoc.tasks[0]["associated-activities"][0]["activity-uuid"] = "00000000-0000-4000-8000-000000000001";
        });
        expect(errors.map((e) => e.message).join("\n")).toMatch(/component .* is not defined in the SSP[\s\S]*activity .* is not defined in the plan/);
      });
      it("rejects a document that breaks the schema", () => {
        expect(broken((p) => delete (p.assessmentPlan as Doc)["assessment-plan"]["import-ssp"]).some((e) => e.layer === "schema" && e.document === "assessment-plan")).toBe(true);
      });
      it("rejects Assessment Results with no Assessment Plan in the package", () => {
        const copy = clone(pkg) as Partial<typeof pkg>;
        delete copy.assessmentPlan;
        expect(validateOscalPackage(copy as OscalPackage).map((e) => e.path)).toContain("/assessment-results/import-ap/href");
      });
    });
  });

  describe("a failing release does not undo closing the audit", () => {
    it("closes anyway, makes no release, and leaves the owner able to make one by hand", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      failure.on = true;
      const checkUp = t.find(t.systemControls[0].code);
      await t.answer(checkUp.id, t.systemOwner);
      expect((await evaluate(checkUp.id, t.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" })).status).toBe(201);
      const response = await close(t);
      failure.on = false;
      expect(response.status).toBe(200);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(t.systemId), expect.any(Error));
      error.mockRestore();
      expect((await prisma.internalAudit.findUniqueOrThrow({ where: { id: t.auditId } })).status).toBe("CLOSED");
      expect(await prisma.oscalRelease.count({ where: { systemId: t.systemId } })).toBe(0);
      const made = await createOscalRelease({ systemId: t.systemId, actorId: t.systemOwner, trigger: "INTERNAL_AUDIT_CLOSE", internalAuditId: t.auditId });
      expect(made.kind).toBe("ok");
    });
  });
});

/** The number of Check-up questions the System's Check-ups in the audit hold. */
async function await_count(scenario: { auditId: string; systemId: string }): Promise<number> {
  return prisma.checkUpQuestion.count({ where: { checkUp: { internalAuditId: scenario.auditId, systemId: scenario.systemId } } });
}
