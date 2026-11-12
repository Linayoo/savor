import {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  GetBucketVersioningCommand,
  GetObjectTaggingCommand,
  GetPublicAccessBlockCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createUploadOutputSchema,
  downloadUrlsOutputSchema,
} from "@savor/shared";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { env, mutation, pass, query, signIn } from "./api-client";

// `pnpm --filter @savor/api photo-checks`: the manual S3 checks from spec
// 006, against the deployed API and the real bucket, with the smoke test's
// two users. Reads the bucket's settings with your AWS credentials.
// `-- --expiry` also waits out the upload (5 min) and download (15 min) URLs.

const bucket = env("SAVOR_PHOTOS_BUCKET");
const s3 = new S3Client({ region: "eu-central-1" });
const waitForExpiry = process.argv.includes("--expiry");

type Form = { url: string; fields: Record<string, string> };

// S3 takes the fields first and the file last
async function post(
  { url, fields }: Form,
  file: { size: number; contentType?: string },
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  if (file.contentType) form.set("Content-Type", file.contentType);
  form.append("file", new Blob([randomBytes(file.size)]), "photo.jpg");
  const response = await fetch(url, { method: "POST", body: form });
  return { status: response.status, body: await response.text() };
}

async function objectExists(key: string) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === "NotFound") return false;
    throw error;
  }
}

// The bucket's settings, read with your credentials
const block = await s3.send(
  new GetPublicAccessBlockCommand({ Bucket: bucket }),
);
assert.deepEqual(block.PublicAccessBlockConfiguration, {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
});
pass("the bucket blocks all public access");

const { Policy } = await s3.send(
  new GetBucketPolicyCommand({ Bucket: bucket }),
);
const policy = JSON.parse(Policy ?? "{}");
assert.ok(
  policy.Statement.some(
    (s: { Effect: string; Condition?: Record<string, unknown> }) =>
      s.Effect === "Deny" &&
      JSON.stringify(s.Condition) ===
        JSON.stringify({ Bool: { "aws:SecureTransport": "false" } }),
  ),
  "the bucket policy denies plain HTTP",
);
assert.equal(policy.Statement.length, 1, "the bucket policy grants nothing");
pass("the bucket policy only denies plain HTTP, and grants nothing");

const encryption = await s3.send(
  new GetBucketEncryptionCommand({ Bucket: bucket }),
);
assert.equal(
  encryption.ServerSideEncryptionConfiguration?.Rules?.[0]
    ?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
  "AES256",
);
const versioning = await s3.send(
  new GetBucketVersioningCommand({ Bucket: bucket }),
);
assert.notEqual(versioning.Status, "Enabled");
const lifecycle = await s3.send(
  new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
);
const rule = (id: string) => lifecycle.Rules?.find((r) => r.ID === id);
assert.equal(
  rule("abort-incomplete-uploads")?.AbortIncompleteMultipartUpload
    ?.DaysAfterInitiation,
  1,
);
pass("SSE-S3, no versioning, incomplete uploads aborted after 1 day");
const expiry = rule("expire-unconfirmed-uploads");
assert.equal(expiry?.Status, "Enabled");
assert.deepEqual(expiry?.Filter?.Tag, { Key: "upload", Value: "pending" });
assert.equal(expiry?.Expiration?.Days, 2);
pass("objects still tagged upload=pending expire after 2 days");

const a = await signIn("SMOKE_USER_A");
const b = await signIn("SMOKE_USER_B");
pass("A and B sign in");

