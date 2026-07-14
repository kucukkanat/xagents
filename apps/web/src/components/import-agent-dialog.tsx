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
import { toast } from "sonner";

type Phase = "validating" | "previewed" | "committing";

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

function LogRow({ entry }: { entry: ImportLogEntry }) {
  const Icon = SEVERITY_ICON[entry.severity];
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${SEVERITY_CLASS[entry.severity]}`} />
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
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [phase, setPhase] = useState<Phase>("validating");

  const reset = () => {
    setFile(null);
    setReport(null);
    setPhase("validating");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFilePicked = async (picked: File) => {
    setFile(picked);
    setReport(null);
    setPhase("validating");
    setOpen(true);
    try {
      setReport(await importAgent(picked, { dryRun: true }));
      setPhase("previewed");
    } catch (e) {
      toast.error(errorMessage(e));
      setOpen(false);
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
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
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
              {file?.name ?? "Reviewing archive"} — validated before anything is saved.
            </DialogDescription>
          </DialogHeader>

          {phase === "validating" ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Validating archive…
            </div>
          ) : report ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {report.ok ? (
                  <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                ) : (
                  <XCircleIcon className="size-4 text-destructive" />
                )}
                <span className="font-medium">
                  {report.ok ? "Ready to import" : "Cannot import"}
                </span>
                <span className="text-muted-foreground">
                  · {report.source} · {report.summary.skills} skill(s),{" "}
                  {report.summary.knowledgebases} KB(s), {report.summary.documents} doc(s)
                </span>
              </div>

              <ScrollArea className="max-h-64 rounded-md border p-2">
                <ul className="divide-y divide-border/50">
                  {report.log.map((entry, i) => (
                    <LogRow key={i} entry={entry} />
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={phase !== "previewed" || !report?.ok}
            >
              {phase === "committing" ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" /> Importing…
                </>
              ) : (
                "Import agent"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
