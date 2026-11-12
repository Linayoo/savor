# 009: Abuse limits

Status: in progress

## Problem

Before the App Store, anyone can make an account. Today the only limits are Cognito sign-in, one API Gateway stage throttle of 10 requests per second with a burst of 20 (shared by everyone), a 10 MB cap on each photo upload, and a monthly budget alarm. One account, buggy or hostile, could fill the photo bucket, the database or the Lambda account limit, and the first sign of it would be the bill. This spec adds per-user quotas in the API, caps on the Lambdas, earlier cost alerts, and cleanup of uploads that were never confirmed. The limits are set so that a real person never meets them.

## Behavior

### Quotas per user, enforced in the API

| Quota                  | Limit | Counted                                                                                                          |
| ---------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| Photos per moment      | 10    | Live photo records with the same `momentId`, after the push                                                      |
| New moments per day    | 500   | Moment ids the server hasn't seen before, by the server's UTC day of arrival                                     |
| Photo uploads per day  | 300   | `photos.createUpload` calls, by UTC day. Retrying the same photo counts again; the limit leaves room for retries |
| Photo storage per user | 5 GB  | Sizes of confirmed, live photos                                                                                  |

Why these numbers:

- **10 photos per moment:** a moment is "photos and a line". Ten is more than anyone keeps for one moment, and the app's picker stops there too.
- **500 new moments per day:** a person keeps a handful. The number is high because the first sign-in pushes everything kept on the phone so far, in one day. A bigger history keeps syncing the next day.
- **300 uploads per day:** the same reasoning, for photos. In the worst case, 300 uploads of 10 MB come to 3 GB in a day, all deleted or counted against the storage quota.
- **5 GB:** about 2,000 photos at the app's quality, which is years of moments. Storing it costs about $0.12 a month in eu-central-1.

Rules:

- Deletes and edits never count toward a quota, and a quota never refuses one. Deleting must always work, for privacy.
- A refusal changes nothing on the server and doesn't use up versions, the same as any failed push (spec 003).
- On the phone, nothing is lost. A moment the server refuses stays on the phone, pending, and syncs once the quota allows it. Photos over the storage quota stay on this phone only.
- A moment kept with more than 10 photos before 1.0.4 keeps them all on the phone. Its first 10 by position sync; the rest are never pushed or uploaded, so they stay on that phone. Deleting one of the first 10 brings the next one in. So 1.0.4 never meets the `photosPerMoment` refusal. A phone still on 1.0.3 that pushes such a moment is refused until it updates.
- Quotas count per account, not per device.

### What the person sees

The words are plain and never count, rank or scold (CLAUDE.md product rules). They describe what happens next, not what the person did.

- **Photos per moment:** the picker never offers more than the moment has room for, and the camera button is disabled at 10. The card says, quietly: "A moment holds up to 10 photos." This never reaches the server in normal use; the server check is for other clients.
- **Daily quotas:** sync goes to a `waiting` status, and the Account screen's sync line reads "Some changes will sync tomorrow". The rest of the sync still runs: the pull, and the photo uploads and downloads. The refused part is tried again at the longest retry delay, 10 minutes, rather than backing off from 5 seconds. The timeline shows no warning, the same as other sync states (spec 005).
- **Storage:** a `storage` refusal doesn't fail the sync. The Account screen shows one line: "New photos stay on this phone. Savor's space for your photos is full." Moments keep syncing, with their text and kind. The waiting photos are tried at every sync, so after deleting moments with photos frees space they upload, and the line goes away.

### Caps on the Lambdas

- The account's Lambda concurrency limit is 10 today (`aws lambda get-account-settings`, 2026-11-12), the reduced limit of a new account. Reserving concurrency needs 100 left unreserved, so it can't be set yet. Until it can, the account limit caps both Lambdas together at 10.
- `infra/bootstrap` requests an increase to the standard 1,000 with `aws_servicequotas_service_quota` (Lambda, `L-B99A9384`). AWS may also raise it on its own as the account is used.
- Once the limit is 1,000, the reserved concurrency below is set in `infra/app`, in its own change.
- The API Lambda gets reserved concurrency 10. That's the stage limit of 10 requests per second with requests well under a second, so a real burst never meets it. A runaway can no longer use the whole account's concurrency or open connections to Neon without limit.
- The letters Lambda gets reserved concurrency 2: one scheduled run and one manual invoke (docs/operations.md).
- Requests over the cap are throttled by Lambda. API Gateway returns an error, which the phone treats as `unavailable` and retries. A throttled scheduled letters run is retried by Lambda for up to 6 hours.

### Cost Anomaly Detection

- AWS already made the monitor: `Default-Services-Monitor` (`DIMENSIONAL`, `SERVICE`, created 2026-07-06). Terraform imports it and its subscription with `import` blocks instead of creating a second one.
- The subscription changes to a daily email summary to the budget address when an anomaly's impact is at least $1. The budget is $5 a month, so AWS's default thresholds, 40% and $100, would never fire.
- It lives in `infra/bootstrap`, next to the budget, because it covers the whole account.
- Cost Anomaly Detection is free. It runs about three times a day, so it can be up to a day late. The budget alarm stays.

