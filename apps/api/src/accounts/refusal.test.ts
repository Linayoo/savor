import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import {
  deletedAccounts,
  letterSettings,
  letters,
  moments,
} from "../db/schema";
import { runLetters } from "../letters/job";
import { setSettings } from "../letters/procedures";
import type { LetterWriter } from "../letters/writer";
import { confirmUpload, createUpload } from "../photos/procedures";
import { appRouter } from "../router";
import { push } from "../sync/push";
import { createCallerFactory } from "../trpc";
import { unavailableAccountDirectory } from "./directory";

// Spec 010: once an account is marked deleted, nothing reads or writes it
// anymore, from any device

const db = testDb();
const t = Date.UTC(2026, 10, 20, 9, 30);

const markDeleted = (userId: string) =>
  db.insert(deletedAccounts).values({ userId, deletedAt: t });

const caller = (userId: string) =>
  createCallerFactory(appRouter)({
    db,
    userId,
    photos: new FakePhotoStorage(),
    accounts: unavailableAccountDirectory,
  });

const momentChange = () => ({
  id: randomUUID(),
  text: "Ramen with Ana",
  kind: "meal" as const,
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
});

const refused = {
  code: "FORBIDDEN",
  cause: expect.objectContaining({ name: "AccountDeleted" }),
};

describe("a deleted account", () => {
  const procedures: [string, (userId: string) => Promise<unknown>][] = [
    [
      "sync.push",
      (u) => caller(u).sync.push({ moments: [momentChange()], photos: [] }),
    ],
    ["sync.pull", (u) => caller(u).sync.pull({ sinceVersion: 0, limit: 10 })],
    [
      "photos.createUpload",
      (u) => caller(u).photos.createUpload({ photoId: randomUUID() }),
    ],
    [
      "photos.confirmUpload",
      (u) => caller(u).photos.confirmUpload({ photoId: randomUUID() }),
    ],
    [
      "photos.downloadUrls",
      (u) => caller(u).photos.downloadUrls({ photoIds: [randomUUID()] }),
    ],
    ["letters.getSettings", (u) => caller(u).letters.getSettings()],
    [
      "letters.setSettings",
      (u) =>
        caller(u).letters.setSettings({
          enabled: true,
          timeZone: "Europe/Zurich",
        }),
    ],
    ["letters.list", (u) => caller(u).letters.list()],
  ];

  it.each(procedures)("is refused by %s", async (_, call) => {
    const userId = newUserId();
    await markDeleted(userId);

    await expect(call(userId)).rejects.toMatchObject(refused);
  });

  it("doesn't refuse anyone else", async () => {
    const other = newUserId();
    await markDeleted(newUserId());

    await expect(caller(other).letters.list()).resolves.toEqual({
      letters: [],
    });
  });
});

// The procedures check before they run; writers check again under the
// user's sync lock, for a call that passed that check just before the
// account was marked
describe("writers, called after the account was marked", () => {
  it("push writes nothing", async () => {
    const userId = newUserId();
    await markDeleted(userId);

    await expect(
      push(db, userId, { moments: [momentChange()], photos: [] }),
    ).rejects.toMatchObject(refused);
    expect(
      await db.select().from(moments).where(eq(moments.userId, userId)),
    ).toEqual([]);
  });

  it("createUpload and confirmUpload are refused", async () => {
    const userId = newUserId();
    const storage = new FakePhotoStorage();
    await markDeleted(userId);

    await expect(
      createUpload(db, storage, userId, randomUUID()),
    ).rejects.toMatchObject(refused);
    await expect(
      confirmUpload(db, storage, userId, randomUUID()),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("setSettings writes nothing", async () => {
    const userId = newUserId();
    await markDeleted(userId);

    await expect(
      setSettings(db, userId, { enabled: true, timeZone: "Europe/Zurich" }),
    ).rejects.toMatchObject(refused);
    expect(
      await db
        .select()
        .from(letterSettings)
        .where(eq(letterSettings.userId, userId)),
    ).toEqual([]);
  });
});

describe("the letter job", () => {
  it("skips a deleted account", async () => {
    const userId = newUserId();
    // October 2060, far from other tests' months
    const day = (d: number) => Date.UTC(2060, 9, d, 12);
    await db.insert(letterSettings).values({
      userId,
      enabled: true,
      timeZone: "Europe/Zurich",
      updatedAt: 0,
    });
    await db.insert(moments).values(
      [1, 2, 3].map((d) => ({
        ...momentChange(),
        userId,
        createdAt: day(d),
        updatedAt: day(d),
        version: d,
      })),
    );
    await markDeleted(userId);
    const writer: LetterWriter & { calls: number } = {
      model: "fake-model",
      calls: 0,
      async write() {
        this.calls++;
        return { ok: true, body: "Dear you", inputTokens: 1, outputTokens: 1 };
      },
    };

    await runLetters({
      db,
      writer,
      now: Date.UTC(2060, 10, 1, 7),
      month: "2060-10",
      log: () => undefined,
    });

    expect(writer.calls).toBe(0);
    expect(
      await db.select().from(letters).where(eq(letters.userId, userId)),
    ).toEqual([]);
  });
});

describe("over HTTP", () => {
  it("answers 403 with the reason ACCOUNT_DELETED", async () => {
    const userId = newUserId();
    await markDeleted(userId);

    const response = await fetchRequestHandler({
      endpoint: "/",
      req: new Request("http://localhost/letters.list"),
      router: appRouter,
      createContext: () => ({
        db,
        userId,
        photos: new FakePhotoStorage(),
        accounts: unavailableAccountDirectory,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.data).toMatchObject({
      code: "FORBIDDEN",
      reason: "ACCOUNT_DELETED",
    });
  });
});
