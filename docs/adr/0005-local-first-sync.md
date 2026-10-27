# 0005: Local-first sync between devices and the server

Status: accepted
Date: 2026-10-27

## Context

Savor must keep working offline: moments are kept in the moment, often without a connection.
One user may use several devices, and several users will have private accounts.
Today, moments live only in AsyncStorage on one phone, with ids from Date.now() and hard deletes.
Sharing moments between users is out of scope.

## Decision

1. The device stays the place the app reads and writes. The UI never waits for the network.
2. On the device, moments move from AsyncStorage to SQLite with Drizzle, with a one-time migration of existing moments.
   - expo-sqlite is installed with `expo install expo-sqlite` (`~58.0.14` on SDK 58), not the `@next` tag Drizzle's docs suggest.
   - The app talks to SQLite through `drizzle-orm/expo-sqlite`, using the same stable drizzle-orm 0.45.x as the API (ADR 0003).
3. Moment ids become UUIDs generated on the device. Existing ids are migrated.
4. Every moment has `updatedAt` and `deletedAt`. Deleting sets `deletedAt` (a tombstone) instead of removing the row.
5. The server gives every change a per-user, increasing `version`.
6. Sync runs in two steps, when the app opens, after a change, and on pull-to-refresh:
   - Push: send moments changed locally since the last sync.
   - Pull: ask for everything with a version above the last one seen, and apply it.
7. Conflicts: the change that reaches the server last wins, per moment. Edits to the same moment on two devices before a sync are rare for a personal journal; this can be refined later.
8. Photos are uploaded separately, straight to S3 with presigned URLs, under `users/<userId>/photos/<photoId>`. A moment syncs its text right away; its photos follow when uploaded.
9. Zod schemas for moments and sync messages live in packages/shared and are used by both app and API.

## Consequences

- The app works fully offline, and nothing is lost when the network fails.
- Deletes reach every device through tombstones; tombstones can be cleaned up after a long retention period.
- Last-write-wins can drop one side of a simultaneous edit. Accepted for now.
- The SQLite migration and UUID change are a real step on their own and need their own spec (spec 002), done before the server work.
- expo-sqlite is included in Expo Go, so development keeps working without a development build.
- Drizzle migrations bundle their SQL files into the app. That needs `babel-plugin-inline-import` for `.sql` files and a `metro.config.js` that adds `sql` to `resolver.sourceExts`.
- Savor is mobile only. expo-sqlite on web would need Metro wasm support and COOP/COEP headers, so the web target is removed as part of spec 002.
- Sync logic is the most complex part of M2 and needs thorough tests, including offline and two-device cases.

## References

- [expo-sqlite for SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/)
- [Drizzle with Expo SQLite](https://orm.drizzle.team/docs/connect-expo-sqlite), with the migration setup