// A keeps a moment with one photo
const now = Date.now();
const moment = {
  id: randomUUID(),
  text: `Photo checks ${new Date(now).toISOString()}`,
  kind: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const photo = {
  id: randomUUID(),
  momentId: moment.id,
  position: 0,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const key = `users/${a.sub}/photos/${photo.id}.jpg`;
const pushed = await mutation("sync.push", {
  token: a.accessToken,
  input: { moments: [moment], photos: [photo] },
});
assert.equal(pushed.status, 200, "A's push succeeds");

async function createUpload(token: string) {
  const response = await mutation("photos.createUpload", {
    token,
    input: { photoId: photo.id },
  });
  return {
    status: response.status,
    form:
      response.status === 200
        ? createUploadOutputSchema.parse(response.body.result.data)
        : null,
  };
}

const { form } = await createUpload(a.accessToken);
assert.ok(form);
assert.equal(form.fields.key, key, "the server built the key from A's id");
pass("A gets an upload form for exactly users/<A>/photos/<id>.jpg");

const expiringForm = form;

const tooLarge = await post(form, { size: 10 * 1024 * 1024 + 1 });
assert.equal(tooLarge.status, 400, tooLarge.body);
assert.match(tooLarge.body, /EntityTooLarge/);
pass("S3 refuses a file over 10 MB");

const png = await post(form, { size: 1000, contentType: "image/png" });
assert.equal(png.status, 403, png.body);
pass("S3 refuses another content type");

const otherKey = await post(
  { ...form, fields: { ...form.fields, key: `users/${b.sub}/photos/x.jpg` } },
  { size: 1000 },
);
assert.equal(otherKey.status, 403, otherKey.body);
pass("S3 refuses another key");

const tagsOf = async () =>
  (await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key })))
    .TagSet;

const ok = await post(form, { size: 1000 });
assert.equal(ok.status, 204, ok.body);
assert.deepEqual(await tagsOf(), [{ Key: "upload", Value: "pending" }]);
pass("S3 accepts the JPEG, tagged upload=pending");

for (const [check, call] of [
  ["createUpload", () => createUpload(b.accessToken)],
  [
    "confirmUpload",
    () =>
      mutation("photos.confirmUpload", {
        token: b.accessToken,
        input: { photoId: photo.id },
      }),
  ],
] as const) {
  assert.equal((await call()).status, 404, check);
  pass(`B's ${check} for A's photo is NOT_FOUND`);
}

const confirmed = await mutation("photos.confirmUpload", {
  token: a.accessToken,
  input: { photoId: photo.id },
});
assert.equal(confirmed.status, 200, "A's confirmUpload succeeds");
assert.deepEqual(await tagsOf(), []);
pass("A confirms the upload, which clears the tag");

async function downloadUrls(token: string) {
  const response = await query("photos.downloadUrls", {
    token,
    input: { photoIds: [photo.id] },
  });
  assert.equal(response.status, 200);
  return downloadUrlsOutputSchema.parse(response.body.result.data).urls;
}

assert.deepEqual(await downloadUrls(b.accessToken), []);
pass("B's downloadUrls leaves out A's photo");

const [download] = await downloadUrls(a.accessToken);
assert.ok(download);
const got = await fetch(download.url);
assert.equal(got.status, 200);
assert.equal((await got.arrayBuffer()).byteLength, 1000);
pass("A downloads the photo");

const plainHttp = await fetch(download.url.replace(/^https:/, "http:"));
assert.equal(plainHttp.status, 403);
pass("plain HTTP is refused, even with a signed URL");

const unsigned = await fetch(download.url.split("?")[0]);
assert.equal(unsigned.status, 403);
pass("the object isn't public");

if (waitForExpiry) {
  const issued = Date.now();
  console.log("…waiting 5 minutes for the upload form to expire");
  await sleep(5 * 60_000 + 30_000 - (Date.now() - issued));
  const late = await post(expiringForm, { size: 1000 });
  assert.equal(late.status, 403, late.body);
  pass("the upload form stops working after 5 minutes");

  console.log("…waiting until 15 minutes for the download URL");
  await sleep(15 * 60_000 + 30_000 - (Date.now() - issued));
  assert.equal((await fetch(download.url)).status, 403);
  pass("the download URL stops working after 15 minutes");
}

// Deleting the moment removes the file
const deleted = await mutation("sync.push", {
  token: a.accessToken,
  input: {
    moments: [{ ...moment, updatedAt: Date.now(), deletedAt: Date.now() }],
    photos: [],
  },
});
assert.equal(deleted.status, 200, "A's delete succeeds");
assert.equal(await objectExists(key), false, "the object is gone");
pass("deleting the moment deletes the photo's object");

console.log("Photo checks passed");
