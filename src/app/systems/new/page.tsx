import { getActingUser } from "@/lib/acting-user";
import { NewSystemForm } from "@/components/NewSystemForm";

export default async function NewSystemPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">New System</h1>
      <NewSystemForm />
    </div>
  );
}
