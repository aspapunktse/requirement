import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { canCurateFramework } from "@/lib/frameworks";

export const FRAMEWORK_CURATION_REFUSAL =
  "Only a Compliance Manager, an Admin or (except for the base Framework) this Framework's owner can curate it";

/**
 * The one gate in front of every Framework curation route (#320): resolves the acting user, loads the Framework in
 * the URL and applies `canCurateFramework`, before the route reads a body or writes anything.
 *
 * - no acting user: 401;
 * - the Framework does not exist: 404;
 * - the user may not curate it: 403, and the route changes nothing (as the role gate this replaces did, for a Draft
 *   Framework too).
 *
 * Returns the acting user and the Framework (just what the rule and the routes' labels need). A Requirement or
 * Control Mapping in the URL must still be checked to belong to this Framework, as the routes do.
 */
export async function authorizeFrameworkCuration(request: NextRequest, frameworkId: string) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth;

  const framework = await prisma.framework.findUnique({
    where: { id: frameworkId },
    select: { id: true, name: true, version: true, status: true, isBase: true, ownerId: true },
  });
  if (!framework) return { response: NextResponse.json({ error: "Framework not found" }, { status: 404 }) };

  if (!canCurateFramework(auth.user, framework)) {
    return { response: NextResponse.json({ error: FRAMEWORK_CURATION_REFUSAL }, { status: 403 }) };
  }
  return { user: auth.user, framework };
}
