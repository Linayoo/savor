import { S3Client } from "@aws-sdk/client-s3";
import { createDb } from "../src/db/client";
import { backfillPhotoSizes } from "../src/photos/backfill-sizes";
import { s3PhotoStorage } from "../src/photos/s3-storage";

// `pnpm --filter @savor/api backfill-photo-sizes`: once, after the deploy
// that added moment_photos.size_bytes (spec 009). Reads the sizes of photos
// confirmed before it from the bucket, with your AWS credentials, and writes
// them to DATABASE_URL (docs/operations.md, "Abuse limits").
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const bucket = process.env.SAVOR_PHOTOS_BUCKET;
if (!bucket) throw new Error("SAVOR_PHOTOS_BUCKET is not set");

const { db, close } = createDb(url);
try {
  const storage = s3PhotoStorage(
    new S3Client({ region: "eu-central-1" }),
    bucket,
  );
  const { filled, missing } = await backfillPhotoSizes(db, storage);
  console.log(`Sizes filled in for ${filled} photos`);
  if (missing.length > 0) {
    console.log(`No file in the bucket for: ${missing.join(", ")}`);
  }
} finally {
  await close();
}
