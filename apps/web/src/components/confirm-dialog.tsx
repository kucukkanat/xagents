import { useState, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * A reusable confirmation gate for irreversible actions. Wrap any trigger; the
 * confirm button shows a spinner while `onConfirm` runs, closes on success, and
 * surfaces a toast on failure (the dialog stays open so the user can retry).
 */
export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
}: {
  /** Omit when driving `open`/`onOpenChange` yourself (e.g. from a menu item). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  onConfirm: () => Promise<void> | void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const [pending, setPending] = useState(false);
  const open = openProp ?? uncontrolled;

  const setOpen = (next: boolean): void => {
    if (pending) return;
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  const run = async (): Promise<void> => {
    setPending(true);
    try {
      await onConfirm();
      if (openProp === undefined) setUncontrolled(false);
      onOpenChange?.(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant={variant} onClick={() => void run()} disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
