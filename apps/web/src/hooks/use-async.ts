import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly reload: () => void;
}

export const errorMessage = (e: unknown): string =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong";

/**
 * Loads async data on mount and whenever `deps` change. Failures are captured as
 * a message string (never thrown) so pages can render a graceful error state
 * instead of crashing the router.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    fn()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
