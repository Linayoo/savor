import { MAX_PUSH_ITEMS, pushOutputSchema } from "@savor/shared";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { env, mutation, signIn, signInAs } from "./api-client";
import { readSamples } from "./samples";

// `pnpm --filter @savor/api seed-moments --file samples.json`: keeps sample
// moments with the dates in the file, through the deployed API's sync.push, as
// the phone would. For trying the monthly letter on a month that has passed
// (README, "Monthly letters").
//
// The account is SEED_EMAIL with SEED_PASSWORD when both are set (from the
// gitignored apps/api/.env.seed), otherwise the smoke user A. Needs the smoke
// test's environment and your AWS credentials for the sign-in.
// Running it again with the same file changes nothing: each moment's id comes
// from the user, its date and its words.

const { values } = parseArgs({ options: { file: { type: "string" } } });
if (!values.file) throw new Error("--file is required");

const samples = await readSamples(values.file);
const email = process.env.SEED_EMAIL ?? env("SMOKE_USER_A_EMAIL");
const { idToken, sub } = process.env.SEED_EMAIL
  ? await signInAs(email, env("SEED_PASSWORD"))
  : await signIn("SMOKE_USER_A");

// A name-based UUID (version 5 layout) from SHA-256
function idOf(createdAt: number, text: string): string {
  const hex = createHash("sha256")
    .update(`${sub}\n${createdAt}\n${text}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const moments = samples.map(({ createdAt, kind, text }) => ({
  id: idOf(createdAt, text),
  text,
  kind,
  createdAt,
  updatedAt: createdAt,
  deletedAt: null,
}));

let version = 0;
for (let i = 0; i < moments.length; i += MAX_PUSH_ITEMS) {
  const { status, body } = await mutation("sync.push", {
    token: idToken,
    input: { moments: moments.slice(i, i + MAX_PUSH_ITEMS), photos: [] },
  });
  if (status !== 200) {
    throw new Error(`sync.push answered ${status}: ${JSON.stringify(body)}`);
  }
  version = pushOutputSchema.parse(body.result.data).version;
}
console.log(`Kept ${moments.length} moments for ${email} (version ${version})`);
