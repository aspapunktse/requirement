import { redirect } from "next/navigation";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import { RoleChecker } from "@/components/RoleChecker";

/**
 * The dev-stub-gated "start here" page: picks who to act as, then lands on
 * /home (the real role-scoped dashboard, see #57). A stand-in for a future
 * real login page — see #59. Once an acting user is already set, this
 * redirects straight to /home rather than showing the picker again.
 */
export default async function Home() {
  const user = await getActingUser();
  if (user) {
    redirect("/home");
  }

  if (!isDevAuthStubEnabled()) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">No authentication is configured yet.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Requirement & Risk Onboarding</h1>
      <p className="mb-6 text-sm text-zinc-500">Pick a user to act as.</p>
      <RoleChecker />
    </div>
  );
}
