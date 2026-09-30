import { getActingUser } from "@/lib/acting-user";
import { NewSystemForm } from "@/components/NewSystemForm";
import { canCreateSystem } from "@/lib/system-permissions";

export default async function NewSystemPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canCreateSystem(user)) {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only a System Owner, Risk Owner or Admin can create a System.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">New System</h1>
      <NewSystemForm />
    </div>
  );
}
