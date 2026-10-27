import type { PullOutput } from "@savor/shared";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client";
import { momentPhotos, moments } from "../db/schema";

// Changes for one user after sinceVersion, moments and photos merged in
// version order. Versions are unique per user across both tables.
export async function pull(
  db: Db,
  userId: string,
  { sinceVersion, limit }: { sinceVersion: number; limit: number },
): Promise<PullOutput> {
  // limit + 1 from each table is enough to fill the page and know if more
  // remain
  const [momentRows, photoRows] = await Promise.all([
    db
      .select()
      .from(moments)
      .where(and(eq(moments.userId, userId), gt(moments.version, sinceVersion)))
      .orderBy(asc(moments.version))
      .limit(limit + 1),
    db
      .select()
      .from(momentPhotos)
      .where(
        and(
          eq(momentPhotos.userId, userId),
          gt(momentPhotos.version, sinceVersion),
        ),
      )
      .orderBy(asc(momentPhotos.version))
      .limit(limit + 1),
  ]);

  const merged = [
    ...momentRows.map((row) => ({ type: "moment" as const, row })),
    ...photoRows.map((row) => ({ type: "photo" as const, row })),
  ].sort((a, b) => a.row.version - b.row.version);
  const page = merged.slice(0, limit);

  const output: PullOutput = {
    moments: [],
    photos: [],
    version: page.at(-1)?.row.version ?? sinceVersion,
    hasMore: merged.length > limit,
  };
  for (const item of page) {
    if (item.type === "moment") {
      const { userId: _, ...change } = item.row;
      output.moments.push(change);
    } else {
      const { userId: _, ...change } = item.row;
      output.photos.push(change);
    }
  }
  return output;
}
