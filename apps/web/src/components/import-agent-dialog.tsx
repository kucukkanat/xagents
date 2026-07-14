import { useRef, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import type { ImportLogEntry, ImportReport, ImportSeverity } from "@xagents/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { errorMessage } from "@/hooks/use-async";
import { importAgent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// "idle" waits on the dropzone; the rest track the dry-run → commit lifecycle.
type Phase = "idle" | "validating" | "previewed" | "committing";

const SEVERITY_ICON: Record<ImportSeverity, typeof InfoIcon> = {
  info: InfoIcon,
  warning: AlertTriangleIcon,
  error: XCircleIcon,
};
const SEVERITY_CLASS: Record<ImportSeverity, string> = {
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-500",
  error: "text-destructive",
};

/** Pluralize a count against a singular noun without dragging in a dependency. */
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

function LogRow({ entry }: { entry: ImportLogEntry }) {
  const Icon = SEVERITY_ICON[entry.severity];
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", SEVERITY_CLASS[entry.severity])} />
      <span className="min-w-0">
        <span className="font-mono text-xs text-muted-foreground">{entry.step}</span>{" "}
        <span className="text-foreground">{entry.message}</span>
      </span>
    </li>
  );
}

/**
 * Import an agent from a zip (an xagents export or a plain eve project). Runs a
 * dry-run first so the user reviews the full validation log and a summary of
 * what will be created before committing anything.
 */
export function ImportAgentDialog({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");

  const reset = () => {
    setFile(null);
    setReport(null);
    setPhase("idle");
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFilePicked = async (picked: File) => {
    setFile(picked);
    setReport(null);
    setDragging(false);
    setPhase("validating");
    try {
      setReport(await importAgent(picked, { dryRun: true }));
      setPhase("previewed");
    } catch (e) {
      toast.error(errorMessage(e));
      reset();
    }
  };

  const onConfirm = async () => {
    if (!file) return;
    setPhase("committing");
    try {
      const result = await importAgent(file);
      setReport(result);
      if (result.committed) {
        toast.success(`Imported "${result.agentName ?? "agent"}"`);
        setOpen(false);
        reset();
        onImported();
      } else {
        setPhase("previewed"); // surfaced errors; let the user read them
      }
    } catch (e) {
      toast.error(errorMessage(e));
      setPhase("previewed");
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void onFilePicked(picked);
        }}
      />
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UploadIcon /> Import
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import agent</DialogTitle>
            <DialogDescription>
              {file
                ? `${file.name} — validated before anything is saved.`
                : "Drop an xagents export or eve project archive to preview it."}
            </DialogDescription>
          </DialogHeader>

          {phase === "idle" ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                const picked = e.dataTransfer.files?.[0];
                if (picked) void onFilePicked(picked);
              }}
              className={cn(
                "press flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-200 ease-fluid",
                dragging
                  ? "border-brand bg-brand-subtle"
                  : "border-brand-border/60 bg-brand-subtle/40 hover:border-brand hover:bg-brand-subtle",
              )}
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-brand-subtle text-brand">
                <UploadIcon className="size-5" />
              </span>
              <span className="space-y-1">
                <span className="block text-sm font-medium text-foreground">
                  Drop your archive here, or click to browse
                </span>
                <span className="block text-xs text-muted-foreground">
                  A .zip xagents export or eve project
                </span>
              </span>
            </button>
          ) : phase === "validating" ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Validating archive…
            </div>
          ) : report ? (
            <div className="space-y-4">
              {/* Verdict banner — tinted success vs destructive so the outcome reads at a glance. */}
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  report.ok
                    ? "border-success/30 bg-success/5"
                    : "border-destructive/30 bg-destructive/5",
                )}
              >
                {report.ok ? (
                  <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-medium">
                    {report.ok ? "Ready to import" : "Cannot import"}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      · recognized as {report.source}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="font-normal">
                      {count(report.summary.skills, "skill")}
                    </Badge>
                    <Badge variant="secondary" className="font-normal">
                      {count(report.summary.knowledgebases, "knowledgebase")}
                    </Badge>
                    <Badge variant="secondary" className="font-normal">
                      {count(report.summary.documents, "document")}
                    </Badge>
                  </div>
                </div>
              </div>

              {report.log.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Validation log</p>
                  <ScrollArea className="scrollbar-subtle max-h-64 rounded-lg border">
                    <ul className="divide-y divide-border/50 px-3">
                      {report.log.map((entry, i) => (
                        <LogRow key={i} entry={entry} />
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {/* The commit button only appears once there's something to commit. */}
            {phase !== "idle" ? (
              <Button onClick={onConfirm} disabled={phase !== "previewed" || !report?.ok}>
                {phase === "committing" ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" /> Importing…
                  </>
                ) : (
                  "Import agent"
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
