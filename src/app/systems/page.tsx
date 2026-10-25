import { getActingUser } from "@/lib/acting-user";
import { loadSystemsView } from "./systems-data";
import { SystemsRegister } from "./SystemsRegister";

/**
 * The Systems list, design proposal A "Register table" in the Home look (issue #232): a hero with the
 * Onboarding Status ring, stat cards that are saved views (one follows the acting role), and one card with
 * status tabs, search, filters, grouping and a sortable, pageable table. `loadSystemsView` reads the rows
 * and every figure in one snapshot, and only what the user may see (`visibleSystemsWhere`); the client
 * component only adds the interactions and keeps their state in the URL. Deep links from Home:
 * `?owner=me` and `?status=<OnboardingStatus>`.
 */
export default async function SystemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }

  // Keyed on the acting user, so switching user starts from a clean state: no selection or filter carried over.
  return <SystemsRegister key={user.id} view={await loadSystemsView(user)} initialQuery={params.toString()} />;
}
