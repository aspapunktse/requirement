import { getActingUser } from "@/lib/acting-user";
import { FrameworksCatalog } from "./FrameworksCatalog";
import { loadFrameworksView } from "./frameworks-data";

/**
 * The Framework list, design proposal A "Catalog table" in the Home look (issue #266): a hero with the
 * library-wide coverage ring, stat cards that filter, and one card with search, grouping and a sortable table.
 * `loadFrameworksView` reads the rows and every figure in one snapshot, and only what the user may see: Drafts
 * for Compliance Managers and Admins, and only the Systems the user can see in the Systems count.
 */
export default async function FrameworksOverviewPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  // Keyed on the acting user, so switching user starts from a clean state: no view or search carried over.
  return <FrameworksCatalog key={user.id} view={await loadFrameworksView(user)} />;
}
