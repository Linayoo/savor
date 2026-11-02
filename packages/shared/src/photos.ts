import { z } from "zod";

// Photo uploads and downloads (spec 006). The phone names a photo by its id;
// the server builds the storage key from the signed-in user.

export const MAX_DOWNLOAD_URLS = 50;

export const photoIdInputSchema = z.object({ photoId: z.uuid() });
export type PhotoIdInput = z.infer<typeof photoIdInputSchema>;

// A form to POST to S3: every field, then the file
export const createUploadOutputSchema = z.object({
  url: z.url(),
  fields: z.record(z.string(), z.string()),
});
export type CreateUploadOutput = z.infer<typeof createUploadOutputSchema>;

export const confirmUploadOutputSchema = z.object({
  uploadedAt: z.int().min(0),
});
export type ConfirmUploadOutput = z.infer<typeof confirmUploadOutputSchema>;

export const downloadUrlsInputSchema = z.object({
  photoIds: z.array(z.uuid()).min(1).max(MAX_DOWNLOAD_URLS),
});
export type DownloadUrlsInput = z.infer<typeof downloadUrlsInputSchema>;

// Only photos the caller may download; other ids are left out
export const downloadUrlsOutputSchema = z.object({
  urls: z.array(z.object({ photoId: z.uuid(), url: z.url() })),
});
export type DownloadUrlsOutput = z.infer<typeof downloadUrlsOutputSchema>;
