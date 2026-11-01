import { getActingUser } from "@/lib/acting-user";
import { ControlsRegister } from "./ControlsRegister";
import { loadOrganizationControlsView } from "./controls-data";

/**
 * The Organization's Controls (Organizational and Both) with their Organization Control Implementation: status,
 * description, Control Owner (PRD 0001 F-IN.1, #120), as design proposal A "Implementation register" in the Home
 * look (issue #284). Readable by every signed-in role; the rows a user may edit open an editor in place, and
 * `PATCH /api/organization/controls/[controlId]` (one) and `PATCH /api/organization/controls` (several) enforce
 * who may write. `?mine=1` (the link on a Control Owner's home tasks) starts with the Controls they own.
 * `loadOrganizationControlsView` reads everything in one snapshot.
 */
export default async function OrganizationControlsPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  const { mine } = await searchParams;
  const view = await loadOrganizationControlsView(user);

  // Keyed on the acting user, so switching user starts from a clean state: no filter, search or open Control carried over.
  return <ControlsRegister key={user.id} view={view} initialMine={mine === "1"} />;
}
