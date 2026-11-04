import { SyncError } from "@/sync/api";
import { createTrpcLettersApi, createTrpcSyncApi } from "@/sync/trpc-api";

type Call = { url: string; method: string; headers: Headers; body?: string };

// Answers like the deployed API: tRPC's JSON shapes, and API Gateway's own
// 401 body before the Lambda runs
function fakeFetch(respond: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const trpcError = (code: string, httpStatus: number) => ({
  status: httpStatus,
  body: { error: { message: "raw", code: -32000, data: { code, httpStatus } } },
});

const api = (
  fetch: typeof globalThis.fetch,
  getToken = async () => "token-a",
) =>
  createTrpcSyncApi({
    url: "https://api.example.com/",
    getToken,
    fetch,
  });

describe("createTrpcSyncApi", () => {
  it("pushes with the access token as a bearer token", async () => {
    const { calls, fetch } = fakeFetch(() => ({
      status: 200,
      body: { result: { data: { version: 3 } } },
    }));

    const output = await api(fetch).push({ moments: [], photos: [] });

    expect(output).toEqual({ version: 3 });
    expect(calls[0]).toMatchObject({
      url: "https://api.example.com/sync.push",
      method: "POST",
    });
    expect(calls[0].headers.get("authorization")).toBe("Bearer token-a");
    expect(JSON.parse(calls[0].body!)).toEqual({ moments: [], photos: [] });
  });

  it("pulls with the version and page size in the query", async () => {
    const page = { moments: [], photos: [], version: 7, hasMore: false };
    const { calls, fetch } = fakeFetch(() => ({
      status: 200,
      body: { result: { data: page } },
    }));

    expect(await api(fetch).pull({ sinceVersion: 7, limit: 200 })).toEqual(
      page,
    );
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/sync.pull");
    expect(JSON.parse(url.searchParams.get("input")!)).toEqual({
      sinceVersion: 7,
      limit: 200,
    });
  });

  it("calls the photo procedures with the token, mutations as POST", async () => {
    const { calls, fetch } = fakeFetch((call) => ({
      status: 200,
      body: {
        result: {
          data: call.url.includes("photos.downloadUrls")
            ? { urls: [] }
            : call.url.includes("photos.confirmUpload")
              ? { uploadedAt: 5 }
              : { url: "https://s3.example.com/", fields: { key: "k" } },
        },
      },
    }));
    const photoId = "6f1c1d0e-1c1a-4f6e-9a51-3f3f0b0e2a11";

    expect(await api(fetch).createUpload({ photoId })).toEqual({
      url: "https://s3.example.com/",
      fields: { key: "k" },
    });
    expect(await api(fetch).confirmUpload({ photoId })).toEqual({
      uploadedAt: 5,
    });
    expect(await api(fetch).downloadUrls({ photoIds: [photoId] })).toEqual({
      urls: [],
    });
    expect(calls.map((c) => [c.method, new URL(c.url).pathname])).toEqual([
      ["POST", "/photos.createUpload"],
      ["POST", "/photos.confirmUpload"],
      ["GET", "/photos.downloadUrls"],
    ]);
    expect(
      calls.every((c) => c.headers.get("authorization") === "Bearer token-a"),
    ).toBe(true);
  });

  it.each([
    ["NOT_FOUND", 404, "notFound"],
    ["CONFLICT", 409, "conflict"],
    ["BAD_REQUEST", 400, "rejected"],
    ["UNAUTHORIZED", 401, "unauthorized"],
    ["INTERNAL_SERVER_ERROR", 500, "unavailable"],
  ] as const)("turns %s into a %s sync error", async (code, status, kind) => {
    const { fetch } = fakeFetch(() => trpcError(code, status));

    await expect(api(fetch).push({ moments: [], photos: [] })).rejects.toEqual(
      new SyncError(kind),
    );
  });

  it("treats API Gateway's own 401 as an ended session", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      body: { message: "Unauthorized" },
    }));

    await expect(
      api(fetch).pull({ sinceVersion: 0, limit: 200 }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("treats a gateway error as worth retrying", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 503,
      body: { message: "Service Unavailable" },
    }));

    await expect(
      api(fetch).pull({ sinceVersion: 0, limit: 200 }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("treats a network failure as worth retrying", async () => {
    const fetch = (async () => {
      throw new TypeError("Network request failed");
    }) as typeof globalThis.fetch;

    await expect(
      api(fetch).pull({ sinceVersion: 0, limit: 200 }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("passes on the token's own error, such as an ended session", async () => {
    const { calls, fetch } = fakeFetch(() => ({ status: 200, body: {} }));
    const getToken = async () => {
      throw new SyncError("unauthorized");
    };

    await expect(
      api(fetch, getToken).pull({ sinceVersion: 0, limit: 200 }),
    ).rejects.toMatchObject({ kind: "unauthorized" });
    expect(calls).toEqual([]);
  });
});

describe("createTrpcLettersApi", () => {
  const lettersApi = (fetch: typeof globalThis.fetch) =>
    createTrpcLettersApi({
      url: "https://api.example.com/",
      getToken: async () => "token-a",
      fetch,
    });

  it("lists letters and reads the settings with the token", async () => {
    const letter = {
      id: "0b6f8f4e-7d7a-4f7e-9d43-5a1e2c3b4d5f",
      month: "2026-10",
      body: "Dear you",
      createdAt: 1,
    };
    const { calls, fetch } = fakeFetch((call) => ({
      status: 200,
      body: {
        result: {
          data: call.url.endsWith("letters.list")
            ? { letters: [letter] }
            : { enabled: false, timeZone: null },
        },
      },
    }));

    expect(await lettersApi(fetch).list()).toEqual({ letters: [letter] });
    expect(await lettersApi(fetch).getSettings()).toEqual({
      enabled: false,
      timeZone: null,
    });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "https://api.example.com/letters.list"],
      ["GET", "https://api.example.com/letters.getSettings"],
    ]);
    expect(calls[1].headers.get("authorization")).toBe("Bearer token-a");
  });

  it("saves the settings with the time zone as a POST", async () => {
    const { calls, fetch } = fakeFetch(() => ({
      status: 200,
      body: { result: { data: { enabled: true, timeZone: "Europe/Zurich" } } },
    }));

    await lettersApi(fetch).setSettings({
      enabled: true,
      timeZone: "Europe/Zurich",
    });

    expect(calls[0]).toMatchObject({
      url: "https://api.example.com/letters.setSettings",
      method: "POST",
    });
    expect(JSON.parse(calls[0].body!)).toEqual({
      enabled: true,
      timeZone: "Europe/Zurich",
    });
  });

  it("fails with the same errors as sync", async () => {
    const { fetch } = fakeFetch(() => ({ status: 502, body: {} }));

    await expect(lettersApi(fetch).list()).rejects.toEqual(
      new SyncError("unavailable"),
    );
  });
});
