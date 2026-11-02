import type { KeyValueStorageInterface } from "aws-amplify/utils";
import * as SecureStore from "expo-secure-store";

// Some iOS releases refused Keychain values above about 2048 bytes. Cognito
// refresh tokens come close, so every stored value stays well under it.
const MAX_BYTES = 1024;
const INDEX_KEY = "amplify-index";

// Amplify's token storage in the Keychain and Keystore instead of
// AsyncStorage (spec 005, ADR 0006).
//
// - Keys: SecureStore allows letters, digits, ".", "-" and "_". Anything else,
//   and "_" itself, is written as _hh_ so different keys stay different.
// - Long values are split across chunk keys. The key itself holds either the
//   value ("v:...") or which chunks to read ("c:<generation>:<count>"), and
//   is written after the chunks, so a failed write leaves the old value whole.
// - SecureStore can't list its keys, so an index of stored keys lets clear()
//   remove them all.
// - Errors are passed on, never swallowed. Calls run one at a time, since
//   Amplify writes several tokens at once and they share the index.
export class SecureTokenStorage implements KeyValueStorageInterface {
  private queue: Promise<unknown> = Promise.resolve();

  setItem(key: string, value: string): Promise<void> {
    return this.serial(async () => {
      const base = storeKey(key);
      const previous = parseHeader(await SecureStore.getItemAsync(base));

      if (utf8Bytes(value) + 2 <= MAX_BYTES) {
        await SecureStore.setItemAsync(base, `v:${value}`);
      } else {
        const generation = previous?.chunked ? previous.generation + 1 : 1;
        const chunks = splitUtf8(value, MAX_BYTES);
        for (const [i, chunk] of chunks.entries()) {
          await SecureStore.setItemAsync(chunkKey(base, generation, i), chunk);
        }
        await SecureStore.setItemAsync(
          base,
          `c:${generation}:${chunks.length}`,
        );
      }

      if (previous?.chunked) await deleteChunks(base, previous);
      if (!previous) await this.addToIndex(key);
    });
  }

  getItem(key: string): Promise<string | null> {
    return this.serial(async () => {
      const base = storeKey(key);
      const raw = await SecureStore.getItemAsync(base);
      const header = parseHeader(raw);
      if (!header) return null;
      if (!header.chunked) return raw!.slice(2);

      let value = "";
      for (let i = 0; i < header.count; i++) {
        const chunk = await SecureStore.getItemAsync(
          chunkKey(base, header.generation, i),
        );
        if (chunk === null) {
          throw new Error(`Secure storage is missing part ${i} of ${key}`);
        }
        value += chunk;
      }
      return value;
    });
  }

  removeItem(key: string): Promise<void> {
    return this.serial(() => this.remove(key));
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      for (const key of await readIndex()) await this.remove(key);
      await SecureStore.deleteItemAsync(INDEX_KEY);
    });
  }

  private async remove(key: string) {
    const base = storeKey(key);
    const header = parseHeader(await SecureStore.getItemAsync(base));
    await SecureStore.deleteItemAsync(base);
    if (header?.chunked) await deleteChunks(base, header);
    const index = await readIndex();
    if (index.includes(key)) {
      await writeIndex(index.filter((k) => k !== key));
    }
  }

  private async addToIndex(key: string) {
    const index = await readIndex();
    if (!index.includes(key)) await writeIndex([...index, key]);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

type Header =
  { chunked: false } | { chunked: true; generation: number; count: number };

function parseHeader(raw: string | null): Header | null {
  if (raw === null) return null;
  if (raw.startsWith("v:")) return { chunked: false };
  const [, generation, count] = raw.split(":");
  return {
    chunked: true,
    generation: Number(generation),
    count: Number(count),
  };
}

async function deleteChunks(
  base: string,
  { generation, count }: { generation: number; count: number },
) {
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(base, generation, i));
  }
}

// The index holds Amplify's keys as given; it may grow past one value too,
// but stays small: Amplify keeps a handful of keys per user.
async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function writeIndex(keys: string[]) {
  if (keys.length === 0) await SecureStore.deleteItemAsync(INDEX_KEY);
  else await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(keys));
}

// Every stored key starts with "amplify.", so none can be the index. Escapes
// are _hh_ with two hex digits, so "_chunk" can't come out of escaping.
function storeKey(key: string): string {
  const escaped = [...key]
    .map((char) =>
      /[A-Za-z0-9.-]/.test(char)
        ? char
        : [...new TextEncoder().encode(char)]
            .map((byte) => `_${byte.toString(16).padStart(2, "0")}_`)
            .join(""),
    )
    .join("");
  return `amplify.${escaped}`;
}

function chunkKey(base: string, generation: number, index: number) {
  return `${base}_chunk${generation}-${index}`;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// Splits on character boundaries, so no chunk holds half a character
function splitUtf8(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of text) {
    const bytes = utf8Bytes(char);
    if (currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}
