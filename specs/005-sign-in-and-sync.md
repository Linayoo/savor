# 005: Sign-in and moment sync

Status: approved

## Problem

The sync API runs on AWS behind Cognito (spec 004), and the phone keeps moments in SQLite with UUIDs and tombstones (spec 002), but the two don't talk yet. This spec lets a person create an account, sign in, and have their moments, kinds, edits and deletes follow them to every device they use, following ADR 0005. Photos stay on the device that took them until spec 006.

## Principles

- Savor works fully without an account. Signing in is an offer ("keep your moments safe and on all your devices"), never a wall in front of keeping a moment.
- Sync is quiet. No counters, badges or nagging. A problem shows up in one place (the account screen), in plain words.
- Nothing the person kept is ever lost because of sync.

## Behavior

### Account

1. A small account button in the Moments header opens the Account screen.
2. Signed out, the Account screen offers "Sign in" and "Create account".
3. Create account: email and password (rules shown before typing: at least 12 characters, upper and lower case, a number), then a 6-digit code sent by email, then the person is signed in.
4. Sign in: email and password. "Forgot password" sends a code by email and lets the person set a new password.
5. Signed in, the Account screen shows the email, a quiet sync line ("Synced just now", "Synced 3 hours ago", "Waiting for a connection", "Couldn't sync, will try again"), and "Sign out".
6. Sessions last until sign-out; tokens refresh without asking the person to sign in again, for as long as the refresh token is valid (30 days of inactivity).
7. Errors are shown in plain words next to the field they concern (wrong code, password too short, email already used), never as raw service messages.

### Ownership of the moments on a phone

8. The phone remembers which account its moments belong to (`app_meta.ownerUserId`).
9. On the first sign-in on a phone whose moments have no owner, those moments become that account's and are pushed.
10. Signing out stops syncing and keeps everything on the phone. Signing back in with the same account resumes.
11. Signing in with a different account than the phone's owner is refused with: "This phone holds moments from another account. Sign in with that account to keep syncing." Switching accounts on one phone is out of scope.

### Sync

12. When signed in, the phone syncs: when the app opens or comes back to the foreground, a few seconds after any local change (debounced), on pull-to-refresh in the timeline, and when the connection returns.
13. One sync at a time. A sync triggered while one runs is queued once, not repeated.
14. A sync pushes first, then pulls.
15. Moments created, edited (text or kind) or deleted on one device appear on the person's other devices after their next sync.
16. Photos are not synced in this spec. A moment with photos syncs its text and kind; on another device it appears without its photos until spec 006.
17. Failed syncs retry with backoff (for example 5 s, 30 s, 2 min, then every 10 min) while the app is open, and immediately on the next trigger. The first call after a long quiet period may be rejected (ADR 0002); a retry handles it.
18. Sync never blocks the UI: keeping, editing and deleting work the same online or offline.

## Data model (phone)

New Drizzle migration:

- `moments.pending` integer not null, default 1: the row has local changes not yet accepted by the server. Existing rows start as pending, so a phone's moments are all pushed on first sign-in.
- `app_meta` keys: `ownerUserId`, `lastPulledVersion` (default 0), `lastSyncedAt`.

Rules:

- Every local write to a moment (keep, edit, delete) sets `pending = 1` in the same synchronous transaction.
- Photo rows are not synced and get no sync columns yet (spec 006).

## Sync engine (phone)

Lives in `apps/mobile/src/sync/`, with no React imports. It takes the database (`AppDb`), an API client, and a clock, so it runs unchanged in Jest on better-sqlite3 with a fake API.

**Push**
1. Read pending moments, oldest `updated_at` first, in batches of up to 100.
2. Send each batch with `sync.push` (schemas from `@savor/shared`, photos array empty).
3. On success, in one synchronous transaction, clear `pending` only on rows whose `updated_at` still equals the value that was sent. A row changed during the push stays pending and goes in the next push.
4. A `CONFLICT` response stops the sync and is reported (it means the data belongs to another account; it should never happen in normal use).

**Pull**
1. Call `sync.pull` from `lastPulledVersion`, page by page, until `hasMore` is false.
2. Apply each page in one synchronous transaction, together with the new `lastPulledVersion`:
   - A pulled moment that doesn't exist locally is inserted (not pending).
   - A pulled moment that exists locally and is not pending replaces the local row.
   - A pulled moment that exists locally and is pending is skipped, except a pulled delete, which always applies and clears `pending`. (Deletes are final on the server too, so a local edit to a deleted moment would be ignored anyway.)
   - When a pulled delete applies to a moment with local photo files, the files are deleted and the photo rows get `deleted_at`, as in a local delete.
3. Pulled photo records are ignored until spec 006.
4. After the last page, set `lastSyncedAt`.

All writes are synchronous Drizzle calls inside synchronous transactions (spec 002). Network calls happen between transactions, never inside one.

## API client and configuration

