import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordStatSnapshots } from "@/lib/stat-snapshots";

export const dynamic = "force-dynamic";
// One User at a time, a dozen queries each: allow a long run as the number of Users grows.
export const maxDuration = 60;

/** True only when `CRON_SECRET` is set and the request carries it as `Authorization: Bearer <secret>`. */
function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily stat-snapshots job (#227), called by Vercel cron (the `crons` entry in `vercel.json`).
 * The job runs via Vercel cron, which sends `CRON_SECRET` (set it in Vercel Production; JSON cannot hold this
 * comment). Public by design (there is no acting user), so it denies by default: no `CRON_SECRET` configured, or
 * a header that does not match, is a 401 and writes nothing.
 */
export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const run = await recordStatSnapshots(new Date());
  return NextResponse.json(run, { status: run.failedUsers > 0 ? 500 : 200 });
}
