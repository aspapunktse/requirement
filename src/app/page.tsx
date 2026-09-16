import Link from "next/link";
import { redirect } from "next/navigation";
import { getActingUser, isDevAuthStubEnabled } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { RolePicker } from "@/components/RolePicker";

/**
 * The role-checker/picker page: a dev-only stand-in for a real login page,
 * shown when no acting user is set (or to switch who you're acting as before
 * heading in). The role-differentiated dashboard itself lives at /home. See
 * issue #59 for why this split exists, and #57 for /home's redesign.
 */
export default async function RootPage() {
  if (!isDevAuthStubEnabled()) {
    redirect("/home");
  }

  const [users, actingUser] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
    getActingUser(),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Pick a user to act as</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Dev-only stand-in for a real login page. Choose who you want to act as below.
      </p>

      {actingUser && (
        <div className="mb-6 flex items-center justify-between rounded-[var(--ems-radius-2)] border border-zinc-200 bg-ems-paper-2 p-4 dark:border-zinc-800">
          <span className="text-sm">
            Currently acting as <strong>{actingUser.name}</strong> ({actingUser.role.replace(/_/g, " ")})
          </span>
          <Link href="/home" className="text-sm font-medium underline">
            Continue to /home &rarr;
          </Link>
        </div>
      )}

      <RolePicker users={users} actingUserId={actingUser?.id ?? null} />
    </div>
  );
}
