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
    <header className="flex items-center justify-between gap-3.5 border-b border-rg-line bg-rg-surface px-5 py-3">
      <Link
        href={isSignIn ? "/" : "/home"}
        className="flex items-center gap-3 text-rg-ink no-underline"
        aria-label="ISMS - system onboarding"
      >
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[var(--rg-radius-md)] bg-rg-accent">
          <span className="size-3 rounded-full border-2 border-rg-on-accent" />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-bold">ISMS</span>
          <span className="hidden text-xs text-rg-muted sm:block">System onboarding</span>
        </span>
      </Link>

      {!isSignIn && (devStub ? <RoleSwitcher /> : user && <UserChip user={user} />)}
    </header>
  );
}
