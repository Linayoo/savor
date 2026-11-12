// Where photo files live (spec 006): S3 in AWS (s3-storage.ts), a fake in
// tests. The API builds every key from the verified user id; the phone never
// sends one.

export const PHOTO_CONTENT_TYPE = "image/jpeg";
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const UPLOAD_EXPIRES_SECONDS = 5 * 60;
export const DOWNLOAD_EXPIRES_SECONDS = 15 * 60;

// Every upload form tags its object upload=pending, and confirmUpload clears
// it. The bucket's lifecycle rule expires objects still tagged after 2 days,
// so an upload nobody confirmed doesn't stay forever (spec 009, photos.tf).
export const PENDING_TAGGING =
  "<Tagging><TagSet><Tag><Key>upload</Key><Value>pending</Value></Tag></TagSet></Tagging>";

// A form the phone posts the file with: every field, then the file
export type PresignedUpload = { url: string; fields: Record<string, string> };

export interface PhotoStorage {
  // Accepts one JPEG of 1 byte to 10 MB at exactly this key, for 5 minutes
  createUpload(key: string): Promise<PresignedUpload>;
  // The object's size in bytes, or null when there is none
  size(key: string): Promise<number | null>;
  // Removes the upload=pending tag, so the lifecycle rule keeps the object
  clearPendingTag(key: string): Promise<void>;
  // Reads the object, for 15 minutes
  downloadUrl(key: string): Promise<string>;
  deleteAll(keys: string[]): Promise<void>;
}

export const photoKey = (userId: string, photoId: string) =>
  `users/${userId}/photos/${photoId}.jpg`;

// For the local dev server: the app only ever talks to the deployed API
export const unavailablePhotoStorage: PhotoStorage = {
  createUpload: unavailable,
  size: unavailable,
  clearPendingTag: unavailable,
  downloadUrl: unavailable,
  deleteAll: async () => undefined,
};

async function unavailable(): Promise<never> {
  throw new Error("Photo storage is only available in AWS");
}
