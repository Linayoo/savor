import type { AppRouter } from "@savor/api/router";
import { QUOTAS, type Quota } from "@savor/shared";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { AccountApi } from "../account-api";
import type { LettersApi } from "../letters/api";
import { SyncError, type SyncApi, type SyncErrorKind } from "./api";

type ClientOptions = {
  url: string;
  // Throws a SyncError when there is no valid session; null for a public
  // procedure, which goes without a token
  getToken: (() => Promise<string>) | null;
  fetch?: typeof globalThis.fetch;
};

// A tRPC client for the deployed API. Every call carries the current access
// token; errors become SyncErrors.
function createCaller({ url, getToken, fetch }: ClientOptions) {
  // Fetched before each request, so a failure stops it before it's sent
  let token = "";
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: url.replace(/\/$/, ""),
        fetch,
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      }),
    ],
  });

  const call = async <T>(
    request: (trpc: typeof client) => Promise<T>,
  ): Promise<T> => {
    token = getToken ? await getToken() : "";
    try {
      return await request(client);
    } catch (error) {
      throw toSyncError(error);
    }
  };
  return call;
}

// The deployed API behind the SyncApi interface, for the sync engine
export function createTrpcSyncApi(options: ClientOptions): SyncApi {
  const call = createCaller(options);
  return {
    push: (input) => call((trpc) => trpc.sync.push.mutate(input)),
    pull: (input) => call((trpc) => trpc.sync.pull.query(input)),
    createUpload: (input) =>
      call((trpc) => trpc.photos.createUpload.mutate(input)),
    confirmUpload: (input) =>
      call((trpc) => trpc.photos.confirmUpload.mutate(input)),
    downloadUrls: (input) =>
      call((trpc) => trpc.photos.downloadUrls.query(input)),
  };
}

// The letters procedures (spec 007)
export function createTrpcLettersApi(options: ClientOptions): LettersApi {
  const call = createCaller(options);
  return {
    list: () => call((trpc) => trpc.letters.list.query()),
    getSettings: () => call((trpc) => trpc.letters.getSettings.query()),
    setSettings: (input) =>
      call((trpc) => trpc.letters.setSettings.mutate(input)),
  };
}

// Account deletion (spec 010). wasDeleted needs no token: it's for a phone
// whose tokens stopped working.
export function createTrpcAccountApi(options: ClientOptions): AccountApi {
  const call = createCaller(options);
  const publicCall = createCaller({ ...options, getToken: null });
  return {
    deleteAccount: async () => {
      await call((trpc) => trpc.account.delete.mutate());
    },
    wasDeleted: async (userId) =>
      (await publicCall((trpc) => trpc.account.wasDeleted.query({ userId })))
        .deleted,
  };
}

const kindByCode: Partial<Record<string, SyncErrorKind>> = {
  CONFLICT: "conflict",
  BAD_REQUEST: "rejected",
  UNAUTHORIZED: "unauthorized",
  NOT_FOUND: "notFound",
};

function toSyncError(error: unknown): SyncError {
  if (!(error instanceof TRPCClientError)) return new SyncError("unavailable");
  const code: string | undefined = error.data?.code;
  if (code && kindByCode[code]) return new SyncError(kindByCode[code]!);
  // A quota refusal names its quota; API Gateway's own throttle doesn't
  if (code === "FORBIDDEN" && error.data?.reason === "ACCOUNT_DELETED") {
    return new SyncError("accountDeleted");
  }
  const quota: unknown = error.data?.quota;
  if (code === "TOO_MANY_REQUESTS" && isQuota(quota)) {
    return new SyncError("overQuota", "overQuota", quota);
  }
  // API Gateway answers 401 itself, without tRPC's shape, before the Lambda
  // runs (spec 004)
  const status: number | undefined =
    error.data?.httpStatus ??
    (error.meta?.response as Response | undefined)?.status;
  return new SyncError(status === 401 ? "unauthorized" : "unavailable");
}

const isQuota = (value: unknown): value is Quota =>
  QUOTAS.includes(value as Quota);
