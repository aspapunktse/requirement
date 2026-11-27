// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { prisma } from "@/lib/prisma";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { oscalUuid } from "@/lib/oscal/ids";
import { loadOscalPackage, OSCAL_APP_NS } from "@/lib/oscal/package-builder";
import { validateOscalPackage, type OscalPackage } from "@/lib/oscal/validate";
import { createOscalRelease, type OscalReleaseManifest } from "@/lib/oscal/releases";
import { packageFileBytes } from "@/lib/oscal/package-zip";
import { POST as postClose } from "@/app/api/internal-audits/[id]/close/route";
import { POST as postEvaluation } from "@/app/api/check-ups/[id]/evaluation/route";
import { PATCH as patchRisk } from "@/app/api/systems/[id]/risks/[riskId]/route";
import { POST as postMilestone } from "@/app/api/systems/[id]/risks/[riskId]/milestones/route";
import { PATCH as patchMilestone } from "@/app/api/systems/[id]/risks/[riskId]/milestones/[milestoneId]/route";

/**
 * The POA&M of a System (#456), against real Postgres. Fixtures only (`Test 456...`, via `createCheckUpScenario`): a System with a
 * Conforming and a Nonconformity Check-up whose Risk is also the Waived Control's Risk. That Risk gets a deadline, two milestones and
 * its status changed through the real routes (created Open, Accepted, Open again: three history rows).
 */
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("OSCAL POA&M (#456)", { timeout: 120_000 }, () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let admin: { id: string; role: "ADMIN" };
  let riskId = "";
  let checkUpId = "";
  let milestoneIds: string[] = [];
  const riskOwner = () => s.roleUser.RISK_OWNER;
  const patch = (userId: string, body: unknown, id = riskId) =>
    patchRisk(requestAs(`/api/systems/${s.systemId}/risks/${id}`, userId, "PATCH", body), { params: Promise.resolve({ id: s.systemId, riskId: id }) } as never);
  const addMilestone = (userId: string, body: unknown) =>
    postMilestone(requestAs(`/api/systems/${s.systemId}/risks/${riskId}/milestones`, userId, "POST", body), { params: Promise.resolve({ id: s.systemId, riskId }) } as never);
  const history = (id = riskId) => prisma.statusChange.findMany({ where: { subjectType: "RISK", subjectId: id }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });
  const poamOf = (pkg: OscalPackage) => (pkg.poam as Doc)["plan-of-action-and-milestones"] as Doc;
  const load = async () => {
    const result = await loadOscalPackage(s.systemId, admin);
    if (result.kind !== "ok") throw new Error("expected a package");
    return result.pkg;
  };

  beforeAll(async () => {
    s = await createCheckUpScenario("456a", { systemControls: 2, organizationControls: 0 });
    admin = { id: s.roleUser.ADMIN, role: "ADMIN" };
    const auditor = s.roleUser.INTERNAL_AUDITOR;
    const [conforming, nonconformity] = s.systemControls.map((c) => s.find(c.code));
    checkUpId = nonconformity.id;
    const waived = await prisma.controlAssessment.create({
      data: { systemId: s.systemId, controlId: s.systemControls[1].id, status: "WAIVED", notes: "Accepted for now.", assessedById: riskOwner(), assessedAt: new Date() },
    });
    await s.answer(conforming.id, s.systemOwner);
    await s.answer(nonconformity.id, s.systemOwner);
    const evaluate = (id: string, body: unknown) => postEvaluation(requestAs(`/api/check-ups/${id}/evaluation`, auditor, "POST", body), idCtx(id));
    expect((await evaluate(conforming.id, { outcome: "CONFORMING" })).status).toBe(201);
    expect((await evaluate(nonconformity.id, { outcome: "NONCONFORMITY", comment: "No review took place." })).status).toBe(201);
    expect((await postClose(requestAs(`/api/internal-audits/${s.auditId}/close`, auditor, "POST"), idCtx(s.auditId))).status).toBe(200);
    const risk = await prisma.risk.findUniqueOrThrow({ where: { checkUpId: nonconformity.id } });
    riskId = risk.id;
    await prisma.risk.update({ where: { id: risk.id }, data: { controlAssessmentId: waived.id } });

    // Three status changes through the real route: created Open (by the nonconformity), Accepted with a deadline, Open again.
    expect((await patch(riskOwner(), { status: "ACCEPTED", mitigationPlan: "Reviewed quarterly.", deadline: "2027-03-31" })).status).toBe(200);
    expect((await patch(riskOwner(), { status: "OPEN" })).status).toBe(200);
    for (const [title, plannedDate] of [["Write the review procedure", "2027-01-15"], ["Hold the first review", "2027-02-15"]]) {
      const response = await addMilestone(riskOwner(), { title, plannedDate });
      expect(response.status).toBe(201);
    }
    milestoneIds = (await prisma.riskMilestone.findMany({ where: { riskId }, orderBy: { plannedDate: "asc" } })).map((m) => m.id);
    const done = await patchMilestone(
      requestAs(`/api/systems/${s.systemId}/risks/${riskId}/milestones/${milestoneIds[0]}`, riskOwner(), "PATCH", { completedDate: new Date().toISOString().slice(0, 10) }),
      { params: Promise.resolve({ id: s.systemId, riskId, milestoneId: milestoneIds[0] }) } as never,
    );
    expect(done?.status).toBe(200);
    // Risks that are not open work: never POA&M items.
    for (const status of ["MITIGATED", "CLOSED", "TRANSFERRED"] as const) {
      await prisma.risk.create({ data: { systemId: s.systemId, title: `Test 456 ${status} ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW", status, mitigationPlan: status === "MITIGATED" ? "Done." : null } });
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.statusChange.deleteMany({ where: { systemId: s.systemId } });
    await s.cleanup();
  }, 60_000);

  it("keeps the three status changes of the Risk in order, with who made them", async () => {
    const rows = await history();
    expect(rows.map((r) => [r.fromStatus, r.toStatus])).toEqual([[null, "OPEN"], ["OPEN", "ACCEPTED"], ["ACCEPTED", "OPEN"]]);
    expect(rows.map((r) => r.actorId)).toEqual([s.roleUser.INTERNAL_AUDITOR, riskOwner(), riskOwner()]);
    expect(rows.every((r) => r.systemId === s.systemId)).toBe(true);
  });

  it("makes one item from the open Risk, with deadline, milestones, risk log, finding and a document that validates with no errors", async () => {
    const pkg = await load();
    const doc = poamOf(pkg);
    expect(doc["poam-items"]).toHaveLength(1);
    expect(doc["import-ssp"].href).toBe("ssp.json");
    expect(doc["system-id"].id).toBe(oscalUuid("System", s.systemId));
    expect(doc.metadata["document-ids"]).toHaveLength(1);
    const [risk] = doc.risks as Doc[];
    expect(risk.uuid).toBe(oscalUuid("Risk", riskId));
    expect(risk.status).toBe("open");
    expect(risk.deadline).toBe("2027-03-31T23:59:59Z");
    expect(risk["risk-log"].entries.map((e: Doc) => e["status-change"])).toEqual(["open", "deviation-approved", "open"]);
    expect(risk["risk-log"].entries.map((e: Doc) => e.start)).toEqual([...risk["risk-log"].entries.map((e: Doc) => e.start)].sort());
    expect(risk["risk-log"].entries[0]["logged-by"]).toHaveLength(1);
    const [remediation] = risk.remediations as Doc[];
    expect(remediation.uuid).toBe(oscalUuid("Remediation", riskId));
    expect(remediation.lifecycle).toBe("planned");
    expect(remediation.tasks.map((t: Doc) => [t.type, t.timing["on-date"].date])).toEqual([["milestone", "2027-01-15T23:59:59Z"], ["milestone", "2027-02-15T23:59:59Z"]]);
    expect(remediation.tasks[0].props.find((p: Doc) => p.name === "completed-date")).toBeTruthy();
    const item = doc["poam-items"][0] as Doc;
    expect(item["related-risks"]).toEqual([{ "risk-uuid": oscalUuid("Risk", riskId) }]);
    expect(item["related-findings"]).toEqual([{ "finding-uuid": oscalUuid("Finding", checkUpId) }]);
    expect((doc.findings as Doc[]).map((f) => f.uuid)).toEqual([oscalUuid("Finding", checkUpId)]);
    expect(validateOscalPackage(pkg)).toEqual([]);
  });

  it("leaves Mitigated, Closed and Transferred Risks out", async () => {
    const doc = poamOf(await load());
    expect(doc.risks).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("Test 456 MITIGATED");
    expect(JSON.stringify(doc)).not.toContain("Test 456 CLOSED");
    expect(JSON.stringify(doc)).not.toContain("Test 456 TRANSFERRED");
  });

  it("uses the same Risk uuid in the SSP, the Assessment Results and the POA&M", async () => {
    const pkg = await load();
    const expected = oscalUuid("Risk", riskId);
    const ssp = JSON.stringify(pkg.ssp);
    expect(ssp).toContain(`"name":"risk","ns":"${OSCAL_APP_NS}","value":"${expected}"`);
    const ar = (pkg.assessmentResults as Doc)["assessment-results"].results[0].risks as Doc[];
    expect(ar.map((r) => r.uuid)).toContain(expected);
    expect(poamOf(pkg).risks.map((r: Doc) => r.uuid)).toEqual([expected]);
    // The same status in both documents.
    expect(ar.find((r) => r.uuid === expected)!.status).toBe(poamOf(pkg).risks[0].status);
  });

  it("rejects a POA&M whose references or Risk status are broken", async () => {
    const broken = async (edit: (p: Doc) => void) => {
      const pkg = JSON.parse(JSON.stringify(await load())) as OscalPackage;
      edit(poamOf(pkg));
      return validateOscalPackage(pkg).map((e) => e.message);
    };
    const ghost = "00000000-0000-4000-8000-000000000000";
    expect((await broken((p) => (p["import-ssp"].href = "other.json"))).join("\n")).toContain("does not resolve to ssp.json");
    expect((await broken((p) => (p["system-id"].id = ghost))).join("\n")).toContain("is not a system id of the SSP");
    expect((await broken((p) => p["poam-items"][0]["related-risks"].push({ "risk-uuid": ghost }))).join("\n")).toContain(`risk "${ghost}" is not defined`);
    expect((await broken((p) => p["poam-items"][0]["related-findings"].push({ "finding-uuid": ghost }))).join("\n")).toContain(`finding "${ghost}" is not defined`);
    expect((await broken((p) => (p.risks[0]["risk-log"].entries[0]["logged-by"][0]["party-uuid"] = ghost))).join("\n")).toContain(`party "${ghost}" is not defined`);
    expect((await broken((p) => (p.risks[0].status = "closed"))).join("\n")).toContain(`in the Assessment Results`);
    expect((await broken((p) => delete p["poam-items"])).join("\n")).toContain("poam-items");
  });

  it("is part of every OSCAL Release and of the download, and an older release is not rewritten", async () => {
    const first = await createOscalRelease({ systemId: s.systemId, actorId: s.roleUser.ADMIN, trigger: "MANUAL" });
    if (first.kind !== "ok") throw new Error("expected a release");
    const stored = await prisma.oscalRelease.findUniqueOrThrow({ where: { id: first.release.id } });
    const before = Buffer.from(stored.data).toString("base64");
    const files = unzipSync(new Uint8Array(stored.data));
    expect(Object.keys(files)).toContain("poam.json");
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as OscalReleaseManifest;
    expect(manifest.files.map((f) => f.name)).toContain("poam.json");
    expect(JSON.parse(strFromU8(files["poam.json"]))["plan-of-action-and-milestones"].metadata.version).toBe(String(first.release.number));
    expect(Object.keys(packageFileBytes(await load()))).toContain("poam.json");
    // Another release leaves the first one's bytes alone.
    await createOscalRelease({ systemId: s.systemId, actorId: s.roleUser.ADMIN, trigger: "MANUAL" });
    const again = await prisma.oscalRelease.findUniqueOrThrow({ where: { id: first.release.id } });
    expect(Buffer.from(again.data).toString("base64")).toBe(before);
  });

  it("completed lifecycle once every milestone is done, and no item once the Risk is no longer open", async () => {
    const done = await patchMilestone(
      requestAs(`/api/systems/${s.systemId}/risks/${riskId}/milestones/${milestoneIds[1]}`, riskOwner(), "PATCH", { completedDate: new Date().toISOString().slice(0, 10) }),
      { params: Promise.resolve({ id: s.systemId, riskId, milestoneId: milestoneIds[1] }) } as never,
    );
    expect(done?.status).toBe(200);
    expect(poamOf(await load()).risks[0].remediations[0].lifecycle).toBe("completed");
    expect((await patch(riskOwner(), { status: "MITIGATED", mitigationPlan: "Procedure in place." })).status).toBe(200);
    expect((await load()).poam).toBeUndefined();
    expect((await history()).map((r) => r.toStatus)).toEqual(["OPEN", "ACCEPTED", "OPEN", "MITIGATED"]);
  });

  it("refuses a milestone and a status change from a role that may not manage the Risk, changing nothing", async () => {
    const rowsBefore = (await history()).length;
    const milestonesBefore = await prisma.riskMilestone.count({ where: { riskId } });
    const denied = await addMilestone(s.systemOwner, { title: "Not mine", plannedDate: "2027-05-01" });
    expect([401, 403]).toContain(denied.status);
    const deniedPatch = await patch(s.roleUser.RISK_FACILITATOR, { status: "CLOSED" });
    expect(deniedPatch.status).toBe(403);
    const invalid = await addMilestone(riskOwner(), { title: "", plannedDate: "not-a-date" });
    expect(invalid.status).toBe(400);
    expect((await history()).length).toBe(rowsBefore);
    expect(await prisma.riskMilestone.count({ where: { riskId } })).toBe(milestonesBefore);
    expect((await prisma.risk.findUniqueOrThrow({ where: { id: riskId } })).status).toBe("MITIGATED");
  });
});
