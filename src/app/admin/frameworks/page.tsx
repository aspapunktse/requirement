import { getActingUser } from "@/lib/acting-user";
import { FrameworkManager } from "@/components/FrameworkManager";

export default async function FrameworksPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Only Admins can manage the Framework catalog.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">Frameworks</h1>
      <FrameworkManager />
    </div>
  );
}
