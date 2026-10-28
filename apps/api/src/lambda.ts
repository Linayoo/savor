import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDb } from "./db/client";
import { createHandler } from "./handler";
import { readDatabaseUrl } from "./secret";

// The Lambda entry point, bundled into the container image (Dockerfile).
// infra/app sets DATABASE_SECRET_ID to the secret holding the Neon urls.
const secretId = process.env.DATABASE_SECRET_ID;
if (!secretId) throw new Error("DATABASE_SECRET_ID is not set");

const secrets = new SecretsManagerClient({});

export const handler = createHandler({
  getDatabaseUrl: () => readDatabaseUrl(secrets, secretId),
  createDb: (url) => createDb(url, "neon"),
});
