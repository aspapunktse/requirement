import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { closedRefusalText } from "@/lib/system-closed";
import { loadOscalPackage } from "@/lib/oscal/package-builder";
import { packageFileBytes, packageFileName, zipFiles } from "@/lib/oscal/package-zip";

/**
 * Downloads a System's OSCAL Package (#442, PRD #440): a zip of `catalog.json`, `profile.json` and `ssp.json`, generated now
 * from the System's current state (one snapshot) and not stored. Whoever may see the System may download it; 404 for an unknown
 * or invisible System (the same answer), 409 for a Rejected or Not selected one. Downloading writes no Change Event.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/oscal-package">): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const now = new Date();
  const result = await loadOscalPackage(id, auth.user, now);
  if (result.kind === "not-found") return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (result.kind === "closed") return NextResponse.json({ error: closedRefusalText(result.status) }, { status: 409 });

  const zip = zipFiles(packageFileBytes(result.pkg));
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${packageFileName(result.system.name, now)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
