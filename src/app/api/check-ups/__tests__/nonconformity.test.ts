import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { evaluateCheckUp, sideEffects } from "@/lib/check-up-evaluations";
import { getComplianceForSystems } from "@/lib/compliance";
import { loadEffectiveStatus, toOwnAssessment } from "@/lib/effective-status-data";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * What a Nonconformity does (#157): opens a Risk linked to the Check-up and sets a Fulfilled target
 * back to In Progress, in the evaluation's transaction. Fixtures only (CI's database is migrated,
 * not seeded); every name and code carries this run's suffix.
 */

describe("Nonconformity side effects (#157)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const auditor = () => ({ id: s.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" as const });
  const [BOTH_ORG, BOTH_OWN_NULL, BOTH_OWN_PERSON, BOTH_INHERITED, BOTH_PROVIDER] = [0, 1, 2, 3, 4];
  const created: { offerings: string[]; dependencies: string[] } = { offerings: [], dependencies: [] };

  /** Answers the Check-up as its recipient and evaluates it as the Internal Auditor. */
  async function evaluate(controlCode: string, organization: boolean, outcome: "CONFORMING" | "OBSERVATION" | "NONCONFORMITY", comment = "The control does not work") {
    const checkUp = s.find(controlCode, organization);
    await s.answer(checkUp.id, organization ? s.controlOwner : s.systemOwner);
    await evaluateCheckUp(checkUp.id, auditor(), { outcome, comment });
    return checkUp;
  }
  const control = (list: { id: string; code: string }[], index: number) => list[index];
  const both = (index: number) => control(s.bothControls, index);

  const setAssessment = (systemId: string, controlId: string, status: ControlAssessmentStatus, assessedById: string | null, notes: string | null = null) =>
    prisma.controlAssessment.upsert({
      where: { systemId_controlId: { systemId, controlId } },
      create: { systemId, controlId, status, assessedById, notes },
      update: { status, assessedById, notes },
    });
  const setImplementation = (controlId: string, status: ControlAssessmentStatus, description: string | null = null) =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId },
      create: { controlId, status, description, updatedById: s.controlOwner },
      update: { status, description, updatedById: s.controlOwner },
    });
  const row = (systemId: string, controlId: string) => prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId, controlId } } });
  const implementation = (controlId: string) => prisma.organizationControlImplementation.findUnique({ where: { controlId } });
  const effective = async (systemId: string, controlId: string) => {
    const own = await row(systemId, controlId);
    return loadEffectiveStatus(systemId, { id: controlId, applicability: "BOTH" }, own ? toOwnAssessment(own) : null, prisma);
  };
  const riskOf = (checkUpId: string) => prisma.risk.findUnique({ where: { checkUpId } });
  const systemEvents = (systemId: string, extra: object = {}) => prisma.changeEvent.findMany({ where: { systemId, ...extra }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    s = await createCheckUpScenario("157", { systemControls: 12, organizationControls: 8, bothControls: 5, extraSystems: 3 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.providerDependency.deleteMany({ where: { id: { in: created.dependencies } } });
    await prisma.controlOffering.deleteMany({ where: { id: { in: created.offerings } } });
    await prisma.organizationControlImplementation.deleteMany({
      where: { controlId: { in: [...s.organizationControls, ...s.bothControls].map((c) => c.id) } },
    });
    await s.cleanup();
  });

  it("launched what the tests below expect", () => {
    expect(s.checkUps.filter((c) => c.target.kind === "organization")).toHaveLength(13);
    expect(s.checkUps.filter((c) => c.target.kind === "system")).toHaveLength(17);
  });

  describe("a System-level Nonconformity", () => {
    it("sets a Fulfilled Control Assessment back to In Progress, opens a Risk on the System linked to the Check-up and logs a system event", async () => {
      const code = s.systemControls[0];
      await setAssessment(s.systemId, code.id, "FULFILLED", s.systemOwner, "Owner's own note");
      const checkUp = await evaluate(code.code, false, "NONCONFORMITY", "No evidence of operation");

      const after = await row(s.systemId, code.id);
      expect(after).toMatchObject({ status: "IN_PROGRESS", assessedById: s.systemOwner });
      // Appended, never overwritten, and linked to the finding.
      expect(after!.notes).toContain("Owner's own note");
      expect(after!.notes).toContain(`/check-ups/${checkUp.id}`);

      const risk = await riskOf(checkUp.id);
      expect(risk).toMatchObject({ systemId: s.systemId, status: "OPEN", severity: "MEDIUM", likelihood: "MEDIUM", ownerId: null, controlAssessmentId: null });
      expect(risk!.title).toContain(code.code);
      expect(risk!.description).toContain("No evidence of operation");
      expect(risk!.description).toContain("set back to In Progress");

      const events = await systemEvents(s.systemId, { actorId: SYSTEM_ACTOR });
      const statusEvent = events.find((e) => e.action === "ASSESSMENT_STATUS_CHANGED" && e.detail.includes(code.code));
      expect(statusEvent!.detail).toContain("FULFILLED to IN_PROGRESS");
      expect(statusEvent!.detail).toContain(`/check-ups/${checkUp.id}`);
      expect(events.some((e) => e.action === "RISK_STATUS_CHANGED" && e.detail.includes(code.code))).toBe(true);
    });

    it("caps what it copies of a long comment into the Risk", async () => {
      const code = s.systemControls[1];
      const checkUp = await evaluate(code.code, false, "NONCONFORMITY", "x".repeat(2000));
      expect((await riskOf(checkUp.id))!.description.length).toBeLessThan(1000);
    });

    it.each<[ControlAssessmentStatus, number]>([["IN_PROGRESS", 2], ["WAIVED", 3], ["NOT_APPLICABLE", 4], ["NOT_STARTED", 5]])(
      "leaves a %s Control Assessment as it is and still opens the Risk",
      async (status, index) => {
        const code = s.systemControls[index];
        await setAssessment(s.systemId, code.id, status, s.systemOwner, "Keep me");
        const before = await row(s.systemId, code.id);
        const eventsBefore = await systemEvents(s.systemId, { action: "ASSESSMENT_STATUS_CHANGED" });

        const checkUp = await evaluate(code.code, false, "NONCONFORMITY");

        expect(await row(s.systemId, code.id)).toEqual(before);
        expect(await systemEvents(s.systemId, { action: "ASSESSMENT_STATUS_CHANGED" })).toEqual(eventsBefore);
        const risk = await riskOf(checkUp.id);
        expect(risk).toMatchObject({ systemId: s.systemId });
        expect(risk!.description).toContain("Not changed");
      },
    );

    it("opens the Risk and writes no Assessment when the System has no row at all", async () => {
      const code = s.systemControls[6];
      const checkUp = await evaluate(code.code, false, "NONCONFORMITY");
      expect(await row(s.systemId, code.id)).toBeNull();
      expect(await riskOf(checkUp.id)).toMatchObject({ systemId: s.systemId });
    });
  });

  describe("a System that had Fulfilled the Control itself (acceptance criterion 4)", () => {
    it("is effectively In Progress after the set-back and stays so, with a Fulfilled Organization source", async () => {
      const bothControl = both(BOTH_OWN_PERSON);
      await setImplementation(bothControl.id, "FULFILLED");
      await setAssessment(s.systemId, bothControl.id, "FULFILLED", s.systemOwner);
      expect((await effective(s.systemId, bothControl.id)).status).toBe("FULFILLED");

      await evaluate(bothControl.code, false, "NONCONFORMITY");

      expect(await row(s.systemId, bothControl.id)).toMatchObject({ status: "IN_PROGRESS", assessedById: s.systemOwner });
      const afterwards = await effective(s.systemId, bothControl.id);
      expect(afterwards).toMatchObject({ status: "IN_PROGRESS", source: { kind: "SYSTEM" }, overridesInherited: true });
      // The Organization's own implementation is untouched by a System-level finding.
      expect((await implementation(bothControl.id))!.status).toBe("FULFILLED");
      // Re-granting the source changes nothing either: the System's own status keeps overriding it.
      await setImplementation(bothControl.id, "IN_PROGRESS");
      await setImplementation(bothControl.id, "FULFILLED");
      expect((await effective(s.systemId, bothControl.id)).status).toBe("IN_PROGRESS");
    });

    it("is effectively In Progress too when its Fulfilled row was nobody's work (assessedById null, as a migration left it)", async () => {
      const bothControl = both(BOTH_OWN_NULL);
      await setImplementation(bothControl.id, "FULFILLED");
      await setAssessment(s.systemId, bothControl.id, "FULFILLED", null);

      await evaluate(bothControl.code, false, "NONCONFORMITY");

      // Kept person-set: attributed to the Internal Auditor whose finding it is, so it can't fall back to the source.
      const stored = await row(s.systemId, bothControl.id);
      expect(stored).toMatchObject({ status: "IN_PROGRESS", assessedById: s.roleUser.INTERNAL_AUDITOR });
      expect(stored!.assessedAt).not.toBeNull();
      expect(await effective(s.systemId, bothControl.id)).toMatchObject({ status: "IN_PROGRESS", source: { kind: "SYSTEM" } });
      // And it is not "untouched" any more, so a recompute never removes it.
      expect(stored).not.toMatchObject({ status: "NOT_STARTED", assessedById: null });
    });

    it("does nothing to a System that is Fulfilled only through inheritance, and says so in the Risk", async () => {
      const bothControl = both(BOTH_INHERITED);
      await setImplementation(bothControl.id, "FULFILLED");
      expect(await row(s.systemId, bothControl.id)).toBeNull();
      expect((await effective(s.systemId, bothControl.id)).status).toBe("FULFILLED");

      const checkUp = await evaluate(bothControl.code, false, "NONCONFORMITY");

      // Nothing written, no event, and the System stays effectively Fulfilled (the issue's wording: the stored status decides).
      expect(await row(s.systemId, bothControl.id)).toBeNull();
      expect((await effective(s.systemId, bothControl.id)).status).toBe("FULFILLED");
      expect(await systemEvents(s.systemId, { action: "ASSESSMENT_STATUS_CHANGED", detail: { contains: bothControl.code } })).toEqual([]);
      const risk = await riskOf(checkUp.id);
      expect(risk).toMatchObject({ systemId: s.systemId });
      expect(risk!.description).toContain("inherited");
      expect(risk!.description).toContain("nothing to set back");
    });
  });

  describe("an Organization-level Nonconformity on a Both Control", () => {
    it("sets the Fulfilled implementation back, opens one System-less Risk, drops every inheriting System and logs system events only on those that moved", async () => {
      const bothControl = both(BOTH_ORG);
      const [x1, x2, x3] = s.extraSystemIds;
      await setImplementation(bothControl.id, "FULFILLED", "How we do it");
      // x2 overrides with its own person-set status; x3 has Fulfilled it itself; x1 and the audited System have no row.
      await setAssessment(x2, bothControl.id, "IN_PROGRESS", s.systemOwner);
      await setAssessment(x3, bothControl.id, "FULFILLED", s.systemOwner);
      // A requirement that only this Control satisfies, so the Compliance Percentage moves visibly.
      await mapControlsToFramework(s.frameworkId, [bothControl.id]);
      const systems = [s.systemId, x1, x2, x3];
      const before = Object.fromEntries(
        await Promise.all(systems.map(async (id) => [id, { status: (await effective(id, bothControl.id)).status, met: (await getComplianceForSystems({ id }, { frameworkId: s.frameworkId })).bySystem[0].met }] as const)),
      );
      expect(before[s.systemId].status).toBe("FULFILLED");
      expect(before[x1].status).toBe("FULFILLED");
      expect(before[x2].status).toBe("IN_PROGRESS");
      expect(before[x3].status).toBe("FULFILLED");
      const implementationBefore = await implementation(bothControl.id);

      const checkUp = await evaluate(bothControl.code, true, "NONCONFORMITY", "Org-wide gap");

      const saved = await implementation(bothControl.id);
      expect(saved!.status).toBe("IN_PROGRESS");
      // "Last updated by" is left as it was (no person edited it); the description keeps the owner's text and links the finding.
      expect(saved!.updatedById).toBe(implementationBefore!.updatedById);
      expect(saved!.description).toContain("How we do it");
      expect(saved!.description).toContain(`/check-ups/${checkUp.id}`);

      const risk = await riskOf(checkUp.id);
      expect(risk).toMatchObject({ systemId: null, status: "OPEN" });
      expect(risk!.description).toContain("Org-wide gap");
      expect(await prisma.risk.count({ where: { checkUpId: checkUp.id } })).toBe(1);

      // x1 and the audited System (no row) drop to Not Started: nothing gives credit any more and they did nothing themselves;
      // x3 (own Fulfilled) stays Fulfilled by itself; x2 was already In Progress.
      expect((await effective(s.systemId, bothControl.id)).status).toBe("NOT_STARTED");
      expect((await effective(x1, bothControl.id)).status).toBe("NOT_STARTED");
      expect((await effective(x2, bothControl.id)).status).toBe("IN_PROGRESS");
      expect((await effective(x3, bothControl.id)).status).toBe("FULFILLED");
      for (const id of [s.systemId, x1]) {
        const compliance = (await getComplianceForSystems({ id }, { frameworkId: s.frameworkId })).bySystem[0];
        expect(compliance.met).toBe(before[id].met - 1);
      }
      expect((await getComplianceForSystems({ id: x3 }, { frameworkId: s.frameworkId })).bySystem[0].met).toBe(before[x3].met);

      const eventFor = (id: string) => systemEvents(id, { action: "ASSESSMENT_STATUS_CHANGED", actorId: SYSTEM_ACTOR, detail: { contains: bothControl.code } });
      for (const id of [s.systemId, x1]) {
        const events = await eventFor(id);
        expect(events).toHaveLength(1);
        expect(events[0].detail).toContain("no longer inherited from the Organization");
      }
      expect(await eventFor(x2)).toEqual([]);
      expect(await eventFor(x3)).toEqual([]);
      // No System-less ORGANIZATION_IMPLEMENTATION_CHANGED for a Both Control, and the Risk's own event is System-less.
      expect(await prisma.changeEvent.count({ where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", detail: { contains: s.suffix } } })).toBe(0);
      const riskEvents = await prisma.changeEvent.findMany({ where: { action: "RISK_STATUS_CHANGED", systemId: null, detail: { contains: bothControl.code } } });
      expect(riskEvents).toHaveLength(1);
      expect(riskEvents[0].actorId).toBe(SYSTEM_ACTOR);
    });

    it("sets an Organizational Control's implementation back with the System-less event, attributed to the system, and none per System", async () => {
      const organizational = s.organizationControls[0];
      await setImplementation(organizational.id, "FULFILLED");
      const checkUp = await evaluate(organizational.code, true, "NONCONFORMITY");

      expect((await implementation(organizational.id))!.status).toBe("IN_PROGRESS");
      expect(await riskOf(checkUp.id)).toMatchObject({ systemId: null });
      const events = await prisma.changeEvent.findMany({ where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", detail: { contains: organizational.code } } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ systemId: null, actorId: SYSTEM_ACTOR });
      expect(await prisma.changeEvent.count({ where: { systemId: { in: [s.systemId, ...s.extraSystemIds] }, detail: { contains: organizational.code }, action: "ASSESSMENT_STATUS_CHANGED" } })).toBe(0);
    });

    it.each<[ControlAssessmentStatus | null, number]>([["IN_PROGRESS", 1], ["WAIVED", 2], [null, 3]])(
      "leaves a %s implementation as it is and still opens the one System-less Risk",
      async (status, index) => {
        const organizational = s.organizationControls[index];
        if (status === null) {
          // A Control whose implementation row is missing reads Not Started.
          await prisma.organizationControlImplementation.deleteMany({ where: { controlId: organizational.id } });
        } else {
          await setImplementation(organizational.id, status, "Waived because of X");
        }
        const before = await implementation(organizational.id);
        const eventsBefore = await prisma.changeEvent.count({ where: { detail: { contains: organizational.code }, action: { not: "RISK_STATUS_CHANGED" } } });

        const checkUp = await evaluate(organizational.code, true, "NONCONFORMITY");

        expect(await implementation(organizational.id)).toEqual(before);
        expect(await prisma.changeEvent.count({ where: { detail: { contains: organizational.code }, action: { not: "RISK_STATUS_CHANGED" } } })).toBe(eventsBefore + 1); // the evaluation's own event
        expect(await riskOf(checkUp.id)).toMatchObject({ systemId: null });
      },
    );
  });

  describe("a System-level Nonconformity on a Provider", () => {
    it("moves its dependents exactly as a person's change of the Provider's status does", async () => {
      const bothControl = both(BOTH_PROVIDER);
      const dependent = s.extraSystemIds[0];
      // The audited System is a Provider, Onboarded, offering the Control in full; the extra System depends on it.
      await prisma.system.update({ where: { id: s.systemId }, data: { isProvider: true, status: "ONBOARDED" } });
      const offering = await prisma.controlOffering.create({ data: { providerId: s.systemId, controlId: bothControl.id, type: "FULL" } });
      const dependency = await prisma.providerDependency.create({ data: { dependentId: dependent, providerId: s.systemId } });
      created.offerings.push(offering.id);
      created.dependencies.push(dependency.id);
      await setAssessment(s.systemId, bothControl.id, "FULFILLED", s.systemOwner);
      expect((await effective(dependent, bothControl.id)).status).toBe("FULFILLED");

      const checkUp = await evaluate(bothControl.code, false, "NONCONFORMITY");

      expect((await row(s.systemId, bothControl.id))!.status).toBe("IN_PROGRESS");
      expect((await effective(dependent, bothControl.id)).status).toBe("NOT_STARTED");
      const events = await systemEvents(dependent, { action: "ASSESSMENT_STATUS_CHANGED", actorId: SYSTEM_ACTOR, detail: { contains: bothControl.code } });
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain("no longer inherited from Provider");
      expect(await riskOf(checkUp.id)).toMatchObject({ systemId: s.systemId });
    });
  });

  describe("Conforming and Observation", () => {
    it.each(["CONFORMING", "OBSERVATION"] as const)("%s changes nothing and opens no Risk", async (outcome) => {
      const systemControl = s.systemControls[outcome === "CONFORMING" ? 7 : 8];
      const organizational = s.organizationControls[outcome === "CONFORMING" ? 4 : 5];
      await setAssessment(s.systemId, systemControl.id, "FULFILLED", s.systemOwner, "n");
      await setImplementation(organizational.id, "FULFILLED");
      const snapshot = async () =>
        JSON.parse(
          JSON.stringify({
            assessments: await prisma.controlAssessment.findMany({ where: { systemId: { in: [s.systemId, ...s.extraSystemIds] } }, orderBy: { id: "asc" } }),
            implementations: await prisma.organizationControlImplementation.findMany({ where: { controlId: { in: [organizational.id, systemControl.id] } }, orderBy: { id: "asc" } }),
            risks: await prisma.risk.count({ where: { OR: [{ system: { name: { endsWith: s.suffix } } }, { checkUp: { internalAuditId: s.auditId } }] } }),
            events: await prisma.changeEvent.findMany({ where: { action: { not: "CHECK_UP_EVALUATED" }, detail: { contains: s.suffix } }, orderBy: { id: "asc" } }),
          }),
        );
      const before = await snapshot();

      await evaluate(systemControl.code, false, outcome, "Seen");
      await evaluate(organizational.code, true, outcome, "Seen");

      expect(await snapshot()).toEqual(before);
    });
  });

  describe("one transaction", () => {
    it("rolls the evaluation, its Change Event, the Risk and the set-back all back when a side effect fails after the Risk was inserted", async () => {
      const systemControl = s.systemControls[9];
      await setAssessment(s.systemId, systemControl.id, "FULFILLED", s.systemOwner, "keep");
      const checkUp = s.find(systemControl.code, false);
      await s.answer(checkUp.id, s.systemOwner);
      const original = sideEffects.onEvaluated;
      vi.spyOn(sideEffects, "onEvaluated").mockImplementation(async (evaluated) => {
        await original(evaluated);
        // The Risk and the set-back are in place inside the transaction when this throws.
        expect(await evaluated.tx.risk.count({ where: { checkUpId: evaluated.checkUpId } })).toBe(1);
        throw new Error("forced failure");
      });
      const eventsBefore = await prisma.changeEvent.count({ where: { detail: { contains: s.suffix } } });

      await expect(evaluateCheckUp(checkUp.id, auditor(), { outcome: "NONCONFORMITY", comment: "Fails midway" })).rejects.toThrow("forced failure");

      expect(await prisma.checkUpEvaluation.findUnique({ where: { checkUpId: checkUp.id } })).toBeNull();
      expect(await riskOf(checkUp.id)).toBeNull();
      expect(await prisma.changeEvent.count({ where: { detail: { contains: s.suffix } } })).toBe(eventsBefore);
      expect(await row(s.systemId, systemControl.id)).toMatchObject({ status: "FULFILLED", notes: "keep" });

      // And the Check-up can still be evaluated afterwards.
      vi.restoreAllMocks();
      await evaluateCheckUp(checkUp.id, auditor(), { outcome: "NONCONFORMITY", comment: "Second try" });
      expect((await row(s.systemId, systemControl.id))!.status).toBe("IN_PROGRESS");
    });

    it("rolls an Organization-level evaluation back too, with its per-System events", async () => {
      const other = both(BOTH_PROVIDER);
      await setImplementation(other.id, "FULFILLED");
      const target = s.find(other.code, true);
      await s.answer(target.id, s.controlOwner);
      const original = sideEffects.onEvaluated;
      vi.spyOn(sideEffects, "onEvaluated").mockImplementation(async (evaluated) => {
        await original(evaluated);
        throw new Error("forced failure");
      });
      const eventsBefore = await prisma.changeEvent.count({ where: { detail: { contains: other.code } } });

      await expect(evaluateCheckUp(target.id, auditor(), { outcome: "NONCONFORMITY", comment: "Fails midway" })).rejects.toThrow("forced failure");

      expect((await implementation(other.id))!.status).toBe("FULFILLED");
      expect(await riskOf(target.id)).toBeNull();
      expect(await prisma.changeEvent.count({ where: { detail: { contains: other.code } } })).toBe(eventsBefore);
    });

    it("runs no query on the global Prisma client: four concurrent evaluations finish on a pool of three", async () => {
      // A query on the global client inside the transaction needs a second connection; with every
      // connection held by a transaction waiting for it, they would all wait until Prisma times out.
      const targets = [
        { control: s.systemControls[10], organization: false },
        { control: s.organizationControls[6], organization: true },
        { control: s.systemControls[11], organization: false },
        { control: s.organizationControls[7], organization: true },
      ];
      for (const t of targets) {
        if (t.organization) await setImplementation(t.control.id, "FULFILLED");
        else await setAssessment(s.systemId, t.control.id, "FULFILLED", s.systemOwner);
        await s.answer(s.find(t.control.code, t.organization).id, t.organization ? s.controlOwner : s.systemOwner);
      }
      const results = await Promise.allSettled(
        targets.map((t) => evaluateCheckUp(s.find(t.control.code, t.organization).id, auditor(), { outcome: "NONCONFORMITY", comment: "Concurrent" })),
      );
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    }, 60_000);

    it("keeps the global client out of the side-effect code (a grep, as the Provider code does)", () => {
      for (const file of ["src/lib/check-up-nonconformity.ts", "src/lib/check-up-nonconformity-rules.ts"]) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toMatch(/@\/lib\/prisma"/);
        expect(source, file).not.toMatch(/\bprisma\./);
      }
    });
  });
});
