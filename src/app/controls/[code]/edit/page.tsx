import Link from "next/link";
import { notFound } from "next/navigation";
import { getActingUser } from "@/lib/acting-user";
import { canEditControlLibrary } from "@/lib/control-library";
import { decodeControlCode } from "../control-page-data";
import { controlHref } from "../control-page-logic";
import { ControlEditor } from "./ControlEditor";
import { loadControlEditView } from "./control-edit-data";

/**
 * The editor for one Control (issue #314, decision 3), for a Compliance Manager or an Admin: the same two roles
 * `PATCH /api/controls/[id]` accepts. Any other role gets the refusal below (as `/admin/controls` words it), and
 * nothing of the Control is read for them. A code no Control has is a 404. `?tab=` is the tab of the Control's
 * page to return to.
 */
export default async function EditControlPage({ params, searchParams }: PageProps<"/controls/[code]/edit">) {
  const { code: segment } = await params;
  const { tab } = await searchParams;
  const code = decodeControlCode(segment);
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!canEditControlLibrary(user)) {
    return (
      <p className="p-6 text-rg-muted">
        Only Compliance Managers and Admins can edit Controls.{" "}
        <Link href={controlHref(code)} className="text-ems-blue hover:underline">
          Back to the Control
        </Link>
        .
      </p>
    );
  }

  const view = await loadControlEditView(code);
  if (!view) notFound();

  // Keyed on the acting user and the Control, so switching either starts from a clean form.
  return <ControlEditor key={`${user.id}:${view.control.id}`} view={view} returnTab={typeof tab === "string" ? tab : null} />;
}
