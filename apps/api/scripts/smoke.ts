import { pullOutputSchema, pushOutputSchema } from "@savor/shared";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mutation, pass, query, signIn } from "./api-client";

// `pnpm --filter @savor/api smoke`: checks the deployed API end to end with
// two test users (README, "Smoke test"). Signs in with the admin flow, so it
// needs AWS credentials for Savor's account.

// Every change B can see, page by page
async function pullAll(token: string) {
  const moments: { id: string }[] = [];
  let sinceVersion = 0;
  for (;;) {
    const { status, body } = await query("sync.pull", {
      token,
      input: { sinceVersion },
    });
    assert.equal(status, 200, "B's pull succeeds");
    const page = pullOutputSchema.parse(body.result.data);
    moments.push(...page.moments);
    sinceVersion = page.version;
    if (!page.hasMore) return moments;
  }
}

const health = await query("health.check");
assert.equal(health.status, 200);
assert.deepEqual(health.body, { result: { data: { ok: true } } });
pass("health.check answers without a token");

const now = Date.now();
const kept = {
  id: randomUUID(),
  text: `Smoke test ${new Date(now).toISOString()}`,
  kind: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};
const push = { moments: [kept], photos: [] };

for (const [check, call] of [
  ["sync.push without a token", mutation("sync.push", { input: push })],
  [
    "sync.pull without a token",
    query("sync.pull", { input: { sinceVersion: 0 } }),
  ],
  [
    "sync.pull with only x-dev-user-id",
    query("sync.pull", {
      input: { sinceVersion: 0 },
      headers: { "x-dev-user-id": "ana" },
    }),
  ],
  [
    "sync.pull with a forged token",
    query("sync.pull", { token: "not-a-jwt", input: { sinceVersion: 0 } }),
  ],
] as const) {
  assert.equal((await call).status, 401, check);
  pass(`${check} gets 401`);
}

const a = await signIn("SMOKE_USER_A");
const b = await signIn("SMOKE_USER_B");
pass("A and B sign in");

// A pushes with an ID token and names B in the dev header, which must not count
const pushed = await mutation("sync.push", {
  token: a.idToken,
  input: push,
  headers: { "x-dev-user-id": b.sub },
});
assert.equal(pushed.status, 200, "A's push succeeds");
const { version } = pushOutputSchema.parse(pushed.body.result.data);
pass("A pushes a moment (ID token, with a different x-dev-user-id)");

const pulled = await query("sync.pull", {
  token: a.idToken,
  input: { sinceVersion: version - 1 },
});
assert.equal(pulled.status, 200, "A's pull succeeds");
const page = pullOutputSchema.parse(pulled.body.result.data);
assert.deepEqual(
  page.moments.find((m) => m.id === kept.id),
  { ...kept, version },
  "A gets back what A pushed",
);
pass("A pulls the moment back");

// B pulls with an access token
const seenByB = await pullAll(b.accessToken);
assert.ok(
  !seenByB.some((m) => m.id === kept.id),
  "B's pull doesn't contain A's moment",
);
pass(`B's pull (access token, ${seenByB.length} moments) has none of A's`);

// Leave A with a tombstone, not a growing timeline
const deleted = await mutation("sync.push", {
  token: a.accessToken,
  input: {
    moments: [{ ...kept, updatedAt: Date.now(), deletedAt: Date.now() }],
    photos: [],
  },
});
assert.equal(deleted.status, 200, "A's delete succeeds");
pass("A deletes the moment (access token)");

console.log("Smoke test passed");
