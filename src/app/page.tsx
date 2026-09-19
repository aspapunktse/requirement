import { redirect } from "next/navigation";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import { RoleChecker } from "@/components/RoleChecker";

/**
 * The dev-stub-gated "start here" page: picks who to act as, then lands on
 * /home (the real role-scoped dashboard, see #57). A stand-in for a future
 * real login page — see #59 and #64. Once an acting user is already set, this
 * redirects straight to /home rather than showing the picker again.
 */
export default async function Home() {
  const user = await getActingUser();
  if (user) {
    redirect("/home");
  }

  if (!isDevAuthStubEnabled()) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 sm:py-24">
        <p className="ems-mono-label mb-4 text-ems-ink-3">{"// Sign-in unavailable"}</p>
        <h1 className="font-sans! text-3xl">Sign in to continue</h1>
        <p className="mt-3 text-ems-ink-3">No authentication is configured yet.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:py-24">
      <p className="ems-mono-label mb-4 text-ems-ink-3">{"// Dev sign-in · Requirement & Risk Onboarding"}</p>
      <h1 className="font-sans! text-3xl">Sign in to continue</h1>
      <p className="mt-3 mb-8 text-ems-ink-2">
        Pick the user you want to act as. You will only see pages relevant to that user&apos;s role.
      </p>
      <RoleChecker />
    </main>
  );
}
