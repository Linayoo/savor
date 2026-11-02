import { photoChangeSchema, momentChangeSchema } from "@savor/shared";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { newUserId, testDb } from "../../test/db";
import { appRouter } from "../router";
import { createCallerFactory } from "../trpc";

const db = testDb();
const as = (userId: string) => createCallerFactory(appRouter)({ db, userId });

// The pull output as the spec 005 build parses it, frozen here: phones on
// that build keep syncing while spec 006 rolls out, server first
const versioned = { version: z.int().min(1) };
const spec005PullOutputSchema = z.object({
  moments: z.array(momentChangeSchema.extend(versioned)),
  photos: z.array(photoChangeSchema.extend(versioned)),
  version: z.int().min(0),
  hasMore: z.boolean(),
});

const t = Date.UTC(2026, 10, 1, 9, 30);

describe("phones on the spec 005 build", () => {
  it("still parse the pull output, which only adds uploadedAt to photos", async () => {
    const user = newUserId();
    const momentId = randomUUID();
    await as(user).sync.push({
      moments: [
        {
          id: momentId,
          text: "Ramen",
          kind: "meal",
          createdAt: t,
          updatedAt: t,
          deletedAt: null,
        },
      ],
      photos: [
        {
          id: randomUUID(),
          momentId,
          position: 0,
          createdAt: t,
          updatedAt: t,
          deletedAt: null,
        },
      ],
    });

    const pulled = await as(user).sync.pull({ sinceVersion: 0 });
    const parsed = spec005PullOutputSchema.safeParse(pulled);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.moments).toHaveLength(1);
    expect(parsed.data?.photos).toHaveLength(1);
  });
});
