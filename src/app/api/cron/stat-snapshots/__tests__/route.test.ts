import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The route is only the secret check around `recordStatSnapshots`, which `src/lib/__tests__/stat-snapshots.test.ts`
// drives against the database with its own Users. A real run here would cover every User in the shared test
// database and write snapshots for other files' fixtures, so the job is replaced by a spy: a refused request
// never reaching it is what "writes nothing" means.
const record = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stat-snapshots", () => ({ recordStatSnapshots: record }));

import { GET } from "../route";

const call = (authorization?: string) =>
  GET(new NextRequest("http://localhost/api/cron/stat-snapshots", { headers: authorization ? { authorization } : {} }));
const original = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  record.mockReset();
  record.mockResolvedValue({ day: "2026-10-24", users: 2, recorded: 5, failedUsers: 0 });
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/stat-snapshots (#227)", () => {
  it("refuses a request without the secret and does not run the job", async () => {
    expect((await call()).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret and does not run the job", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call("test-cron-secret")).status).toBe(401);
    expect((await call("Bearer test-cron-secretx")).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call("Bearer ")).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("runs the job once with the right secret and returns its summary", async () => {
    const response = await call("Bearer test-cron-secret");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ day: "2026-10-24", users: 2, recorded: 5, failedUsers: 0 });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when any User failed, so the failure shows in Vercel", async () => {
    record.mockResolvedValue({ day: "2026-10-24", users: 2, recorded: 3, failedUsers: 1 });
    const response = await call("Bearer test-cron-secret");
    expect(response.status).toBe(500);
    expect((await response.json()).failedUsers).toBe(1);
  });
});
