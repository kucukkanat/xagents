import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRoundIcon, ShieldIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOverview } from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import { useConfig } from "@/lib/config-context";
import { errorMessage } from "@/hooks/use-async";

const STORAGE_KEY = "xagents.adminToken";

const AdminTokenContext = createContext<string>("");

/** The verified admin token, available to every admin API call under the guard. */
export const useAdminToken = (): string => useContext(AdminTokenContext);

type Status = "idle" | "checking" | "ok" | "bad";

/**
 * Gates the admin console. When the feature is off (no `ADMIN_TOKEN` on the
 * server) it shows a disabled state. Otherwise it prompts for the operator
 * token, verifies it against `/overview`, persists it locally, and re-prompts on
 * rejection — then provides the token to descendants.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { adminAvailable } = useConfig();
  const [token, setToken] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [status, setStatus] = useState<Status>(token.length > 0 ? "checking" : "idle");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (token.length === 0) {
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("checking");
    getOverview(token)
      .then(() => {
        if (active) setStatus("ok");
      })
      .catch((e: unknown) => {
        if (!active) return;
        setStatus("bad");
        setError(
          e instanceof ApiError && e.status === 403 ? "That token was rejected." : errorMessage(e),
        );
        localStorage.removeItem(STORAGE_KEY);
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (!adminAvailable) {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="Admin console is disabled"
        description="Set ADMIN_TOKEN in the server's .env and restart to enable the super-admin console."
      />
    );
  }

  if (status === "ok") {
    return <AdminTokenContext value={token}>{children}</AdminTokenContext>;
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const next = input.trim();
    if (next.length === 0) return;
    localStorage.setItem(STORAGE_KEY, next);
    setToken(next);
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 rounded-xl border px-8 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-subtle text-brand">
        <KeyRoundIcon className="size-5" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Admin access</h1>
        <p className="text-sm text-muted-foreground">
          Enter the operator token to open the monitoring &amp; governance console.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
        <Input
          type="password"
          autoFocus
          placeholder="ADMIN_TOKEN"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-invalid={status === "bad"}
        />
        {status === "bad" && error !== undefined ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
        <Button type="submit" variant="brand" disabled={status === "checking" || input.trim().length === 0}>
          {status === "checking" ? "Verifying…" : "Unlock console"}
        </Button>
      </form>
    </div>
  );
}
