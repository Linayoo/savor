# 010: Account deletion

Status: done

## Problem

Savor lets people create an account, but not delete it. The App Store requires account deletion inside the app for any app that offers account creation, and the privacy policy currently asks people to email the developer instead. This spec lets a person delete their account and everything in it from the Account screen.

## Principles

- Deleting an account deletes everything: sign-in, moments, photos, letters, settings and counters, on the server and on this phone.
- It can't be undone, so the app says so plainly and asks for a deliberate confirmation.
- A deletion that fails halfway can always be completed by trying again. Nothing is left half-deleted without a way to finish.
- After deletion, no device signed in to that account can write to it again.

## Behavior

1. Signed in, the Account screen shows "Delete account" below Sign out, in a quiet destructive style.
2. It opens a screen that explains what will be deleted: your sign-in, all moments and photos, your letters and settings, on every device, permanently. Letters and moments can't be recovered.
3. To confirm, the person types "delete" and taps "Delete account". The button is disabled until the word matches.
4. While it runs, the screen shows a calm progress state and can't be dismissed.
5. On success, the app stops syncing, clears everything of that account from this phone (moments, photo files, letters, sign-in), and returns to the empty, signed-out timeline with one line: "Your account and moments were deleted."
6. On failure, the person sees "Couldn't delete your account. Nothing was lost; please try again." and can retry. Retrying always continues where the last attempt stopped.
7. Other devices signed in to the deleted account: the next time they talk to the server, they learn the account no longer exists, clear that account's data from the device, and show "This account was deleted."
8. Signed out, nothing changes: local moments that were never synced belong to no account and stay.
9. When a sign-in is refused because "This phone holds moments from another account", the screen also offers "Remove them from this phone". A confirmation warns that moments never synced will be lost. Confirming clears that account's data from this phone only (moments, photo files, letters, owner and sync state); nothing on the server changes, and the next sign-in claims the empty phone. This is the way out for a phone that can't learn its account was deleted (see Rules: after 90 days), or that someone simply wants to hand over.

## Server

New procedure `account.delete`, which needs a valid token but, unlike the other protected procedures, runs for an account that's already marked. Every attempt runs these steps in order, and each is safe to repeat:

1. **Mark the account as deleted** in a new `deleted_accounts` table (`user_id`, `deleted_at`, `finished_at`), under the user's sync lock (`user_sync_state`), so writes already in flight finish first. A row that's already there is kept, with its first date. From this moment, every protected procedure refuses this user with `ACCOUNT_DELETED`, so no other device can push, pull, upload or change settings while deletion runs or afterwards.
2. **Revoke sessions:** Cognito `AdminUserGlobalSignOut`, so refresh tokens stop working.
3. **Delete photo objects:** every object under `users/<userId>/` in the photos bucket, by listing the prefix in pages and deleting in batches. Listing catches unconfirmed uploads too.
4. **Delete rows**, in one transaction under the same lock: `moments`, `moment_photos`, `letters`, `letter_settings`, `user_quota_usage`, `user_sync_state` for that user.
5. **Delete the Cognito user:** `AdminDeleteUser`. A user that's already gone counts as success.
6. **Set `finished_at`** and return `{ deleted: true }`.

New public procedure `account.wasDeleted({ userId })`, on its own route without the JWT authorizer, like `health.check`: `{ deleted: true }` while that id has a `deleted_accounts` row. A phone asks it about its own owner when its session ends, and when it opens signed out with an owner. It reads and writes nothing else.

Rules:

