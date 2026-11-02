import { randomBytes } from "node:crypto";
import { SecureTokenStorage } from "@/auth/secure-storage";

// expo-secure-store in memory, with the documented key rules and the limit
// some iOS releases had: values above 2048 bytes are refused
const mockStore = new Map<string, string>();
let mockFailWrites = false;
jest.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid key ${key}`);
    if (Buffer.byteLength(value, "utf8") > 2048) {
      throw new Error("Value too large for the Keychain");
    }
    if (mockFailWrites) throw new Error("Keychain write failed");
    mockStore.set(key, value);
  },
  getItemAsync: async (key: string) => mockStore.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    mockStore.delete(key);
  },
}));

const b64url = (bytes: number) => randomBytes(bytes).toString("base64url");

// Cognito refresh tokens are encrypted JWTs (JWE): a header, an RSA-OAEP
// encrypted key, an IV, the ciphertext and a tag, about 1,800 characters
function refreshTokenSized() {
  const header = Buffer.from(
    JSON.stringify({ cty: "JWT", enc: "A256GCM", alg: "RSA-OAEP" }),
  ).toString("base64url");
  return [header, b64url(256), b64url(12), b64url(1010), b64url(16)].join(".");
}

beforeEach(() => {
  mockStore.clear();
  mockFailWrites = false;
});

const key = "CognitoIdentityServiceProvider.client.user.refreshToken";

describe("SecureTokenStorage", () => {
  it("stores and reads back a small value", async () => {
    const storage = new SecureTokenStorage();

    await storage.setItem(key, "small");

    expect(await storage.getItem(key)).toBe("small");
  });

  it("has nothing for a key it never stored", async () => {
    expect(await new SecureTokenStorage().getItem(key)).toBeNull();
  });

  it("stores a refresh token's worth whole, in pieces SecureStore accepts", async () => {
    const storage = new SecureTokenStorage();
    const token = refreshTokenSized();
    expect(token.length).toBeGreaterThan(1700);

    await storage.setItem(key, token);

    expect(await storage.getItem(key)).toBe(token);
    for (const value of mockStore.values()) {
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1024);
    }
  });

  it("stores large and non-ASCII values whole", async () => {
    const storage = new SecureTokenStorage();
    const large = b64url(7500);
    const accents = "Ramen mit Anaïs 🍜 ".repeat(200);

    await storage.setItem("large", large);
    await storage.setItem("accents", accents);

    expect(await storage.getItem("large")).toBe(large);
    expect(await storage.getItem("accents")).toBe(accents);
  });

  it("stores keys SecureStore doesn't allow, without mixing them up", async () => {
    const storage = new SecureTokenStorage();

    await storage.setItem("ana@example.com", "one");
    await storage.setItem("ana_40_example.com", "two");

    expect(await storage.getItem("ana@example.com")).toBe("one");
    expect(await storage.getItem("ana_40_example.com")).toBe("two");
  });

  it("replaces a long value with a short one and leaves no pieces behind", async () => {
    const storage = new SecureTokenStorage();
    await storage.setItem(key, refreshTokenSized());
    await storage.setItem("other", "kept");
    const before = mockStore.size;

    await storage.setItem(key, "short");

    expect(await storage.getItem(key)).toBe("short");
    expect(mockStore.size).toBeLessThan(before);
    expect(await storage.getItem("other")).toBe("kept");
  });

  it("replaces a long value with another long one", async () => {
    const storage = new SecureTokenStorage();
    const first = refreshTokenSized();
    const second = refreshTokenSized();
    await storage.setItem(key, first);
    const size = mockStore.size;

    await storage.setItem(key, second);

    expect(await storage.getItem(key)).toBe(second);
    expect(mockStore.size).toBe(size);
  });

  it("reports a failed write instead of swallowing it, and keeps the previous value", async () => {
    const storage = new SecureTokenStorage();
    const first = refreshTokenSized();
    await storage.setItem(key, first);
    mockFailWrites = true;

    await expect(storage.setItem(key, refreshTokenSized())).rejects.toThrow(
      "Keychain write failed",
    );

    mockFailWrites = false;
    expect(await storage.getItem(key)).toBe(first);
  });

  it("removes a value with all its pieces", async () => {
    const storage = new SecureTokenStorage();
    await storage.setItem(key, refreshTokenSized());

    await storage.removeItem(key);

    expect(await storage.getItem(key)).toBeNull();
    expect([...mockStore.keys()].filter((k) => k !== "amplify-index")).toEqual(
      [],
    );
  });

  it("clears everything it stored, also after writes at the same time", async () => {
    const storage = new SecureTokenStorage();
    await Promise.all([
      storage.setItem("idToken", refreshTokenSized()),
      storage.setItem("accessToken", "a"),
      storage.setItem(key, refreshTokenSized()),
      storage.setItem("LastAuthUser", "user"),
    ]);

    await storage.clear();

    expect(mockStore.size).toBe(0);
  });

  it("reads what an earlier app launch stored", async () => {
    const token = refreshTokenSized();
    await new SecureTokenStorage().setItem(key, token);

    const later = new SecureTokenStorage();

    expect(await later.getItem(key)).toBe(token);
    await later.clear();
    expect(mockStore.size).toBe(0);
  });
});
