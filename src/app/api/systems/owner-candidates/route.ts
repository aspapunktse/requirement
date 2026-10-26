import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { listOwnerCandidates, mayListOwnerCandidates } from "@/lib/system-owner";

/**
 * The users who could become a System's owner (#233): everyone with a System-creating role. Only for a
 * user who can change some System's owner (an Admin, or the owner of at least one System); everyone else
 * gets 403, a read-only role included. `GET /api/users` stays for Admins and requirement-database managers.
 * Returns `{ users: [{ id, name, email, role }] }`.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  if (!(await mayListOwnerCandidates(auth.user))) {
    return NextResponse.json({ error: "Only an Admin or a System's owner can list possible owners" }, { status: 403 });
  }
  return NextResponse.json({ users: await listOwnerCandidates() });
}