- tRPC client (`@trpc/client`, `httpLink`) typed with the API's `AppRouter` (type-only import from `@savor/api`).
- Every request carries the current Cognito token in `Authorization`. An expired token is refreshed first; a refresh failure signs the person out of syncing (data stays) and the Account screen says so.
- `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_USER_POOL_ID` and `EXPO_PUBLIC_USER_POOL_CLIENT_ID` come from the environment (none are secrets). An `.env.example` documents them; the real `.env` is gitignored.

## Auth library

Amplify Auth v6 (`aws-amplify` with `@aws-amplify/react-native`), chosen after checking current docs:

- SRP sign-in (the app client allows SRP and refresh only), sign-up with email code, forgot password, token refresh, sign-out.
- Tokens stored in the device's secure storage: `expo-secure-store` (Keychain and Keystore), through Amplify's custom token storage, not AsyncStorage. Values longer than SecureStore safely holds are split across several keys. Write errors are never swallowed.
- Amplify v6 does its SRP math in a native module that Expo Go doesn't include, so the app runs as a development build from now on (ADR 0006):
  - Continuous Native Generation: native settings live in `app.json` and config plugins; `ios/` and `android/` are generated by prebuild and stay gitignored.
  - Bundle identifier and Android package: `com.linayoo.savor`.
  - Moments kept in Expo Go don't carry over to the development build.
  - CI keeps running without Xcode: typecheck, lint, tests and `expo export --platform ios` only bundle JavaScript.

## API

No changes. The phone uses `sync.push` and `sync.pull` from spec 003 as deployed in spec 004.

## Acceptance criteria

Account
- [ ] Given no account, when I create one with a valid email and password and enter the emailed code, then I'm signed in.
- [ ] Given a password that breaks the rules or a wrong code, then I see a plain message next to the field and nothing else changes.
- [ ] Given I forgot my password, when I request a code and set a new password, then I can sign in with it.
- [ ] Given I'm signed in and close and reopen the app, then I'm still signed in.
- [ ] Given I'm signed out, then I can keep, edit and delete moments exactly as before.

Ownership
- [ ] Given a phone with moments and no owner, when I sign in for the first time, then those moments are pushed to my account.
- [ ] Given I sign out, then my moments stay on the phone and syncing stops.
- [ ] Given the phone belongs to account A, when I sign in as B, then sign-in is refused with the ownership message and nothing is pushed or pulled.

Sync
- [ ] Given two devices signed in to the same account, when I keep a moment with a kind on one, then after a sync it appears on the other with the same text, kind and date.
- [ ] Given a moment edited on device 1, then device 2 shows the new text and kind after its next sync.
- [ ] Given a moment deleted on device 1, then it disappears from device 2 after its next sync, and device 2 deletes any local photo files for it.
- [ ] Given device 2 has an unsynced edit to a moment that device 1 deleted, when device 2 syncs, then the moment is deleted on device 2.
- [ ] Given a moment edited while a push is in flight, then the edit stays pending and is pushed in the next sync.
- [ ] Given I keep moments offline, when the connection returns, then they are pushed without any action from me.
- [ ] Given more than 100 pending moments, then they are pushed in batches of at most 100, and all arrive.
- [ ] Given more changes on the server than one pull page, then all pages are applied and `lastPulledVersion` ends at the highest version.
- [ ] Given a pull page fails to apply, then none of its rows and not its version are saved, and the next sync retries it.
- [ ] Given the API rejects a call (network error or the first call after a quiet period), then sync retries with backoff and the UI stays usable.
- [ ] Given two sync triggers at once, then only one sync runs and one more is queued.
- [ ] A moment with photos syncs its text and kind; its photos stay on the original device.

Quality
- [ ] Sync engine tests run on better-sqlite3 with a fake API that applies the server rules from spec 003, including two simulated devices syncing through one fake server.
- [ ] Mutation check: removing the "still unchanged" condition after push, or the pending check on pull, makes a test fail.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass locally and in CI, and `expo export --platform ios` passes in CI without Xcode.
- [ ] Tokens are stored in `expo-secure-store`; a value the size of a real Cognito refresh token is stored and read back whole, and a failed write is reported, not swallowed.

Manual (the development build on two iOS simulators as the two devices, no Apple account needed; the phone is optional)
- [ ] Create an account on simulator 1, see its existing moments appear on simulator 2 after signing in there.
- [ ] Keep, edit and delete on each simulator and see the changes arrive on the other.
- [ ] Take the Mac offline (the simulators share its connection), keep a moment on simulator 1, go back online, and see it arrive on simulator 2 without any action.
- [ ] The Account screen shows the sync line, and nothing in the timeline nags or counts.

## Out of scope

- Photo upload, download and photo record sync (spec 006)
- Account deletion and changing email or password while signed in
- Social sign-in
- Switching between accounts on one phone
- Syncing while the app is closed (background sync)
- Showing or resolving edit conflicts in the UI

## Open questions

- None.