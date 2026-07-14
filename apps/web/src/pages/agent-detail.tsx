import { useState } from "react";
import {
  BookOpenIcon,
  BotIcon,
  DownloadIcon,
  MessageSquareIcon,
  PencilIcon,
  SparklesIcon,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { createChat, exportAgent, getAgent, listChats } from "@/lib/api";
import { toast } from "sonner";

export function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(
    () => getAgent(id ?? ""),
    [id],
  );
  const { data: chats } = useAsync(() => listChats(id ?? ""), [id]);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const onNewChat = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const chat = await createChat({ agentId: id });
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const onExport = async () => {
    if (!id) return;
    setExporting(true);
    try {
      await exportAgent(id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data) {
    return (
      <EmptyState
        icon={BotIcon}
        title="Couldn't load this agent"
        description={error ?? "Not found."}
        action={
          <Button variant="outline" onClick={reload}>
            Retry
          </Button>
        }
      />
    );
  }

  const { agent, knowledgebases, skills } = data;

  return (
    <>
      <PageHeader
        title={agent.name}
        description={agent.description || "No description."}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={`/agents/${agent.id}/edit`}>
                <PencilIcon /> Edit
              </Link>
            </Button>
            <Button variant="outline" onClick={onExport} disabled={exporting}>
              <DownloadIcon /> {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button onClick={onNewChat} disabled={busy}>
              <MessageSquareIcon /> New chat
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant={agent.visibility === "public" ? "default" : "secondary"}>
          {agent.visibility}
        </Badge>
        <Badge variant="outline">{agent.modelId}</Badge>
        <Badge variant="outline">reasoning: {agent.reasoning}</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown content={agent.instructionsMd} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <AttachedCard
            icon={BookOpenIcon}
            title="Knowledgebases"
            items={knowledgebases.map((k) => ({ id: k.id, name: k.name, to: `/knowledgebases/${k.id}` }))}
          />
          <AttachedCard
            icon={SparklesIcon}
            title="Skills"
            items={skills.map((s) => ({ id: s.id, name: s.name, to: `/skills/${s.id}` }))}
          />
        </div>
      </div>

      {chats && chats.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareIcon className="size-4" /> Recent conversations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ConversationList chats={chats} showAgent={false} />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function AttachedCard({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof BookOpenIcon;
  title: string;
  items: readonly { id: string; name: string; to: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None attached.</p>
        ) : (
          items.map((it) => (
            <Link
              key={it.id}
              to={it.to}
              className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              {it.name}
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
