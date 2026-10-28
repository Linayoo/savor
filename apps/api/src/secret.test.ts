import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { readDatabaseUrl } from "./secret";

const client = (SecretString?: string) => ({
  send: vi.fn(async () => ({ SecretString })),
});

describe("readDatabaseUrl", () => {
  it("returns the url from the secret", async () => {
    const secrets = client(
      JSON.stringify({
        url: "postgres://pooled",
        migrationUrl: "postgres://direct",
      }),
    );

    await expect(readDatabaseUrl(secrets, "savor/database")).resolves.toBe(
      "postgres://pooled",
    );
    const [command] = secrets.send.mock.calls[0] as unknown as [
      GetSecretValueCommand,
    ];
    expect(command).toBeInstanceOf(GetSecretValueCommand);
    expect(command.input).toEqual({ SecretId: "savor/database" });
  });

  it.each([
    ["an empty secret", undefined],
    ["a secret that isn't JSON", "postgres://pooled"],
    [
      "a secret without a url",
      JSON.stringify({ migrationUrl: "postgres://x" }),
    ],
  ])("rejects %s", async (_, value) => {
    await expect(
      readDatabaseUrl(client(value), "savor/database"),
    ).rejects.toThrow();
  });
});
