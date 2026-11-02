import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { s3PhotoStorage } from "./s3-storage";

const bucket = "savor-photos-123456789012";
const key = "users/sub-a/photos/6f1c2c1e-1b7a-4c1e-9d2a-3f4b5c6d7e8f.jpg";

// Signs offline, with credentials like the Lambda role's: temporary, with a
// session token
function client() {
  return new S3Client({
    region: "eu-central-1",
    credentials: {
      accessKeyId: "ASIAEXAMPLE",
      secretAccessKey: "secret",
      sessionToken: "session-token",
    },
  });
}

const decodePolicy = (policy: string) =>
  JSON.parse(Buffer.from(policy, "base64").toString("utf8")) as {
    expiration: string;
    conditions: unknown[];
  };

describe("createUpload", () => {
  it("allows one JPEG of 1 byte to 10 MB at exactly this key, for 5 minutes", async () => {
    const before = Date.now();
    const { url, fields } = await s3PhotoStorage(client(), bucket).createUpload(
      key,
    );
    const policy = decodePolicy(fields.Policy);

    expect(url).toBe(`https://${bucket}.s3.eu-central-1.amazonaws.com/`);
    expect(fields).toMatchObject({
      key,
      "Content-Type": "image/jpeg",
      "X-Amz-Security-Token": "session-token",
    });
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        { key },
        { bucket },
        { "Content-Type": "image/jpeg" },
        ["content-length-range", 1, 10 * 1024 * 1024],
        { "X-Amz-Security-Token": "session-token" },
      ]),
    );
    const lifetime = Date.parse(policy.expiration) - before;
    expect(lifetime).toBeGreaterThan(295_000);
    expect(lifetime).toBeLessThanOrEqual(301_000);
  });
});

describe("downloadUrl", () => {
  it("reads this key for 15 minutes", async () => {
    const url = new URL(
      await s3PhotoStorage(client(), bucket).downloadUrl(key),
    );

    expect(url.host).toBe(`${bucket}.s3.eu-central-1.amazonaws.com`);
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  });
});

describe("size", () => {
  it("is null for a missing object, which S3 answers with 404", async () => {
    const s3 = client();
    vi.spyOn(s3, "send").mockRejectedValue(
      Object.assign(new Error("NotFound"), { name: "NotFound" }),
    );

    expect(await s3PhotoStorage(s3, bucket).size(key)).toBeNull();
  });

  it("is the object's size", async () => {
    const s3 = client();
    vi.spyOn(s3, "send").mockResolvedValue({ ContentLength: 1234 } as never);

    expect(await s3PhotoStorage(s3, bucket).size(key)).toBe(1234);
  });

  it("doesn't take other errors, like a refused permission, for a missing object", async () => {
    const s3 = client();
    vi.spyOn(s3, "send").mockRejectedValue(
      Object.assign(new Error("Forbidden"), { name: "Forbidden" }),
    );

    await expect(s3PhotoStorage(s3, bucket).size(key)).rejects.toThrow(
      "Forbidden",
    );
  });
});

describe("deleteAll", () => {
  it("deletes in batches of 1000", async () => {
    const s3 = client();
    const send = vi.spyOn(s3, "send").mockResolvedValue({} as never);
    const keys = Array.from(
      { length: 1001 },
      (_, i) => `users/a/photos/${i}.jpg`,
    );

    await s3PhotoStorage(s3, bucket).deleteAll(keys);

    const sizes = send.mock.calls.map(
      ([command]) =>
        (command.input as { Delete: { Objects: unknown[] } }).Delete.Objects
          .length,
    );
    expect(sizes).toEqual([1000, 1]);
  });

  it("fails when S3 couldn't delete some of them", async () => {
    const s3 = client();
    vi.spyOn(s3, "send").mockResolvedValue({
      Errors: [{ Key: key, Code: "AccessDenied" }],
    } as never);

    await expect(s3PhotoStorage(s3, bucket).deleteAll([key])).rejects.toThrow(
      "AccessDenied",
    );
  });
});
