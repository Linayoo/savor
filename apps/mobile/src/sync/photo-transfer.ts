import type { CreateUploadOutput } from "@savor/shared";

// The phone's side of moving photo files (spec 006). The app implements it
// with the image manipulator, fetch and expo-file-system (src/photos.ts);
// tests with in-memory files.
export interface PhotoTransfer {
  exists(fileName: string): boolean;
  // Makes the copy to upload: longest edge at most 2048 px, JPEG at 0.8,
  // re-encoded without EXIF or GPS. Returns its uri; the original stays.
  uploadCopy(fileName: string): Promise<string>;
  // POSTs the copy to S3 with the form from createUpload. Throws a
  // SyncError if S3 refuses it or can't be reached.
  upload(form: CreateUploadOutput, uri: string): Promise<void>;
  discard(uri: string): void;
  // Saves the photo at a download URL into the photos folder and returns its
  // file name. Throws a SyncError if it can't.
  download(url: string, photoId: string): Promise<string>;
}

// Runs task for every item, at most `limit` at a time. One failing item
// doesn't stop the others; the errors are returned.
export async function forEachInParallel<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await task(item);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return errors;
}
