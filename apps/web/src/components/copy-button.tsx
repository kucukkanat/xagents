import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CopySize = "icon-xs" | "icon-sm" | "xs" | "sm";

/**
 * Copy-to-clipboard control. The icon morphs to a spring-popped check for a beat
 * on success. Works as an icon-only button or with a text label.
 */
export function CopyButton({
  value,
  label = "Copy",
  size = "icon-xs",
  className,
}: {
  value: string;
  label?: string;
  size?: CopySize;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const iconOnly = size.startsWith("icon");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={copied ? "Copied" : label}
          onClick={() => void copy()}
          className={cn("text-muted-foreground", className)}
        >
          {copied ? (
            <CheckIcon className="animate-pop text-success" />
          ) : (
            <CopyIcon />
          )}
          {iconOnly ? null : <span>{copied ? "Copied" : label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : label}</TooltipContent>
    </Tooltip>
  );
}
