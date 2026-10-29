import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PaletteProvider } from "@/components/PaletteProvider";
import type { PublicUser } from "@/lib/acting-user";

/**
 * A page under the real app header and palette provider, as the layout renders it (#256). Without a user the
 * header has no "Jump to" button and the palette lists the page's own items only; Ctrl+K still opens it.
 * The test must mock `next/navigation` with `usePathname` and `useRouter`.
 */
export function withHeader(page: ReactNode, user: PublicUser | null = null) {
  return (
    <PaletteProvider>
      <AppHeader devStub={false} user={user} />
      {page}
    </PaletteProvider>
  );
}
