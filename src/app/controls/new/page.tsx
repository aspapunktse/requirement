import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { NewControlForm } from "./NewControlForm";

/**
 * "New Control" (issue #412): the create form that used to sit at `/admin/controls`, on its own page in the
 * Control Library look. Compliance Managers and Admins only (the roles `POST /api/controls` admits). Any other
 * role gets the refusal below, as the editor words it. After a create the new Control's editor opens, where its
 * Deployment Facets, Sensitivity Level and Impact Level minimums and Control Owner are set. This static route
 * wins over `/controls/[code]`, which is why the code `new` is reserved (`control-schema.ts`).
 */
export default async function NewControlPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role)) {
    return (
      <p className="p-6 text-rg-muted">
        Only Compliance Managers and Admins can create Controls.{" "}
        <Link href="/controls" className="text-ems-blue hover:underline">
          Back to the Control Library
        </Link>
        .
      </p>
    );
  }

  // Keyed on the acting user, so switching user starts from a clean form.
  return <NewControlForm key={user.id} />;
}
