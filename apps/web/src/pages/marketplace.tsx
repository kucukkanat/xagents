import { useState } from "react";
import { CopyIcon, MessageSquareIcon, StoreIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { GalleryItem } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, useAsync } from "@/hooks/use-async";
import {
  cloneAgent,
  cloneKnowledgebase,
  cloneSkill,
  createChat,
  getGallery,
} from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { toast } from "sonner";

type Kind = GalleryItem["kind"];

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

export function MarketplacePage() {
  const [kind, setKind] = useState<Kind>("agent");
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => getGallery(kind), [kind]);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const onClone = async (item: GalleryItem) => {
    setBusy(item.id);
    try {
      await clone(item);
      toast.success(`Cloned "${item.name}" to your workspace`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  const onChat = async (item: GalleryItem) => {
    setBusy(item.id);
    try {
      const chat = await createChat({ agentId: item.id });
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="Explore"
        description="Discover and clone agents, knowledgebases, and skills shared by the community."
      />

      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
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
          icon={StoreIcon}
          title="Nothing here yet"
          description="Public items will appear here once the community shares them."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item) => (
            <Card key={item.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">{item.name}</CardTitle>
                  <Badge variant="secondary" className="capitalize">
                    {item.kind}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {item.description || "No description."}
                </p>
              </CardContent>
              <CardFooter className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  @{item.ownerHandle} · {relativeTime(item.updatedAt)}
                </span>
                <div className="flex gap-2">
                  {item.kind === "agent" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === item.id}
                      onClick={() => onChat(item)}
                    >
                      <MessageSquareIcon /> Chat
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={busy === item.id} onClick={() => onClone(item)}>
                    <CopyIcon /> Clone
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
