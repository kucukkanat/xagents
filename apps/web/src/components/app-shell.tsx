import { useState } from "react";
import {
  BookOpenIcon,
  BotIcon,
  CompassIcon,
  MenuIcon,
  MessageSquareIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";

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

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2 border-b px-5">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BotIcon className="size-4" />
      </div>
      <span className="text-sm font-semibold tracking-tight">xagents</span>
    </div>
  );
}

/** `onNavigate` lets the mobile drawer close itself when a link is tapped. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
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
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )
              }
            >
              <Icon className="size-4" />
              {label}
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

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Brand />
      <NavLinks onNavigate={onNavigate} />
      <UserFooter />
    </>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile top bar with a hamburger that opens the same nav in a drawer. */}
      <header className="flex h-14 items-center gap-2 border-b bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger className="-ml-1 flex size-9 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent">
            <MenuIcon className="size-5" />
            <span className="sr-only">Open navigation</span>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
            >
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <SidebarBody onNavigate={() => setOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BotIcon className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">xagents</span>
        </div>
      </header>

      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBody />
      </aside>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
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
