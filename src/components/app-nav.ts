import type { UserRole } from "@prisma/client";
import type { HomeIconKey } from "@/app/home/home-types";
import { canReadInternalAudits } from "@/lib/internal-audit-rules";
import { canReadOrganizationRisks } from "@/lib/risk-roles";

/**
 * The app header's main navigation (#256): which items there are, which of them a role may open, which one a
 * path belongs to and what the Ctrl+K palette lists under "Go to". Pure data and functions, so the header, the
 * palette and the tests share them. The role rules come from the same modules the pages use.
 */

export type NavKey =
  | "home"
  | "systems"
  | "controls"
  | "risks"
  | "check-ups"
  | "internal-audits"
  | "soa"
  | "frameworks"
  | "business-risk-owner"
  | "admin";

export type NavItem = {
  key: NavKey;
  label: string;
  /** The full name, shown as the tooltip and in the narrow menu, when the label is short. */
  title?: string;
  icon: HomeIconKey;
  /** The route; absent for Admin, which opens a menu of the Admin pages. */
  href?: string;
  /** Path prefixes (whole segments) that mark this item current. */
  prefixes: string[];
  /** Whether the acting role may open the page. Items a role can't open are hidden, not greyed out. */
  allows: (role: UserRole) => boolean;
};

const everyone = () => true;

/** In order, as in the design's header (`public/design/shared/appbar.js`), then the two role-only items. */
export const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", icon: "home", href: "/home", prefixes: ["/home"], allows: everyone },
  { key: "systems", label: "Systems", icon: "system", href: "/systems", prefixes: ["/systems"], allows: everyone },
  { key: "controls", label: "Controls", icon: "control", href: "/controls", prefixes: ["/controls"], allows: everyone },
  { key: "risks", label: "Risks", icon: "risk", href: "/risks/organization", prefixes: ["/risks"], allows: (role) => canReadOrganizationRisks({ role }) },
  { key: "check-ups", label: "Check-ups", icon: "checkup", href: "/check-ups", prefixes: ["/check-ups"], allows: everyone },
  { key: "internal-audits", label: "Internal Audits", icon: "audit", href: "/internal-audits", prefixes: ["/internal-audits"], allows: (role) => canReadInternalAudits({ role }) },
  { key: "soa", label: "SoA", title: "Statement of Applicability", icon: "doc", href: "/statement-of-applicability", prefixes: ["/statement-of-applicability"], allows: everyone },
  { key: "frameworks", label: "Frameworks", icon: "layers", href: "/frameworks", prefixes: ["/frameworks"], allows: everyone },
  // Product-owner decision 1a on #256: only the role whose page it is. The page admits an Admin too, but the item shows to a Business Risk Owner only.
  { key: "business-risk-owner", label: "My Business Risks", icon: "chart", href: "/business-risk-owner", prefixes: ["/business-risk-owner"], allows: (role) => role === "BUSINESS_RISK_OWNER" },
  { key: "admin", label: "Admin", icon: "stack", prefixes: ["/admin"], allows: (role) => role === "ADMIN" },
];

/**
 * The Admin pages, one per folder under `src/app/admin`, labelled by their page heading and ordered as Home's
 * Admin shortcuts where they overlap (product-owner decision 3b on #256). Add a new Admin page here.
 */
export const ADMIN_PAGES: { label: string; href: string }[] = [
  { label: "Control Library", href: "/admin/controls" },
  { label: "Frameworks", href: "/admin/frameworks" },
  { label: "Deployment Facets", href: "/admin/deployment-facets" },
  { label: "Review Groups", href: "/admin/review-groups" },
  { label: "Business Units", href: "/admin/business-units" },
  { label: "Business Risk Owners", href: "/admin/business-risk-owners" },
  { label: "Settings", href: "/admin/settings" },
];

/** The items the role may open, in order. */
export function navItemsFor(role: UserRole | null | undefined): NavItem[] {
  return role ? NAV_ITEMS.filter((item) => item.allows(role)) : [];
}

/** The item a path belongs to, sub-pages included (`/systems/abc` is Systems, `/admin/settings` is Admin). */
export function currentNavKey(pathname: string): NavKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const item = NAV_ITEMS.find((candidate) => candidate.prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
  return item?.key ?? null;
}

/** The group name of the navigation pages in the Ctrl+K palette. */
export const GO_TO_GROUP = "Go to";

export type NavPaletteItem = { group: string; icon: HomeIconKey; label: string; meta: string; href: string };

/** The "Go to" entries for the palette: the role's navigation pages and, for an Admin, the Admin pages. */
export function goToPaletteItems(role: UserRole | null | undefined): NavPaletteItem[] {
  const items: NavPaletteItem[] = [];
  for (const item of navItemsFor(role)) {
    if (item.href) items.push({ group: GO_TO_GROUP, icon: item.icon, label: item.title ?? item.label, meta: item.title ? item.label : "", href: item.href });
    else if (item.key === "admin") {
      for (const page of ADMIN_PAGES) items.push({ group: GO_TO_GROUP, icon: item.icon, label: page.label, meta: "Admin", href: page.href });
    }
  }
  return items;
}
