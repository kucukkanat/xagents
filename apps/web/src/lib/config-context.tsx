import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ClientConfig } from "@xagents/core";
import { getConfig } from "@/lib/api";

/** Fallback so the shell still renders when the API is unreachable. */
const FALLBACK: ClientConfig = {
  models: [],
  currentUser: { id: "", handle: "you", displayName: "You" },
  sandboxBackend: "unknown",
};

const ConfigContext = createContext<ClientConfig>(FALLBACK);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ClientConfig>(FALLBACK);

  useEffect(() => {
    let active = true;
    getConfig()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        // Keep the fallback; individual pages surface their own errors.
      });
    return () => {
      active = false;
    };
  }, []);

  return <ConfigContext value={config}>{children}</ConfigContext>;
}

export const useConfig = (): ClientConfig => useContext(ConfigContext);
