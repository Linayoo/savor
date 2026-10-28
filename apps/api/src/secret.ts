import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

// The secret infra/app writes: the pooled url for the Lambda and the direct
// one for migrations (Neon's pooler runs in transaction mode)
const databaseSecretSchema = z.object({ url: z.string().min(1) });

type SecretsClient = {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
};

export async function readDatabaseUrl(
  client: SecretsClient,
  secretId: string,
): Promise<string> {
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!SecretString) throw new Error(`Secret ${secretId} is empty`);
  return databaseSecretSchema.parse(JSON.parse(SecretString)).url;
}
