import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { type AppError, type Result, appError, err, httpStatusFor, ok } from "@xagents/core";

/** Send a domain error as the uniform `ApiErrorBody` with its mapped status. */
export const sendError = (c: Context, error: AppError): Response =>
  c.json(
    { error: { code: error.code, message: error.message } },
    httpStatusFor(error.code) as ContentfulStatusCode,
  );

/** Validate an unknown body against a Zod schema into a typed Result. */
export const parseBody = <S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
): Result<z.infer<S>, AppError> => {
  const parsed = schema.safeParse(data);
  return parsed.success
    ? ok(parsed.data)
    : err(appError("validation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
};

/** Read and JSON-parse a request body, tolerating an empty body as `{}`. */
export const readJson = async (c: Context): Promise<unknown> => {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
};
