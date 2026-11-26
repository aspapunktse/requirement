import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { prisma } from "@/lib/prisma";
import { packageFileName } from "@/lib/oscal/package-zip";

/**
 * Downloads one stored OSCAL Release (#453): the exact bytes that were stored, never rebuilt. Whoever may see the System may
 * download; 404 for an unknown or invisible System or a release number it doesn't have (and for a number that isn't a positive
 * integer). A System that has since closed keeps its releases downloadable. There is deliberately no PATCH, PUT or DELETE: a
 * release is never changed or removed through the app (Next answers those with 405).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/oscal-releases/[number]">): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, number: raw } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  const number = /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
  const release = number === null ? null : await prisma.oscalRelease.findUnique({ where: { systemId_number: { systemId: id, number } }, select: { data: true, createdAt: true, number: true } });
  if (!release) return NextResponse.json({ error: "Release not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(release.data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(release.data.length),
      "Content-Disposition": `attachment; filename="${packageFileName(system.name, release.createdAt, release.number)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
