import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listCheckUps } from "@/lib/check-ups";
import { checkUpProgress } from "@/lib/check-up-response-rules";
import { listMyCheckUps } from "@/lib/check-up-tasks";
import { countAwaitingEvaluation } from "@/lib/check-up-evaluations";
import { lockCheckUp } from "@/lib/check-up-responses";
import { requestAs } from "@/test/provider-fixtures";
import { ALL_ROLES, createCheckUpScenario } from "@/test/check-up-fixtures";
import { GET as getCheckUp } from "../[id]/route";
import { PUT as putResponse } from "../[id]/response/route";
import { POST as postEvaluation } from "../[id]/evaluation/route";

/**
 * Evaluating a Check-up (#156). Fixtures only (CI's database is migrated, not seeded): every name
 * and code carries this run's suffix, and the Change Events these tests cause are found through it.
 */

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Evaluating a Check-up (#156)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let pool: typeof s.checkUps;
  const allUsers = () => [...Object.values(s.roleUser), s.secondAuditor, s.systemOwner, s.controlOwner];

  const evaluate = (checkUpId: string, userId: string | null, body: unknown) =>
    postEvaluation(requestAs(`/api/check-ups/${checkUpId}/evaluation`, userId, "POST", body), ctx(checkUpId));
  const putMine = (checkUpId: string, userId: string, body: unknown) =>
    putResponse(requestAs(`/api/check-ups/${checkUpId}/response`, userId, "PUT", body), ctx(checkUpId));
  const read = (checkUpId: string, userId: string) => getCheckUp(requestAs(`/api/check-ups/${checkUpId}`, userId, "GET"), ctx(checkUpId));

  /** The next unused Check-up, answered by its recipient (a System Owner or the Control Owner). */
  async function fresh(answered = true) {
    const checkUp = pool.splice(pool.findIndex((c) => c.target.kind === "system"), 1)[0];
    if (answered) await s.answer(checkUp.id, checkUp.target.kind === "system" ? s.systemOwner : s.controlOwner);
    return checkUp;
  }
  const recipientOf = (checkUp: { target: { kind: string } }) => (checkUp.target.kind === "system" ? s.systemOwner : s.controlOwner);

  const evaluations = (ids: string[]) => prisma.checkUpEvaluation.findMany({ where: { checkUpId: { in: ids } }, orderBy: { id: "asc" } });
  const events = () =>
    prisma.changeEvent.findMany({ where: { action: "CHECK_UP_EVALUATED", detail: { contains: s.suffix } }, orderBy: { createdAt: "asc" } });
  const responseOf = (checkUpId: string) =>
    prisma.checkUpResponse.findUnique({ where: { checkUpId }, include: { answers: { orderBy: { id: "asc" } } } });

  /** Everything an evaluation must leave alone: Assessments, Organization implementations, Risks and the other Change Events. */
  async function elsewhere() {
    return JSON.parse(
      JSON.stringify({
        assessments: await prisma.controlAssessment.findMany({ where: { systemId: s.systemId }, orderBy: { id: "asc" } }),
        implementations: await prisma.organizationControlImplementation.findMany({
          where: { controlId: { in: s.organizationControls.map((c) => c.id) } },
          orderBy: { id: "asc" },
        }),
        risks: await prisma.risk.findMany({ where: { systemId: s.systemId }, orderBy: { id: "asc" } }),
        events: await prisma.changeEvent.findMany({
          where: { action: { not: "CHECK_UP_EVALUATED" }, OR: [{ systemId: s.systemId }, { actorId: { in: allUsers() } }] },
          orderBy: { id: "asc" },
        }),
      }),
    );
  }

  beforeAll(async () => {
    s = await createCheckUpScenario("156", { systemControls: 30, organizationControls: 4 });
    pool = [...s.checkUps];
    // Something for an evaluation not to touch: a Fulfilled Assessment, a Fulfilled implementation, a Risk.
    await prisma.controlAssessment.create({ data: { systemId: s.systemId, controlId: s.systemControls[0].id, status: "FULFILLED", selfAssessmentAnswer: "YES" } });
    await prisma.organizationControlImplementation.create({ data: { controlId: s.organizationControls[0].id, status: "FULFILLED" } });
    await prisma.risk.create({ data: { systemId: s.systemId, title: "Test 156 Risk", description: "d", severity: "LOW", likelihood: "LOW" } });
  });

  afterAll(async () => {
    await prisma.organizationControlImplementation.deleteMany({ where: { controlId: { in: s.organizationControls.map((c) => c.id) } } });
    await prisma.risk.deleteMany({ where: { systemId: s.systemId } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: s.systemId } });
    await s.cleanup();
  });

  it("launched what the tests below expect", () => {
    expect(s.checkUps).toHaveLength(34);
    expect(s.checkUps.filter((c) => c.target.kind === "organization")).toHaveLength(4);
  });

  describe("an Internal Auditor evaluates an answered Check-up", () => {
    it.each([
      ["CONFORMING", ""],
      ["OBSERVATION", "The policy exists but is not reviewed yearly"],
      ["NONCONFORMITY", "No evidence of the control operating"],
    ])("as %s on a System-level Check-up", async (outcome, comment) => {
      const target = await fresh();
      const before = await elsewhere();
      const eventsBefore = (await events()).length;

      const response = await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome, comment });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.checkUp.evaluation).toMatchObject({ outcome, comment, evaluatedBy: { id: s.roleUser.INTERNAL_AUDITOR } });
      expect(body.checkUp.evaluated).toBe(true);

      const [row] = await evaluations([target.id]);
      expect(row).toMatchObject({ outcome, comment, evaluatedById: s.roleUser.INTERNAL_AUDITOR });

      // Exactly one System-less Change Event, actor the auditor, naming the audit, the Control, the System and the outcome.
      const written = (await events()).slice(eventsBefore);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ systemId: null, action: "CHECK_UP_EVALUATED", actorId: s.roleUser.INTERNAL_AUDITOR });
      expect(written[0].detail).toContain(s.auditTitle);
      expect(written[0].detail).toContain(target.control.code);
      expect(written[0].detail).toContain(`System "${s.systemName}"`);
      expect(written[0].detail).toContain(outcome === "CONFORMING" ? "Conforming" : outcome === "OBSERVATION" ? "Observation" : "Nonconformity");
      expect(written[0].detail).not.toContain(comment || "\u0000");

      // A Nonconformity too: no Risk, no status change, nothing else.
      expect(await elsewhere()).toEqual(before);
    });

    it.each(["CONFORMING", "OBSERVATION", "NONCONFORMITY"])("as %s on an Organization-level Check-up", async (outcome) => {
      const target = pool.splice(pool.findIndex((c) => c.target.kind === "organization"), 1)[0];
      await s.answer(target.id, s.controlOwner);
      const before = await elsewhere();
      const eventsBefore = (await events()).length;

      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome, comment: "Because" })).status).toBe(201);
      const [row] = await evaluations([target.id]);
      expect(row).toMatchObject({ outcome, comment: "Because" });

      const written = (await events()).slice(eventsBefore);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ systemId: null, actorId: s.roleUser.INTERNAL_AUDITOR });
      expect(written[0].detail).toContain("for the Organization");
      expect(written[0].detail).toContain(target.control.code);
      expect(await elsewhere()).toEqual(before);
    });

    it("lets any Internal Auditor evaluate, not only the one who created the audit", async () => {
      const target = await fresh();
      expect((await evaluate(target.id, s.secondAuditor, { outcome: "CONFORMING" })).status).toBe(201);
      expect((await evaluations([target.id]))[0].evaluatedById).toBe(s.secondAuditor);
    });

    it("stores the trimmed comment and answers 401 without an acting user and 404 for a Check-up that doesn't exist", async () => {
      const target = await fresh();
      expect((await evaluate(target.id, null, { outcome: "CONFORMING" })).status).toBe(401);
      expect((await evaluate("no-such-check-up", s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" })).status).toBe(404);
      expect(await evaluations([target.id])).toEqual([]);
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "OBSERVATION", comment: "  padded  " })).status).toBe(201);
      expect((await evaluations([target.id]))[0].comment).toBe("padded");
    });
  });

  describe("what can't be evaluated", () => {
    it("refuses an unanswered Check-up with a 409, changing nothing", async () => {
      const target = await fresh(false);
      const before = await elsewhere();
      const eventsBefore = await events();
      const response = await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/answered/);
      expect(await evaluations([target.id])).toEqual([]);
      expect(await events()).toEqual(eventsBefore);
      expect(await elsewhere()).toEqual(before);
    });

    it("refuses a Check-up of an audit that isn't launched, whether draft or closed", async () => {
      const target = await fresh();
      const eventsBefore = await events();
      for (const status of ["CLOSED", "DRAFT"] as const) {
        await prisma.internalAudit.update({ where: { id: s.auditId }, data: { status } });
        try {
          const response = await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" });
          expect(response.status).toBe(409);
          expect((await response.json()).error).toMatch(new RegExp(status.toLowerCase()));
        } finally {
          await prisma.internalAudit.update({ where: { id: s.auditId }, data: { status: "LAUNCHED" } });
        }
      }
      expect(await evaluations([target.id])).toEqual([]);
      expect(await events()).toEqual(eventsBefore);
    });

    it("refuses a second evaluation with a 409: an evaluation is final", async () => {
      const target = await fresh();
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "OBSERVATION", comment: "First" })).status).toBe(201);
      const [first] = await evaluations([target.id]);
      const eventsBefore = (await events()).length;

      for (const userId of [s.roleUser.INTERNAL_AUDITOR, s.secondAuditor]) {
        const again = await evaluate(target.id, userId, { outcome: "NONCONFORMITY", comment: "Second" });
        expect(again.status).toBe(409);
        expect((await again.json()).error).toMatch(/final/);
      }
      expect(await evaluations([target.id])).toEqual([first]);
      expect((await events()).length).toBe(eventsBefore);
    });
  });

  describe("who may evaluate", () => {
    it("refuses every role but the Internal Auditor with a 403 and no DB change, the Admin, the Compliance Manager and the recipient included", async () => {
      const targets = [await fresh(), pool.splice(pool.findIndex((c) => c.target.kind === "organization"), 1)[0]];
      await s.answer(targets[1].id, s.controlOwner);
      const before = await elsewhere();
      const eventsBefore = await events();
      const responsesBefore = await Promise.all(targets.map((t) => responseOf(t.id)));

      const refused = ALL_ROLES.filter((role) => role !== "INTERNAL_AUDITOR").map((role) => s.roleUser[role]);
      for (const target of targets) {
        for (const userId of [...refused, s.systemOwner, s.controlOwner]) {
          const response = await evaluate(target.id, userId, { outcome: "CONFORMING", comment: "I am not an auditor" });
          expect(response.status).toBe(403);
        }
        // ...also with an invalid body, and for the recipient, before anything about the Check-up is revealed.
        expect((await evaluate(target.id, recipientOf(target), { outcome: "nonsense" })).status).toBe(403);
      }
      // ...and a Check-up that doesn't exist is a 403 for them too, not a hint that it is missing.
      expect((await evaluate("no-such-check-up", s.roleUser.ADMIN, { outcome: "CONFORMING" })).status).toBe(403);

      expect(await evaluations(targets.map((t) => t.id))).toEqual([]);
      expect(await events()).toEqual(eventsBefore);
      expect(await Promise.all(targets.map((t) => responseOf(t.id)))).toEqual(responsesBefore);
      expect(await elsewhere()).toEqual(before);
    });
  });

  describe("the comment", () => {
    it("is required for an Observation and a Nonconformity, optional for Conforming, and capped", async () => {
      const target = await fresh();
      const eventsBefore = await events();
      for (const body of [
        { outcome: "OBSERVATION" },
        { outcome: "NONCONFORMITY", comment: "   " },
        { outcome: "CONFORMING", comment: "x".repeat(2001) },
        { outcome: "FAIL", comment: "x" },
        { comment: "no outcome" },
        { outcome: ["CONFORMING"] },
        "nope",
      ]) {
        expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, body)).status).toBe(400);
      }
      expect(await evaluations([target.id])).toEqual([]);
      expect(await events()).toEqual(eventsBefore);
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" })).status).toBe(201);
      expect((await evaluations([target.id]))[0].comment).toBe("");
    });

    it("keeps a long comment out of the Change Event", async () => {
      const target = await fresh();
      const comment = "A secret finding about the vendor. ".repeat(50);
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "NONCONFORMITY", comment })).status).toBe(201);
      const written = (await events()).filter((e) => e.detail.includes(target.control.code));
      expect(written).toHaveLength(1);
      expect(written[0].detail).not.toContain("secret");
      expect(written[0].detail.length).toBeLessThan(600);
    });
  });

  describe("an evaluated Check-up's response", () => {
    it("can no longer be changed by the recipient (409, no DB change), and the recipient reads the evaluation", async () => {
      const target = await fresh();
      const [question] = await prisma.checkUpQuestion.findMany({ where: { checkUpId: target.id } });
      const body = { answers: [{ questionId: question.id, answer: "NO", description: "Changed my mind" }], evidenceLinks: [] };

      // Before the evaluation the recipient may still change it.
      expect((await putMine(target.id, s.systemOwner, body)).status).toBe(200);
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "OBSERVATION", comment: "Seen" })).status).toBe(201);

      const before = await responseOf(target.id);
      const eventsBefore = await events();
      const refused = await putMine(target.id, s.systemOwner, { answers: [{ questionId: question.id, answer: "YES", description: "" }], evidenceLinks: [] });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toMatch(/evaluated/);
      expect(await responseOf(target.id)).toEqual(before);
      expect(await events()).toEqual(eventsBefore);

      const read1 = await (await read(target.id, s.systemOwner)).json();
      expect(read1.canAnswer).toBe(false);
      expect(read1.canEvaluate).toBe(false);
      expect(read1.checkUp.evaluation).toMatchObject({ outcome: "OBSERVATION", comment: "Seen", evaluatedBy: { id: s.roleUser.INTERNAL_AUDITOR } });
    });

    it("is read with its evaluation by the audit's reading roles, who can't answer, and by nobody else", async () => {
      const target = await fresh();
      await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING", comment: "Good" });
      for (const role of ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "INTERNAL_AUDITOR"] as UserRole[]) {
        const body = await (await read(target.id, s.roleUser[role])).json();
        expect(body.checkUp.evaluation).toMatchObject({ outcome: "CONFORMING", comment: "Good" });
        expect(body.canAnswer).toBe(false);
      }
      for (const role of ["SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"] as UserRole[]) {
        expect((await read(target.id, s.roleUser[role])).status).toBe(403);
      }
    });

    it("tells an Internal Auditor it can evaluate an answered, unevaluated Check-up, and nobody else", async () => {
      const target = await fresh();
      const unanswered = await fresh(false);
      const mine = await (await read(target.id, s.roleUser.INTERNAL_AUDITOR)).json();
      expect(mine.canEvaluate).toBe(true);
      expect((await (await read(unanswered.id, s.roleUser.INTERNAL_AUDITOR)).json()).canEvaluate).toBe(false);
      for (const role of ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER"] as UserRole[]) {
        expect((await (await read(target.id, s.roleUser[role])).json()).canEvaluate).toBe(false);
      }
      expect((await (await read(target.id, s.systemOwner)).json()).canEvaluate).toBe(false);
    });
  });

  describe("progress and the lists", () => {
    it("counts evaluated Check-ups apart from answered ones, and shows each outcome", async () => {
      const rows = await listCheckUps(s.auditId);
      const progress = checkUpProgress(rows);
      expect(progress.sent).toBe(34);
      const evaluatedRows = rows.filter((r) => r.evaluation);
      expect(progress.evaluated).toBe(evaluatedRows.length);
      expect(progress.evaluated).toBeGreaterThan(0);
      expect(progress.answered).toBeGreaterThanOrEqual(progress.evaluated);
      expect(progress.awaitingEvaluation).toBe(progress.answered - progress.evaluated);
      expect(progress.open).toBe(progress.sent - progress.answered);
      expect(evaluatedRows.every((r) => r.answered && r.evaluated && r.evaluation!.evaluatedByName.startsWith("Test 156"))).toBe(true);
      expect(await countAwaitingEvaluation()).toBeGreaterThanOrEqual(progress.awaitingEvaluation);
    });

    it("keeps an evaluated Check-up out of 'open' and shows the outcome in the recipient's list", async () => {
      const target = await fresh();
      await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "NONCONFORMITY", comment: "Bad" });
      const mine = await listMyCheckUps({ id: s.systemOwner, role: "SYSTEM_OWNER" });
      expect(mine.find((c) => c.id === target.id)).toMatchObject({ answered: true, open: false, overdue: false, outcome: "NONCONFORMITY" });
      const unevaluated = mine.find((c) => c.outcome === null && c.answered);
      expect(unevaluated?.outcome).toBeNull();
    });
  });

  describe("concurrency", () => {
    /**
     * Holds the Check-up's row lock until `release`, like a transaction in the middle of a write. It
     * uses a client of its own: the test pool is 3 connections, and the holder plus the two waiting
     * writers would leave the test's own queries none.
     */
    function holdLock(checkUpId: string) {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const held = new Promise<void>((resolve) => (locked = resolve));
      const holder = new PrismaClient();
      const done = holder
        .$transaction(async (tx) => {
          await lockCheckUp(tx, checkUpId);
          locked();
          await released;
        })
        .finally(() => holder.$disconnect());
      return { held, release, done };
    }
    const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), sleep(300).then(() => false)]);

    /** Either the change landed first and is what was evaluated, or the evaluation came first and the change was refused. */
    async function expectConsistent(checkUpId: string, putStatus: number, evaluateStatus: number) {
      expect(evaluateStatus).toBe(201);
      const [evaluation] = await evaluations([checkUpId]);
      const response = (await responseOf(checkUpId))!;
      if (putStatus === 200) {
        expect(response.answers[0]).toMatchObject({ answer: "NO", description: "Changed after" });
        expect(response.updatedAt.getTime()).toBeLessThanOrEqual(evaluation.evaluatedAt.getTime());
      } else {
        expect(putStatus).toBe(409);
        expect(response.answers[0]).toMatchObject({ answer: "YES", description: "" });
        expect(response.updatedAt.getTime()).toBeLessThanOrEqual(evaluation.evaluatedAt.getTime());
      }
    }
    const changeBody = async (checkUpId: string) => {
      const [question] = await prisma.checkUpQuestion.findMany({ where: { checkUpId } });
      return { answers: [{ questionId: question.id, answer: "NO", description: "Changed after" }], evidenceLinks: [] };
    };

    it.each([
      ["the change queued first", true],
      ["the evaluation queued first", false],
    ])("serializes an evaluation and a response change behind the Check-up's lock (%s)", async (_label, changeFirst) => {
      const target = await fresh();
      const body = await changeBody(target.id);
      const lock = holdLock(target.id);
      await lock.held;

      const startChange = () => putMine(target.id, s.systemOwner, body);
      const startEvaluate = () => evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "OBSERVATION", comment: "Seen" });
      let change: Promise<Response>, evaluating: Promise<Response>;
      if (changeFirst) {
        change = startChange();
        await sleep(100);
        evaluating = startEvaluate();
      } else {
        evaluating = startEvaluate();
        await sleep(100);
        change = startChange();
      }
      // Both wait for the lock: neither has written anything.
      expect(await settled(Promise.all([change, evaluating]))).toBe(false);
      expect(await evaluations([target.id])).toEqual([]);
      expect((await responseOf(target.id))!.answers[0].description).toBe("");

      lock.release();
      await lock.done;
      const [changed, evaluated] = await Promise.all([change, evaluating]);
      await expectConsistent(target.id, changed.status, evaluated.status);
      // Queued in that order, the first one in wins the lock.
      expect(changed.status).toBe(changeFirst ? 200 : 409);
    });

    it("gives exactly one success to two evaluations at once, with one evaluation and one Change Event", async () => {
      const target = await fresh();
      const eventsBefore = (await events()).length;
      const results = await Promise.all([
        evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "NONCONFORMITY", comment: "A" }),
        evaluate(target.id, s.secondAuditor, { outcome: "OBSERVATION", comment: "B" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await evaluations([target.id])).toHaveLength(1);
      expect((await events()).length - eventsBefore).toBe(1);
    });

    it("never evaluates a response that then changed, whichever of a racing pair wins", async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const target = await fresh();
        const body = await changeBody(target.id);
        const run = [
          () => putMine(target.id, s.systemOwner, body),
          () => evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "OBSERVATION", comment: "Seen" }),
        ];
        if (attempt % 2 === 1) run.reverse();
        const results = await Promise.all(run.map((start) => start()));
        const [changed, evaluated] = attempt % 2 === 1 ? [results[1], results[0]] : [results[0], results[1]];
        await expectConsistent(target.id, changed.status, evaluated.status);
        expect(await evaluations([target.id])).toHaveLength(1);
      }
    });
  });
});
