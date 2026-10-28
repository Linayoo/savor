import type {
  APIGatewayEventRequestContextJWTAuthorizer,
  Context,
} from "aws-lambda";
import type { ApiEvent } from "../src/handler";

type Claims = APIGatewayEventRequestContextJWTAuthorizer["jwt"]["claims"];

type Request = {
  method?: "GET" | "POST";
  path: string;
  input?: unknown;
  headers?: Record<string, string>;
  // What the JWT authorizer verified; routes without it pass no claims
  claims?: Claims;
};

// An API Gateway HTTP API event (payload format 2.0) on the $default stage
export function apiEvent({
  method = "GET",
  path,
  input,
  headers = {},
  claims,
}: Request): ApiEvent {
  const query =
    method === "GET" && input !== undefined
      ? `input=${encodeURIComponent(JSON.stringify(input))}`
      : "";
  return {
    version: "2.0",
    routeKey: claims ? "$default" : `${method} /${path}`,
    rawPath: `/${path}`,
    rawQueryString: query,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(input) : undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "api",
      domainName: "api.execute-api.eu-central-1.amazonaws.com",
      domainPrefix: "api",
      http: {
        method,
        path: `/${path}`,
        protocol: "HTTP/1.1",
        sourceIp: "192.0.2.1",
        userAgent: "test",
      },
      requestId: "request",
      routeKey: claims ? "$default" : `${method} /${path}`,
      stage: "$default",
      time: "28/Oct/2026:12:00:00 +0000",
      timeEpoch: 1793188800000,
      ...(claims && {
        authorizer: {
          principalId: "",
          integrationLatency: 0,
          jwt: { claims, scopes: null },
        },
      }),
    },
  };
}

// The handler doesn't read the Lambda context
export const lambdaContext = {} as Context;
