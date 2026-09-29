import { getActingUser } from "@/lib/acting-user";
import { NewSystemForm } from "@/components/NewSystemForm";
import { canWriteSystems } from "@/lib/system-visibility";

export default async function NewSystemPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canWriteSystems(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Your role can read Systems but not create them.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">New System</h1>
      <NewSystemForm />
    </div>
  );
}
