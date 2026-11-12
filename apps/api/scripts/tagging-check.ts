import {
  DeleteObjectCommand,
  DeleteObjectTaggingCommand,
  GetObjectTaggingCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

// `pnpm --filter @savor/api tagging-check`: spec 009's check, before the
// lifecycle rule relies on it, that an upload form can tag the object it
// uploads. Signs the form with your AWS credentials and tries two small
// uploads under checks/ in the photos bucket, one that S3 should refuse; the
// object is deleted at the end.

const bucket = process.env.SAVOR_PHOTOS_BUCKET;
if (!bucket) throw new Error("SAVOR_PHOTOS_BUCKET is not set");
const pass = (check: string) => console.log(`ok  ${check}`);
const s3 = new S3Client({ region: "eu-central-1" });
const key = `checks/tagging-${randomUUID()}.jpg`;

// S3's tag set for POST uploads, as the form field `tagging`
const tagging = (value: string) =>
  `<Tagging><TagSet><Tag><Key>upload</Key><Value>${value}</Value></Tag></TagSet></Tagging>`;

async function post(fields: Record<string, string>, url: string) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", new Blob([randomBytes(1024)]), "photo.jpg");
  const response = await fetch(url, { method: "POST", body: form });
  return { status: response.status, body: await response.text() };
}

const tagsOf = async () =>
  (await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key })))
    .TagSet;

try {
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      { "Content-Type": "image/jpeg" },
      ["content-length-range", 1, 10 * 1024 * 1024],
      { tagging: tagging("pending") },
    ],
    Fields: { "Content-Type": "image/jpeg", tagging: tagging("pending") },
    Expires: 300,
  });

  const changed = await post({ ...fields, tagging: tagging("kept") }, url);
  assert.equal(changed.status, 403, changed.body);
  pass("S3 refuses the form with a different tag");

  const upload = await post(fields, url);
  assert.equal(upload.status, 204, upload.body);
  assert.deepEqual(await tagsOf(), [{ Key: "upload", Value: "pending" }]);
  pass("the form uploads the file tagged upload=pending");

  await s3.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }));
  assert.deepEqual(await tagsOf(), []);
  pass("removing the tag leaves the object untagged");
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
