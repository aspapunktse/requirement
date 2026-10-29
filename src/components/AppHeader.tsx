"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import { JumpPalette, usePaletteToggle, type PaletteItem } from "@/app/home/JumpPalette";
import type { PublicUser } from "@/lib/acting-user";
import { ADMIN_PAGES, GO_TO_GROUP, currentNavKey, goToPaletteItems, navItemsFor, type NavItem } from "@/components/app-nav";
import { usePageRegistration, type PageRegistration } from "@/components/PaletteProvider";
import { RoleSwitcher, UserChip } from "@/components/RoleSwitcher";
import { useExclusivePopover } from "@/components/useExclusivePopover";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rg-accent";
const NAV_ITEM = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[13.5px] font-semibold text-rg-muted transition-colors motion-reduce:transition-none hover:bg-rg-accent-soft hover:text-rg-ink aria-[current=page]:bg-rg-accent-soft aria-[current=page]:font-bold aria-[current=page]:text-rg-accent ${FOCUS}`;
const BUTTON = `inline-flex items-center gap-2 rounded-[10px] border border-rg-line bg-rg-surface px-2.5 py-1.5 text-[13.5px] font-semibold text-rg-ink hover:border-rg-accent ${FOCUS}`;
const PANEL =
  "absolute top-[calc(100%+8px)] z-40 grid gap-0.5 rounded-[14px] border border-rg-line bg-rg-surface p-1.5 shadow-[var(--rg-shadow-popover)]";
const PANEL_LINK = `flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm font-semibold text-rg-ink hover:bg-rg-accent-soft aria-[current=page]:bg-rg-accent-soft aria-[current=page]:text-rg-accent ${FOCUS}`;

/**
 * A disclosure popover: a button with aria-expanded and a panel of links. One popover open at a time (see
 * `useExclusivePopover`), closed by an outside click, Escape (focus goes back to the button), picking a link, or
 * tabbing out of it.
 */
function PopoverMenu({
  id,
  label,
  current,
  buttonClassName,
  panelClassName,
  children,
}: {
  id: string;
  label: ReactNode;
  current?: boolean;
  buttonClassName: string;
  panelClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useExclusivePopover(id, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((value) => !value)}
        className={buttonClassName}
      >
        {label}
      </button>
      {open && (
        <div
          id={panelId}
          className={panelClassName}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <span aria-hidden className="text-[10px] text-rg-muted">
      ▾
    </span>
  );
}

function MenuLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={PANEL_LINK}>
      {label}
    </Link>
  );
}

const onAdminPage = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function AdminMenu({ item, current, pathname }: { item: NavItem; current: boolean; pathname: string }) {
  return (
    <PopoverMenu
      id="admin-menu"
      current={current}
      buttonClassName={`${NAV_ITEM} cursor-pointer`}
      panelClassName={`${PANEL} left-0 w-64`}
      label={
        <>
          <Icon name={item.icon} size={16} />
          {item.label}
          <Chevron />
        </>
      }
    >
      <nav aria-label="Admin pages" className="grid gap-0.5">
        {ADMIN_PAGES.map((page) => (
          <MenuLink key={page.href} href={page.href} label={page.label} current={onAdminPage(pathname, page.href)} />
        ))}
      </nav>
    </PopoverMenu>
  );
}

/**
 * The app header (#65, #256): the wordmark on the left, the main navigation with the current part of the app
 * marked, "Jump to" (Ctrl+K) and the acting user. Items a role can't open are left out. Below 1240px the
 * navigation collapses into a menu button showing the current page. The header owns the one Ctrl+K palette:
 * a page's own items (registered through `PaletteProvider`) come first, then the "Go to" pages.
 * On the sign-in page (`/`) only the wordmark shows, so the tile picker is the single way to choose a user there.
 */
export function AppHeader({ devStub, user }: { devStub: boolean; user: PublicUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSignIn = pathname === "/";
  const role = user?.role ?? null;
  const items = navItemsFor(role);
  const currentKey = currentNavKey(pathname, role);
  const currentItem = items.find((item) => item.key === currentKey);

  const registrationRef = usePageRegistration();
  const { open: paletteOpen, openPalette, closePalette } = usePaletteToggle();
  const [page, setPage] = useState<PageRegistration | null>(null);

  function openJump() {
    setPage(registrationRef?.current ?? null);
    openPalette();
  }

  useEffect(() => {
    if (isSignIn) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openJump();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const paletteItems: PaletteItem[] = [...(page?.items ?? []), ...goToPaletteItems(role, pathname)];
  function selectItem(item: PaletteItem) {
    // The page's latest handler, not the one from when the palette opened.
    const onSelect = registrationRef?.current?.onSelect;
    if (item.group !== GO_TO_GROUP && page && onSelect) onSelect(item);
    else router.push(item.href);
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2 border-b border-rg-line bg-rg-surface px-4 py-2.5 sm:px-5 sm:py-3">
      <div className="flex min-w-0 items-center gap-3 min-[1241px]:gap-5">
        <Link
          href={isSignIn ? "/" : "/home"}
          className={`flex shrink-0 items-center gap-3 rounded-[10px] text-rg-ink no-underline ${FOCUS}`}
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

        {!isSignIn && items.length > 0 && (
          <>
            <nav aria-label="Main" className="hidden items-center gap-0.5 min-[1241px]:flex">
              {items.map((item) =>
                item.href ? (
                  <Link
                    key={item.key}
                    href={item.href}
                    title={item.title}
                    aria-current={item.key === currentKey ? "page" : undefined}
                    className={NAV_ITEM}
                  >
                    <Icon name={item.icon} size={16} />
                    {item.label}
                  </Link>
                ) : (
                  <AdminMenu key={item.key} item={item} current={item.key === currentKey} pathname={pathname} />
                ),
              )}
            </nav>

            <div className="min-w-0 min-[1241px]:hidden">
              <PopoverMenu
                id="go-to-menu"
                buttonClassName={`${BUTTON} max-w-full`}
                panelClassName={`${PANEL} left-0 w-[min(300px,calc(100vw-32px))]`}
                label={
                  <>
                    <Icon name={currentItem?.icon ?? "grid"} size={16} />
                    <span className="truncate">{currentItem?.label ?? "Menu"}</span>
                    <Chevron />
                  </>
                }
              >
                <nav aria-label="Go to" className="grid gap-0.5">
                  {items.map(
                    (item) =>
                      item.href && <MenuLink key={item.key} href={item.href} label={item.title ?? item.label} current={item.key === currentKey} />,
                  )}
                </nav>
                {items.some((item) => item.key === "admin") && (
                  <nav aria-label="Admin pages" className="mt-1 grid gap-0.5 border-t border-rg-line pt-1">
                    <span className="px-2.5 pt-1 pb-0.5 text-[11px] font-bold tracking-wider text-rg-muted uppercase">Admin</span>
                    {ADMIN_PAGES.map((adminPage) => (
                      <MenuLink key={adminPage.href} href={adminPage.href} label={adminPage.label} current={onAdminPage(pathname, adminPage.href)} />
                    ))}
                  </nav>
                )}
              </PopoverMenu>
            </div>
          </>
        )}
      </div>

      {!isSignIn && (
        <div className="flex min-w-0 items-center gap-2.5">
          {user && (
            <button type="button" onClick={openJump} aria-keyshortcuts="Control+K" aria-label="Jump to" className={BUTTON}>
              <Icon name="search" size={16} />
              <span className="hidden sm:inline">Jump to</span>
              <kbd className="hc-kbd hidden sm:inline" aria-hidden="true">
                Ctrl K
              </kbd>
            </button>
          )}
          {devStub ? <RoleSwitcher /> : user && <UserChip user={user} />}
        </div>
      )}

      {!isSignIn && paletteOpen && (
        <JumpPalette items={paletteItems} onClose={closePalette} onSelect={selectItem} placeholder={page?.placeholder ?? "Jump to a page…"} />
      )}
    </header>
  );
}
