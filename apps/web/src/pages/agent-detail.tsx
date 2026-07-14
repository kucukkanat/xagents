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
import { AgentAvatar } from "@/components/agent-avatar";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { exportAgent, getAgent, listChats } from "@/lib/api";
import { toast } from "sonner";

export function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(
    () => getAgent(id ?? ""),
    [id],
  );
  const { data: chats } = useAsync(() => listChats(id ?? ""), [id]);
  const [exporting, setExporting] = useState(false);

  // Open a draft chat; the row is created lazily on the first message.
  const onNewChat = (): void => {
    if (id) navigate(`/chat/new?agent=${id}`);
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
            <Button variant="outline" className="press" asChild>
              <Link to={`/agents/${agent.id}/edit`}>
                <PencilIcon /> Edit
              </Link>
            </Button>
            <Button variant="outline" className="press" onClick={onExport} disabled={exporting}>
              <DownloadIcon /> {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button variant="brand" className="press" onClick={onNewChat}>
              <MessageSquareIcon /> New chat
            </Button>
          </div>
        }
      />

      {/* Identity strip: avatar monogram leads the visibility + model metadata. */}
      <div className="flex flex-wrap items-center gap-3 animate-in fade-in-0 slide-in-from-top-2 duration-300 ease-out">
        <AgentAvatar name={agent.name} className="size-10" />
        <div className="flex flex-wrap items-center gap-2">
          {agent.visibility === "public" ? (
            <Badge className="border-brand-border bg-brand-subtle text-brand-muted-foreground">
              public
            </Badge>
          ) : (
            <Badge variant="secondary">private</Badge>
          )}
          <Badge variant="outline">{agent.modelId}</Badge>
          <Badge variant="outline">reasoning: {agent.reasoning}</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out">
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
            delay={40}
            items={knowledgebases.map((k) => ({ id: k.id, name: k.name, to: `/knowledgebases/${k.id}` }))}
          />
          <AttachedCard
            icon={SparklesIcon}
            title="Skills"
            delay={80}
            items={skills.map((s) => ({ id: s.id, name: s.name, to: `/skills/${s.id}` }))}
          />
        </div>
      </div>

      {chats && chats.length > 0 ? (
        <Card className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareIcon className="size-4 text-brand" /> Recent conversations
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
  delay,
}: {
  icon: typeof BookOpenIcon;
  title: string;
  items: readonly { id: string; name: string; to: string }[];
  delay: number;
}) {
  return (
    <Card
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {/* Key section icon carries the brand accent. */}
          <Icon className="size-4 text-brand" /> {title}
          {items.length > 0 ? (
            <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length}</span>
          ) : null}
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
              className="block truncate rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              {it.name}
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
