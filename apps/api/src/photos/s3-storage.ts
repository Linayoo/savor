import {
  DeleteObjectsCommand,
  DeleteObjectTaggingCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  createPresignedPost,
  type PresignedPostOptions,
} from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DOWNLOAD_EXPIRES_SECONDS,
  MAX_PHOTO_BYTES,
  PENDING_TAGGING,
  PHOTO_CONTENT_TYPE,
  UPLOAD_EXPIRES_SECONDS,
  type PhotoStorage,
} from "./storage";

// DeleteObjects takes at most 1000 keys
const DELETE_BATCH = 1000;

// What S3 checks on every upload form. createPresignedPost adds the exact
// key and the bucket; the fake storage in tests checks these same entries.
export const UPLOAD_CONDITIONS: NonNullable<
  PresignedPostOptions["Conditions"]
> = [
  { "Content-Type": PHOTO_CONTENT_TYPE },
  ["content-length-range", 1, MAX_PHOTO_BYTES],
  { tagging: PENDING_TAGGING },
];

// Photos in the bucket from infra/app/photos.tf. URLs are signed with the
// Lambda role's credentials, so they can do no more than the role may.
export function s3PhotoStorage(client: S3Client, bucket: string): PhotoStorage {
  return {
    createUpload: (key) =>
      createPresignedPost(client, {
        Bucket: bucket,
        Key: key,
        Conditions: UPLOAD_CONDITIONS,
        // A condition's value must also be a form field
        Fields: {
          "Content-Type": PHOTO_CONTENT_TYPE,
          tagging: PENDING_TAGGING,
        },
        Expires: UPLOAD_EXPIRES_SECONDS,
      }),

    async size(key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return head.ContentLength ?? 0;
      } catch (error) {
        // 404 needs s3:ListBucket; without it S3 answers 403 (photos.tf)
        if ((error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },

    async clearPendingTag(key) {
      await client.send(
        new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }),
      );
    },

    downloadUrl: (key) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: DOWNLOAD_EXPIRES_SECONDS,
      }),

    async deleteAll(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const { Errors } = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
        if (Errors?.length) {
          throw new Error(
            `Couldn't delete ${Errors.length} photos: ${Errors[0].Code}`,
          );
        }
      }
    },
  };
}
