import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { canRecordRiskAnalysis, hasCompletedRiskAnalysisSince } from "@/lib/risk-analysis";

const suffix = `${process.pid}-${Date.now()}`;
let ownerId: string;
let systemId: string;
let emptySystemId: string;
let otherSystemId: string;

const T = new Date("2026-06-01T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { email: `test-ra-lib-${suffix}@example.com`, name: "Test RA Lib Owner", role: "SYSTEM_OWNER" } })).id;
  const make = async (label: string) => (await prisma.system.create({ data: { name: `Test RA Lib ${label} ${suffix}`, ownerId, status: "DRAFT" } })).id;
  systemId = await make("main");
  emptySystemId = await make("empty");
  otherSystemId = await make("other");
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: [systemId, emptySystemId, otherSystemId] } } });
  await prisma.user.delete({ where: { id: ownerId } });
});

describe("canRecordRiskAnalysis (#325)", () => {
  const system = { ownerId: "owner-1" };
  it("allows a Risk Owner or an Admin who isn't the System's owner", () => {
    expect(canRecordRiskAnalysis({ id: "u", role: "RISK_OWNER" }, system)).toBe(true);
    expect(canRecordRiskAnalysis({ id: "u", role: "ADMIN" }, system)).toBe(true);
  });
  it("refuses the System's owner, an Admin or Risk Owner included", () => {
    expect(canRecordRiskAnalysis({ id: "owner-1", role: "ADMIN" }, system)).toBe(false);
    expect(canRecordRiskAnalysis({ id: "owner-1", role: "RISK_OWNER" }, system)).toBe(false);
    expect(canRecordRiskAnalysis({ id: "owner-1", role: "SYSTEM_OWNER" }, system)).toBe(false);
  });
  it("refuses every other role", () => {
    for (const role of ["SYSTEM_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"] as const) {
      expect(canRecordRiskAnalysis({ id: "u", role }, system)).toBe(false);
    }
  });
});

describe("hasCompletedRiskAnalysisSince (#325)", () => {
  const record = (sid: string, completedAt: Date | null) =>
    prisma.riskAnalysis.create({ data: { systemId: sid, heldOn: new Date("2026-05-01T00:00:00.000Z"), completedAt } });

  it("is false for a System with no Risk Analysis", async () => {
    expect(await hasCompletedRiskAnalysisSince(prisma, emptySystemId, T)).toBe(false);
  });

  it("is false for one that isn't completed, however recent", async () => {
    await record(systemId, null);
    expect(await hasCompletedRiskAnalysisSince(prisma, systemId, T)).toBe(false);
  });

  it("is false for one completed before T", async () => {
    await record(systemId, at("2026-05-31T23:59:59.999Z"));
    expect(await hasCompletedRiskAnalysisSince(prisma, systemId, T)).toBe(false);
  });

  it("is true for one completed at T or after it", async () => {
    const created = await record(systemId, T);
    expect(await hasCompletedRiskAnalysisSince(prisma, systemId, T)).toBe(true);
    await prisma.riskAnalysis.update({ where: { id: created.id }, data: { completedAt: at("2026-07-01T00:00:00.000Z") } });
    expect(await hasCompletedRiskAnalysisSince(prisma, systemId, T)).toBe(true);
    // ...but not since a later moment.
    expect(await hasCompletedRiskAnalysisSince(prisma, systemId, at("2026-07-02T00:00:00.000Z"))).toBe(false);
  });

  it("looks only at the System asked about", async () => {
    await record(otherSystemId, at("2026-08-01T00:00:00.000Z"));
    expect(await hasCompletedRiskAnalysisSince(prisma, emptySystemId, T)).toBe(false);
    expect(await hasCompletedRiskAnalysisSince(prisma, otherSystemId, T)).toBe(true);
  });

  it("can be given a transaction client", async () => {
    const result = await prisma.$transaction((tx) => hasCompletedRiskAnalysisSince(tx, otherSystemId, T));
    expect(result).toBe(true);
  });
});
