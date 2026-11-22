import { redirect } from "next/navigation";

/**
 * `/admin/frameworks` is retired (issue #413): the Frameworks are listed at `/frameworks` and each is edited at
 * `/frameworks/<id>/edit`. This keeps old bookmarks working. A page rather than `redirects` in `next.config` so
 * the redirect is covered by a unit test.
 */
export default function RetiredAdminFrameworksPage(): never {
  redirect("/frameworks");
}