### Unconfirmed uploads

- An upload whose photo is never confirmed (`photos.confirmUpload`) leaves an object that nothing points to. Today it stays forever.
- `tagging-check` confirmed on 2026-11-12, against the real bucket, that a presigned POST can set the tag and that S3 refuses the form with a different one. The `uploads/` prefix fallback isn't needed. Setting the tag through the form needs `s3:PutObjectTagging` on the signing role, and clearing it `s3:DeleteObjectTagging`.
- The upload form tags the object `upload=pending`. `confirmUpload` removes the tag once it has checked the size. A lifecycle rule expires objects still tagged `upload=pending` after 2 days. S3 rounds that to the next midnight UTC and expires objects asynchronously, so it can take a little longer.
- The existing rule that aborts incomplete multipart uploads stays as its own rule, since S3 doesn't allow that action in a rule filtered by tag.
- Photos uploaded before this change have no tag, and the rule never touches them.
- The phone never confirms an old upload. Each attempt runs `createUpload`, the upload and `confirmUpload` in a row, and a photo that failed is retried from the start at the next sync (spec 006). An expired object is only ever one that's already been given up on.

### Throttling per client, and WAF: not now

Checked against the AWS docs on 2026-11-12:

- **HTTP APIs have no per-client throttling.** API keys and usage plans are for REST APIs only. An HTTP API offers stage and per-route throttling, as best-effort targets.
- **Per-route limits don't help.** Savor's tRPC calls all go through the one `$default` route.
- **WAF can't be attached to an HTTP API.**
  - It can protect a CloudFront distribution in front of the API, with rate-based rules keyed on a header such as `Authorization`, over windows of 1 to 10 minutes.
  - CloudFront's flat-rate Free plan includes WAF with 5 rules.
  - But the API's own `execute-api` address would stay open around CloudFront. Closing it means disabling the default endpoint, which needs a custom domain and certificate. The alternative is a secret header from CloudFront that the API checks.
- **Decision:** keep the shared stage throttle, and rely on the per-user quotas for the paths that cost money (storage, uploads, database rows). Revisit CloudFront and WAF when there are enough users for one person to crowd the others out under the shared throttle.

## Data model

API, Postgres:

