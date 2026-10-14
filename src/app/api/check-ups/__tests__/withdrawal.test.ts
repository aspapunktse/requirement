import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listCheckUps } from "@/lib/check-ups";
import { checkUpProgress } from "@/lib/check-up-response-rules";
import { getCheckUpTasks, listMyCheckUps } from "@/lib/check-up-tasks";
import { countAwaitingEvaluation } from "@/lib/check-up-evaluations";
import { lockCheckUp } from "@/lib/check-up-responses";
import { MAX_WITHDRAWAL_REASON_LENGTH } from "@/lib/check-up-withdrawal-rules";
import { requestAs } from "@/test/provider-fixtures";
import { ALL_ROLES, createCheckUpScenario } from "@/test/check-up-fixtures";
import { GET as getCheckUp } from "../[id]/route";
import { PUT as putResponse } from "../[id]/response/route";
import { POST as postEvaluation } from "../[id]/evaluation/route";
import { POST as postWithdrawal } from "../[id]/withdrawal/route";

/**
 * Withdrawing a Check-up (#158). Fixtures only (CI's database is migrated, not seeded): every name
 * and code carries this run's suffix.
 */

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Withdrawing a Check-up (#158)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let pool: typeof s.checkUps;
  const allUsers = () => [...Object.values(s.roleUser), s.secondAuditor, s.systemOwner, s.controlOwner];

  const withdraw = (checkUpId: string, userId: string | null, body: unknown) =>
    postWithdrawal(requestAs(`/api/check-ups/${checkUpId}/withdrawal`, userId, "POST", body), ctx(checkUpId));
  const evaluate = (checkUpId: string, userId: string, body: unknown) =>
    postEvaluation(requestAs(`/api/check-ups/${checkUpId}/evaluation`, userId, "POST", body), ctx(checkUpId));
  const putMine = (checkUpId: string, userId: string, body: unknown) =>
    putResponse(requestAs(`/api/check-ups/${checkUpId}/response`, userId, "PUT", body), ctx(checkUpId));
  const read = (checkUpId: string, userId: string) => getCheckUp(requestAs(`/api/check-ups/${checkUpId}`, userId, "GET"), ctx(checkUpId));

  /** The next unused System-level Check-up, answered by its recipient if asked. */
  async function fresh(answered = false) {
    const checkUp = pool.splice(pool.findIndex((c) => c.target.kind === "system"), 1)[0];
    if (answered) await s.answer(checkUp.id, s.systemOwner);
    return checkUp;
  }

  const withdrawals = (ids: string[]) => prisma.checkUpWithdrawal.findMany({ where: { checkUpId: { in: ids } }, orderBy: { id: "asc" } });
  const responseOf = (checkUpId: string) =>
    prisma.checkUpResponse.findUnique({ where: { checkUpId }, include: { answers: { orderBy: { id: "asc" } } } });

  /** Everything a withdrawal must leave alone: the audit, the other Check-up tables, Assessments, Risks and every Change Event of these users. */
  async function elsewhere(ids: string[]) {
    return JSON.parse(
      JSON.stringify({
        audit: await prisma.internalAudit.findUnique({ where: { id: s.auditId } }),
        responses: await prisma.checkUpResponse.findMany({ where: { checkUpId: { in: ids } }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } } } }),
        evaluations: await prisma.checkUpEvaluation.findMany({ where: { checkUpId: { in: ids } }, orderBy: { id: "asc" } }),
        assessments: await prisma.controlAssessment.findMany({ where: { systemId: s.systemId }, orderBy: { id: "asc" } }),
        risks: await prisma.risk.findMany({ where: { OR: [{ systemId: s.systemId }, { checkUpId: { in: ids } }] }, orderBy: { id: "asc" } }),
        events: await prisma.changeEvent.findMany({
          where: { OR: [{ systemId: s.systemId }, { actorId: { in: allUsers() } }, { systemId: null, detail: { contains: s.suffix } }] },
          orderBy: { id: "asc" },
        }),
      }),
    );
  }

  beforeAll(async () => {
    s = await createCheckUpScenario("158w", { systemControls: 40, organizationControls: 4 });
    pool = [...s.checkUps];
  });

  afterAll(async () => {
    await s.cleanup();
  });

  describe("an Internal Auditor withdraws a Check-up", () => {
    it("withdraws an unanswered Check-up with a reason, recording who and when, and changing nothing else", async () => {
      const target = await fresh();
      const before = await elsewhere([target.id]);

      const response = await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "  The Control no longer applies  " });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.checkUp.withdrawn).toBe(true);
      expect(body.checkUp.withdrawal).toMatchObject({ reason: "The Control no longer applies", withdrawnBy: { id: s.roleUser.INTERNAL_AUDITOR } });
      expect(body.checkUp.open).toBe(false);
      expect(body.checkUp.overdue).toBe(false);
      expect(body.canAnswer).toBe(false);
      expect(body.canEvaluate).toBe(false);
      expect(body.canWithdraw).toBe(false);

      const [row] = await withdrawals([target.id]);
      expect(row).toMatchObject({ reason: "The Control no longer applies", withdrawnById: s.roleUser.INTERNAL_AUDITOR });
      // No Change Event, no status, no Risk: the decision of #158 (1a).
      expect(await elsewhere([target.id])).toEqual(before);
    });

    it("withdraws an Organization-level Check-up too", async () => {
      const target = pool.splice(pool.findIndex((c) => c.target.kind === "organization"), 1)[0];
      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Out of scope" })).status).toBe(201);
      expect(await withdrawals([target.id])).toHaveLength(1);
    });

    it("withdraws an answered, not yet evaluated Check-up and keeps its response as part of the record", async () => {
      const target = await fresh(true);
      const responseBefore = JSON.parse(JSON.stringify(await responseOf(target.id)));
      expect((await withdraw(target.id, s.secondAuditor, { reason: "Superseded by another audit" })).status).toBe(201);

      expect(JSON.parse(JSON.stringify(await responseOf(target.id)))).toEqual(responseBefore);
      expect((await withdrawals([target.id]))[0].withdrawnById).toBe(s.secondAuditor); // any Internal Auditor may withdraw
      const seen = await (await read(target.id, s.roleUser.ADMIN)).json();
      expect(seen.checkUp.answered).toBe(true);
      expect(seen.checkUp.response).not.toBeNull();
      expect(seen.checkUp.withdrawal.reason).toBe("Superseded by another audit");
    });

    it("answers 401 without an acting user and 404 for a Check-up that doesn't exist", async () => {
      const target = await fresh();
      expect((await withdraw(target.id, null, { reason: "x" })).status).toBe(401);
      expect((await withdraw("no-such-check-up", s.roleUser.INTERNAL_AUDITOR, { reason: "x" })).status).toBe(404);
      expect(await withdrawals([target.id])).toEqual([]);
      pool.push(target);
    });
  });

  describe("only an Internal Auditor can withdraw", () => {
    it("refuses every other role with a 403 and no DB change, even for the Check-up's own recipient", async () => {
      const target = await fresh(true);
      const before = await elsewhere([target.id]);
      for (const [userId, role] of [
        ...ALL_ROLES.filter((r) => r !== "INTERNAL_AUDITOR").map((r) => [s.roleUser[r], r] as const),
        [s.systemOwner, "the recipient"],
        [s.controlOwner, "the Control Owner"],
      ]) {
        const response = await withdraw(target.id, userId, { reason: "Because" });
        expect(response.status, role).toBe(403);
      }
      expect(await withdrawals([target.id])).toEqual([]);
      expect(await elsewhere([target.id])).toEqual(before);
      pool.push(target);
    });

    it("tells the page what the viewer may do: only an auditor can withdraw an unevaluated Check-up", async () => {
      const target = await fresh();
      for (const role of ALL_ROLES) {
        const body = await (await read(target.id, s.roleUser[role])).json();
        if (body.checkUp) expect(body.canWithdraw, role).toBe(role === "INTERNAL_AUDITOR");
      }
      expect((await (await read(target.id, s.systemOwner)).json()).canWithdraw).toBe(false);
      pool.push(target);
    });
  });

  describe("what can't be withdrawn", () => {
    it("refuses a Check-up that has been evaluated with a 409, keeping the evaluation", async () => {
      const target = await fresh(true);
      expect((await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "CONFORMING" })).status).toBe(201);
      const before = await elsewhere([target.id]);

      const response = await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Changed my mind" });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/evaluated/);
      expect(await withdrawals([target.id])).toEqual([]);
      expect(await elsewhere([target.id])).toEqual(before);
    });

    it("refuses a second withdrawal with a 409: a withdrawal is final", async () => {
      const target = await fresh();
      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "First" })).status).toBe(201);
      const [first] = await withdrawals([target.id]);

      for (const userId of [s.roleUser.INTERNAL_AUDITOR, s.secondAuditor]) {
        const again = await withdraw(target.id, userId, { reason: "Second" });
        expect(again.status).toBe(409);
        expect((await again.json()).error).toMatch(/withdrawn already/);
      }
      expect(await withdrawals([target.id])).toEqual([first]);
    });

    it("refuses a Check-up of an audit that isn't launched, whether draft or closed", async () => {
      const target = await fresh();
      for (const status of ["CLOSED", "DRAFT"] as const) {
        await prisma.internalAudit.update({ where: { id: s.auditId }, data: { status } });
        try {
          const response = await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Too late" });
          expect(response.status).toBe(409);
          expect((await response.json()).error).toMatch(new RegExp(status.toLowerCase()));
        } finally {
          await prisma.internalAudit.update({ where: { id: s.auditId }, data: { status: "LAUNCHED" } });
        }
      }
      expect(await withdrawals([target.id])).toEqual([]);
      pool.push(target);
    });

    it("needs a reason: blank, missing, over-long and malformed bodies are 400s that change nothing", async () => {
      const target = await fresh();
      const bodies: unknown[] = [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(MAX_WITHDRAWAL_REASON_LENGTH + 1) }, { reason: 5 }, "nope", null];
      for (const body of bodies) {
        const response = await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, body);
        expect(response.status, JSON.stringify(body)?.slice(0, 30)).toBe(400);
      }
      expect(await withdrawals([target.id])).toEqual([]);
      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "x".repeat(MAX_WITHDRAWAL_REASON_LENGTH) })).status).toBe(201);
    });
  });

  describe("what a withdrawal does to the rest of the Check-up's life", () => {
    it("removes the Check-up from the recipient's tasks but keeps it in their list, marked withdrawn", async () => {
      const target = await fresh();
      const owner = { id: s.systemOwner, role: "SYSTEM_OWNER" as const };
      expect((await getCheckUpTasks(owner)).rows.some((row) => row.id === `${target.id}:check-up`)).toBe(true);
      const tasksBefore = (await getCheckUpTasks(owner)).rows.length;
      const totalBefore = (await getCheckUpTasks(owner)).total;

      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Not needed" })).status).toBe(201);

      const after = await getCheckUpTasks(owner);
      expect(after.rows.some((row) => row.id === `${target.id}:check-up`)).toBe(false);
      expect(after.rows).toHaveLength(tasksBefore - 1);
      expect(after.total).toBe(totalBefore);
      const mine = (await listMyCheckUps(owner)).find((c) => c.id === target.id)!;
      expect(mine).toMatchObject({ withdrawn: true, open: false, overdue: false });
    });

    it("removes an Organization-level Check-up from the Control Owner's tasks", async () => {
      const target = pool.splice(pool.findIndex((c) => c.target.kind === "organization"), 1)[0];
      const owner = { id: s.controlOwner, role: "RISK_OWNER" as const };
      expect((await getCheckUpTasks(owner)).rows.some((row) => row.id === `${target.id}:check-up`)).toBe(true);
      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Not needed" })).status).toBe(201);
      expect((await getCheckUpTasks(owner)).rows.some((row) => row.id === `${target.id}:check-up`)).toBe(false);
    });

    it("can no longer be answered or have its response changed: a 409 for the recipient, nothing written", async () => {
      const unanswered = await fresh();
      const answered = await fresh(true);
      for (const target of [unanswered, answered]) expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" })).status).toBe(201);
      const answeredBefore = JSON.parse(JSON.stringify(await responseOf(answered.id)));

      for (const target of [unanswered, answered]) {
        const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId: target.id } });
        const body = { answers: questions.map((q) => ({ questionId: q.id, answer: "NO", description: "Changed" })), evidenceLinks: [] };
        const response = await putMine(target.id, s.systemOwner, body);
        expect(response.status).toBe(409);
        expect((await response.json()).error).toMatch(/withdrawn/);
      }
      expect(await responseOf(unanswered.id)).toBeNull();
      expect(JSON.parse(JSON.stringify(await responseOf(answered.id)))).toEqual(answeredBefore);

      const detail = await (await read(answered.id, s.systemOwner)).json();
      expect(detail.canAnswer).toBe(false);
    });

    it("can no longer be evaluated: a 409 whether or not it was answered, nothing written", async () => {
      const unanswered = await fresh();
      const answered = await fresh(true);
      for (const target of [unanswered, answered]) expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" })).status).toBe(201);
      const before = await elsewhere([unanswered.id, answered.id]);

      for (const target of [unanswered, answered]) {
        const response = await evaluate(target.id, s.roleUser.INTERNAL_AUDITOR, { outcome: "NONCONFORMITY", comment: "Bad" });
        expect(response.status).toBe(409);
        expect((await response.json()).error).toMatch(/withdrawn/);
      }
      expect(await elsewhere([unanswered.id, answered.id])).toEqual(before);
      expect((await (await read(answered.id, s.roleUser.INTERNAL_AUDITOR)).json()).canEvaluate).toBe(false);
    });

    it("drops out of the progress and the awaiting-evaluation counts", async () => {
      const target = await fresh(true);
      const rowsBefore = await listCheckUps(s.auditId);
      const before = checkUpProgress(rowsBefore);
      const awaitingBefore = await countAwaitingEvaluation(s.auditId);
      expect(awaitingBefore).toBe(before.awaitingEvaluation);
      expect(awaitingBefore).toBeGreaterThan(0);

      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" })).status).toBe(201);

      const rows = await listCheckUps(s.auditId);
      const after = checkUpProgress(rows);
      expect(rows.find((r) => r.id === target.id)).toMatchObject({ withdrawn: true, answered: true, evaluated: false, overdue: false });
      expect(after).toMatchObject({
        sent: before.sent,
        answered: before.answered - 1,
        awaitingEvaluation: before.awaitingEvaluation - 1,
        withdrawn: before.withdrawn + 1,
        evaluated: before.evaluated,
      });
      expect(after.sent).toBe(after.open + after.answered + after.withdrawn);
      expect(await countAwaitingEvaluation(s.auditId)).toBe(awaitingBefore - 1);
    });

    it("is no longer overdue", async () => {
      const target = await fresh();
      const late = new Date(Date.now() + 90 * 86_400_000);
      expect((await listCheckUps(s.auditId, late)).find((r) => r.id === target.id)!.overdue).toBe(true);
      expect((await withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" })).status).toBe(201);
      expect((await listCheckUps(s.auditId, late)).find((r) => r.id === target.id)!.overdue).toBe(false);
    });
  });

  describe("concurrent writes on one Check-up", () => {
    /** Holds the Check-up's row lock until `release`, like a transaction in the middle of a write, on a client of its own (the test pool is small). */
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

    it("gives exactly one success to a withdrawal and an evaluation at once, whichever wins", async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const target = await fresh(true);
        const run = [
          () => withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" }),
          () => evaluate(target.id, s.secondAuditor, { outcome: "OBSERVATION", comment: "Seen" }),
        ];
        if (attempt % 2 === 1) run.reverse();
        const results = await Promise.all(run.map((start) => start()));
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
        // Never both: a Check-up is evaluated or withdrawn, not neither and not both.
        const evaluated = await prisma.checkUpEvaluation.count({ where: { checkUpId: target.id } });
        expect(evaluated + (await withdrawals([target.id])).length).toBe(1);
      }
    });

    it("gives exactly one success to two withdrawals at once, with one withdrawal row", async () => {
      const target = await fresh();
      const results = await Promise.all([
        withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "A" }),
        withdraw(target.id, s.secondAuditor, { reason: "B" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await withdrawals([target.id])).toHaveLength(1);
    });

    it.each([
      ["the response change queued first", true],
      ["the withdrawal queued first", false],
    ])("serializes a withdrawal and a response change behind the Check-up's lock (%s)", async (_label, changeFirst) => {
      const target = await fresh(true);
      const [question] = await prisma.checkUpQuestion.findMany({ where: { checkUpId: target.id } });
      const body = { answers: [{ questionId: question.id, answer: "NO", description: "Changed after" }], evidenceLinks: [] };
      const lock = holdLock(target.id);
      await lock.held;

      const startChange = () => putMine(target.id, s.systemOwner, body);
      const startWithdraw = () => withdraw(target.id, s.roleUser.INTERNAL_AUDITOR, { reason: "Gone" });
      let change: Promise<Response>, withdrawing: Promise<Response>;
      if (changeFirst) {
        change = startChange();
        await sleep(100);
        withdrawing = startWithdraw();
      } else {
        withdrawing = startWithdraw();
        await sleep(100);
        change = startChange();
      }
      // Both wait for the lock: neither has written anything.
      expect(await settled(Promise.all([change, withdrawing]))).toBe(false);
      expect(await withdrawals([target.id])).toEqual([]);
      expect((await responseOf(target.id))!.answers[0].description).toBe("");

      lock.release();
      await lock.done;
      const [changed, withdrawn] = await Promise.all([change, withdrawing]);
      expect(withdrawn.status).toBe(201);
      // The first one in wins the lock: a change that came first landed, one that came second was refused.
      expect(changed.status).toBe(changeFirst ? 200 : 409);
      expect((await responseOf(target.id))!.answers[0].description).toBe(changeFirst ? "Changed after" : "");
      expect(await withdrawals([target.id])).toHaveLength(1);
    });
  });
});
