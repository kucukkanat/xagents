import { useState } from "react";
import { BookOpenIcon, FileTextIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import type { CreateKnowledgebaseInput, Visibility } from "@xagents/core";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage, useAsync } from "@/hooks/use-async";
import { createKnowledgebase, deleteKnowledgebase, listKnowledgebases } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { toast } from "sonner";

export function KnowledgebasesListPage() {
  const { data, error, loading, reload } = useAsync(listKnowledgebases, []);
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its documents?`)) return;
    setBusy(id);
    try {
      await deleteKnowledgebase(id);
      toast.success(`Deleted "${name}"`);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <PageHeader
        title="Knowledgebases"
        description="Upload documents your agents can retrieve from."
        action={<CreateKbDialog onCreated={reload} />}
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={BookOpenIcon}
          title="Couldn't load knowledgebases"
          description={error}
          action={
            <Button variant="outline" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={BookOpenIcon}
          title="No knowledgebases yet"
          description="Create one and upload documents to give your agents knowledge."
          action={<CreateKbDialog onCreated={reload} />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((kb) => (
            <Card key={kb.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate">
                    <Link to={`/knowledgebases/${kb.id}`} className="hover:underline">
                      {kb.name}
                    </Link>
                  </CardTitle>
                  <Badge variant={kb.visibility === "public" ? "default" : "secondary"}>
                    {kb.visibility}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {kb.description || "No description."}
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileTextIcon className="size-3.5" />
                  {kb.documentCount} document{kb.documentCount === 1 ? "" : "s"} · updated{" "}
                  {relativeTime(kb.updatedAt)}
                </p>
              </CardContent>
              <CardFooter>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/knowledgebases/${kb.id}`}>Open</Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  disabled={busy === kb.id}
                  aria-label="Delete knowledgebase"
                  onClick={() => onDelete(kb.id, kb.name)}
                >
                  <Trash2Icon />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function CreateKbDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("A name is required.");
      return;
    }
    setSaving(true);
    try {
      const input: CreateKnowledgebaseInput = {
        name: name.trim(),
        description: description.trim(),
        visibility,
      };
      await createKnowledgebase(input);
      toast.success("Knowledgebase created");
      setOpen(false);
      setName("");
      setDescription("");
      setVisibility("private");
      onCreated();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New knowledgebase
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New knowledgebase</DialogTitle>
          <DialogDescription>Documents you upload are chunked and indexed for retrieval.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kb-name">Name</Label>
            <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-desc">Description</Label>
            <Textarea
              id="kb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kb-vis">Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
              <SelectTrigger id="kb-vis" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public (marketplace)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
