import {
  confirmUploadOutputSchema,
  createUploadOutputSchema,
  downloadUrlsInputSchema,
  downloadUrlsOutputSchema,
  letterSettingsSchema,
  listLettersOutputSchema,
  photoIdInputSchema,
  pullInputSchema,
  pullOutputSchema,
  pushInputSchema,
  pushOutputSchema,
  setLetterSettingsInputSchema,
} from "@savor/shared";
import { getSettings, listLetters, setSettings } from "./letters/procedures";
import { deletePushedPhotoFiles } from "./photos/delete-files";
import { confirmUpload, createUpload, downloadUrls } from "./photos/procedures";
import { pull } from "./sync/pull";
import { push } from "./sync/push";
import { protectedProcedure, publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => ({ ok: true as const })),
  }),
  sync: router({
    push: protectedProcedure
      .input(pushInputSchema)
      .output(pushOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const output = await push(ctx.db, ctx.userId, input);
        // After the commit: a refused push deletes nothing
        await deletePushedPhotoFiles(ctx.db, ctx.photos, ctx.userId, input);
        return output;
      }),
    pull: protectedProcedure
      .input(pullInputSchema)
      .output(pullOutputSchema)
      .query(({ ctx, input }) => pull(ctx.db, ctx.userId, input)),
  }),
  photos: router({
    createUpload: protectedProcedure
      .input(photoIdInputSchema)
      .output(createUploadOutputSchema)
      .mutation(({ ctx, input }) =>
        createUpload(ctx.db, ctx.photos, ctx.userId, input.photoId),
      ),
    confirmUpload: protectedProcedure
      .input(photoIdInputSchema)
      .output(confirmUploadOutputSchema)
      .mutation(({ ctx, input }) =>
        confirmUpload(ctx.db, ctx.photos, ctx.userId, input.photoId),
      ),
    downloadUrls: protectedProcedure
      .input(downloadUrlsInputSchema)
      .output(downloadUrlsOutputSchema)
      .query(({ ctx, input }) =>
        downloadUrls(ctx.db, ctx.photos, ctx.userId, input.photoIds),
      ),
  }),
  letters: router({
    getSettings: protectedProcedure
      .output(letterSettingsSchema)
      .query(({ ctx }) => getSettings(ctx.db, ctx.userId)),
    setSettings: protectedProcedure
      .input(setLetterSettingsInputSchema)
      .output(letterSettingsSchema)
      .mutation(({ ctx, input }) => setSettings(ctx.db, ctx.userId, input)),
    list: protectedProcedure
      .output(listLettersOutputSchema)
      .query(({ ctx }) => listLetters(ctx.db, ctx.userId)),
  }),
});

export type AppRouter = typeof appRouter;
