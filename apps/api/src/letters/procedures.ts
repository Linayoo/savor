import type {
  LetterSettings,
  ListLettersOutput,
  SetLetterSettingsInput,
} from "@savor/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { letterSettings, letters } from "../db/schema";

// The letter procedures from spec 007, each scoped to the signed-in user

export async function getSettings(
  db: Db,
  userId: string,
): Promise<LetterSettings> {
  const [row] = await db
    .select({
      enabled: letterSettings.enabled,
      timeZone: letterSettings.timeZone,
    })
    .from(letterSettings)
    .where(eq(letterSettings.userId, userId));
  return row ?? { enabled: false, timeZone: null };
}

export async function setSettings(
  db: Db,
  userId: string,
  { enabled, timeZone }: SetLetterSettingsInput,
  now = Date.now(),
): Promise<LetterSettings> {
  await db
    .insert(letterSettings)
    .values({ userId, enabled, timeZone, updatedAt: now })
    .onConflictDoUpdate({
      target: letterSettings.userId,
      set: { enabled, timeZone, updatedAt: now },
    });
  return { enabled, timeZone };
}

export async function listLetters(
  db: Db,
  userId: string,
): Promise<ListLettersOutput> {
  const rows = await db
    .select({
      id: letters.id,
      month: letters.month,
      body: letters.body,
      createdAt: letters.createdAt,
    })
    .from(letters)
    .where(eq(letters.userId, userId))
    .orderBy(desc(letters.month));
  return { letters: rows };
}
