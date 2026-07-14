import type { ReactElement } from "react";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free Markdown rendering: enough for chat bubbles and
 * previews (code fences, inline code, bold, links, headings, lists) without
 * pulling in a parser. Content is split into blocks and rendered as React
 * nodes, so no `dangerouslySetInnerHTML` and no XSS surface.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content.trim()) return null;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {splitBlocks(content).map((block, i) =>
        block.type === "code" ? (
          <CodeBlock key={i} text={block.text} lang={block.lang} />
        ) : block.type === "heading" ? (
          <p key={i} className="text-base font-semibold tracking-tight">
            {inline(block.text)}
          </p>
        ) : block.type === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {block.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block.text)}
          </p>
        ),
      )}
    </div>
  );
}

/** A fenced code block with a language label and a copy affordance. */
function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/60">
      <div className="flex items-center justify-between border-b bg-muted/40 py-1 pl-3 pr-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {lang || "code"}
        </span>
        <CopyButton value={text} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs text-foreground">
        <code>{text}</code>
      </pre>
    </div>
  );
}

type Block =
  | { type: "code"; text: string; lang?: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

function splitBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: "code", text: body.join("\n"), lang: lang || undefined });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/^#{1,6}\s/, "") });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s/, ""));
        i += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !(lines[i] ?? "").startsWith("```")) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ type: "paragraph", text: para.join("\n") });
  }
  return blocks;
}

/** Only allow safe, non-javascript link targets. */
const safeHref = (href: string): string | undefined =>
  /^(https?:\/\/|\/)/i.test(href) ? href : undefined;

/** Render inline `code`, **bold**, and [links](url) spans. */
function inline(text: string): (string | ReactElement)[] {
  const parts: (string | ReactElement)[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(regex)) {
    const idx = match.index;
    if (idx > last) parts.push(text.slice(last, idx));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeHref(link[2] ?? "") : undefined;
      if (link && href) {
        parts.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline decoration-brand/40 underline-offset-2 transition-colors hover:decoration-brand"
          >
            {link[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    }
    last = idx + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
