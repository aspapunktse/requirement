import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { canEditControlLibrary, loadControlLibrary } from "@/lib/control-library";
import { ControlLibrary } from "@/components/ControlLibrary";
import { buttonClassName } from "@/components/ui/Button";

/**
 * The Control Library, read-only, for every signed-in role (PRD 0001 F-CL, #169): each Control with its
 * scoping, Self-Assessment Question, Control Owner and the Requirements it satisfies. A Draft Framework
 * is invisible to anyone but a Compliance Manager or an Admin, who also get a link to the editor.
 */
export default async function ControlLibraryReadPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const rows = await loadControlLibrary(user);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">Control Library</h1>
        {canEditControlLibrary(user) && (
          <Link href="/admin/controls" className={buttonClassName("secondary")}>
            Edit Controls
          </Link>
        )}
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        Every Control, base and Supplementary, with what it applies to and the Framework Requirements it satisfies.
      </p>
      <ControlLibrary rows={rows} />
    </div>
  );
}
