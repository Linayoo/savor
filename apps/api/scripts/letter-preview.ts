import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import {
  letterMonthSchema,
  momentKindSchema,
  pullOutputSchema,
  timeZoneSchema,
} from "@savor/shared";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { invokeLetterModel } from "../src/letters/bedrock-writer";
import {
  buildLetterRequest,
  checkLetter,
  MAX_LETTER_MOMENTS,
  type LetterMoment,
} from "../src/letters/prompt";

// `pnpm --filter @savor/api letter-preview --month YYYY-MM`: writes a letter
// through the real model and prints it, without saving it (spec 007). For
// tuning the prompt by reading real output.
//
// The moments are the smoke user A's, pulled from the deployed API (README,
// "Smoke test", for its environment), or a JSON file of samples with --file:
//   [{ "date": "2026-10-04T13:00:00+02:00", "kind": "meal", "text": "..." }]
// --dry-run prints the exact request instead of sending it. Otherwise it calls
// Bedrock with your AWS credentials, so it costs about a cent.

const { values } = parseArgs({
  options: {
    month: { type: "string" },
    file: { type: "string" },
    "time-zone": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const month = letterMonthSchema.parse(values.month);
const timeZone = timeZoneSchema.parse(
  values["time-zone"] ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
);
const modelId =
  process.env.LETTER_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

const sampleSchema = z.array(
  z.object({
    date: z.iso.datetime({ offset: true }),
    kind: momentKindSchema.nullable().default(null),
    text: z.string(),
  }),
);

async function fromFile(path: string): Promise<LetterMoment[]> {
  const samples = sampleSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return samples.map(({ date, kind, text }) => ({
    createdAt: Date.parse(date),
    kind,
    text,
  }));
}

// Everything A has kept and not deleted, page by page
async function fromSmokeUser(): Promise<LetterMoment[]> {
  const { query, signIn } = await import("./api-client");
  const { idToken } = await signIn("SMOKE_USER_A");
  const kept: LetterMoment[] = [];
  let sinceVersion = 0;
  for (;;) {
    const { status, body } = await query("sync.pull", {
      token: idToken,
      input: { sinceVersion },
    });
    if (status !== 200) throw new Error(`sync.pull answered ${status}`);
    const page = pullOutputSchema.parse(body.result.data);
    for (const m of page.moments) {
      if (m.deletedAt === null) {
        kept.push({ createdAt: m.createdAt, kind: m.kind, text: m.text });
      }
    }
    sinceVersion = page.version;
    if (!page.hasMore) return kept;
  }
}

// As the job chooses them: that month in the time zone, the most recent first
const monthOf = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone,
});
const all = values.file ? await fromFile(values.file) : await fromSmokeUser();
const moments = all
  .filter((m) => monthOf.format(m.createdAt) === month)
  .sort((a, b) => b.createdAt - a.createdAt)
  .slice(0, MAX_LETTER_MOMENTS);
console.log(`${moments.length} moments in ${month} (${timeZone})`);
if (moments.length < 3) {
  console.log("The job writes no letter for fewer than 3 moments.");
  process.exit(1);
}

const input = { month, timeZone, moments };
if (values["dry-run"]) {
  console.log(JSON.stringify(buildLetterRequest(input, modelId), null, 2));
  process.exit(0);
}

const reply = await invokeLetterModel(
  new BedrockRuntimeClient({ region: "eu-central-1" }),
  modelId,
  input,
);
const text = z
  .object({
    content: z.array(
      z.looseObject({ type: z.string(), text: z.string().optional() }),
    ),
  })
  .parse(reply)
  .content.filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("");
const check = checkLetter(reply);

console.log(`\n${text.trim()}\n`);
console.log(
  check.ok
    ? `ok: ${text.trim().split(/\s+/).length} words, ${check.inputTokens} tokens in, ${check.outputTokens} out (${modelId})`
    : `refused by the checks: ${check.reason} (${modelId})`,
);