- `user_quota_usage`: `user_id` text, `day` date (UTC), `new_moments` integer, `uploads` integer, primary key (`user_id`, `day`). Updated in the same transaction as the push or under the same lock as `createUpload`. Rows older than a week can be deleted by the letters job or a later cleanup; old rows change nothing but take space.
- `moment_photos.size_bytes` bigint, nullable: set by `confirmUpload` from the size it already reads. Photos confirmed before this change get theirs from a one-time backfill script that reads the sizes from S3 (run from `docs/operations.md`, not in a migration, because migrations don't call S3). Until it's run, their size counts as 0.

Phone: none. The photos-per-moment limit is a constant in `packages/shared`, used by the app and the API.

## API

- Quota refusals are `TOO_MANY_REQUESTS`, with `data.quota` set to `photosPerMoment`, `momentsPerDay`, `uploadsPerDay` or `storage`. The phone maps them to a new `SyncError` kind, `overQuota`, which carries the quota.
- `sync.push`:
  - checks photos per moment and new moments per day after applying the changes, inside the transaction, so a refusal rolls it all back;
  - counts new moments only for ids that weren't in `moments` before.
- After a `momentsPerDay` refusal, the phone pushes only its pending deletes, of moments and of photos. Deletes keep reaching the server; new moments and edits wait for the next day. The phone can't tell a new moment from an edit, because both are just pending, and deletes are what matters for privacy. Decided 2026-11-12.
- A `TOO_MANY_REQUESTS` without a quota, such as API Gateway's own throttle, stays `unavailable`.
- `photos.createUpload`:
  - checks uploads per day and storage before signing the form;
  - the form gains a `tagging` field and the matching policy condition.
- `photos.confirmUpload`: stores `size_bytes` and removes the `upload=pending` tag. The Lambda role gains `s3:PutObjectTagging` and `s3:DeleteObjectTagging` on the photos prefix.
- The limits live in one place in the API (`src/quotas.ts`), as constants, so tests and the spec can name them.

Infrastructure (Terraform):

- `infra/bootstrap`: `aws_servicequotas_service_quota` for Lambda concurrent executions, 1,000.
- `infra/app/function.tf` and `letters.tf`: `reserved_concurrent_executions = 10` and `2`, once the increase is granted.
- `infra/app/photos.tf`: a second lifecycle rule, filtered on the tag `upload=pending`, expiring after 2 days.
- `infra/bootstrap`: `Default-Services-Monitor` imported as `aws_ce_anomaly_monitor`, and its subscription as `aws_ce_anomaly_subscription` (`DAILY`, email to the budget address, `ANOMALY_TOTAL_IMPACT_ABSOLUTE` at least 1).

## UI notes

- Moments screen card:
  - the picker's `selectionLimit` is the room left in the moment;
  - at 10 photos the camera button is disabled, and the card shows the one line about the limit.
- Account screen:
  - the sync line gains "Some changes will sync tomorrow";
  - one line for storage, under the sync line, only while photos are waiting for space.
- No alerts, no badges, no counts anywhere.

## Acceptance criteria

Quotas

- [x] Given a push that leaves a moment with 11 live photos, then it fails with `TOO_MANY_REQUESTS` and `photosPerMoment`, and nothing from it is stored. Verified: `sync/quotas.test.ts` (11 photos across two pushes, and in one), and `trpc.test.ts` for the 429 with `quota` over HTTP.
- [x] Given 500 new moments pushed today, when a push adds one more new moment, then it fails with `momentsPerDay` and nothing from it is stored; a push of edits and deletes still succeeds; the next UTC day the new moment is accepted. Verified: `sync/quotas.test.ts`, including a moment pushed twice counting once and one that arrives deleted not counting.
- [x] Given a user over a daily quota or the storage quota, when they push a delete, then it succeeds. Verified: `sync/quotas.test.ts` (deletes over the daily quota) and `photos/quotas.test.ts` (deleting a moment at 5 GB); pushes never check storage.
- [x] Given 300 `createUpload` calls today, when there's another, then it fails with `uploadsPerDay`. Verified: `photos/quotas.test.ts`, which also takes it the next UTC day.
- [x] Given confirmed live photos totalling 5 GB, when `createUpload` is called, then it fails with `storage`; after deleting a moment with photos, `createUpload` succeeds again. Verified: `photos/quotas.test.ts`; unconfirmed uploads don't count. Sizes of photos confirmed before were filled in by `backfill-photo-sizes` on 2026-11-12: 14 photos; one confirmed photo had no file in the bucket, `510d377b-e60f-4167-b720-42152e441836`.
- [x] Given another user at their quota, then my pushes and uploads are unaffected. Verified: `sync/quotas.test.ts` and `photos/quotas.test.ts`.

App

- [x] The picker offers only the room left in the moment, and the camera button is disabled at 10, with the line "A moment holds up to 10 photos." Verified: `moments-screen.test.tsx`, and on the simulator on 2026-11-12.
- [x] Given a `momentsPerDay` refusal, then the moments stay on the phone, pending, the sync line says "Some changes will sync tomorrow", pending deletes still sync, edits wait, and changes from other devices are still pulled. Verified: `sync-quotas.test.ts`, against the fake server; the waiting status is retried after 10 minutes.
- [x] Given a moment kept with 12 photos, then the moment and its first 10 photos sync and upload, and the other 2 stay on this phone. Verified: `sync-quotas.test.ts`.
- [x] Given a `storage` refusal, then the moment syncs without that photo, the photo stays on this phone, and the Account screen shows the storage line; no counts appear anywhere. Verified: `sync-quotas.test.ts`, and `sync-provider.test.tsx` for the Account line, which goes once the photo uploads.

Infrastructure

- [x] The Lambda concurrency increase to 1,000 is requested through Terraform. Verified: `infra/bootstrap/lambda-quota.tf`, applied on 2026-11-12.
- [ ] Once it's granted, the API and letters Lambdas have reserved concurrency 10 and 2 (`terraform plan` shows it; `aws lambda get-function-concurrency` confirms it).
- [ ] A new upload is tagged `upload=pending`, `confirmUpload` removes the tag, and an object left unconfirmed is gone a few days later (`photo-checks`). The tag, its removal and the rule were checked by `photo-checks` against the deployed API on 2026-11-12; an unconfirmed object expiring is still to be seen.
- [x] `Default-Services-Monitor` and its subscription are in Terraform state, with no second monitor, and the subscription sends a daily email at $1 or more. Verified: imported and applied with `infra/bootstrap/anomaly.tf` on 2026-11-12.
- [x] The README's architecture notes and docs/operations.md describe the limits and the backfill script. Verified: README architecture notes and highlights; docs/operations.md, "Abuse limits".

## Out of scope

- CloudFront and WAF in front of the API, and per-client throttling (see "not now" above).
- Sign-up abuse: many accounts made by one person. Cognito's own limits apply. WAF on the user pool costs at least $5 a month, the whole budget, and waits for real abuse.
- Quotas on pulls and photo downloads. The stage throttle covers them; S3 egress is the cost to watch, and Cost Anomaly Detection would show it.
- Limits on letters, which the server writes once a month and nobody can trigger.
- Showing anyone how close they are to a quota.

## Open questions

None. Resolved on 2026-11-12:

- **Account concurrency:** the limit is 10, so reserved concurrency waits for the increase (Caps on the Lambdas).
- **The default anomaly monitor:** it exists and is imported (Cost Anomaly Detection).
- **Tagging through the upload form:** checked against the real bucket before the lifecycle rule, with the prefix fallback (Unconfirmed uploads).
- **The numbers:** 10, 500, 300 and 5 GB, approved as proposed.
