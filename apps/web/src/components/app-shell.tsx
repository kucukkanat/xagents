import {
  BookOpenIcon,
  BotIcon,
  SparklesIcon,
  StoreIcon,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

const NAV: readonly NavItem[] = [
  { to: "/", label: "Marketplace", icon: StoreIcon },
  { to: "/agents", label: "Agents", icon: BotIcon },
  { to: "/knowledgebases", label: "Knowledgebases", icon: BookOpenIcon },
  { to: "/skills", label: "Skills", icon: SparklesIcon },
];

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export function AppShell() {
  const { currentUser } = useConfig();
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BotIcon className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">xagents</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
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
        </nav>

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
