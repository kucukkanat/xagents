import { useState } from "react";
import { BotIcon, MessageSquareIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { Agent } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { createChat, deleteAgent, listAgents } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { toast } from "sonner";

export function AgentsListPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(listAgents, []);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const onChat = async (agent: Agent) => {
    setBusy(agent.id);
    try {
      const chat = await createChat({ agentId: agent.id });
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(undefined);
    }
  };

  const onDelete = async (agent: Agent) => {
    if (!confirm(`Delete "${agent.name}"? This can't be undone.`)) return;
    setBusy(agent.id);
    try {
      await deleteAgent(agent.id);
      toast.success(`Deleted "${agent.name}"`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="My agents"
        description="Build and manage your AI agents."
        action={
          <Button asChild>
            <Link to="/agents/new">
              <PlusIcon /> New agent
            </Link>
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
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
          icon={BotIcon}
          title="No agents yet"
          description="Create your first agent to start chatting."
          action={
            <Button asChild>
              <Link to="/agents/new">
                <PlusIcon /> New agent
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((agent) => (
            <Card key={agent.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">
                    <Link to={`/agents/${agent.id}`} className="hover:underline">
                      {agent.name}
                    </Link>
                  </CardTitle>
                  <Badge variant={agent.visibility === "public" ? "default" : "secondary"}>
                    {agent.visibility}
                  </Badge>
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
                <Button size="sm" disabled={busy === agent.id} onClick={() => onChat(agent)}>
                  <MessageSquareIcon /> Chat
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/agents/${agent.id}/edit`}>
                    <PencilIcon /> Edit
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  disabled={busy === agent.id}
                  aria-label="Delete agent"
                  onClick={() => onDelete(agent)}
                >
                  <Trash2Icon />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
