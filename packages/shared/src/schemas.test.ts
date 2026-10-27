import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MOMENT_KINDS,
  momentChangeSchema,
  momentKindSchema,
  photoChangeSchema,
  pullInputSchema,
  pushInputSchema,
} from "./index";

const t = Date.UTC(2026, 9, 1, 9, 30);

const moment = () => ({
  id: randomUUID(),
  text: "Ramen with Ana",
  kind: "meal" as const,
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
});

const photo = (momentId = randomUUID()) => ({
  id: randomUUID(),
  momentId,
  position: 0,
  createdAt: t,
  updatedAt: t,
  deletedAt: null,
});

describe("moment kinds", () => {
  it("lists the kinds from spec 001, in order", () => {
    expect(MOMENT_KINDS).toEqual([
      "meal",
      "film",
      "book",
      "nature",
      "friends",
      "body",
      "phrase",
    ]);
  });

  it("rejects a kind it doesn't know", () => {
    expect(momentKindSchema.safeParse("dance").success).toBe(false);
  });
});

describe("momentChangeSchema", () => {
  it("accepts a moment with or without a kind", () => {
    const withKind = moment();
    const withoutKind = { ...moment(), kind: null };

    expect(momentChangeSchema.parse(withKind)).toEqual(withKind);
    expect(momentChangeSchema.parse(withoutKind)).toEqual(withoutKind);
  });

  it.each([
    ["a bad uuid", { id: "not-a-uuid" }],
    ["an unknown kind", { kind: "dance" }],
    ["text over 5000 characters", { text: "a".repeat(5001) }],
    ["a time that isn't an integer", { updatedAt: 1.5 }],
  ])("rejects %s", (_, change) => {
    expect(
      momentChangeSchema.safeParse({ ...moment(), ...change }).success,
    ).toBe(false);
  });

  it("accepts text of exactly 5000 characters", () => {
    expect(
      momentChangeSchema.safeParse({ ...moment(), text: "a".repeat(5000) })
        .success,
    ).toBe(true);
  });
});

describe("photoChangeSchema", () => {
  it("accepts a photo record without a file name", () => {
    expect(photoChangeSchema.safeParse(photo()).success).toBe(true);
  });

  it.each([
    ["a negative position", -1],
    ["a position outside the 32-bit range", 2 ** 31],
    ["a position that isn't an integer", 0.5],
  ])("rejects %s", (_, position) => {
    expect(photoChangeSchema.safeParse({ ...photo(), position }).success).toBe(
      false,
    );
  });

  it("rejects a bad moment id", () => {
    expect(
      photoChangeSchema.safeParse({ ...photo(), momentId: "nope" }).success,
    ).toBe(false);
  });
});

describe("pushInputSchema", () => {
  it("accepts up to 100 items in total", () => {
    const input = {
      moments: Array.from({ length: 40 }, moment),
      photos: Array.from({ length: 60 }, () => photo()),
    };
    expect(pushInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects more than 100 items in total", () => {
    const input = {
      moments: Array.from({ length: 41 }, moment),
      photos: Array.from({ length: 60 }, () => photo()),
    };
    expect(pushInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("pullInputSchema", () => {
  it("defaults limit to 200", () => {
    expect(pullInputSchema.parse({ sinceVersion: 0 })).toEqual({
      sinceVersion: 0,
      limit: 200,
    });
  });

  it.each([
    ["a negative sinceVersion", { sinceVersion: -1 }],
    ["a limit of 0", { sinceVersion: 0, limit: 0 }],
    ["a limit over 500", { sinceVersion: 0, limit: 501 }],
  ])("rejects %s", (_, input) => {
    expect(pullInputSchema.safeParse(input).success).toBe(false);
  });
});
