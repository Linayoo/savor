import type { AppRouter } from "@savor/api/router";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { SyncError, type SyncApi, type SyncErrorKind } from "./api";

// The deployed API behind the SyncApi interface. Every call carries the
// current access token; errors become SyncErrors the engine understands.
export function createTrpcSyncApi({
  url,
  getToken,
  fetch,
}: {
  url: string;
  // Throws a SyncError when there is no valid session
  getToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): SyncApi {
  // Fetched before each request, so a failure stops it before it's sent
  let token = "";
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: url.replace(/\/$/, ""),
        fetch,
        headers: () => ({ authorization: `Bearer ${token}` }),
      }),
    ],
  });

  const call = async <T>(request: () => Promise<T>): Promise<T> => {
    token = await getToken();
    try {
      return await request();
    } catch (error) {
      throw toSyncError(error);
    }
  };

  return {
    push: (input) => call(() => client.sync.push.mutate(input)),
    pull: (input) => call(() => client.sync.pull.query(input)),
    createUpload: (input) =>
      call(() => client.photos.createUpload.mutate(input)),
    confirmUpload: (input) =>
      call(() => client.photos.confirmUpload.mutate(input)),
    downloadUrls: (input) =>
      call(() => client.photos.downloadUrls.query(input)),
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
  // API Gateway answers 401 itself, without tRPC's shape, before the Lambda
  // runs (spec 004)
  const status: number | undefined =
    error.data?.httpStatus ??
    (error.meta?.response as Response | undefined)?.status;
  return new SyncError(status === 401 ? "unauthorized" : "unavailable");
}
