import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "../route";

const SUFFIX = Date.now();
const P1 = `test-186-a-${SUFFIX}`;
const P2 = `test-186-b-${SUFFIX}`;
const A = randomUUID();
const B = randomUUID();

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/design-votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const get = (voter?: string) =>
  GET(new NextRequest(`http://localhost/api/design-votes${voter === undefined ? "" : `?voter=${voter}`}`));
const total = () => prisma.designVote.count();

afterAll(async () => {
  await prisma.designVote.deleteMany({ where: { voterId: { in: [A, B] } } });
});

describe("/api/design-votes", () => {
  it("adds a vote, idempotently, and reports it as the voter's own", async () => {
    const res = await post({ proposal: P1, voter: A, vote: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts[P1]).toBe(1);
    expect(body.mine).toEqual([P1]);

    const again = await (await post({ proposal: P1, voter: A, vote: true })).json();
    expect(again.counts[P1]).toBe(1);
    expect(await prisma.designVote.count({ where: { proposalId: P1, voterId: A } })).toBe(1);
  });

  it("counts across voters and keeps `mine` per voter", async () => {
    await post({ proposal: P1, voter: B, vote: true });
    const bBody = await (await post({ proposal: P2, voter: B, vote: true })).json();
    expect(bBody.counts[P1]).toBe(2);
    expect(bBody.counts[P2]).toBe(1);
    expect([...bBody.mine].sort()).toEqual([P1, P2].sort());

    const aBody = await (await get(A)).json();
    expect(aBody.counts[P1]).toBe(2);
    expect(aBody.mine).toEqual([P1]);
  });

  it("removes a vote, and removing a missing vote is harmless", async () => {
    const body = await (await post({ proposal: P1, voter: A, vote: false })).json();
    expect(body.counts[P1]).toBe(1);
    expect(body.mine).toEqual([]);
    const again = await post({ proposal: P1, voter: A, vote: false });
    expect(again.status).toBe(200);
    expect((await again.json()).counts[P1]).toBe(1);
  });

  it("refuses bad input and changes nothing", async () => {
    const before = await total();
    const bad: unknown[] = [
      { proposal: "Has Caps", voter: A, vote: true },
      { proposal: "", voter: A, vote: true },
      { proposal: "a".repeat(65), voter: A, vote: true },
      { proposal: P1, voter: "not-a-uuid", vote: true },
      { proposal: P1, voter: A, vote: "yes" },
      { proposal: P1, voter: A },
      { voter: A, vote: true },
      "{not json",
    ];
    for (const b of bad) expect((await post(b)).status).toBe(400);
    expect(await total()).toBe(before);
    expect((await get()).status).toBe(400);
    expect((await get("nope")).status).toBe(400);
  });
});
