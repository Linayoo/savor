import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContextFactory } from "./context";
import type { Db } from "./db/client";
import { appRouter } from "./router";

// tRPC's standalone HTTP server for local development. In AWS, lambda.ts is
// the entry point.
export function createServer(db: Db) {
  return createHTTPServer({
    router: appRouter,
    createContext: createContextFactory(db),
  });
}
