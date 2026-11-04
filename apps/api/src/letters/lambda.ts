import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDb } from "../db/client";
import { readDatabaseUrl } from "../secret";
import { bedrockLetterWriter } from "./bedrock-writer";
import { createLettersHandler } from "./handler";
import { letterModelSettings } from "./prompt";

// The letters Lambda's entry point, bundled into the API's image as
// letters.mjs (Dockerfile). infra/app/letters.tf sets both variables.
const secretId = process.env.DATABASE_SECRET_ID;
if (!secretId) throw new Error("DATABASE_SECRET_ID is not set");
const modelId = process.env.LETTER_MODEL_ID;
if (!modelId) throw new Error("LETTER_MODEL_ID is not set");
// Fails at start, not once per letter, for a model the request can't serve
letterModelSettings(modelId);

// In the function's own Region, where the inference profile is called
const bedrock = new BedrockRuntimeClient({});
const secrets = new SecretsManagerClient({});

export const handler = createLettersHandler({
  getDatabaseUrl: () => readDatabaseUrl(secrets, secretId),
  createDb: (url) => createDb(url, "neon"),
  writer: bedrockLetterWriter(bedrock, modelId),
  now: Date.now,
});
