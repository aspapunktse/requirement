import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// Anonymous thumbs-up votes on the public /design landing page (#186). No acting user and no role:
// the voter is a random UUID the browser keeps.

const proposalSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);
const voterSchema = z.string().uuid();
const bodySchema = z.object({
  proposal: proposalSchema,
  voter: voterSchema,
  vote: z.boolean(),
});

const NO_STORE = { "Cache-Control": "no-store" };

async function tally(voter: string) {
  const [grouped, mine] = await Promise.all([
    prisma.designVote.groupBy({ by: ["proposalId"], _count: { _all: true } }),
    prisma.designVote.findMany({ where: { voterId: voter }, select: { proposalId: true } }),
  ]);
  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.proposalId] = g._count._all;
  return { counts, mine: mine.map((m) => m.proposalId) };
}

export async function GET(request: NextRequest) {
  const parsed = voterSchema.safeParse(request.nextUrl.searchParams.get("voter"));
  if (!parsed.success) {
    return NextResponse.json({ error: "voter must be a UUID" }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json(await tally(parsed.data), { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid vote" }, { status: 400, headers: NO_STORE });
  }
  const { proposal, voter, vote } = parsed.data;
  if (vote) {
    await prisma.designVote.createMany({
      data: [{ proposalId: proposal, voterId: voter }],
      skipDuplicates: true,
    });
  } else {
    await prisma.designVote.deleteMany({ where: { proposalId: proposal, voterId: voter } });
  }
  return NextResponse.json(await tally(voter), { headers: NO_STORE });
}
