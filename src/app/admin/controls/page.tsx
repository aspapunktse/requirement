import { redirect } from "next/navigation";

/**
 * `/admin/controls` is retired (issue #412): Controls are created at `/controls/new` and edited at
 * `/controls/<code>/edit`. This keeps old bookmarks working. A page rather than `redirects` in `next.config`
 * so the redirect is covered by a unit test.
 */
export default function RetiredAdminControlsPage(): never {
  redirect("/controls");
}
