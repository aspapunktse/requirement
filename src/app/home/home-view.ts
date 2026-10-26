import type { UserRole } from "@prisma/client";
import type { NavTile } from "@/components/ui/TileNav";
import { ORGANIZATION_RISKS_HREF } from "@/lib/risks";
import { roleView } from "./role-view";
import { roleLabel } from "./role-label";
import type { HomeIconKey, HomeTile, HomeView } from "./home-types";

/** Every role can read the Framework Coverage view (#74), so it is a shortcut for all of them. */
const FRAMEWORK_COVERAGE_TILE: NavTile = {
  title: "Framework coverage",
  description: "Which Requirements the Control Library covers, and the gaps.",
  href: "/frameworks",
};

const ICON_BY_HREF: Record<string, HomeIconKey> = {
  "/systems/new": "plus",
  "/systems": "stack",
  "/systems?owner=me": "stack",
  "/systems?status=ONBOARDED": "stack",
  "/check-ups": "check",
  "/controls": "book",
  "/admin/controls": "book",
  "/statement-of-applicability": "doc",
  "/internal-audits": "search",
  "/frameworks": "grid",
  "/admin/frameworks": "layers",
  "/admin/deployment-facets": "layers",
  "/admin/review-groups": "layers",
  "/admin/settings": "layers",
  "/organization/controls": "building",
  [ORGANIZATION_RISKS_HREF]: "alert",
  "/business-risk-owner": "chart",
};

/** The role's own first shortcut is its primary one (the empty state of the task list points at it). */
export function homeTiles(tiles: NavTile[]): HomeTile[] {
  return [...tiles, FRAMEWORK_COVERAGE_TILE].map((tile, index) => ({
    title: tile.title,
    description: tile.description,
    href: tile.href,
    ...(tile.foot && { foot: tile.foot }),
    icon: ICON_BY_HREF[tile.href] ?? "grid",
    ...(index === 0 && { primary: true }),
  }));
}

/** Everything the Home page's client component shows for `user`, as plain serialisable data. */
export async function homeView(user: { id: string; name: string; role: UserRole }, now = new Date()): Promise<HomeView> {
  const view = await roleView(user, now);
  return {
    name: user.name,
    role: user.role,
    roleLabel: roleLabel(user.role),
    lede: view.lede,
    ...(view.scope && { scope: view.scope }),
    stats: view.stats,
    tasks: view.tasks,
    tiles: homeTiles(view.tiles),
    picture: view.picture,
    activity: view.activity,
  };
}
