# 003: Shared schemas and the sync API (local)

Status: done

## Problem

The phone keeps moments in SQLite with UUIDs and tombstones (spec 002), but there is nowhere to sync them to. This spec builds the server side of sync from ADR 0005: shared Zod schemas, a tRPC API with `push` and `pull`, and a Postgres data model, all running and tested locally. Auth and AWS come in spec 004; the phone side of sync and photo uploads in spec 005.

## Behavior

1. A developer runs `docker compose up -d` and `pnpm --filter @savor/api dev`, and has a working API on `http://localhost:3000` backed by a local Postgres.
2. `sync.push` accepts a batch of changed moments and photo records from one device and stores them for the calling user.
3. `sync.pull` returns everything that changed for the calling user after a given version, in version order, in pages.
4. Every procedure except `health` requires a user. Until spec 004, the user comes from a development-only stand-in (see Auth stand-in).
5. The app and the API use the same schemas and the same list of moment kinds from `packages/shared`.

## Packages

**`packages/shared` (`@savor/shared`)**, TypeScript source consumed directly by the app and the API:
- `momentKindSchema`: enum of the kind keys from spec 001. The app's `kinds.ts` keeps labels and icons but takes its keys and the `MomentKind` type from here.
- `momentChangeSchema`: `id` (uuid), `text` (string, max 5000), `kind` (momentKind, nullable), `createdAt`, `updatedAt` (integer ms), `deletedAt` (integer ms, nullable).
- `photoChangeSchema`: `id` (uuid), `momentId` (uuid), `position` (32-bit integer ≥ 0, matching the Postgres `integer` column), `createdAt`, `updatedAt`, `deletedAt`. No file name: the server identifies a photo by its id.
- `pushInputSchema`: `{ moments: momentChange[], photos: photoChange[] }`, at most 100 items in total.
- `pullInputSchema`: `{ sinceVersion: integer ≥ 0, limit: integer 1–500, default 200 }`.
- `pullOutputSchema`: `{ moments: (momentChange & { version })[], photos: (photoChange & { version })[], version, hasMore }`.

**`apps/api` (`@savor/api`)**: Node 24, tRPC v11, Drizzle 0.45, tests with Vitest.

## Data model (Postgres)

`moments`: `id` uuid primary key, `user_id` text not null, `text` text not null, `kind` text nullable, `created_at`, `updated_at` bigint not null (ms, from the device), `deleted_at` bigint nullable, `version` bigint not null.
Index on `(user_id, version)`.

`moment_photos`: `id` uuid primary key, `user_id`, `moment_id` uuid not null, `position` integer not null, `created_at`, `updated_at`, `deleted_at`, `version` as above.
Index on `(user_id, version)`.
No foreign key from `moment_id` to `moments.id`: a push holds at most 100 items, so a photo can reach the server in a different push than its moment. Spec 005 revisits this together with the phone's push order.

`user_sync_state`: `user_id` text primary key, `version` bigint not null.

`user_id` is a plain text id. In spec 004 it becomes the Cognito user's `sub`.

## Sync rules

Push, in one interactive transaction:
1. Lock the user's `user_sync_state` row (creating it at 0 if missing).
2. Reject the whole push with `CONFLICT` if any moment or photo id in it already exists for a different user, or if a photo's `momentId` is a moment of a different user.
3. For each change, in input order (moments before photos), assign the next version and upsert.
4. Last write wins by arrival: a change that reaches the server later replaces the stored row.
5. Deletes are final: once a row has `deleted_at`, later changes to it are ignored, except another delete. A stale edit can't bring a deleted moment back.
6. Pushing the same batch twice leaves the same data apart from `version` (it only uses up versions).
7. Return the user's version after the push.

Pull: rows of the calling user with `version > sinceVersion`, moments and photos merged in version order, at most `limit` rows, with `hasMore` when more exist and `version` = highest version returned (or `sinceVersion` when nothing changed).

## Auth stand-in

- tRPC context has `userId: string | null`. A `protectedProcedure` rejects calls without it (`UNAUTHORIZED`).
- Only when `NODE_ENV=development`, the local server reads the user id from an `x-dev-user-id` header. In any other environment the header is ignored.
- Tests create the context with a user id directly.
- Spec 004 replaces this with Cognito JWT verification.

## Local development and tests

- `docker-compose.yml` at the root runs Postgres 17 for development, and a separate database for tests.
- Locally and in CI the API talks to Postgres through `drizzle-orm/node-postgres`. In production it uses `drizzle-orm/neon-serverless` (ADR 0003). Both come from one `createDb()`, and both support interactive transactions, so the sync code is the same. ADR 0003 gets a short note about this.
- Migrations are generated with drizzle-kit and checked in.
- The API runs locally with tRPC's standalone HTTP adapter and file watching. The Lambda entry point and Docker image come with deployment in spec 004.
- CI runs the API tests against a Postgres service container, on Node 24 like the API. `.nvmrc` pins Node 24 for local development.

## API

- `health.check` (public): `{ ok: true }`
- `sync.push` (protected): `pushInput` → `{ version }`
- `sync.pull` (protected): `pullInput` → `pullOutput`

## Acceptance criteria

- [x] `packages/shared` exports the schemas and the kind enum; the app's `MomentKind` comes from it, and the app still typechecks, bundles for iOS and passes its tests.
- [x] Given no user, when calling `sync.push` or `sync.pull`, then the call fails with `UNAUTHORIZED`. `health.check` works without a user.
- [x] Given `NODE_ENV` is not `development`, then `x-dev-user-id` is ignored.
- [x] Given a push of two moments and three photos, then a pull from 0 returns all five with increasing versions, and the returned version equals the highest one.
- [x] Given a pull with `limit` smaller than the number of changes, then `hasMore` is true, and pulling again from the returned version returns the rest with no gaps and no repeats.
- [x] Given a moment edited and pushed again, then a pull from the earlier version returns it once, with the new text and a higher version.
- [x] Given a deleted moment, when a later push contains an edit to it, then it stays deleted and its text is unchanged.
- [x] Given the same push sent twice, then the stored moments and photos are the same as after one push, apart from `version`.
- [x] Given user A's moment, when user B pushes a change with the same id, then the push fails with `CONFLICT` and A's moment is unchanged; and user B's pull never returns A's rows.
- [x] Given user A's moment, when user B pushes a photo whose `momentId` is A's moment, then the push fails with `CONFLICT` and nothing from B's push is stored.
- [x] Given two pushes for the same user running at the same time, then every row gets a unique version and none are lost.
- [x] Given invalid input (bad uuid, unknown kind, text over 5000 characters, a photo position outside the 32-bit range, more than 100 items), then the call fails with `BAD_REQUEST` and nothing is stored.
- [x] Given a push that fails partway, then nothing from that push is stored and the user's version is unchanged.
- [x] `docker compose up -d` and `pnpm --filter @savor/api dev` start a working API; README explains both.
- [x] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass locally and in CI, including API tests against Postgres.

## Out of scope

- Cognito, AWS, Terraform, the Lambda entry point and Docker image (spec 004)
- The phone calling the API, and photo uploads to S3 (spec 005)
- Cleaning up old tombstones
- Rate limiting

## Open questions

None. The foreign key question is answered under Data model: no foreign key in this spec.