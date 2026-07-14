import { useMemo, useState } from "react";
import { MessageSquareIcon, SearchXIcon } from "lucide-react";
import { rangesForKey, type SearchKey } from "@xagents/search";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { NewChatButton } from "@/components/new-chat-button";
import { PageHeader } from "@/components/page-header";
import { SearchField } from "@/components/search-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { listChats } from "@/lib/api";

// Chats search their title (weighted highest), the agent they're with, and the
// last message preview — so "the thread where I asked about X" is findable.
const CHAT_KEYS: readonly SearchKey[] = [
  { name: "chat.title", weight: 2 },
  { name: "agentName", weight: 1 },
  { name: "lastMessagePreview", weight: 1 },
];

export function ConversationsPage() {
  const { data, error, loading, reload } = useAsync(() => listChats(), []);
  const [query, setQuery] = useState("");
  const results = useFuzzySearch(data ?? [], query, CHAT_KEYS);

  const filtered = useMemo(() => results.map((r) => r.item), [results]);
  const titleRanges = useMemo(
    () => new Map(results.map((r) => [r.item.chat.id, rangesForKey(r, "chat.title")] as const)),
    [results],
  );

  return (
    <>
      <PageHeader
        title="Chats"
        description="Revisit and continue your past chats with any agent."
        action={<NewChatButton />}
      />

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : error ? (
        <EmptyState
          icon={MessageSquareIcon}
          title="Couldn't load your conversations"
          description={error}
          action={
            <Button variant="outline" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          tone="brand"
          icon={MessageSquareIcon}
          title="No conversations yet"
          description="Your history lives here — start a chat and it'll show up, ready to pick back up anytime."
          action={<NewChatButton />}
        />
      ) : (
        <div className="space-y-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search conversations…"
            className="max-w-sm"
          />
          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title="No matching conversations"
              description={`Nothing matches “${query.trim()}”. Try a different search.`}
            />
          ) : (
            <ConversationList chats={filtered} titleRanges={titleRanges} onChanged={reload} />
          )}
        </div>
      )}
    </>
  );
}
