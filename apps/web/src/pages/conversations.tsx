import { MessageSquareIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsync } from "@/hooks/use-async";
import { listChats } from "@/lib/api";

export function ConversationsPage() {
  const { data, error, loading, reload } = useAsync(() => listChats(), []);

  return (
    <>
      <PageHeader
        title="Chats"
        description="Revisit and continue your past chats with any agent."
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
          icon={MessageSquareIcon}
          title="No conversations yet"
          description="Start chatting with an agent and it'll show up here."
          action={
            <Button asChild>
              <Link to="/agents">Browse agents</Link>
            </Button>
          }
        />
      ) : (
        <ConversationList chats={data} />
      )}
    </>
  );
}
