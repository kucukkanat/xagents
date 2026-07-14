import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  BrainIcon,
  ChevronDownIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { ChatRole, ChatStreamEvent, KbSearchHit } from "@xagents/core";
import { AgentAvatar, type AgentActivity } from "@/components/agent-avatar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/hooks/use-async";
import {
  cancelChat,
  createChat,
  deleteChat,
  getAgent,
  getChat,
  renameChat,
  retryChat,
  sendMessage,
  streamChat,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface ToolStep {
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  result?: unknown;
  ok?: boolean;
  sandbox?: boolean;
}

type TurnStatus = "preparing" | "thinking" | undefined;

interface Bubble {
  readonly id: string;
  readonly role: ChatRole;
  text: string;
  reasoning: string;
  tools: ToolStep[];
  citations: KbSearchHit[];
  /** Lifecycle hint for the in-progress assistant bubble (cold start, etc.). */
  status: TurnStatus;
  /** Set when the turn failed; shown in-bubble and rebuilt on reload. */
  error: string | undefined;
}

const newBubble = (id: string, role: ChatRole, text = ""): Bubble => ({
  id,
  role,
  text,
  reasoning: "",
  tools: [],
  citations: [],
  status: undefined,
  error: undefined,
});

/** Fold one stream event into a bubble. Shared by live streaming and by
 *  reconstructing an interrupted turn from its persisted events on reload. */
const applyEvent = (b: Bubble, ev: ChatStreamEvent): Bubble => {
  switch (ev.type) {
    case "status":
      return { ...b, status: ev.state };
    case "text_delta":
      return { ...b, status: undefined, text: b.text + ev.text };
    case "reasoning_delta":
      return { ...b, reasoning: b.reasoning + ev.text };
    case "tool_call":
      return {
        ...b,
        status: undefined,
        tools: [...b.tools, { callId: ev.callId, toolName: ev.toolName, args: ev.args }],
      };
    case "tool_result":
      return {
        ...b,
        tools: b.tools.map((t) =>
          t.callId === ev.callId ? { ...t, result: ev.result, ok: ev.ok, sandbox: ev.sandbox } : t,
        ),
      };
    case "kb_citations":
      return { ...b, citations: [...ev.hits] };
    case "turn_completed":
      return { ...b, status: undefined, text: ev.text || b.text };
    case "error":
      // A failure clears the pending "thinking"/"preparing" indicator and is
      // recorded on the bubble so it survives a reload — status events (which
      // drive that indicator) are never persisted, so without this a refreshed
      // or reattached client would sit on "Thinking…" forever.
      return { ...b, status: undefined, error: ev.message };
    case "turn_started":
      return b;
  }
};

const SUGGESTIONS: readonly string[] = [
  "Run a quick Python script and show me the output",
  "Search my knowledgebase and summarize what you find",
  "Explain how you'd approach a tricky problem, step by step",
  "What can you help me with? List your capabilities",
];

export function ChatPage() {
  const { chatId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // A "draft" chat has no persisted row yet — the target agent rides in ?agent=.
  // The row is created lazily on the first send, so opening a chat and leaving
  // never litters history with empty conversations.
  const isDraft = chatId === "new";
  const draftAgentId = searchParams.get("agent") ?? "";
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [title, setTitle] = useState("Chat");
  const [agentName, setAgentName] = useState("Agent");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-follow the stream only while the user is parked at the bottom.
  const stick = useRef(true);
  // One live stream at a time; aborted when the chat changes or unmounts.
  const abortRef = useRef<AbortController | undefined>(undefined);
  // Carries a just-created chat's live bubbles across the draft→real URL swap so
  // the destination attaches to the running turn without a reload/flash.
  const draftHandoff = useRef<{ id: string; assistantId: string } | undefined>(undefined);

  const nearBottom = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  /** Tail the server's live turn into the assistant bubble `assistantId`.
   *  Text/reasoning deltas are coalesced on a ~40ms flush so rapid streaming
   *  never triggers a render per token (which janks scrolling); structural
   *  events (tool calls, completion, errors) apply immediately. */
  const attach = useCallback(async (id: string, assistantId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const queue: ChatStreamEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      flushTimer = undefined;
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length);
      setBubbles((prev) =>
        prev.map((b) => (b.id === assistantId ? batch.reduce(applyEvent, b) : b)),
      );
    };

    setStreaming(true);
    try {
      for await (const ev of streamChat(id, controller.signal)) {
        queue.push(ev);
        if (ev.type === "error") toast.error(ev.message);
        if (ev.type === "text_delta" || ev.type === "reasoning_delta") {
          if (flushTimer === undefined) flushTimer = setTimeout(flush, 40);
        } else {
          clearTimeout(flushTimer);
          flush();
        }
      }
    } catch (e) {
      // An abort (chat switch/unmount) is expected; surface only real failures.
      if (!controller.signal.aborted) toast.error(errorMessage(e));
    } finally {
      clearTimeout(flushTimer);
      flush();
      if (abortRef.current === controller) {
        abortRef.current = undefined;
        setStreaming(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;

    // Handoff from a just-sent draft: bubbles + the running turn are already set,
    // so attach to the live stream without clearing/reloading (no skeleton flash).
    const handoff = draftHandoff.current;
    if (handoff && handoff.id === chatId) {
      draftHandoff.current = undefined;
      setLoading(false);
      void attach(chatId, handoff.assistantId);
      return () => {
        active = false;
        abortRef.current?.abort();
        abortRef.current = undefined;
      };
    }

    setLoading(true);
    setLoadError(undefined);
    setBubbles([]);
    setStreaming(false);
    stick.current = true;
    setShowJump(false);

    // Draft chat: no row exists yet — just load the agent for its identity and
    // empty-state copy. The row is created on the first send (see sendText).
    if (isDraft) {
      setTitle("New chat");
      if (!draftAgentId) {
        setLoadError("No agent selected for this chat.");
        setLoading(false);
        return () => {
          active = false;
        };
      }
      getAgent(draftAgentId)
        .then(({ agent }) => {
          if (active) setAgentName(agent.name);
        })
        .catch((e: unknown) => {
          if (active) setLoadError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    getChat(chatId)
      .then(({ chat, agentName: name, messages, pending, streaming: isStreaming }) => {
        if (!active) return;
        setTitle(chat.title || "Chat");
        setAgentName(name);
        const base = messages.map((m) => newBubble(m.id, m.role, m.content));
        // Reconstruct an in-progress/interrupted assistant turn, if any.
        const hasLiveTurn = isStreaming || pending.length > 0;
        const liveId = `live-${chat.id}`;
        const live = pending.reduce(applyEvent, newBubble(liveId, "assistant"));
        setBubbles(hasLiveTurn ? [...base, live] : base);
        if (isStreaming) void attach(chat.id, liveId);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abortRef.current?.abort();
      abortRef.current = undefined;
    };
  }, [chatId, isDraft, draftAgentId, attach]);

  // Follow the tail only while anchored; jump instantly during a stream, smoothly otherwise.
  useEffect(() => {
    if (stick.current) {
      endRef.current?.scrollIntoView({ block: "end", behavior: streaming ? "auto" : "smooth" });
    }
  }, [bubbles, streaming]);

  useEffect(() => {
    // Focus the composer when a chat opens (desktop only — avoids popping the
    // mobile keyboard on load).
    if (!loading && !loadError && window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, [loading, loadError, chatId]);

  const onScroll = (): void => {
    const near = nearBottom();
    setShowJump(!near);
    if (near) stick.current = true;
  };
  const releaseStick = (): void => {
    if (!nearBottom()) stick.current = false;
  };
  const jumpToLatest = (): void => {
    stick.current = true;
    setShowJump(false);
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  const failSend = (assistantId: string, message: string): void => {
    toast.error(message);
    setStreaming(false);
    setBubbles((prev) =>
      prev.map((b) => (b.id === assistantId ? { ...b, status: undefined, error: message } : b)),
    );
  };

  const sendText = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || streaming) return;
    setInput("");
    stick.current = true;
    setShowJump(false);
    const assistantId = `live-${Date.now()}`;
    setBubbles((prev) => [
      ...prev,
      newBubble(`u-${Date.now()}`, "user", text),
      { ...newBubble(assistantId, "assistant"), status: "preparing" },
    ]);
    setStreaming(true);

    if (isDraft) {
      // Create the row only now, on the first message.
      let created;
      try {
        created = await createChat({ agentId: draftAgentId });
      } catch (e) {
        failSend(assistantId, errorMessage(e));
        return;
      }
      try {
        await sendMessage(created.id, { message: text });
      } catch (e) {
        // The first send failed — remove the just-created empty row rather than
        // leave it stranded in history.
        void deleteChat(created.id).catch(() => undefined);
        failSend(assistantId, errorMessage(e));
        return;
      }
      // Mirror the server's auto-title (first message, capped) so the header
      // updates immediately instead of lingering on "New chat" until a reload.
      setTitle(text.slice(0, 60));
      // Swap to the real URL; the load effect attaches via the handoff (no reload).
      draftHandoff.current = { id: created.id, assistantId };
      navigate(`/chat/${created.id}`, { replace: true });
      return;
    }

    try {
      await sendMessage(chatId, { message: text });
      await attach(chatId, assistantId);
    } catch (e) {
      failSend(assistantId, errorMessage(e));
    }
  };

  const stop = async (): Promise<void> => {
    setStopping(true);
    try {
      await cancelChat(chatId);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStopping(false);
    }
  };

  const retry = async (bubbleId: string): Promise<void> => {
    stick.current = true;
    setShowJump(false);
    setBubbles((prev) =>
      prev.map((b) => (b.id === bubbleId ? { ...newBubble(bubbleId, "assistant"), status: "preparing" } : b)),
    );
    setStreaming(true);
    try {
      await retryChat(chatId);
      await attach(chatId, bubbleId);
    } catch (e) {
      const msg = errorMessage(e);
      toast.error(msg);
      setStreaming(false);
      setBubbles((prev) =>
        prev.map((b) => (b.id === bubbleId ? { ...b, status: undefined, error: msg } : b)),
      );
    }
  };

  const remove = async (): Promise<void> => {
    await deleteChat(chatId);
    toast.success("Conversation deleted");
    navigate("/");
  };

  const activity: AgentActivity = streaming ? "streaming" : "idle";
  const lastId = bubbles.at(-1)?.id;

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        title={title}
        agentName={agentName}
        activity={activity}
        canManage={!isDraft}
        onBack={() => navigate(-1)}
        onRename={async (next) => {
          const trimmed = next.trim();
          if (!trimmed || trimmed === title) return;
          setTitle(trimmed);
          try {
            await renameChat(chatId, trimmed);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
        onDelete={remove}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={(e) => {
          if (e.deltaY < 0) stick.current = false;
        }}
        onTouchMove={releaseStick}
        className="scrollbar-subtle relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
          {loading ? (
            <div className="space-y-5">
              <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
              <Skeleton className="h-24 w-3/4 rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-2/5 rounded-2xl" />
            </div>
          ) : loadError ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{loadError}</p>
          ) : bubbles.length === 0 ? (
            <EmptyChat agentName={agentName} onPick={(t) => void sendText(t)} disabled={streaming} />
          ) : (
            bubbles.map((b) => (
              <BubbleView
                key={b.id}
                bubble={b}
                agentName={agentName}
                streaming={streaming && b.id === lastId}
                onRetry={() => void retry(b.id)}
              />
            ))
          )}
          {streaming && isAwaitingFirstToken(bubbles.at(-1)) ? <ThinkingDots /> : null}
          <div ref={endRef} className="h-px" />
        </div>
      </div>

      <JumpToLatest show={showJump} onClick={jumpToLatest} />

      <Composer
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSend={() => void sendText(input)}
        onStop={() => void stop()}
        streaming={streaming}
        stopping={stopping}
        disabled={loading || Boolean(loadError)}
      />
    </div>
  );
}

/** True when a turn is running but no visible output has arrived yet. */
function isAwaitingFirstToken(last: Bubble | undefined): boolean {
  return (
    last !== undefined &&
    last.role === "assistant" &&
    last.status === undefined &&
    last.error === undefined &&
    last.text.length === 0 &&
    last.reasoning.length === 0 &&
    last.tools.length === 0
  );
}

function ChatHeader({
  title,
  agentName,
  activity,
  canManage,
  onBack,
  onRename,
  onDelete,
}: {
  title: string;
  agentName: string;
  activity: AgentActivity;
  /** False for a draft chat that has no persisted row yet (no rename/delete). */
  canManage: boolean;
  onBack: () => void;
  onRename: (next: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const beginRename = (): void => {
    setDraft(title);
    setEditing(true);
  };
  const commit = (): void => {
    setEditing(false);
    onRename(draft);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Go back" className="press">
        <ArrowLeftIcon />
      </Button>
      <AgentAvatar name={agentName} status={activity} className="size-8" />
      <div className="min-w-0 flex-1">
        {editing && canManage ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-md border bg-transparent px-2 py-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Conversation title"
          />
        ) : (
          <>
            <h1 className="truncate text-sm font-semibold leading-tight">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {activity === "streaming" ? "Responding…" : agentName}
            </p>
          </>
        )}
      </div>
      {canManage ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Conversation options"
                className="press"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={beginRename}>
                <SparklesIcon />
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
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="Delete this conversation?"
            description="This permanently removes the conversation and its messages. This can't be undone."
            confirmLabel="Delete"
            onConfirm={onDelete}
          />
        </>
      ) : null}
    </header>
  );
}

function JumpToLatest({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none relative z-10">
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 absolute bottom-3 left-1/2 -translate-x-1/2 duration-200">
        <Button
          size="sm"
          variant="secondary"
          onClick={onClick}
          className="pointer-events-auto gap-1.5 rounded-full border shadow-md"
        >
          <ChevronDownIcon className="size-4" />
          Jump to latest
        </Button>
      </div>
    </div>
  );
}

function Composer({
  inputRef,
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  stopping,
  disabled,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  stopping: boolean;
  disabled: boolean;
}) {
  return (
    <div className="shrink-0 border-t bg-background/80 px-3 pb-safe pt-3 backdrop-blur-md sm:px-6 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/60">
          <Textarea
            ref={inputRef}
            value={value}
            placeholder="Message the agent…"
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2.5 py-1.5 text-base shadow-none focus-visible:ring-0 sm:text-sm [field-sizing:content]"
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!streaming) onSend();
              }
            }}
          />
          <Button
            size="icon"
            aria-label={streaming ? "Stop generating" : "Send message"}
            className="press size-9 shrink-0 rounded-xl"
            variant={streaming ? "secondary" : "default"}
            disabled={streaming ? stopping : !value.trim()}
            onClick={streaming ? onStop : onSend}
          >
            {streaming ? (
              stopping ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <SquareIcon className="fill-current" />
              )
            ) : (
              <ArrowUpIcon />
            )}
          </Button>
        </div>
        <p className="mt-1.5 hidden px-1 text-center text-[11px] text-muted-foreground sm:block">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift</kbd> +{" "}
          <kbd className="font-sans">Enter</kbd> for a new line
        </p>
      </div>
    </div>
  );
}

function EmptyChat({
  agentName,
  onPick,
  disabled,
}: {
  agentName: string;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center gap-6 py-10 text-center sm:py-16">
      <div aria-hidden className="bg-aurora pointer-events-none absolute inset-x-0 -top-6 h-56 opacity-80" />
      <AgentAvatar name={agentName} className="relative size-14" />
      <div className="relative space-y-1.5">
        <h2 className="text-xl font-semibold tracking-tight text-balance">
          What should {agentName} work on?
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick a starting point, or just type below.
        </p>
      </div>
      <div className="relative grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            style={{ animationDelay: `${i * 45}ms` }}
            className="animate-in fade-in-0 slide-in-from-bottom-2 group flex items-center gap-2.5 rounded-xl border bg-card/60 px-3.5 py-3 text-left text-sm transition-all duration-200 ease-fluid hover:-translate-y-0.5 hover:border-brand-border hover:bg-accent disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <SparklesIcon className="size-4 shrink-0 text-brand transition-transform group-hover:scale-110" />
            <span className="text-pretty">{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BubbleView({
  bubble,
  agentName,
  streaming,
  onRetry,
}: {
  bubble: Bubble;
  agentName: string;
  streaming: boolean;
  onRetry: () => void;
}) {
  const isUser = bubble.role === "user";
  return (
    <div
      className={cn(
        "group/msg flex animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out",
        isUser ? "justify-end" : "justify-start gap-3",
      )}
    >
      {!isUser ? <AgentAvatar name={agentName} className="mt-0.5 size-7" /> : null}
      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", isUser && "items-end")}>
        {bubble.reasoning ? <ReasoningBlock text={bubble.reasoning} /> : null}
        {bubble.tools.map((t) => (
          <ToolStepView key={t.callId} step={t} />
        ))}
        {bubble.text ? (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5 text-sm",
              isUser
                ? "rounded-br-md bg-primary text-primary-foreground"
                : "rounded-bl-md bg-muted text-foreground",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{bubble.text}</p>
            ) : (
              <div className={cn(streaming && "streaming-caret")}>
                <Markdown content={bubble.text} />
              </div>
            )}
          </div>
        ) : null}
        {bubble.status ? <StatusLine status={bubble.status} /> : null}
        {bubble.error ? <ErrorLine message={bubble.error} onRetry={onRetry} /> : null}
        {bubble.citations.length > 0 ? <Citations hits={bubble.citations} /> : null}
        {!streaming && bubble.text && !bubble.error ? (
          <MessageActions text={bubble.text} align={isUser ? "end" : "start"} />
        ) : null}
      </div>
    </div>
  );
}

/** Copy (and any future) actions — revealed on hover on desktop, always shown on touch. */
function MessageActions({ text, align }: { text: string; align: "start" | "end" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover/msg:opacity-100 sm:focus-within:opacity-100",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      <CopyButton value={text} />
    </div>
  );
}

/** In-bubble indicator for what the background turn is doing before output arrives. */
function StatusLine({ status }: { status: "preparing" | "thinking" }) {
  const label = status === "preparing" ? "Starting the agent…" : "Thinking…";
  return (
    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted px-4 py-2.5 text-sm text-muted-foreground">
      {status === "preparing" ? (
        <ShieldCheckIcon className="size-4 text-brand" />
      ) : (
        <BrainIcon className="size-4 text-brand" />
      )}
      <span>{label}</span>
      <ThinkingDots />
    </div>
  );
}

/** A failed turn, surfaced in the assistant bubble and rebuilt on reload. */
function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl rounded-bl-md border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
      <TriangleAlertIcon className="size-4 shrink-0" />
      <span className="min-w-0">{message}</span>
      <Button
        size="xs"
        variant="outline"
        onClick={onRetry}
        className="press ml-auto gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
      >
        <RotateCwIcon />
        Try again
      </Button>
    </div>
  );
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        <BrainIcon className="size-3.5 text-brand" />
        Thinking
        <ChevronDownIcon
          className={cn("ml-auto size-3.5 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      <Collapse open={open}>
        <p className="whitespace-pre-wrap border-t px-3 py-2 text-xs text-muted-foreground">{text}</p>
      </Collapse>
    </div>
  );
}

function ToolStepView({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const pending = step.ok === undefined;
  return (
    <div className="overflow-hidden rounded-xl border bg-card/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 font-medium transition-colors hover:bg-accent/50"
      >
        <StatusDot state={pending ? "running" : step.ok ? "ok" : "failed"} />
        <WrenchIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{step.toolName}</span>
        {step.sandbox ? (
          <Badge variant="outline" className="gap-1 text-[11px]">
            <ShieldCheckIcon className="size-3 text-brand" /> microVM
          </Badge>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {pending ? "running…" : open ? "hide" : "details"}
        </span>
        <ChevronDownIcon
          className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      <Collapse open={open}>
        <div className="space-y-2 border-t px-3 py-2">
          <Payload label="args" value={step.args} />
          {step.ok !== undefined ? <ResultView value={step.result} /> : null}
        </div>
      </Collapse>
    </div>
  );
}

/** Colored status indicator for a tool step: pulsing while running, then solid. */
function StatusDot({ state }: { state: "running" | "ok" | "failed" }) {
  const color =
    state === "running" ? "bg-brand" : state === "ok" ? "bg-success" : "bg-destructive";
  return (
    <span className="relative flex size-2 shrink-0">
      {state === "running" ? (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", color)} />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", state === "ok" && "animate-pop", color)} />
    </span>
  );
}

interface ShellResult {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}
const asShellResult = (v: unknown): ShellResult | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const shellish = "stdout" in o || "stderr" in o || "exitCode" in o;
  return shellish ? (o as ShellResult) : undefined;
};

/** Render a command result as a terminal panel when it looks shell-shaped, else raw JSON. */
function ResultView({ value }: { value: unknown }) {
  const shell = asShellResult(value);
  if (!shell) return <Payload label="result" value={value} />;
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">output</p>
      <div className="overflow-hidden rounded-md border bg-[oklch(0.16_0.01_285)] font-mono text-[11px] text-zinc-100">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-2.5 py-1.5 text-[10px] text-zinc-400">
          <span className="size-2 rounded-full bg-destructive/70" />
          <span className="size-2 rounded-full bg-[oklch(0.8_0.15_85)]/70" />
          <span className="size-2 rounded-full bg-success/70" />
          <span className="ml-1.5">
            exit {shell.exitCode ?? 0}
          </span>
        </div>
        <pre className="max-h-72 overflow-auto px-2.5 py-2 whitespace-pre-wrap">
          {shell.stdout ? shell.stdout : null}
          {shell.stderr ? (
            <span className="text-destructive">{shell.stdout ? "\n" : ""}{shell.stderr}</span>
          ) : null}
          {!shell.stdout && !shell.stderr ? <span className="text-zinc-500">(no output)</span> : null}
        </pre>
      </div>
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px]">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Citations({ hits }: { hits: readonly KbSearchHit[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {hits.map((h) => (
        <Badge
          key={h.chunkId}
          variant="outline"
          title={h.text}
          className="gap-1 border-brand-border/60 font-mono text-[11px] text-brand-muted-foreground"
        >
          {h.citation}
        </Badge>
      ))}
    </div>
  );
}

/** Height-animated disclosure using the grid 0fr→1fr trick (transform-only, no reflow jank). */
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-fluid",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 text-muted-foreground" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
