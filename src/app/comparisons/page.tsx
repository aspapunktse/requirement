import { getActingUser } from "@/lib/acting-user";
import { canCreateSystem } from "@/lib/system-permissions";
import { roleLabel } from "@/app/home/role-label";
import { ComparisonsList } from "./ComparisonsList";

/**
 * The Comparisons the acting user sees (#373), under Systems in the navigation: an Open and a Closed section. The list is read
 * from `GET /api/comparisons` by the client component, which applies the visibility rules; this page only says whether the role
 * may create one (`POST /api/comparisons` enforces it).
 */
export default async function ComparisonsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  // Keyed on the acting user, so switching user starts from a clean list.
  return <ComparisonsList key={user.id} canCreate={canCreateSystem(user)} roleLabel={roleLabel(user.role)} />;
}
