import { useRef, useState } from "react";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  FileTextIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { deleteDocument, getKnowledgebase, uploadDocument } from "@/lib/api";
import { formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function KnowledgebaseDetailPage() {
  const { id } = useParams();
  const kbId = id ?? "";
  const { data, error, loading, reload } = useAsync(() => getKnowledgebase(kbId), [kbId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadDocument(kbId, file);
      toast.success(`Uploaded ${file.name}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data) {
    return (
      <EmptyState
        icon={BookOpenIcon}
        title="Couldn't load this knowledgebase"
        description={error ?? "Not found."}
        action={
          <Button variant="outline" onClick={reload}>
            Retry
          </Button>
        }
      />
    );
  }

  const { knowledgebase: kb, documents } = data;

  return (
    <>
      <PageHeader
        title={kb.name}
        description={kb.description || "No description."}
        action={
          <Button variant="ghost" asChild>
            <Link to="/knowledgebases">
              <ArrowLeftIcon /> Back
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={kb.visibility === "public" ? "default" : "secondary"}>
          {kb.visibility}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {documents.length} document{documents.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Click-to-browse input stays wired; the panel below adds a real drag-and-drop
          target that routes dropped files through the same uploadDocument path. */}
      <input
        ref={fileRef}
        type="file"
        accept=".md,.txt,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file);
        }}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload document"
        aria-disabled={uploading}
        onClick={() => {
          if (!uploading) fileRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !uploading) void onUpload(file);
        }}
        className={cn(
          "bg-grid flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center outline-none transition-all duration-200 ease-fluid",
          "border-brand-border/70 hover:border-brand hover:bg-brand-subtle/40 focus-visible:ring-2 focus-visible:ring-ring",
          dragOver && "border-brand bg-brand-subtle/60 ring-2 ring-ring",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        <div
          className={cn(
            "flex size-11 items-center justify-center rounded-full bg-brand-subtle text-brand transition-transform duration-200 ease-spring",
            dragOver && "scale-110",
          )}
        >
          <UploadIcon className="size-5" />
        </div>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {uploading ? "Uploading…" : "Drop a file here, or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground">
            Markdown, text, or PDF · chunked and indexed for retrieval
          </p>
        </div>
      </div>

      {documents.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No documents yet — upload one above to make it retrievable.
        </p>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {documents.map((doc, i) => (
              // Subtle staggered entrance; row actions stay visible on touch and reveal
              // on hover/focus for pointer users (no hover-only affordance on mobile).
              <div
                key={doc.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 ease-fluid animate-in fade-in-0 slide-in-from-bottom-1 hover:bg-muted/40"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} ·{" "}
                    {formatBytes(doc.byteLength)} · {relativeTime(doc.createdAt)}
                  </p>
                </div>
                <ConfirmDialog
                  trigger={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="press text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label="Delete document"
                    >
                      <Trash2Icon />
                    </Button>
                  }
                  title={`Delete ${doc.filename}?`}
                  description="This removes the document and its indexed chunks from the knowledgebase."
                  onConfirm={async () => {
                    await deleteDocument(kbId, doc.id);
                    toast.success(`Deleted ${doc.filename}`);
                    reload();
                  }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
