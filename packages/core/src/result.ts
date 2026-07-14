/**
 * Explicit, typed success/failure. We model expected failures as values instead
 * of throwing, so callers must handle them (no silent catches).
 * Unexpected/programmer errors still throw.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Domain error kinds shared across packages. */
export type AppErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "forbidden"
  | "provider_error"
  | "sandbox_error"
  | "agent_runtime_error"
  | "internal";

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export const appError = (code: AppErrorCode, message: string, cause?: unknown): AppError =>
  cause === undefined ? { code, message } : { code, message, cause };

/** Map a domain error code to an HTTP status. */
export const httpStatusFor = (code: AppErrorCode): number => {
  switch (code) {
    case "not_found":
      return 404;
    case "validation":
      return 400;
    case "conflict":
      return 409;
    case "forbidden":
      return 403;
    case "provider_error":
    case "sandbox_error":
    case "agent_runtime_error":
    case "internal":
      return 500;
  }
};
