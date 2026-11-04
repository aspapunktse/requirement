import { getActingUser } from "@/lib/acting-user";
import { loadWhereView, pickType } from "./where-data";
import { WhereCanIPut } from "./WhereCanIPut";

/**
 * "Where can I put this information?" (#305, ADR 0012, design proposal A): pick an Information Type and see which Systems
 * already declare it, which may hold it (their Sensitivity Level is at or above the type's) and which are below it. Every
 * signed-in role can use it; it lists only the Systems the acting user can see. `?type=<id>` names the type shown, so
 * the view can be linked and survives a reload; none or an unknown id shows the first type.
 */
export default async function WherePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const requested = (await searchParams).type;
  const view = await loadWhereView(user);
  // Keyed on the acting user, so switching user starts from a clean state (no search carried over).
  return <WhereCanIPut key={user.id} view={view} initialTypeId={pickType(view.types, Array.isArray(requested) ? requested[0] : requested)} />;
}
