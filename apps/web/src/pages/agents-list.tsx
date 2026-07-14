import { useState } from "react";
import {
  BotIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  SearchXIcon,
  Trash2Icon,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { Agent } from "@xagents/core";
import { rangesForKey } from "@xagents/search";
import { AgentAvatar } from "@/components/agent-avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Highlight } from "@/components/highlight";
import { ImportAgentDialog } from "@/components/import-agent-dialog";
import { PageHeader } from "@/components/page-header";
import { SearchField } from "@/components/search-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { useFuzzySearch } from "@/hooks/use-fuzzy-search";
import { deleteAgent, listAgents } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { NAME_DESC_KEYS } from "@/lib/search-keys";
import { toast } from "sonner";

// The lone brand action on this page — routes to the editor from anywhere it renders.
const NewAgentButton = () => (
  <Button asChild variant="brand" className="press">
    <Link to="/agents/new">
      <PlusIcon /> New agent
    </Link>
  </Button>
);

export function AgentsListPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(listAgents, []);
  const [query, setQuery] = useState("");
  const results = useFuzzySearch(data ?? [], query, NAME_DESC_KEYS);

  // Open a draft chat; the row is created lazily on the first message.
  const onChat = (agent: Agent): void => {
    navigate(`/chat/new?agent=${agent.id}`);
  };

  return (
    <>
      <PageHeader
        title="My agents"
        description="Build and manage your AI agents."
        action={
          <div className="flex gap-2">
            <ImportAgentDialog onImported={reload} />
            <NewAgentButton />
          </div>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={BotIcon}
          title="Couldn't load your agents"
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
          icon={BotIcon}
          title="Create your first agent"
          description="Start from scratch with your own instructions and model, or import a template to get going fast."
          action={<NewAgentButton />}
        />
      ) : (
        <div className="space-y-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter agents…"
            className="max-w-sm"
          />
          {results.length === 0 ? (
            <EmptyState
              icon={SearchXIcon}
              title="No matching agents"
              description={`Nothing matches “${query.trim()}”. Try a different search.`}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((result, i) => {
                const agent = result.item;
                return (
                  <Card
                    key={agent.id}
                    // Staggered entrance + hover-lift toward the brand-tinted border.
                    className="group flex flex-col transition-all duration-200 ease-fluid animate-in fade-in-0 slide-in-from-bottom-2 hover:-translate-y-0.5 hover:border-brand-border"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <AgentAvatar name={agent.name} className="size-9" />
                        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                          <CardTitle className="min-w-0 truncate">
                            <Link
                              to={`/agents/${agent.id}`}
                              className="transition-colors hover:text-brand"
                            >
                              <Highlight text={agent.name} ranges={rangesForKey(result, "name")} />
                            </Link>
                          </CardTitle>
                          {agent.visibility === "public" ? (
                            <Badge className="border-brand-border bg-brand-subtle text-brand-muted-foreground">
                              public
                            </Badge>
                          ) : (
                            <Badge variant="secondary">private</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {agent.description || "No description."}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        {agent.modelId} · updated {relativeTime(agent.updatedAt)}
                      </p>
                    </CardContent>
                    <CardFooter className="gap-2">
                      <Button className="press" onClick={() => onChat(agent)}>
                        <MessageSquareIcon /> Chat
                      </Button>
                      <Button variant="outline" className="press" asChild>
                        <Link to={`/agents/${agent.id}/edit`}>
                          <PencilIcon /> Edit
                        </Link>
                      </Button>
                      <ConfirmDialog
                        title={`Delete "${agent.name}"?`}
                        description="This permanently removes the agent and can't be undone."
                        confirmLabel="Delete"
                        trigger={
                          <Button
                            size="icon"
                            variant="ghost"
                            className="press ml-auto text-muted-foreground hover:text-destructive"
                            aria-label="Delete agent"
                          >
                            <Trash2Icon />
                          </Button>
                        }
                        onConfirm={async () => {
                          await deleteAgent(agent.id);
                          toast.success(`Deleted "${agent.name}"`);
                          reload();
                        }}
                      />
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
