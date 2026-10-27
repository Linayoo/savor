# 002: Moments in a local SQLite database

Status: approved

## Problem

Moments live as one JSON blob in AsyncStorage, with ids from `Date.now()` and hard deletes. That works for one phone, but sync (ADR 0005) needs ids that are unique across devices, deletes that other devices can find out about, and a store that can track changes per moment. This spec moves the app's data onto SQLite with that shape, entirely on the phone. Nothing talks to a server yet.

## Behavior

1. For the user, nothing changes: keeping, editing, deleting, the timeline, the gallery, the photo viewer and moment kinds all work as before.
2. On first launch after the update, existing moments, photos and kinds are moved from AsyncStorage into SQLite, in the same order and with the same dates.
3. The move happens once. If it fails, the app shows a short error, keeps the old data untouched, and tries again on the next launch.
4. A deleted moment disappears from the timeline, the gallery and the viewer as before, but stays in the database marked as deleted.
5. The app no longer has a web target.

## Data model

SQLite through expo-sqlite (installed with `expo install`) and `drizzle-orm/expo-sqlite`, Drizzle pinned to 0.45.x (ADR 0003, ADR 0005). Migrations generated with drizzle-kit and applied on app start with `useMigrations`.

`moments`

| Column | Type | Notes |
|---|---|---|
| id | text, primary key | UUID generated on the device |
| text | text, not null | may be empty when the moment has photos |
| kind | text, nullable | one of the kinds from spec 001 |
| created_at | integer, not null | ms since epoch |
| updated_at | integer, not null | ms since epoch, set on every change |
| deleted_at | integer, nullable | ms since epoch; set instead of deleting the row |

`moment_photos`

| Column | Type | Notes |
|---|---|---|
| id | text, primary key | UUID generated on the device; later the S3 object id |
| moment_id | text, not null | references moments.id |
| file_name | text, not null | file name in the app's photos folder, or an old full `file://` path from before spec 001 |
| position | integer, not null | order within the moment, from 0 |
| created_at | integer, not null | |
| updated_at | integer, not null | |
| deleted_at | integer, nullable | |

Index on `moments(deleted_at, created_at)` for the timeline query.

`app_meta`

| Column | Type | Notes |
|---|---|---|
| key | text, primary key | e.g. `sqliteImported` |
| value | text, not null | |

Small key-value table for app state that must change together with data in the same transaction.

The `Moment` type the screens use stays the same shape (`id`, `text`, `photos`, `kind`, `createdAt`), so screens don't need to know about SQLite.

Rules:
- Every insert sets `created_at` and `updated_at`. Every update sets `updated_at`.
- Delete sets `deleted_at` and `updated_at` on the moment and its photos, and deletes the photo files from the phone. Rows are never removed.
- All reads exclude rows with `deleted_at` set.
- UUIDs come from `expo-crypto` `randomUUID()`.

## Migration from AsyncStorage

- Runs after the SQLite migrations, only if the key `savor.moments` exists and the import hasn't been done yet.
- The `app_meta` row `sqliteImported` is the source of truth for "done". If it exists, the import is skipped, even when the AsyncStorage flag is missing; the flag is then set.
- Each old moment gets a new UUID. `created_at` and `updated_at` take the old `createdAt`. `kind` is kept if it's a known kind, otherwise left empty. Photos keep their order and file names.
- All inserts and the `sqliteImported` row are written in one transaction, so either all of it is saved or none of it.
- After the transaction commits, the AsyncStorage flag `savor.sqliteImported` is also set. If the app stops before that, the next launch finds the `app_meta` row and doesn't import again.
- The old `savor.moments` value is left in place as a backup. Removing it and the AsyncStorage dependency is a later cleanup.

## API

None.

## Platform

- Remove the web target: `app.json` platforms become iOS and Android only, web config is removed, and web-only dependencies are removed if nothing else needs them.
- Drizzle migrations need `babel-plugin-inline-import` and a `metro.config.js` that adds `sql` to `resolver.sourceExts`.

## Testing notes

expo-sqlite can't run inside Jest. The data layer should take a Drizzle database as a parameter, so tests can run the same schema and migrations on an in-memory SQLite driver for Node. Screen tests can keep mocking the data layer.

## Acceptance criteria

- [ ] Given moments stored in AsyncStorage (with and without photos, with and without a kind), when the app starts after the update, then every moment appears with the same text, kind, photos in the same order, and date.
- [ ] Given the import has run, when the app starts again, then it does not import again and nothing is duplicated.
- [ ] Given the import fails partway, then no moments are written to SQLite, neither the `app_meta` marker nor the flag is set, and the old AsyncStorage data is unchanged.
- [ ] Given the import committed but the AsyncStorage flag wasn't set (the app stopped in between), when the app starts again, then it does not import again and sets the flag.
- [ ] Given a stored kind that isn't a known kind, when imported, then the moment has no kind.
- [ ] Given I keep a moment, then it gets a UUID id, and `created_at` and `updated_at` are set.
- [ ] Given I edit a moment's text or kind, then `updated_at` changes and `created_at` does not.
- [ ] Given I delete a moment, then it disappears from the timeline, gallery and viewer; its row and photo rows have `deleted_at` set; and its photo files are gone from the phone.
- [ ] Given moments created on two devices in the same millisecond, then their ids differ (UUIDs, covered by using `randomUUID`).
- [ ] The timeline is sorted newest first, as before.
- [ ] All spec 001 tests still pass, adapted only where they touched storage directly.
- [ ] The app has no web target, and `expo export --platform ios` still bundles.
- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.

## Out of scope

- Any server, user id or sync columns (version, last synced), which come with the sync spec
- Uploading photos
- Removing the AsyncStorage backup and dependency
- Cleaning up old tombstones

## Open questions

None.