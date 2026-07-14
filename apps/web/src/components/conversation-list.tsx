import { useEffect, useState } from "react";
import { Loader2Icon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Chat, ChatSummary } from "@xagents/core";
import type { MatchRange } from "@xagents/search";
import { AgentAvatar } from "@/components/agent-avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/hooks/use-async";
import { deleteChat, renameChat } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/**
 * A list of past conversations, newest first. `showAgent` reveals which agent
 * each chat belongs to — on by default for the global history, off on an agent
 * page where the agent is already implied. `onChanged` is called after a row is
 * renamed or deleted so the owner can refetch. `titleRanges` optionally supplies
 * fuzzy-match ranges (by chat id) to highlight in each title.
 */
export function ConversationList({
  chats,
  showAgent = true,
  onChanged,
  titleRanges,
}: {
  chats: readonly ChatSummary[];
  showAgent?: boolean;
  onChanged?: () => void;
  titleRanges?: ReadonlyMap<string, readonly MatchRange[]>;
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {chats.map(({ chat, agentName, messageCount, lastMessagePreview }, i) => {
        const title = chat.title || "Untitled chat";
        const ranges = titleRanges?.get(chat.id);
        return (
          <li
            key={chat.id}
            className="group relative animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out"
            // Cap the stagger so a long history doesn't feel sluggish on load.
            style={{ animationDelay: `${Math.min(i, 7) * 40}ms` }}
          >
            <Link
              to={`/chat/${chat.id}`}
              className="flex items-start gap-3 px-4 py-3 pr-12 transition-colors hover:bg-accent"
            >
              <AgentAvatar name={agentName} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {ranges ? <Highlight text={title} ranges={ranges} /> : title}
                </p>
                <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                  {lastMessagePreview ?? "No messages yet."}
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {showAgent ? (
                    <>
                      <span className="truncate font-medium text-foreground/70">{agentName}</span>
                      <span aria-hidden>·</span>
                    </>
                  ) : null}
                  <span className="shrink-0">
                    {messageCount} {messageCount === 1 ? "message" : "messages"}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{relativeTime(chat.updatedAt)}</span>
                </div>
              </div>
            </Link>
            {/* Sibling of the Link (never nested in the anchor) so its trigger and
                the dialogs it opens don't hijack row navigation. */}
            <ConversationRowMenu chat={chat} onChanged={onChanged} />
          </li>
        );
      })}
    </ul>
  );
}

/** Per-row ⋯ menu: always visible on touch, revealed on hover/focus on desktop. */
function ConversationRowMenu({ chat, onChanged }: { chat: Chat; onChanged?: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = async (): Promise<void> => {
    await deleteChat(chat.id);
    toast.success("Conversation deleted");
    onChanged?.();
  };

  return (
    <div className="absolute right-2 top-2.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Conversation options"
            // Stop the row's <Link> from navigating when the trigger is tapped.
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            className="press text-muted-foreground opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {/* preventDefault keeps focus handoff clean while the dialog opens. */}
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setRenaming(true);
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmDelete(true);
            }}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameChatDialog
        chat={chat}
        open={renaming}
        onOpenChange={setRenaming}
        onRenamed={onChanged}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this conversation?"
        description="This permanently removes the conversation and its messages. This can't be undone."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </div>
  );
}

function RenameChatDialog({
  chat,
  open,
  onOpenChange,
  onRenamed,
}: {
  chat: Chat;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRenamed?: () => void;
}) {
  const [title, setTitle] = useState(chat.title);
  const [pending, setPending] = useState(false);

  // Reset the draft to the persisted title each time the dialog reopens.
  useEffect(() => {
    if (open) setTitle(chat.title);
  }, [open, chat.title]);

  const save = async (): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === chat.title) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    try {
      await renameChat(chat.id, trimmed);
      onOpenChange(false);
      onRenamed?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename conversation</DialogTitle>
          <DialogDescription>Give this conversation a clearer title.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`rename-${chat.id}`}>Title</Label>
          <Input
            id={`rename-${chat.id}`}
            autoFocus
            value={title}
            maxLength={120}
            placeholder="Untitled chat"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void save()} disabled={pending} className="press">
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
