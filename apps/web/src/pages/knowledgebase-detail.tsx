import { useRef, useState } from "react";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  FileTextIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { deleteDocument, getKnowledgebase, uploadDocument } from "@/lib/api";
import { formatBytes, relativeTime } from "@/lib/format";
import { toast } from "sonner";

export function KnowledgebaseDetailPage() {
  const { id } = useParams();
  const kbId = id ?? "";
  const { data, error, loading, reload } = useAsync(() => getKnowledgebase(kbId), [kbId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);

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

  const onDeleteDoc = async (docId: string, filename: string) => {
    setBusy(docId);
    try {
      await deleteDocument(kbId, docId);
      toast.success(`Deleted ${filename}`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge variant={kb.visibility === "public" ? "default" : "secondary"}>
          {kb.visibility}
        </Badge>
        <div>
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
          <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
            <UploadIcon /> {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </div>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="No documents yet"
          description="Upload a Markdown, text, or PDF file to index it for retrieval."
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"} ·{" "}
                    {formatBytes(doc.byteLength)} · {relativeTime(doc.createdAt)}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={busy === doc.id}
                  aria-label="Delete document"
                  onClick={() => onDeleteDoc(doc.id, doc.filename)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
