import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "../route";

const suffix = `${process.pid}-${Date.now()}`;
const email = `test-cron-snap-${suffix}@example.com`;
const startedAt = new Date();
let userId: string;

const call = (authorization?: string) =>
  GET(new NextRequest("http://localhost/api/cron/stat-snapshots", { headers: authorization ? { authorization } : {} }));
const count = () => prisma.statSnapshot.count({ where: { createdAt: { gte: startedAt } } });
const original = process.env.CRON_SECRET;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email, name: "Test Cron Snapshot", role: "VIEWER" } })).id;
});

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

afterAll(async () => {
  // The job covers every User, so remove what this file wrote for the others too.
  await prisma.statSnapshot.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.user.deleteMany({ where: { email } });
});

describe("GET /api/cron/stat-snapshots (#227)", () => {
  it("refuses a request without the secret and writes nothing", async () => {
    expect((await call()).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("refuses a wrong secret and writes nothing", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("test-cron-secret")).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("refuses everything when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("records the snapshots for every user with the right secret", async () => {
    const response = await call("Bearer test-cron-secret");
    const body = await response.json();
    // Other test files create and delete Users concurrently, so a User can vanish mid-run: that is counted
    // (and answered 500), not fatal. The run itself must have happened.
    expect(response.status).toBe(body.failedUsers > 0 ? 500 : 200);
    expect(body.users).toBeGreaterThanOrEqual(1);
    expect(await prisma.statSnapshot.count({ where: { userId } })).toBeGreaterThan(0);
  }, 60_000);
});
