import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenIcon,
  BotIcon,
  CornerDownLeftIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { Agent, ChatSummary, Knowledgebase, Skill } from "@xagents/core";
import { fuzzySearch, rangesForKey, type SearchResult } from "@xagents/search";
import { Highlight } from "@/components/highlight";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/hooks/use-async";
import { listAgents, listChats, listKnowledgebases, listSkills } from "@/lib/api";
import { NAME_DESC_KEYS } from "@/lib/search-keys";
import { cn } from "@/lib/utils";

type EntryKind = "agent" | "knowledgebase" | "skill" | "chat";

/** A single searchable thing, normalized across entity types. */
interface Entry {
  readonly kind: EntryKind;
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** Per-kind presentation and the primary action's label. */
const KIND: Record<EntryKind, { readonly label: string; readonly icon: LucideIcon; readonly hint: string }> = {
  agent: { label: "Agents", icon: BotIcon, hint: "Start chat" },
  knowledgebase: { label: "Knowledgebases", icon: BookOpenIcon, hint: "Open" },
  skill: { label: "Skills", icon: SparklesIcon, hint: "Open" },
  chat: { label: "Chats", icon: MessageSquareIcon, hint: "Resume" },
};

const ORDER: readonly EntryKind[] = ["agent", "knowledgebase", "skill", "chat"];

interface Loaded {
  readonly agents: readonly Agent[];
  readonly knowledgebases: readonly Knowledgebase[];
  readonly skills: readonly Skill[];
  readonly chats: readonly ChatSummary[];
}

const toEntries = (data: Loaded): Record<EntryKind, readonly Entry[]> => ({
  agent: data.agents.map((a) => ({ kind: "agent", id: a.id, name: a.name, description: a.description })),
  knowledgebase: data.knowledgebases.map((k) => ({
    kind: "knowledgebase",
    id: k.id,
    name: k.name,
    description: k.description,
  })),
  skill: data.skills.map((s) => ({ kind: "skill", id: s.id, name: s.name, description: s.description })),
  chat: data.chats.map((c) => ({
    kind: "chat",
    id: c.chat.id,
    name: c.chat.title || "Untitled chat",
    description: c.agentName,
  })),
});

/** Where each kind's primary action navigates. Agents jump straight into a new chat. */
const hrefFor = (entry: Entry): string => {
  switch (entry.kind) {
    case "agent":
      return `/chat/new?agent=${entry.id}`;
    case "knowledgebase":
      return `/knowledgebases/${entry.id}`;
    case "skill":
      return `/skills/${entry.id}`;
    case "chat":
      return `/chat/${entry.id}`;
  }
};

interface Row {
  readonly kind: EntryKind;
  readonly result: SearchResult<Entry>;
}

/**
 * The global ⌘K launcher. Loads the user's agents, knowledgebases, skills and
 * chats on open, fuzzy-searches across all of them at once, and navigates on
 * pick — Enter on an agent starts a fresh chat with it. Driven with a
 * combobox + listbox `aria-activedescendant` pattern so focus stays in the
 * input while ↑/↓ move the selection.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [data, setData] = useState<Loaded | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const activeRef = useRef<HTMLDivElement | null>(null);
  // Last real pointer position, to tell genuine mouse movement apart from the
  // synthetic mousemove Chromium fires when the list scrolls under a still cursor.
  const pointer = useRef({ x: -1, y: -1 });

  // Fetch fresh each time the palette opens; reset the query so it's a clean slate.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setData(undefined);
    setLoadError(undefined);
    pointer.current = { x: -1, y: -1 };
    let active = true;
    Promise.all([listAgents(), listKnowledgebases(), listSkills(), listChats()])
      .then(([agents, knowledgebases, skills, chats]) => {
        if (active) setData({ agents, knowledgebases, skills, chats });
      })
      .catch((e: unknown) => {
        if (active) setLoadError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [open]);

  const entries = useMemo(() => (data ? toEntries(data) : undefined), [data]);

  // One flat, ordered row list drives both rendering and keyboard selection.
  const rows: readonly Row[] = useMemo(() => {
    if (!entries) return [];
    return ORDER.flatMap((kind) =>
      fuzzySearch(entries[kind], query, NAME_DESC_KEYS).map((result) => ({ kind, result })),
    );
  }, [entries, query]);

  // Snap the selection back to the best match whenever the result set is
  // recomputed — a new query, or freshly loaded data. Keying on `rows` (not
  // `rows.length`) also covers query refinements that keep the same count but
  // reorder matches, which a length-only clamp would leave pointing at a stale
  // row (so Enter would fire the wrong result).
  useEffect(() => {
    setActiveIndex(0);
  }, [rows]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activate = (entry: Entry): void => {
    onOpenChange(false);
    navigate(hrefFor(entry));
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) activate(row.result.item);
    }
    // Escape is handled on the Content's onEscapeKeyDown — Radix dismisses it in
    // the capture phase, before this bubble-phase handler could ever run.
  };

  const activeId = rows[activeIndex] ? `cmdk-opt-${activeIndex}` : undefined;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-label="Search"
          onEscapeKeyDown={(e) => {
            // First Escape clears the query and keeps the palette open; a second
            // (empty) Escape falls through to Radix's dismiss. Owned here because
            // Radix handles Escape in the capture phase — calling preventDefault
            // keeps the layer from closing (see DismissableLayer: it only
            // dismisses when the event isn't already defaultPrevented).
            if (query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Search everything</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Find and jump to your agents, knowledgebases, skills, and chats.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-2.5 border-b px-4">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- expected for a command palette */}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search agents, knowledgebases, skills, chats…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              role="combobox"
              aria-expanded={rows.length > 0}
              aria-controls="cmdk-list"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
            />
          </div>

          <div
            id="cmdk-list"
            role="listbox"
            aria-label="Results"
            className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto p-2"
          >
            {loadError ? (
              <p className="px-3 py-8 text-center text-sm text-destructive">{loadError}</p>
            ) : !entries ? (
              <div className="space-y-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query.trim()
                  ? `No matches for “${query.trim()}”`
                  : "Nothing here yet — create an agent, knowledgebase, or skill."}
              </p>
            ) : (
              rows.map((row, i) => {
                const prev = i > 0 ? rows[i - 1] : undefined;
                const showHeader = !prev || prev.kind !== row.kind;
                const meta = KIND[row.kind];
                const Icon = meta.icon;
                const entry = row.result.item;
                const isActive = i === activeIndex;
                return (
                  <Fragment key={`${row.kind}:${entry.id}`}>
                    {showHeader ? (
                      <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                        {meta.label}
                      </p>
                    ) : null}
                    <div
                      ref={isActive ? activeRef : null}
                      id={`cmdk-opt-${i}`}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      onMouseMove={(e) => {
                        // Ignore the synthetic mousemove Chromium fires when the
                        // list scrolls under a stationary cursor during keyboard
                        // nav — only a genuine move should claim the selection.
                        if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
                          return;
                        }
                        pointer.current = { x: e.clientX, y: e.clientY };
                        setActiveIndex(i);
                      }}
                      onClick={() => activate(entry)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left",
                        isActive ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <Icon
                        className={cn("size-4 shrink-0", isActive ? "text-brand" : "text-muted-foreground")}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">
                          <Highlight text={entry.name} ranges={rangesForKey(row.result, "name")} />
                        </p>
                        {entry.description ? (
                          <p className="truncate text-xs text-muted-foreground">{entry.description}</p>
                        ) : null}
                      </div>
                      {isActive ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          {meta.hint}
                          <CornerDownLeftIcon className="size-3" />
                        </span>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
