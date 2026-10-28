import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import type {
  APIGatewayEventRequestContextJWTAuthorizer,
  APIGatewayEventRequestContextV2,
  APIGatewayProxyEventV2WithRequestContext,
  Context as LambdaContext,
} from "aws-lambda";
import type { Db } from "./db/client";
import { appRouter } from "./router";

// An HTTP API request. The JWT authorizer adds the verified claims; routes
// without it, like health.check, have none.
export type ApiEvent = APIGatewayProxyEventV2WithRequestContext<
  APIGatewayEventRequestContextV2 & {
    authorizer?: APIGatewayEventRequestContextJWTAuthorizer;
  }
>;

// EventBridge Scheduler's weekly call that keeps the function active (ADR 0002)
export type KeepwarmEvent = { source: "savor.keepwarm" };

export type HandlerEvent = ApiEvent | KeepwarmEvent;

export type HandlerDeps = {
  getDatabaseUrl: () => Promise<string>;
  createDb: (url: string) => { db: Db; close: () => Promise<void> };
};

// The user is only ever the verified token's subject, never a header
export function userIdFromEvent(event: ApiEvent): string | null {
  const sub = event.requestContext.authorizer?.jwt.claims.sub;
  return typeof sub === "string" && sub ? sub : null;
}

export function createHandler({ getDatabaseUrl, createDb }: HandlerDeps) {
  // Read once per container; a failed read isn't kept, so the next request retries
  let databaseUrl: Promise<string> | undefined;
  const readDatabaseUrl = () => {
    databaseUrl ??= getDatabaseUrl().catch((error: unknown) => {
      databaseUrl = undefined;
      throw error;
    });
    return databaseUrl;
  };

  return async (event: HandlerEvent, context: LambdaContext) => {
    // tRPC's adapter throws on events that aren't HTTP requests
    if ("source" in event) return { ok: true as const };

    // A pool per request, closed before the response (ADR 0003)
    const { db, close } = createDb(await readDatabaseUrl());
    try {
      return await awsLambdaRequestHandler({
        router: appRouter,
        createContext: ({ event }: { event: ApiEvent }) => ({
          db,
          userId: userIdFromEvent(event),
        }),
      })(event, context);
    } finally {
      await close();
    }
  };
}
