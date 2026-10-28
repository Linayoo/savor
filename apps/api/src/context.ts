import type { CreateHTTPContextOptions } from "@trpc/server/adapters/standalone";
import type { IncomingHttpHeaders } from "node:http";
import type { Db } from "./db/client";
import type { Context } from "./trpc";

// Development-only stand-in for auth on the local server. In any other
// environment the header is ignored; in AWS the user comes from the verified
// Cognito token (handler.ts).
export function devUserId(
  headers: IncomingHttpHeaders,
  env = process.env.NODE_ENV,
): string | null {
  if (env !== "development") return null;
  const value = headers["x-dev-user-id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createContextFactory(db: Db, env = process.env.NODE_ENV) {
  return ({ req }: CreateHTTPContextOptions): Context => ({
    db,
    userId: devUserId(req.headers, env),
  });
}
