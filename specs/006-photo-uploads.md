# 006: Photo uploads

Status: approved

## Problem

Moments sync between devices (spec 005), but their photos stay on the device that took them. This spec uploads photos to S3 and brings them to the person's other devices, following ADR 0005 (photos go straight to S3 with presigned URLs, under `users/<userId>/photos/<photoId>`). With it, M2 is complete.

## Principles

- A moment never waits for its photos. Text and kind sync first; photos follow when uploaded.
- Photos are private: only their owner can upload or download them, and the API never accepts a storage key from the phone.
- No location leaves the phone: uploaded photos carry no GPS or other identifying metadata.
- Deleting a photo deletes it everywhere, including S3.

## Behavior

1. When a moment with photos is kept, the photos sync like the moment: their records are pushed, then each file is uploaded in the background.
2. Photos kept before this spec are uploaded on the next sync after updating, as long as their files still exist.
3. On another device, a moment whose photos aren't downloaded yet shows soft placeholder tiles in their places, in the moment's warm colors, never a broken image or an error. The tiles fill in as photos arrive.
4. Downloaded photos appear in the timeline, the gallery and the full-screen viewer exactly like photos taken on that device.
5. Deleting a moment on one device removes its photos from the other devices and from S3.
6. If an old photo file is missing on the phone that took it (for example a temporary file from before spec 001), there is nothing left to upload, so that photo is removed from its moment on every device, like a deleted photo. Its moment and other photos are unaffected.
7. Uploads and downloads use the same quiet sync: no progress bars or counters in the timeline. The Account screen's sync line can say "Uploading photos" or "Downloading photos" while it happens.

## Storage (Terraform, `infra/app`)

- Private S3 bucket for photos in eu-central-1: all public access blocked, server-side encryption, a bucket policy denying non-TLS requests, no versioning (a deleted photo should really be gone), and a lifecycle rule aborting incomplete uploads after 1 day.
- The API Lambda's role may `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `users/*` in that bucket only, and `s3:ListBucket` on the bucket limited to the `users/` prefix, so that checking a missing object answers 404 instead of 403. Presigned URLs are signed with this role.
- The deploy role does not get access to the bucket. No role other than the API's is granted access; the account admin keeps access, for the manual checks.
- Bucket name and region are passed to the Lambda as environment variables.

## Photo files

- Before upload, the phone makes an upload copy: longest edge at most 2048 px, JPEG quality around 0.8, re-encoded so that EXIF metadata, including GPS, is dropped. The local original stays as it is.
- Object key: `users/<sub>/photos/<photoId>.jpg`, built by the API from the verified user id and the photo id. Never sent by the phone.
- Maximum upload size 10 MB, enforced by S3, not only by the app.

## API

Shared schemas (`@savor/shared`):

- `photoChangeSchema` unchanged for input. Pull output gains `uploadedAt` (integer ms, nullable) on photos, set only by the server.

New protected procedures:

- `photos.createUpload({ photoId })` → a presigned POST (URL and form fields) valid for 5 minutes, with conditions on the exact key, `Content-Type: image/jpeg` and a content length of 1 byte to 10 MB. Only for a photo record that belongs to the caller and is not deleted; otherwise `NOT_FOUND`.
- `photos.confirmUpload({ photoId })` → checks with S3 that the object exists and is within the size limit, then sets `uploaded_at` and gives the photo a new version, so other devices learn about it in their next pull. Repeating it is harmless. Unknown, deleted or foreign photo, or missing object: `NOT_FOUND`.
- `photos.downloadUrls({ photoIds })` → presigned GET URLs valid for 15 minutes for up to 50 photos that belong to the caller, are uploaded and not deleted. Other ids are left out of the answer rather than failing the call.

Server data:

- `moment_photos.uploaded_at` bigint nullable.
- When a push tombstones a photo, or a moment with photos, the API deletes the S3 objects after the transaction commits. A failed delete is logged and doesn't fail the push.

## Phone

Data (new migration on `moment_photos`):

- `pending` integer not null default 1, as for moments: the record has changes the server hasn't accepted. Existing rows start pending.
- `upload_state` text: `local` (file here, not uploaded), `uploaded`, `remote` (known from a pull, file not downloaded yet).
- `file_name` becomes nullable, for `remote` photos.
- `uploaded_at` integer nullable, copied from pulls: whether the server has the file. Only `remote` photos with `uploaded_at` are downloaded.

