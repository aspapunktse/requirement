import { NextRequest, NextResponse } from "next/server";
import { strToU8, zipSync } from "fflate";
import { authenticate } from "@/lib/api-authz";
import { closedRefusalText } from "@/lib/system-closed";
import { loadOscalPackage, PACKAGE_FILES } from "@/lib/oscal/package-builder";

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

  const json = (doc: unknown) => strToU8(JSON.stringify(doc, null, 2) + "\n");
  const zip = zipSync({
    [PACKAGE_FILES.catalog]: json(result.pkg.catalog),
    [PACKAGE_FILES.profile]: json(result.pkg.profile),
    [PACKAGE_FILES.ssp]: json(result.pkg.ssp),
  });
  const slug = result.system.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "system";
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="oscal-package-${slug}-${now.toISOString().slice(0, 10)}.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