- The user id comes only from the verified token, as everywhere else, except for `account.wasDeleted`. That one answers only whether a random id was deleted in the last 90 days, which is why it needs no token: a device learns its account was deleted even after its tokens stopped working.
- `deleted_accounts` keeps only the Cognito `sub` (a random id) and the date, for 90 days after the deletion finished, so devices that come back online later still learn the account was deleted. Then the row is removed. The privacy policy says so.
- `account.delete` for a user already in `deleted_accounts` runs every step again; step 1 changes nothing, so a retry completes a deletion that failed partway.
- A daily job finishes deletions still open (no `finished_at`), so a deletion completes even when the phone can't try again, for example after step 2 revoked its session and its access token expired.
- `ACCOUNT_DELETED` is a tRPC `FORBIDDEN` error with `data.reason: "ACCOUNT_DELETED"`; tRPC's codes are fixed. Apps before 1.1.0 take it for a server error and retry, losing nothing.
- Writers (push, uploads, letter settings, the letter job's insert) check `deleted_accounts` again inside their transaction, after taking the user's sync lock, so nothing is written after step 4.
- An upload form issued just before step 1 can still upload a file after step 3, for up to 5 minutes. Its upload can't be confirmed anymore, so it keeps the `upload=pending` tag and the lifecycle rule from spec 009 removes it within 2–3 days.
- The letter job skips users in `deleted_accounts`.
- Deletion never counts toward quotas and is never refused by them.
- Logs record the step reached and counts (objects, rows), never content.

Infrastructure (Terraform, `infra/app`):

- The API role gains `cognito-idp:AdminUserGlobalSignOut` and `cognito-idp:AdminDeleteUser` on Savor's user pool only.
- Its existing S3 access to `users/*` (list, delete) is enough.
- The API function gets the user pool id as `COGNITO_USER_POOL_ID`.
- A public route `GET /account.wasDeleted` without the authorizer.
- The daily job: an EventBridge schedule at 04:00 Zurich calls the API function with `{ source: "savor.accounts" }`, as the keepwarm schedule does. Each run finishes at most 10 deletions that have been open for more than an hour (the phone's own retries come first), then removes rows whose deletion finished more than 90 days ago. The API function already has the S3 and Cognito access it needs; the letters function has neither.

## Phone

- The Account screen entry, the confirmation screen and its states.
- Before calling `account.delete`, the sync engine stops, as for sign-out (spec 005), and the phone refreshes its tokens, so it has a fresh hour for retries.
- After a failed attempt, the phone asks `account.wasDeleted`. If the account isn't marked, syncing resumes. If it is, syncing stays stopped (it would only be refused), the failure line shows, and a retry continues the deletion.
- If a retry is refused because the session can't be refreshed anymore, and the account is marked, the deletion counts as done here and the daily job finishes the server's part.
- After success, in this order: delete the account's photo files, clear the database (moments, photos, letters, `app_meta` owner and sync state) in one transaction, clear the Keychain tokens, then sign out locally.
- `ACCOUNT_DELETED` from a sync, or `account.wasDeleted` answering true after the session ended, triggers the same local clearing on other devices, with the "This account was deleted" message. The phone can't rely on Cognito to say the user no longer exists while refreshing: step 2 revoked the refresh token, and AWS's docs don't say which error a deleted user's refresh gets. Amplify clears the tokens either way, at the latest making the next call find no session, so the phone asks `account.wasDeleted`. Sync always runs before the letters calls, so it's the one place that handles `ACCOUNT_DELETED`.
- Clearing is safe to repeat: if the app is closed halfway, the next open finishes it.
- After the 90 days, a phone that was offline all that time can't learn its account was deleted, and keeps refusing other accounts. "Remove them from this phone" (behavior 9) is the way out.
- Moments kept while signed out and never synced, on a phone with no owner, are not touched.

## Acceptance criteria

Deleting

- [x] Given I'm signed in, the Account screen shows "Delete account". Verified: delete-account tests; manual run.
- [x] Given the confirmation screen, the button stays disabled until I type "delete". Verified: delete-account tests; manual run.
- [x] Given I confirm, then afterwards: my Cognito user doesn't exist, no rows for my user id remain in any table except `deleted_accounts`, and no objects remain under `users/<my id>/` in S3. Verified: API delete tests; in production, the log line `account_deleted`, written only after every step, with 2 objects and 7 rows.
- [x] Given I confirm, then this phone shows the empty, signed-out timeline with the deletion line, and no moments, photo files, letters or tokens of that account remain on it. Verified: delete-account, account-deleted and clear-account tests; manual run.
- [x] Given another user, then none of their data, objects or sign-in is affected. Verified: API delete tests.

Failures and retries

- [x] Given a failure at any server step, then a retry completes the deletion, with no step causing an error because an earlier one already ran. Verified: API delete tests, failing each of the six steps.
- [x] Given deletion has started, then push, pull, uploads, letters and settings for that user are refused with `ACCOUNT_DELETED`. Verified: API refusal tests.
- [x] Given a second device signed in to the deleted account, then on its next sync it clears that account's data and shows "This account was deleted." Verified: account-deleted tests; manual run with two devices.
- [x] Given a device that comes back online within 90 days, then it learns the account was deleted the same way. Verified: account-deleted and was-deleted tests; in production, `account.wasDeleted` answers true for the test account.
- [x] `deleted_accounts` rows whose deletion finished more than 90 days ago are removed, and the daily job finishes deletions still open. Verified: API cleanup tests.
- [x] Given a phone whose session ended on a deleted account, then it asks `account.wasDeleted`, clears that account's data and shows "This account was deleted." Verified: account-deleted tests.

Removing another account's moments

- [x] Given a sign-in refused because the phone holds another account's moments, when I choose "Remove them from this phone" and confirm, then the moments, photo files, letters and owner are gone from this phone, nothing changes on the server, and I can sign in. Verified: remove-other-account tests; manual run.

Quality

- [x] API tests on Postgres with fake storage and a fake Cognito admin, covering every step, retries after each failure point, and the cross-user case.
- [x] Phone tests for the confirmation, the local clearing order, another device receiving `ACCOUNT_DELETED`, a session ending on a deleted account, and removing another account's moments.
- [x] Mutation check: removing the user filter from the delete transaction, or the `deleted_accounts` check from protected procedures, makes a test fail.
- [x] Terraform fmt and validate pass; plan shows no changes after apply.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm test` pass, and the iOS export passes.

Manual

- [x] Delete a test account on a simulator, with a second simulator signed in to it.
- [x] Check with the AWS CLI that the Cognito user is gone and the S3 prefix is empty, and in Neon's SQL editor that no rows remain.

Docs

- [x] The privacy policy's deletion section describes the in-app deletion and the 90-day `deleted_accounts` record.

## Out of scope

- Exporting data before deletion
- A grace period or undo
- Deleting an account from a website or by email (the email route stays in the privacy policy as a fallback for people without the app)

## Release

As in spec 006, the server goes first: apply `infra/app`, deploy the API (migration and procedures), then release the app as 1.1.0.

## Open questions

None. The 90-day cleanup runs as a daily scheduled call to the API function (see Infrastructure).
