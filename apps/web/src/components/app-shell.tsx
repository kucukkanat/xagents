import { useEffect, useState } from "react";
import {
  BookOpenIcon,
  BotIcon,
  CompassIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BrandMark, Wordmark } from "@/components/brand-mark";
import { CommandPalette } from "@/components/command-palette";
import { NewChatDialog } from "@/components/new-chat-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";

// Label the shortcut hint per-platform; the listener accepts either modifier.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
const SEARCH_HINT = IS_MAC ? "⌘K" : "Ctrl K";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

interface NavSection {
  /** Undefined for the primary section (rendered without a heading). */
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

/**
 * Nav is grouped by intent, not entity type: what you *do* daily (Chats,
 * Explore) sits above your *building blocks* (the Library). The "Library"
 * heading disambiguates these owned entities from the same-named tabs in
 * Explore, which browse the public gallery.
 */
const NAV: readonly NavSection[] = [
  {
    items: [
      { to: "/", label: "Chats", icon: MessageSquareIcon },
      { to: "/explore", label: "Explore", icon: CompassIcon },
    ],
  },
  {
    heading: "Library",
    items: [
      { to: "/agents", label: "Agents", icon: BotIcon },
      { to: "/knowledgebases", label: "Knowledgebases", icon: BookOpenIcon },
      { to: "/skills", label: "Skills", icon: SparklesIcon },
    ],
  },
];

/** Every primary destination, flattened for the mobile bottom tab bar. */
const MOBILE_TABS: readonly NavItem[] = NAV.flatMap((section) => section.items);

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

function Brand() {
  return (
    <div className="flex h-14 items-center border-b px-5">
      <Wordmark />
    </div>
  );
}

function NavLinks() {
  return (
    <nav className="flex-1 space-y-6 p-3">
      {NAV.map((section, i) => (
        <div key={section.heading ?? i} className="space-y-1">
          {section.heading ? (
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              {section.heading}
            </p>
          ) : null}
          {section.items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "press relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 ease-fluid",
                  // Accent is reserved for the active destination; everything
                  // else stays neutral and only tints on hover.
                  isActive
                    ? "bg-brand-subtle text-brand"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Left rail reinforces the selected item within the pill. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand transition-opacity duration-200",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="size-4 shrink-0" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function UserFooter() {
  const { currentUser } = useConfig();
  return (
    <div className="flex items-center gap-3 border-t p-3">
      <Avatar className="size-8">
        <AvatarFallback className="text-xs">
          {initials(currentUser.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{currentUser.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">@{currentUser.handle}</p>
      </div>
      <ThemeToggle />
    </div>
  );
}

/** Sidebar entry point to the ⌘K palette — looks like a search box, opens the launcher. */
function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={onOpen}
        className="press flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="pointer-events-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          {SEARCH_HINT}
        </kbd>
      </button>
    </div>
  );
}

/** Primary sidebar action: opens the agent picker to start a fresh chat. */
function SidebarNewChat() {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 pt-2">
      <Button
        variant="brand"
        onClick={() => setOpen(true)}
        className="press w-full justify-start"
      >
        <PlusIcon className="size-4 shrink-0" />
        New chat
      </Button>
      <NewChatDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function SidebarBody({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <>
      <Brand />
      <SearchTrigger onOpen={onOpenSearch} />
      <SidebarNewChat />
      <NavLinks />
      <UserFooter />
    </>
  );
}

/** Compact identity chip for the mobile top bar (the sidebar footer is desktop-only). */
function MobileUserChip() {
  const { currentUser } = useConfig();
  return (
    <Avatar className="size-8">
      <AvatarFallback className="text-xs">
        {initials(currentUser.displayName)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Below `md`, primary navigation lives in a fixed bottom bar (thumb-reachable)
 * rather than a hamburger drawer. Callers hide it on chat routes so it never
 * covers the composer.
 */
function MobileTabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-sidebar/95 pb-safe text-sidebar-foreground backdrop-blur-md md:hidden"
    >
      <div className="grid grid-cols-5">
        {MOBILE_TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "press relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 transition-colors duration-200",
                isActive ? "text-brand" : "text-muted-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Top indicator marks the active tab. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 top-0 h-0.5 rounded-full bg-brand transition-opacity duration-200",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="size-5 shrink-0" />
                <span className="w-full truncate text-center text-[10px] font-medium leading-none">
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function AppShell() {
  // Chat owns the full viewport height (fixed composer), so the bottom tab bar
  // steps aside there to avoid overlapping it.
  const { pathname } = useLocation();
  const isChatRoute = pathname.startsWith("/chat/");
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the palette from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ignore auto-repeat from a held chord — otherwise the repeated keydowns
      // rapidly toggle the palette open/closed (Ctrl+K on Windows/Linux).
      if (e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile top bar: brand + theme toggle live here since the sidebar
          footer is desktop-only. Navigation moves to the bottom tab bar. */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <div className="flex items-center gap-2">
          <BrandMark className="size-7" />
          <span className="text-sm font-semibold tracking-tight">xagents</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="press flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <SearchIcon className="size-5" />
          </button>
          <MobileUserChip />
          <ThemeToggle />
        </div>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBody onOpenSearch={() => setSearchOpen(true)} />
      </aside>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Reserve space on mobile non-chat routes so the last item clears the
          fixed tab bar (its content + the home-indicator safe area). */}
      <main
        className={cn(
          "min-h-0 flex-1 overflow-hidden",
          !isChatRoute && "pb-[calc(3.5rem_+_env(safe-area-inset-bottom))] md:pb-0",
        )}
      >
        <Outlet />
      </main>

      {isChatRoute ? null : <MobileTabBar />}
    </div>
  );
}

/** Scrollable, padded container for standard pages (chat opts out for full height). */
export function PaddedLayout() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}
