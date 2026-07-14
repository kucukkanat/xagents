import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free Markdown rendering: enough for chat bubbles and
 * previews (code fences, inline code, bold, headings, lists) without pulling in
 * a parser. Content is split into blocks and rendered as React nodes, so no
 * `dangerouslySetInnerHTML` and no XSS surface.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  if (!content.trim()) return null;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {splitBlocks(content).map((block, i) =>
        block.type === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground"
          >
            <code>{block.text}</code>
          </pre>
        ) : block.type === "heading" ? (
          <p key={i} className="text-base font-semibold">
            {inline(block.text)}
          </p>
        ) : block.type === "list" ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
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

type Block =
  | { type: "code"; text: string }
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
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ type: "code", text: body.join("\n") });
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

/** Render inline `code` and **bold** spans. */
function inline(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
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
    } else {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = idx + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
