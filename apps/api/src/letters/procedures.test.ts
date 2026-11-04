import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newUserId, testDb } from "../../test/db";
import { FakePhotoStorage } from "../../test/fake-photo-storage";
import { letters } from "../db/schema";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";

const db = testDb();
const as = (userId: string | null) =>
  createCallerFactory(appRouter)({
    db,
    userId,
    photos: new FakePhotoStorage(),
  });

async function storeLetter(userId: string, month: string, body = "Dear you") {
  const id = randomUUID();
  await db.insert(letters).values({
    id,
    userId,
    month,
    body,
    model: "test-model",
    inputTokens: 100,
    outputTokens: 50,
    createdAt: Date.UTC(2026, 10, 1, 7),
  });
  return id;
}

const unauthorized = expect.objectContaining({ code: "UNAUTHORIZED" });

describe("letters.getSettings", () => {
  it("is off, without a time zone, until letters are turned on", async () => {
    expect(await as(newUserId()).letters.getSettings()).toEqual({
      enabled: false,
      timeZone: null,
    });
  });

  it("is refused without a signed-in user", async () => {
    await expect(as(null).letters.getSettings()).rejects.toEqual(unauthorized);
  });
});

describe("letters.setSettings", () => {
  it("turns letters on with the phone's time zone, and off again keeping it", async () => {
    const user = as(newUserId());

    await user.letters.setSettings({
      enabled: true,
      timeZone: "Europe/Zurich",
    });
    expect(await user.letters.getSettings()).toEqual({
      enabled: true,
      timeZone: "Europe/Zurich",
    });

    await user.letters.setSettings({
      enabled: false,
      timeZone: "Pacific/Honolulu",
    });
    expect(await user.letters.getSettings()).toEqual({
      enabled: false,
      timeZone: "Pacific/Honolulu",
    });
  });

  it("refuses a time zone that isn't IANA", async () => {
    await expect(
      as(newUserId()).letters.setSettings({
        enabled: true,
        timeZone: "Mars/Olympus",
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("is refused without a signed-in user", async () => {
    await expect(
      as(null).letters.setSettings({ enabled: true, timeZone: "UTC" }),
    ).rejects.toEqual(unauthorized);
  });

  it("changes only the caller's settings", async () => {
    const a = newUserId();
    const b = newUserId();
    await as(a).letters.setSettings({ enabled: true, timeZone: "UTC" });

    await as(b).letters.setSettings({
      enabled: false,
      timeZone: "Asia/Tokyo",
    });

    expect(await as(a).letters.getSettings()).toEqual({
      enabled: true,
      timeZone: "UTC",
    });
    expect(await as(b).letters.getSettings()).toEqual({
      enabled: false,
      timeZone: "Asia/Tokyo",
    });
  });
});

describe("letters.list", () => {
  it("lists the caller's letters, newest month first", async () => {
    const userId = newUserId();
    const september = await storeLetter(userId, "2026-09", "September");
    const december = await storeLetter(userId, "2025-12", "December");
    const october = await storeLetter(userId, "2026-10", "October");

    expect(await as(userId).letters.list()).toEqual({
      letters: [
        {
          id: october,
          month: "2026-10",
          body: "October",
          createdAt: Date.UTC(2026, 10, 1, 7),
        },
        expect.objectContaining({ id: september }),
        expect.objectContaining({ id: december }),
      ],
    });
  });

  it("is empty without letters", async () => {
    expect(await as(newUserId()).letters.list()).toEqual({ letters: [] });
  });

  it("never returns another user's letters", async () => {
    const a = newUserId();
    await storeLetter(a, "2026-10", "For A");

    expect(await as(newUserId()).letters.list()).toEqual({ letters: [] });
  });

  it("is refused without a signed-in user", async () => {
    await expect(as(null).letters.list()).rejects.toEqual(unauthorized);
  });
});

describe("the letters table", () => {
  it("holds at most one letter per user and month", async () => {
    const userId = newUserId();
    await storeLetter(userId, "2026-10");

    await expect(storeLetter(userId, "2026-10")).rejects.toThrow();
  });
});
