import { useEffect, useState } from "react";
import { PlusIcon, SearchXIcon, SparklesIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { Agent } from "@xagents/core";
import { rangesForKey } from "@xagents/search";
import { AgentAvatar } from "@/components/agent-avatar";
import { Highlight } from "@/components/highlight";
import { SearchField } from "@/components/search-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { listAgents } from "@/lib/api";
import { NAME_DESC_KEYS } from "@/lib/search-keys";
import { cn } from "@/lib/utils";

/**
 * The shared "start a fresh conversation" flow, as a controlled dialog: lists
 * the user's agents and, on pick, opens a draft chat with that agent. A chat is
 * always bound to an agent, so every entry point (the Chats page header, its
 * empty state, the sidebar) routes through this picker to choose one.
 */
export function NewChatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The filter lives here (not in AgentPicker) so the dialog can own Escape:
  // Radix dismisses Escape in the capture phase, before SearchField's own
  // keydown could swallow it, so a first Escape must clear from up here. The
  // content unmounts on close, so reset the filter when the dialog closes.
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => {
          // First Escape clears the filter (dialog stays open); an empty filter
          // falls through to Radix's dismiss. preventDefault keeps the layer
          // open (DismissableLayer only dismisses when not already prevented).
          if (query) {
            e.preventDefault();
            setQuery("");
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Start a new chat</DialogTitle>
          <DialogDescription>Pick an agent to begin the conversation.</DialogDescription>
        </DialogHeader>
        {/* Radix unmounts content when closed, so the picker (and its fetch)
            only runs while the dialog is actually open. */}
        <AgentPicker query={query} onQueryChange={setQuery} onNavigate={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The primary way to start a fresh conversation: a brand button that opens the
 * agent picker. Rendered both as the Chats page-header action and inside its
 * empty state, so a first-run user has an obvious next step.
 */
export function NewChatButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="brand" className="press" onClick={() => setOpen(true)}>
        <PlusIcon /> New chat
      </Button>
      <NewChatDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function AgentPicker({
  query,
  onQueryChange,
  onNavigate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(listAgents, []);
  const results = useFuzzySearch(data ?? [], query, NAME_DESC_KEYS);

  // Open a draft chat — the row is created lazily on the first message, so
  // picking an agent and backing out never leaves an empty conversation behind.
  const pick = (agent: Agent): void => {
    onNavigate();
    navigate(`/chat/new?agent=${agent.id}`);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={reload} className="press">
          Retry
        </Button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          You don&apos;t have any agents yet — create one to start chatting.
        </p>
        <Button asChild className="press" onClick={onNavigate}>
          <Link to="/agents/new">
            <PlusIcon /> Create an agent
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SearchField value={query} onChange={onQueryChange} placeholder="Search agents…" autoFocus />
      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <SearchXIcon className="size-5" />
          <p>No agents match “{query.trim()}”.</p>
        </div>
      ) : (
        <ul className="scrollbar-subtle -mx-1 max-h-[min(60vh,24rem)] space-y-1.5 overflow-y-auto px-1">
          {results.map((result, i) => {
            const agent = result.item;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => pick(agent)}
                  // Cap the stagger so a long agent list doesn't feel sluggish.
                  style={{ animationDelay: `${Math.min(i, 7) * 40}ms` }}
                  className={cn(
                    "press group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left",
                    "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out",
                    "transition-all duration-200 ease-fluid hover:-translate-y-0.5 hover:border-brand-border hover:bg-accent",
                  )}
                >
                  <AgentAvatar name={agent.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <Highlight text={agent.name} ranges={rangesForKey(result, "name")} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {agent.description || "No description."}
                    </p>
                  </div>
                  <SparklesIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:text-brand group-hover:opacity-100" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
