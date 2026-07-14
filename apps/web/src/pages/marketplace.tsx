import { useState } from "react";
import {
  BookOpenIcon,
  BotIcon,
  CopyIcon,
  Loader2Icon,
  type LucideIcon,
  MessageSquareIcon,
  SearchXIcon,
  SparklesIcon,
  StoreIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { GalleryItem } from "@xagents/core";
import { rangesForKey } from "@xagents/search";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState } from "@/components/empty-state";
import { Highlight } from "@/components/highlight";
import { PageHeader } from "@/components/page-header";
import { SearchField } from "@/components/search-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { cloneAgent, cloneKnowledgebase, cloneSkill, getGallery } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { NAME_DESC_KEYS } from "@/lib/search-keys";
import { toast } from "sonner";

type Kind = GalleryItem["kind"];

/** Per-kind identity: icon + how we name the collection in copy. */
const KIND_ICON: Record<Kind, LucideIcon> = {
  agent: BotIcon,
  knowledgebase: BookOpenIcon,
  skill: SparklesIcon,
};
const KIND_PLURAL: Record<Kind, string> = {
  agent: "agents",
  knowledgebase: "knowledgebases",
  skill: "skills",
};

const TABS: readonly { value: Kind; label: string }[] = [
  { value: "agent", label: "Agents" },
  { value: "knowledgebase", label: "Knowledgebases" },
  { value: "skill", label: "Skills" },
];

const clone = (item: GalleryItem): Promise<unknown> =>
  item.kind === "agent"
    ? cloneAgent(item.id)
    : item.kind === "knowledgebase"
      ? cloneKnowledgebase(item.id)
      : cloneSkill(item.id);

/** Which card action is mid-flight — lets us spin the exact button, not both. */
type Busy = { readonly id: string; readonly action: "chat" | "clone" };

export function MarketplacePage() {
  const [kind, setKind] = useState<Kind>("agent");
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => getGallery(kind), [kind]);
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [query, setQuery] = useState("");
  const results = useFuzzySearch(data ?? [], query, NAME_DESC_KEYS);

  const onClone = async (item: GalleryItem) => {
    setBusy({ id: item.id, action: "clone" });
    try {
      await clone(item);
      toast.success(`Cloned "${item.name}" to your workspace`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  // Open a draft chat; the row is created lazily on the first message.
  const onChat = (item: GalleryItem): void => {
    navigate(`/chat/new?agent=${item.id}`);
  };

  return (
    <>
      <PageHeader
        title="Explore"
        description="Discover and clone agents, knowledgebases, and skills shared by the community."
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList>
          {TABS.map((t) => {
            const Icon = KIND_ICON[t.value];
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                // Accent only the active tab — key selected state, everything else stays neutral.
                className="press gap-1.5 data-[state=active]:text-brand"
              >
                <Icon className="size-4" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={StoreIcon}
          title="Couldn't load the marketplace"
          description={error}
          action={
            <Button variant="outline" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={KIND_ICON[kind]}
          title="Nothing shared here yet"
          description={`No public ${KIND_PLURAL[kind]} have been shared with the community yet — check back soon.`}
        />
      ) : (
        <div className="space-y-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={`Filter ${KIND_PLURAL[kind]}…`}
            className="max-w-sm"
          />
          {results.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title={`No matching ${KIND_PLURAL[kind]}`}
              description={`Nothing matches “${query.trim()}”. Try a different search.`}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((result, i) => {
                const item = result.item;
                const Icon = KIND_ICON[item.kind];
                // `busy &&` narrows away undefined so `.action` is safe to read.
                const active = busy && busy.id === item.id ? busy.action : undefined;
                const isBusy = active !== undefined;
                return (
                  <Card
                    key={item.id}
                    // Staggered entrance (capped) + hover-lift with a brand-tinted edge on hover.
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    className="flex flex-col animate-in fade-in-0 slide-in-from-bottom-2 transition-all duration-200 ease-fluid hover:-translate-y-0.5 hover:border-brand-border"
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        {item.kind === "agent" ? (
                          <AgentAvatar name={item.name} />
                        ) : (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                            <Icon className="size-4" />
                          </span>
                        )}
                        <CardTitle className="min-w-0 flex-1 truncate pt-1.5">
                          <Highlight text={item.name} ranges={rangesForKey(result, "name")} />
                        </CardTitle>
                        <Badge variant="secondary" className="shrink-0 capitalize">
                          {item.kind}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-3">
                      <p className="line-clamp-3 text-sm text-muted-foreground">
                        {item.description || "No description."}
                      </p>
                      {/* Owner + freshness on one wrapping row so neither gets ugly-truncated. */}
                      <div className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate font-medium text-foreground/70">
                          @{item.ownerHandle}
                        </span>
                        <span aria-hidden className="text-muted-foreground/50">
                          ·
                        </span>
                        <span className="whitespace-nowrap">{relativeTime(item.updatedAt)}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="justify-end gap-2">
                      {item.kind === "agent" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="press"
                          onClick={() => onChat(item)}
                        >
                          <MessageSquareIcon />
                          Chat
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        className="press"
                        disabled={isBusy}
                        onClick={() => onClone(item)}
                      >
                        {active === "clone" ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <CopyIcon />
                        )}
                        Clone
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
