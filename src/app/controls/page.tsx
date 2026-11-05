import { getActingUser } from "@/lib/acting-user";
import { ControlLibraryWorkbench } from "./ControlLibraryWorkbench";
import { loadControlLibraryView } from "./library-data";

/**
 * The Control Library for every signed-in role (PRD 0001 F-CL, #169), as design proposal A "Workbench" in the
 * Home look (issue #313): each Control with its scoping, Control Owner, Organization status and the Requirements
 * it satisfies. A Draft Framework is invisible to anyone but a Compliance Manager or an Admin, who also get the
 * edit actions (New Control, Edit, bulk Assign owner); the editor itself stays at `/admin/controls`.
 * `loadControlLibraryView` reads everything in one snapshot. `/controls#<code>` opens that Control's drawer.
 */
export default async function ControlLibraryReadPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const view = await loadControlLibraryView(user);

  // Keyed on the acting user, so switching user starts from a clean state: no filter, selection or open Control carried over.
  return <ControlLibraryWorkbench key={user.id} view={view} />;
}
