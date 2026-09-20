"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";
import { RoleSwitcher, UserChip } from "@/components/RoleSwitcher";

/**
 * The app header, following the isms header: a logo mark and wordmark on
 * the left, the acting-user chip on the right. The chip doubles as the role
 * switcher when the dev auth stub is on. On the sign-in page (`/`) only the
 * wordmark shows, so the tile picker is the single way to choose a user
 * there. See #65.
 */
export function AppHeader({ devStub, user }: { devStub: boolean; user: PublicUser | null }) {
  const pathname = usePathname();
  const isSignIn = pathname === "/";

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-300 bg-ems-paper-1 px-4 py-3 sm:px-6 dark:border-zinc-700">
      <Link href={isSignIn ? "/" : "/home"} className="flex items-center gap-3" aria-label="ISMS - system onboarding">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center bg-ems-blue">
          <span className="size-4 rounded-full border-2 border-ems-paper-1" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-medium tracking-wide text-ems-blue">ISMS</span>
          <span className="ems-mono-label hidden text-ems-ink-4 sm:block">System onboarding</span>
        </span>
      </Link>

      {!isSignIn && (devStub ? <RoleSwitcher /> : user && <UserChip user={user} />)}
    </header>
  );
}
