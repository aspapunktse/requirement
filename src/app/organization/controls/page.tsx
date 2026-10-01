import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { listOrganizationControls } from "@/lib/organization-implementation";
import { OrganizationControlImplementations } from "@/components/OrganizationControlImplementations";

/**
 * The Organization's Controls (Organizational and Both) with their Organization
 * Control Implementation: status, description, Control Owner (PRD 0001 F-IN.1, #120).
 * Readable by every signed-in role; the rows a user may edit are editable inline.
 * `?mine=1` (the link on a Control Owner's home tasks) starts with the filter on the
 * Controls they own. The data is loaded here and passed down as props.
 */
export default async function OrganizationControlsPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const { mine } = await searchParams;
  const controls = await listOrganizationControls(prisma);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-1 text-2xl">Organization Control Implementations</h1>
      <p className="mb-4 text-sm text-zinc-500">
        How the Organization implements each Organizational and Both Control. The Control Owner, a Compliance
        Manager or an Admin can update the status and description.
      </p>
      <OrganizationControlImplementations
        controls={controls}
        user={{ id: user.id, role: user.role }}
        initialMine={mine === "1"}
      />
    </div>
  );
}
