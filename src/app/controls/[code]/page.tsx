import { notFound } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { ControlPage } from "./ControlPage";
import { decodeControlCode, loadControlPageView } from "./control-page-data";

/**
 * One Control's page, for every signed-in role (issue #314, design proposal B "Side rail and tabs"): what the
 * Control is, the Requirements it satisfies, the Organization's implementation of it and the Systems it applies
 * to with the status each shows. The code is in the URL, percent-encoded (`/controls/A.5.1`); a code no Control
 * has is a 404. A Draft Framework is invisible to anyone but a Compliance Manager or an Admin, who also get Edit.
 * `loadControlPageView` reads everything in one snapshot. `?tab=` opens one of the tabs.
 */
export default async function ControlDetailPage({ params, searchParams }: PageProps<"/controls/[code]">) {
  const { code } = await params;
  const { tab } = await searchParams;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const view = await loadControlPageView(user, decodeControlCode(code));
  if (!view) notFound();

  // Keyed on the acting user and the Control, so switching either starts from a clean state.
  return <ControlPage key={`${user.id}:${view.control.id}`} view={view} initialTab={typeof tab === "string" ? tab : null} />;
}
