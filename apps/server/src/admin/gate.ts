import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { appError } from "@xagents/core";
import { sendError } from "../http";

/** Constant-time string compare (length-safe). */
const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** Token from `Authorization: Bearer …` or the `x-admin-token` header. */
const presentedToken = (c: Context): string | undefined => {
  const auth = c.req.header("authorization");
  if (auth !== undefined && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return c.req.header("x-admin-token");
};

/**
 * Guard for `/api/admin/*`. When no `ADMIN_TOKEN` is configured the console is
 * off — respond 404 so its existence isn't advertised beyond `adminAvailable`
 * in `GET /api/config`. Otherwise require a matching bearer token (403 if not).
 */
export const requireAdmin = (adminToken: string | undefined): MiddlewareHandler => async (c, next) => {
  if (adminToken === undefined) return sendError(c, appError("not_found", "not found"));
  const token = presentedToken(c);
  if (token === undefined || !safeEqual(token, adminToken)) {
    return sendError(c, appError("forbidden", "admin authentication required"));
  }
  await next();
};
