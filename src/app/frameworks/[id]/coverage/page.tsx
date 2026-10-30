import { getActingUser } from "@/lib/acting-user";
import { FrameworkCoverage } from "./FrameworkCoverage";
import { loadCoverageView } from "./coverage-data";

/**
 * The Framework coverage page, design proposal A "Gap ledger" in the Home look (issue #269): a hero with the
 * resolved-coverage ring, stat cards that filter, and one card with section tabs, search, the table and the
 * Requirement drawer. `loadCoverageView` reads everything in one snapshot and decides what the acting user may
 * see: a Draft Framework is "not found" for anyone who can't see Drafts. `?section=` preselects a section tab.
 */
export default async function FrameworkCoveragePage({ params, searchParams }: PageProps<"/frameworks/[id]/coverage">) {
  const { id } = await params;
  const { section } = await searchParams;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const view = await loadCoverageView(user, id, typeof section === "string" ? section : null);
  if (!view) {
    return <p className="p-6 text-rg-muted">Framework not found.</p>;
  }

  // Keyed on the acting user and the Framework, so switching either starts from a clean state: no filter, search or selection carried over.
  return <FrameworkCoverage key={`${user.id}:${id}`} view={view} />;
}
