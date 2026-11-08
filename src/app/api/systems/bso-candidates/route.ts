import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { listBusinessSystemOwnerCandidates } from "@/lib/business-system-owner";
import { mayListBusinessSystemOwnerCandidates } from "@/lib/system-owner";

/**
 * The users who could be a System's Business System Owner (#321): every User, whatever the role. Only for
 * someone who picks one (an Admin, a role that may create a System, or the owner of a System who isn't
 * read-only); everyone else gets 403, as the list holds names and email addresses.
 * Returns `{ users: [{ id, name, email, role }] }`.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  if (!(await mayListBusinessSystemOwnerCandidates(auth.user))) {
    return NextResponse.json({ error: "Only an Admin, a System creator or a System's owner can list possible Business System Owners" }, { status: 403 });
  }
  return NextResponse.json({ users: await listBusinessSystemOwnerCandidates() });
}