Sync engine:

- Push sends pending photo records together with moments, moments first, within the 100-item batches.
- Pull applies photo records with the same rules as moments (insert, replace if not pending, deletes always win). A pulled photo with `uploadedAt` that has no local file becomes `remote`.
- After push and pull, the engine runs two queues, a few items at a time:
  - Upload: for each `local` photo whose record the server has accepted: make the upload copy, `createUpload`, POST the file, `confirmUpload`, then mark it `uploaded`. If the file is missing, the photo record is tombstoned (and pushed) instead, so it disappears from the moment everywhere.
  - Download: for each `remote` photo with `uploaded_at`: `downloadUrls`, download into the photos folder, then set `file_name` and mark it `uploaded`.
- Failures use the existing backoff. One failing photo doesn't stop the others.
- Database writes stay synchronous transactions; network and file work happen between them (spec 002).
- Deleting a photo's local file only after its tombstone transaction commits, as in spec 005.

## Rollout

The server goes first: Terraform, then the API, checked against S3 on its own. The phone follows once the server is confirmed. In between, phones running the spec 005 build keep syncing against the new API: its pull output only adds `uploadedAt`, which they ignore.

## Acceptance criteria

Upload and download

- [ ] Given I keep a moment with two photos on device 1, then device 2 shows the moment with two placeholder tiles, then the photos, in the same order.
- [ ] Given photos kept before this spec, when device 1 syncs after updating, then they are uploaded and appear on device 2.
- [ ] Given device 2 receives photos, then they appear in its timeline, gallery and full-screen viewer.
- [ ] Given an old photo whose file is missing, then its record is tombstoned, it is never retried, and it disappears from the moment on both devices.
- [ ] Given the upload fails (network off or an expired URL), then it is retried with backoff and succeeds once possible, without blocking the moment's text and kind.
- [ ] Given a photo's upload never completes, then other devices keep its placeholder and never try to download it.

Privacy and security

- [ ] An uploaded photo contains no GPS or other EXIF metadata (checked on a real uploaded object).
- [ ] An uploaded photo's longest edge is at most 2048 px.
- [ ] Given user B, then `createUpload`, `confirmUpload` and `downloadUrls` for user A's photo ids return nothing usable (`NOT_FOUND` or left out).
- [ ] The object key is built on the server; there is no way for the phone to choose it.
- [ ] Given an upload over 10 MB or with another content type, then S3 refuses it.
- [ ] A presigned upload URL stops working after 5 minutes, a download URL after 15.
- [ ] The bucket blocks public access, denies non-TLS requests, and no role other than the API's is granted access to `users/*` (the account admin keeps access).

Deletes

- [ ] Given a moment with photos deleted on device 1, then device 2 removes the photos, and the S3 objects are gone.
- [ ] Given the S3 delete fails, then the push still succeeds and the failure is logged.

Quality

- [ ] API tests for the three procedures, including cross-user cases, run against Postgres with S3 replaced by a fake that checks keys and conditions.
- [ ] A test shows the spec 005 phone code still syncs against the new API (pull output with `uploadedAt`).
- [ ] Phone sync tests cover the photo record rules, both queues, retries, the missing-file case and two devices sharing photos through the fake server and fake storage.
- [ ] Mutation check: removing the ownership check in `createUpload`, or the "not pending" check for photo records on pull, makes a test fail.
- [ ] Terraform fmt and validate pass; plan shows no changes after apply.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass locally and in CI, and the iOS export passes.

Manual (two simulators)

- [ ] Keep a moment with photos on simulator 1 and see them arrive on simulator 2.
- [ ] Download an uploaded object with the AWS CLI and confirm it has no location metadata.
- [ ] Delete the moment and confirm the objects are gone from the bucket.

## Out of scope

- Thumbnails or several image sizes
- Videos and audio
- A setting to download photos only on Wi-Fi
- A sweeper for orphaned objects (for example an upload confirmed for a photo deleted at the same moment)
- Account deletion
- Editing which photos belong to an existing moment

## Open questions

- None. The plan confirms that the phone's image re-encoding drops EXIF, and stops to ask if it doesn't.
