import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { createContextFactory } from "./context";
import type { Db } from "./db/client";
import { appRouter } from "./router";

// tRPC's standalone HTTP server for local development. The Lambda entry
// point comes with deployment in spec 004.
export function createServer(db: Db) {
  return createHTTPServer({
    router: appRouter,
    createContext: createContextFactory(db),
  });
}
