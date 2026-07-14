import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  BrainIcon,
  ChevronDownIcon,
  MessageSquareIcon,
  SendIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import type { ChatRole, KbSearchHit } from "@xagents/core";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/hooks/use-async";
import { getChat, streamChatMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ToolStep {
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  result?: unknown;
  ok?: boolean;
  sandbox?: boolean;
}

interface Bubble {
  readonly id: string;
  readonly role: ChatRole;
  text: string;
  reasoning: string;
  tools: ToolStep[];
  citations: KbSearchHit[];
}

const newBubble = (id: string, role: ChatRole, text = ""): Bubble => ({
  id,
  role,
  text,
  reasoning: "",
  tools: [],
  citations: [],
});

export function ChatPage() {
  const { chatId = "" } = useParams();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [title, setTitle] = useState("Chat");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    getChat(chatId)
      .then(({ chat, messages }) => {
        if (!active) return;
        setTitle(chat.title || "Chat");
        setBubbles(messages.map((m) => newBubble(m.id, m.role, m.content)));
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
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const assistantId = `a-${Date.now()}`;
    setBubbles((prev) => [
      ...prev,
      newBubble(`u-${Date.now()}`, "user", text),
      newBubble(assistantId, "assistant"),
    ]);
    setStreaming(true);

    const patch = (fn: (b: Bubble) => Bubble) =>
      setBubbles((prev) => prev.map((b) => (b.id === assistantId ? fn(b) : b)));

    try {
      for await (const ev of streamChatMessage(chatId, { message: text })) {
        switch (ev.type) {
          case "text_delta":
            patch((b) => ({ ...b, text: b.text + ev.text }));
            break;
          case "reasoning_delta":
            patch((b) => ({ ...b, reasoning: b.reasoning + ev.text }));
            break;
          case "tool_call":
            patch((b) => ({
              ...b,
              tools: [...b.tools, { callId: ev.callId, toolName: ev.toolName, args: ev.args }],
            }));
            break;
          case "tool_result":
            patch((b) => ({
              ...b,
              tools: b.tools.map((t) =>
                t.callId === ev.callId
                  ? { ...t, result: ev.result, ok: ev.ok, sandbox: ev.sandbox }
                  : t,
              ),
            }));
            break;
          case "kb_citations":
            patch((b) => ({ ...b, citations: [...ev.hits] }));
            break;
          case "turn_completed":
            patch((b) => ({ ...b, text: ev.text || b.text }));
            break;
          case "error":
            toast.error(ev.message);
            break;
          case "turn_started":
            break;
        }
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Back to agents">
          <Link to="/agents">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="truncate text-sm font-semibold">{title}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
          {loading ? (
            <>
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="ml-auto h-16 w-1/2" />
            </>
          ) : loadError ? (
            <p className="text-center text-sm text-muted-foreground">{loadError}</p>
          ) : bubbles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
              <MessageSquareIcon className="size-8" />
              <p className="text-sm">Send a message to start the conversation.</p>
            </div>
          ) : (
            bubbles.map((b) => <BubbleView key={b.id} bubble={b} />)
          )}
          {streaming ? <ThinkingDots /> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            placeholder="Message the agent…"
            className="max-h-40 min-h-11 resize-none"
            disabled={loading || Boolean(loadError)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            size="icon"
            aria-label="Send message"
            disabled={streaming || !input.trim()}
            onClick={() => void send()}
          >
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

function BubbleView({ bubble }: { bubble: Bubble }) {
  const isUser = bubble.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "items-end")}>
        {bubble.reasoning ? <ReasoningBlock text={bubble.reasoning} /> : null}
        {bubble.tools.map((t) => (
          <ToolStepView key={t.callId} step={t} />
        ))}
        {bubble.text ? (
          <div
            className={cn(
              "rounded-2xl px-4 py-2.5",
              isUser
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap text-sm">{bubble.text}</p>
            ) : (
              <Markdown content={bubble.text} />
            )}
          </div>
        ) : null}
        {bubble.citations.length > 0 ? <Citations hits={bubble.citations} /> : null}
      </div>
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
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        <BrainIcon className="size-3.5" />
        Thinking
        <ChevronDownIcon
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <p className="whitespace-pre-wrap border-t px-3 py-2 text-xs text-muted-foreground">
          {text}
        </p>
      ) : null}
    </div>
  );
}

function ToolStepView({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const pending = step.ok === undefined;
  return (
    <div className="rounded-xl border bg-card/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 font-medium"
      >
        <WrenchIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono">{step.toolName}</span>
        {step.sandbox ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ShieldCheckIcon className="size-3" /> ran in microVM
          </Badge>
        ) : null}
        <Badge
          variant={pending ? "secondary" : step.ok ? "default" : "destructive"}
          className="text-[10px]"
        >
          {pending ? "running…" : step.ok ? "ok" : "failed"}
        </Badge>
        <ChevronDownIcon
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t px-3 py-2">
          <Payload label="args" value={step.args} />
          {step.ok !== undefined ? <Payload label="result" value={step.result} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px]">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Citations({ hits }: { hits: readonly KbSearchHit[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {hits.map((h) => (
        <Badge key={h.chunkId} variant="outline" title={h.text} className="font-mono text-[10px]">
          {h.citation}
        </Badge>
      ))}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 text-muted-foreground">
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
