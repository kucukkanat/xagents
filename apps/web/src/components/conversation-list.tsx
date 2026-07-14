import { BotIcon, MessageSquareIcon } from "lucide-react";
import { Link } from "react-router-dom";
import type { ChatSummary } from "@xagents/core";
import { relativeTime } from "@/lib/format";

/**
 * A list of past conversations, newest first. `showAgent` reveals which agent
 * each chat belongs to — on by default for the global history, off on an agent
 * page where the agent is already implied.
 */
export function ConversationList({
  chats,
  showAgent = true,
}: {
  chats: readonly ChatSummary[];
  showAgent?: boolean;
}) {
  return (
    <ul className="divide-y rounded-xl border">
      {chats.map(({ chat, agentName, messageCount, lastMessagePreview }) => (
        <li key={chat.id}>
          <Link
            to={`/chat/${chat.id}`}
            className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent"
          >
            <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="truncate text-sm font-medium">{chat.title || "Untitled chat"}</p>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {relativeTime(chat.updatedAt)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                {lastMessagePreview ?? "No messages yet."}
              </p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                {showAgent ? (
                  <span className="inline-flex items-center gap-1">
                    <BotIcon className="size-3" />
                    {agentName}
                  </span>
                ) : null}
                <span>
                  {messageCount} {messageCount === 1 ? "message" : "messages"}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
